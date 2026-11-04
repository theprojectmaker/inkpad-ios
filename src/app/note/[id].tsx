// Editor, laid out like Notability: back / pages / title on the left, the
// tools in the middle, insert / audio / undo / redo / more on the right; the tool's
// options on a card; an optional page sidebar; the ink canvas; panels beside it.
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CanvasHandle, type CanvasPage, type CanvasState, type LegacyStroke, PAGE_GAP, QuillCanvas } from '@/components/quill-canvas';
import { AudioBar, transcribe, TranscriptPanel, useNoteAudio } from '@/components/audio-bar';
import { FindPanel } from '@/components/find-panel';
import { currentTool, FavBar, ToolButtons, ToolStrip } from '@/components/ink-bar';
import { Markdown } from '@/components/markdown';
import { PaperSheet } from '@/components/paper-sheet';
import { NotePicker, SideNote } from '@/components/side-note';
import { PageSidebar } from '@/components/page-sidebar';
import { StudyPanel } from '@/components/study-panel';
import { HandInSheet } from '@/components/classroom-parts';
import { Desmos } from '@/components/desmos';
import { ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, Sheet, useToast } from '@/components/ui';
import { askStudy } from '@/lib/ai';
import { loadPageText, pageTextToSearch, readPages, snapPages } from '@/lib/handindex';
import { dueLabel, handIn as sendToClassroom, openAssignment } from '@/lib/classroom';
import { ensureGoogle, saveToDrive } from '@/lib/drive';
import { shareImage, sharePdf } from '@/lib/export';
import { fsx } from '@/lib/fsx';
import { unpack } from '@/lib/geom';
import { useLibrary } from '@/lib/library';
import { type NoteDoc, type Page, type PaperColor, type PaperStyle, paperPage, pageSizeOf, type Recording, uid } from '@/lib/model';
import { enhanceImage } from '@/lib/ondevice';
import { imagePages, loadDoc, notePath, renderDir, saveDoc, saveImage } from '@/lib/noteio';
import { canScan, scanEnhanced } from '@/lib/scan';
import { paperMarks, paperOf } from '@/lib/paper';
import { useSettings, useTheme } from '@/lib/settings';

const DRAWING = 'drawing.pkd';
const TEXTS = 'texts.json';
/** Absolute file path for the native side (fsx gives file:// uris). */
const absPath = (path: string) => decodeURIComponent(fsx.uri(path).replace(/^file:\/\//, ''));

function canvasPages(id: string, doc: NoteDoc): CanvasPage[] {
  return doc.pages.map((p) => {
    if (p.bg.kind === 'paper') {
      const marks = paperMarks(p.bg.style, p.bg.color, p.w, p.h).map((m) => ('cx' in m
        ? { x: m.cx, y: m.cy, w: 0, h: 0, r: m.r, color: m.color }
        : { x: m.x, y: m.y, w: m.w, h: m.h, r: 0, color: m.color }));
      return { id: p.id, w: p.w, h: p.h, bg: paperOf(p.bg.color).bg, kind: 'paper', file: '', index: 0, marks };
    }
    return { id: p.id, w: p.w, h: p.h, bg: '#FFFFFF', kind: p.bg.kind, file: absPath(notePath(id, p.bg.file)), index: p.bg.kind === 'pdf' ? p.bg.index : 0, marks: [] };
  });
}

/** Ink from before the PencilKit canvas, moved into canvas coordinates (pages stacked, centred). */
function legacyInk(doc: NoteDoc): LegacyStroke[] {
  const W = Math.max(...doc.pages.map((p) => p.w));
  const out: LegacyStroke[] = [];
  let y = 0;
  for (const p of doc.pages) {
    const x = (W - p.w) / 2;
    for (const s of p.strokes) {
      const pts = unpack(s.pts);
      const flat: number[] = [];
      for (const q of pts) flat.push(q.x + x, q.y + y, Number.isFinite(q.p) ? q.p : 0.5);
      if (flat.length) out.push({ pts: flat, color: s.color, w: s.w, hl: s.kind === 'hl' });
    }
    y += p.h + PAGE_GAP;
  }
  return out;
}

export default function Editor() {
  const { id, handin } = useLocalSearchParams<{ id: string; handin?: string }>();
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const lib = useLibrary();
  const { toast } = useToast();
  const canvas = useRef<CanvasHandle>(null);
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const [legacy, setLegacy] = useState<LegacyStroke[]>([]);
  const [st, setSt] = useState<CanvasState>({ canUndo: false, canRedo: false, strokes: 0 });
  const [renaming, setRenaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ruler, setRuler] = useState(false);
  const { s, set } = useSettings();
  const { width } = useWindowDimensions();
  const tool = useMemo(() => currentTool(s),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [s.inkKind, s.penStyle, s.inkSize, s.textSizeIdx, s.penColor, s.hlColor, s.eraser, s.lassoBox, s.tapeColor, s.tapeSize, s.textFont, s.textBold]);
  const [menu, setMenu] = useState(false);
  const [opts, setOpts] = useState(false);     // the picked pen's options card (tap the pen again)
  const [sidebar, setSidebar] = useState(false);
  const [study, setStudy] = useState(false);
  const [calc, setCalc] = useState(false);       // Desmos beside the page (kept loaded once opened)
  const [calcLoaded, setCalcLoaded] = useState(false);
  const [page, setPage] = useState({ page: 0, count: 1 });
  const [ver, setVer] = useState(0);            // bumps when ink changes (page thumbnails redraw)
  const [delPage, setDelPage] = useState<number | null>(null);
  const [handInPdf, setHandInPdf] = useState<{ path: string; title: string } | null>(null);
  const [insert, setInsert] = useState(false);
  const [audioOpen, setAudioOpen] = useState(false);
  const [transcriptOpen, setTranscriptOpen] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [delRec, setDelRec] = useState<string | null>(null);
  const [find, setFind] = useState(false);
  const [second, setSecond] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [focus, setFocus] = useState(false);
  const [pageMenu, setPageMenu] = useState<number | null>(null);
  const [paperFor, setPaperFor] = useState<number | null>(null);
  const [jump, setJump] = useState(false);
  const [explain, setExplain] = useState<{ busy: boolean; text: string } | null>(null);
  const audio = useNoteAudio(id, toast);
  // Leaving the text tool finishes the text being typed.
  useEffect(() => { if (s.inkKind !== 'text') canvas.current?.endTextEdit(); }, [s.inkKind]);
  const meta = lib.lib.notes.find((n) => n.id === id);

  useEffect(() => {
    let live = true;
    (async () => {
      const d = await loadDoc(id);
      if (!live) return;
      if (!d) { toast("This note couldn't be opened."); router.back(); return; }
      if (!fsx.exists(notePath(id, DRAWING))) setLegacy(legacyInk(d));
      setDoc(d);
      lib.updateNote(id, { opened: Date.now() });
    })();
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const pages = useMemo(() => (doc ? canvasPages(id, doc) : []), [doc, id]);

  // A fresh thumbnail for the library, made when you leave the note (making it
  // while writing drew every page on the main thread and froze the ink).
  const thumbStale = useRef(false);
  const makeThumb = useCallback(async () => {
    const name = `thumb_${Date.now().toString(36)}.jpg`;
    try {
      if (!(await canvas.current?.snapshot(absPath(notePath(id, name)), 360))) return;
      const old = lib.meta(id)?.thumb;
      lib.updateNote(id, { thumb: name, updated: Date.now() });
      // Only drop the old picture once the library points at the new one.
      await lib.flush();
      if (old && old !== name) fsx.remove(notePath(id, old));
    } catch {}
  }, [id, lib]);

  const changed = useRef(false);          // written on since it was opened (or last saved to Drive)
  const pageNow = useRef(0);
  pageNow.current = page.page;
  const dirtyPages = useRef(new Set<number>());   // written on since they were last read for search
  // Re-renders only when undo/redo availability flips: re-drawing this screen
  // after every stroke made the next stroke start late.
  const onChange = useCallback((e: { nativeEvent: CanvasState }) => {
    const n = e.nativeEvent;
    setSt((p) => (p.canUndo === n.canUndo && p.canRedo === n.canRedo ? p : n));
    changed.current = true;
    thumbStale.current = true;
    dirtyPages.current.add(pageNow.current);
    setOpts((o) => (o ? false : o));
  }, []);

  /** The note as a PDF (named after the note), ready to share or upload. */
  const makePdf = async () => {
    try { await canvas.current?.save(); } catch {}
    const title = (meta?.title || 'Note').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Note';
    const path = `inkpad/out/${title}.pdf`;
    await canvas.current?.exportPdf(absPath(path));
    return { path, title };
  };

  const subject = () => lib.lib.folders.find((f) => f.id === meta?.folderId)?.name ?? 'Notes';

  /** Saves (or updates) this note in Google Drive › Quill › subject. */
  const uploadPdf = async (pdf: { path: string; title: string }, quiet = false) => {
    const driveId = await saveToDrive(pdf.path, pdf.title, subject(), lib.meta(id)?.drive?.id, { quiet });
    lib.updateNote(id, { drive: { id: driveId, at: Date.now() } });
    changed.current = false;
  };
  const saveDrive = async (quiet = false) => {
    if (busy) return;
    setBusy(true);
    try {
      await ensureGoogle();
      await uploadPdf(await makePdf());
      if (!quiet) toast(`Saved to Google Drive › Quill › ${subject()}`);
    } catch (e) {
      if (String((e as Error)?.message) !== 'cancelled') toast("Couldn't save to Drive: " + String((e as Error)?.message ?? e));
    } finally { setBusy(false); }
  };

  const leaving = useRef(false);
  const back = async () => {
    if (leaving.current) return;
    leaving.current = true;
    if (audio.rec) await stopRecording();
    try { await canvas.current?.save(); } catch {}
    // Handwriting search: pictures of what changed now, and they're read after the note closes.
    let shots: { pageId: string; path: string }[] = [];
    try {
      if (doc) {
        const have = await loadPageText(id);
        const unread = doc.pages.flatMap((p, i) => (have[p.id] ? [] : [i])).slice(0, 6);
        shots = await snapPages(id, doc, [...new Set([...dirtyPages.current, ...unread])], canvas.current, absPath);
      }
    } catch {}
    if (thumbStale.current || !meta?.thumb) { thumbStale.current = false; await makeThumb(); }
    // Keep Drive up to date: the PDF is made here (it needs the page), the upload finishes in the background.
    let pending: { path: string; title: string } | null = null;
    if (changed.current && (s.driveSync || meta?.drive)) { try { pending = await makePdf(); } catch {} }
    if (router.canGoBack()) router.back(); else router.replace('/');
    if (pending) uploadPdf(pending, true).catch(() => toast("Couldn't update the copy in Google Drive. It'll try again next time."));
    if (shots.length && doc) readPages(id, shots).then((t) => lib.updateNote(id, { hand: pageTextToSearch(t, doc.pages.map((p) => p.id)) })).catch(() => {});
  };

  /** Puts new pages right after page `after` (or at the end); ink below them moves down. */
  const insertPages = async (add: Page[], after?: number) => {
    if (!doc || !add.length) return;
    let at = after == null || after >= doc.pages.length - 1 ? doc.pages.length : after + 1;
    const first = at;
    const list = [...doc.pages];
    // One shift for all of them: each page is its height plus the gap between pages.
    if (at < list.length) await canvas.current?.insertPageSpace(at - 1, add.reduce((h, p) => h + p.h + PAGE_GAP, 0) - PAGE_GAP);
    list.splice(at, 0, ...add);
    at += add.length;
    const next = { ...doc, pages: list };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { pages: next.pages.length, updated: Date.now() });
    setVer((v) => v + 1);
    return first;
  };

  /** Scanned paper or photos as new pages after the one you're on. */
  const addPictures = async (from: 'scan' | 'photos') => {
    try {
      let uris: string[] = [];
      if (from === 'scan') uris = await scanEnhanced();
      else {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, selectionLimit: 20 });
        if (!r.canceled) uris = r.assets.map((x) => x.uri);
      }
      if (!uris.length) return;
      const first = await insertPages(await imagePages(id, uris), page.page);
      toast(uris.length === 1 ? `Page ${(first ?? 0) + 1} added` : `${uris.length} pages added`);
      if (first != null) setTimeout(() => canvas.current?.scrollToPage(first), 400);
    } catch (e) { toast("Couldn't add that: " + String((e as Error)?.message ?? e)); }
  };

  /** A blank page like the one it follows, added at the end or right after page `after`. */
  const addPage = async (after?: number) => {
    if (!doc) return;
    const last = doc.pages[after ?? doc.pages.length - 1];
    const size = last && last.bg.kind === 'paper' ? { w: last.w, h: last.h } : pageSizeOf(doc.paper.size);
    const style = last?.bg.kind === 'paper' ? last.bg.style : doc.paper.style;
    const color = last?.bg.kind === 'paper' ? last.bg.color : doc.paper.color;
    const p: Page = paperPage(style, color, { w: size.w, h: size.h });
    const at = after == null || after >= doc.pages.length - 1 ? doc.pages.length : after + 1;
    if (at < doc.pages.length) await canvas.current?.insertPageSpace(at - 1, p.h);
    const next = { ...doc, pages: [...doc.pages.slice(0, at), p, ...doc.pages.slice(at)] };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { pages: next.pages.length, updated: Date.now() });
    setVer((v) => v + 1);
    toast(at === next.pages.length - 1 ? `Page ${at + 1} added at the end` : `New page ${at + 1} inserted`);
  };

  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const title = (meta?.title || 'Note').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Note';
      const path = `inkpad/out/${title}.pdf`;
      await canvas.current?.exportPdf(absPath(path));
      await sharePdf(path, title);
    } catch (e) {
      toast("Couldn't make the PDF: " + String((e as Error)?.message ?? e));
    } finally { setBusy(false); }
  };

  /** The note as a PDF, into the share sheet: pick Classroom, the assignment, Turn in. */
  const handIn = async () => {
    if (busy || !meta?.hw) return;
    setBusy(true);
    try {
      try { await canvas.current?.save(); } catch {}
      const title = meta.hw.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Homework';
      const path = `inkpad/out/${title}.pdf`;
      await canvas.current?.exportPdf(absPath(path));
      setHandInPdf({ path, title });
    } catch (e) {
      toast("Couldn't hand in: " + String((e as Error)?.message ?? e));
    } finally { setBusy(false); }
  };
  // Came from the assignment page's "Hand in": start once the page has loaded.
  const autoHandIn = useRef(false);
  useEffect(() => {
    if (handin === '1' && doc && meta?.hw && !autoHandIn.current) { autoHandIn.current = true; const tm = setTimeout(handIn, 900); return () => clearTimeout(tm); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handin, doc, meta?.hw]);

  /** Quality enhancer: a photo or scan page gets even white paper, crisp writing and less grain. */
  const enhancePage = async (i: number, mode: 'color' | 'document' = 'color') => {
    const p = doc?.pages[i];
    if (!doc || !p || p.bg.kind !== 'image' || busy) return;
    setBusy(true);
    try {
      const old = p.bg.file, name = `img_${uid()}.jpg`;
      await enhanceImage(fsx.uri(notePath(id, old)), fsx.uri(notePath(id, name)), mode);
      const next = { ...doc, pages: doc.pages.map((q, k) => (k === i ? { ...q, bg: { kind: 'image' as const, file: name } } : q)) };
      setDoc(next);
      await saveDoc(next);
      lib.updateNote(id, { updated: Date.now() });
      setVer((v) => v + 1);
      if (!next.pages.some((q) => q.bg.kind === 'image' && q.bg.file === old)) fsx.remove(notePath(id, old));
      toast(mode === 'document' ? `Page ${i + 1} is now a clean black & white document` : `Page ${i + 1} cleaned up`);
    } catch (e) { toast("Couldn't improve that page: " + String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const removePage = async (i: number) => {
    if (!doc || doc.pages.length < 2) return;
    await canvas.current?.deletePage(i);
    const next = { ...doc, pages: doc.pages.filter((_, k) => k !== i) };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { pages: next.pages.length, updated: Date.now() });
    setVer((v) => v + 1);
    toast(`Page ${i + 1} deleted`);
  };

  // ----- audio -----
  const recordings = doc?.recordings ?? [];
  const startRecording = async () => { if (await audio.start()) { setAudioOpen(true); audio.unload(); } };
  const stopRecording = async () => {
    const r = await audio.stop();
    if (!r || !doc) return;
    const next = { ...doc, recordings: [...(doc.recordings ?? []), r] };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { audio: next.recordings!.length });
    audio.load(r);
  };
  const setRecordings = async (list: Recording[]) => {
    if (!doc) return;
    const next = { ...doc, recordings: list };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { audio: list.length, said: list.flatMap((r) => (r.transcript ?? []).map((l) => l.text)).join(' ').slice(0, 12000) });
  };
  const deleteRecording = async (rid: string) => {
    const r = recordings.find((x) => x.id === rid);
    if (audio.loaded?.id === rid) audio.unload();
    await setRecordings(recordings.filter((x) => x.id !== rid));
    if (r) fsx.remove(notePath(id, r.file));
  };
  const makeTranscript = async () => {
    const r = audio.loaded;
    if (!r || transcribing) return;
    setTranscribing(true);
    try {
      const lines = await transcribe(id, r);
      await setRecordings(recordings.map((x) => (x.id === r.id ? { ...x, transcript: lines } : x)));
      audio.load({ ...r, transcript: lines });
    } catch (e) { toast(String((e as Error)?.message ?? e)); }
    finally { setTranscribing(false); }
  };
  const hear = (r: Recording, seconds: number) => {
    setAudioOpen(true);
    audio.load(r);
    // A moment before, so the start of the sentence isn't lost.
    setTimeout(() => { audio.seek(Math.max(0, seconds * 1000 - 1500)); audio.play(); }, 180);
  };
  // Note Replay: ink written later in the recording shows faintly until it's reached.
  const cur = audio.loaded;
  const position = cur ? audio.status.currentTime : 0;
  const replaying = !!cur && audioOpen && !audio.rec && (audio.status.playing || position > 0.1);
  useEffect(() => {
    if (replaying && cur) canvas.current?.setReplay(cur.created / 1000 + position, cur.created / 1000, (cur.created + cur.dur) / 1000);
    else canvas.current?.setReplay(-1, 0, 0);
  }, [replaying, cur, position]);

  // ----- pages -----
  const savePages = async (pages: Page[]) => {
    if (!doc) return;
    const next = { ...doc, pages };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { pages: pages.length, updated: Date.now() });
    setVer((v) => v + 1);
  };
  const movePage = async (i: number, to: number) => {
    if (!doc || to < 0 || to >= doc.pages.length) return;
    await canvas.current?.movePage(i, to);
    const list = [...doc.pages];
    const [p] = list.splice(i, 1);
    list.splice(to, 0, p);
    await savePages(list);
    toast(`Now page ${to + 1}`);
  };
  const duplicatePage = async (i: number) => {
    if (!doc) return;
    await canvas.current?.duplicatePage(i);
    const list = [...doc.pages];
    list.splice(i + 1, 0, { ...doc.pages[i], id: uid('p') });
    await savePages(list);
    toast(`Page ${i + 2} is a copy of page ${i + 1}`);
  };
  const shareCurrentPage = async (i: number) => {
    try {
      const path = `${renderDir(id)}/page_${i + 1}.jpg`;
      if (!(await canvas.current?.pageThumb(i, absPath(path), 1224))) throw new Error('no picture');
      await shareImage(path);
    } catch (e) { toast("Couldn't share that page: " + String((e as Error)?.message ?? e)); }
  };

  // ----- things placed on the page -----
  const placePhoto = async (from: 'library' | 'camera') => {
    try {
      let uri = '';
      if (from === 'camera') {
        const p = await ImagePicker.requestCameraPermissionsAsync();
        if (!p.granted) { toast('Allow the camera for Quill in Settings.'); return; }
        const r = await ImagePicker.launchCameraAsync({ quality: 0.9 });
        if (!r.canceled) uri = r.assets[0]?.uri ?? '';
      } else {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
        if (!r.canceled) uri = r.assets[0]?.uri ?? '';
      }
      if (!uri) return;
      const im = await saveImage(id, uri);
      set({ inkKind: 'lasso', lastTool: s.inkKind });
      await canvas.current?.addPicture(im.file, im.w, im.h);
    } catch (e) { toast("Couldn't add that photo: " + String((e as Error)?.message ?? e)); }
  };
  const paste = async () => {
    set({ inkKind: 'lasso', lastTool: s.inkKind === 'lasso' ? s.lastTool : s.inkKind });
    setOpts(false);
    await canvas.current?.paste();
  };
  const onSelectionAction = async (e: { nativeEvent: { action: string; path?: string; text?: string } }) => {
    const { action, path, text } = e.nativeEvent;
    if (action === 'message' && text) toast(text);
    else if (action === 'share' && path) Sharing.shareAsync('file://' + path, { mimeType: 'image/jpeg', UTI: 'public.jpeg' }).catch(() => {});
    else if (action === 'explain' && path) {
      setExplain({ busy: true, text: '' });
      try {
        const r = await askStudy('explain', ['file://' + path]);
        setExplain({ busy: false, text: r.text ?? 'No answer came back.' });
      } catch (err) { setExplain({ busy: false, text: String((err as Error)?.message ?? err) }); }
    }
  };
  // The Apple Pencil's double-tap does what's set for it in the iPad's Settings.
  const onPencilTap = (e: { nativeEvent: { action: string } }) => {
    const kind = s.inkKind ?? 'pen';
    const a = e.nativeEvent.action;
    if (a === 'eraser') {
      if (kind === 'eraser') set({ inkKind: s.lastTool && s.lastTool !== 'eraser' ? s.lastTool : 'pen', lastTool: 'eraser' });
      else set({ inkKind: 'eraser', lastTool: kind });
    } else if (a === 'previous') set({ inkKind: s.lastTool && s.lastTool !== kind ? s.lastTool : kind === 'pen' ? 'eraser' : 'pen', lastTool: kind });
    else if (a === 'options') setOpts((v) => !v);
  };
  const closePanels = () => { setCalc(false); setStudy(false); setFind(false); setTranscriptOpen(false); };
  const onLast = doc ? page.page >= doc.pages.length - 1 : false;
  const paperPageNow = paperFor != null ? doc?.pages[paperFor] : null;

  const narrow = width < 1000;   // labels hide, so the three parts of the bar never touch
  const subjectName = lib.lib.folders.find((f) => f.id === meta?.folderId)?.name;
  return (
    <View style={{ flex: 1, backgroundColor: t.bar, paddingTop: ins.top }}>
      <Stack.Screen options={{ gestureEnabled: false }} />
      {/* Three parts that never overlap: you and the note on the left, the pens in
          the middle, page actions on the right. */}
      {focus ? null : <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 8 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', minWidth: 0 }}>
          <IconButton name="chevron.left" label="Back to notes" onPress={back} />
          <IconButton name="sidebar.left" label={sidebar ? 'Hide pages' : 'Show pages'} active={sidebar} onPress={() => { setVer((v) => v + 1); setSidebar((v) => !v); }} />
          <Pressable onPress={() => setRenaming(true)} style={{ flexShrink: 1, minWidth: 0, paddingHorizontal: 6, height: 44, justifyContent: 'center' }} accessibilityLabel="Rename note">
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{meta?.title ?? 'Note'}</Text>
            {!narrow ? (
              <Text numberOfLines={1} style={{ color: t.faint, fontSize: 12, marginTop: 1 }}>
                {[subjectName, doc ? `${doc.pages.length} page${doc.pages.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · ')}
              </Text>
            ) : null}
          </Pressable>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 14, paddingHorizontal: 4, height: 44 }}>
          <ToolButtons onOptions={() => setOpts((v) => !v)} />
        </View>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center' }}>
            <IconButton name="plus.circle" label="Insert" onPress={() => setInsert(true)} />
            <IconButton name={audio.rec ? 'waveform' : 'mic'} label="Audio" active={audioOpen || !!audio.rec} color={audio.rec ? '#E5322D' : undefined} onPress={() => setAudioOpen((v) => !v || !!audio.rec)} />
            <IconButton name="arrow.uturn.backward" label="Undo" disabled={!st.canUndo} onPress={() => canvas.current?.undo()} />
            <IconButton name="arrow.uturn.forward" label="Redo" disabled={!st.canRedo} onPress={() => canvas.current?.redo()} />
          </View>
          {calc || study ? <IconButton name="xmark" label={calc ? 'Close calculator' : 'Close Study'} onPress={() => { setCalc(false); setStudy(false); }} /> : null}
          <IconButton name="ellipsis.circle" label="More" onPress={() => setMenu(true)} />
        </View>
      </View>}
      {meta?.hw && !focus ? (
        // Homework: which assignment this is for, and Hand in, out of the way of the tools.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 16, paddingRight: 8, height: 40, backgroundColor: t.dark ? '#13281B' : '#EAF6EE', borderBottomWidth: 1, borderBottomColor: t.line }}>
          <Icon name="graduationcap" size={15} color="#1E8E3E" />
          <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 14 }}>
            <Text style={{ fontWeight: '700' }}>{meta.hw.course}</Text>
            <Text style={{ color: t.sub }}>{'  ·  '}{meta.hw.title}{meta.hw.due ? `  ·  ${dueLabel(meta.hw.due)}` : ''}</Text>
          </Text>
          <Pressable onPress={() => openAssignment(meta.hw!)} style={{ height: 30, paddingHorizontal: 12, borderRadius: 15, justifyContent: 'center' }}>
            <Text style={{ color: t.sub, fontSize: 13.5, fontWeight: '600' }}>Assignment</Text>
          </Pressable>
          <Pressable onPress={handIn} accessibilityLabel="Hand in to Classroom" style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 30, paddingHorizontal: 14, borderRadius: 15, backgroundColor: '#1E8E3E' }}>
            <Icon name="paperplane.fill" size={13} color="#fff" />
            <Text style={{ color: '#fff', fontSize: 13.5, fontWeight: '700' }}>Hand in</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {sidebar && doc ? (
          <PageSidebar noteId={id} pages={doc.pages} current={page.page} ver={ver} canvas={canvas} absPath={absPath}
            onJump={(i) => canvas.current?.scrollToPage(i)} onMenu={setPageMenu} onAdd={() => addPage()} />
        ) : null}
        <View style={{ flex: 1 }}>
          {doc ? (
            <QuillCanvas ref={canvas} style={{ flex: 1 }} pages={pages} tool={tool} fingerDraws={!!s.fingerDraws} inkStats={!!s.inkStats} shapeSnap={s.holdToShape !== false} ruler={ruler}
              onPencilTap={onPencilTap} onSelectionAction={onSelectionAction}
              inkTaps={audioOpen && !audio.rec && recordings.length > 0}
              onInkTapped={(e) => { const ms = e.nativeEvent.ts * 1000; const r = recordings.find((x) => ms >= x.created && ms <= x.created + x.dur); if (r) hear(r, (ms - r.created) / 1000); }}
              drawingPath={absPath(notePath(id, DRAWING))} textsPath={absPath(notePath(id, TEXTS))} legacy={legacy}
              onDrawingChange={onChange} onPageChange={(e) => setPage(e.nativeEvent)} />
          ) : <View style={{ flex: 1, backgroundColor: '#ECECEE' }} />}
          <FavBar />
          {focus ? (
            <View style={{ position: 'absolute', top: 10, right: 12, flexDirection: 'row', backgroundColor: t.elev, borderRadius: 20, paddingHorizontal: 4 }}>
              <IconButton name="arrow.uturn.backward" label="Undo" disabled={!st.canUndo} onPress={() => canvas.current?.undo()} />
              <IconButton name="arrow.down.right.and.arrow.up.left" label="Leave focus mode" onPress={() => setFocus(false)} />
            </View>
          ) : null}
          {!audioOpen ? (
            <View pointerEvents="box-none" style={{ position: 'absolute', right: 14, bottom: 14, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              {onLast ? (
                <Pressable accessibilityLabel="New page" onPress={() => addPage()} style={{ height: 28, paddingHorizontal: 12, borderRadius: 14, justifyContent: 'center', backgroundColor: 'rgba(20,22,28,0.72)' }}>
                  <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>+ New page</Text>
                </Pressable>
              ) : null}
              {page.count > 1 ? (
                <Pressable accessibilityLabel="Go to page" onPress={() => setJump(true)} style={{ backgroundColor: 'rgba(20,22,28,0.72)', borderRadius: 14, paddingHorizontal: 10, height: 28, justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>{page.page + 1} / {page.count}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {audioOpen ? (
            <AudioBar audio={audio} noteId={id} recs={recordings} onStartRec={startRecording} onStopRec={stopRecording} onDelete={setDelRec}
              onTranscript={() => { closePanels(); setTranscriptOpen(true); }} onClose={() => { audio.unload(); setAudioOpen(false); setTranscriptOpen(false); }} />
          ) : null}
        </View>
        {second ? <View style={{ flex: 1 }}><SideNote noteId={second} tool={tool} fingerDraws={!!s.fingerDraws} onSwap={() => setPicking(true)} onClose={() => setSecond(null)} /></View> : null}
        {find && doc ? (
          <FindPanel noteId={id} doc={doc} canvas={canvas} absPath={absPath} stale={() => { const d = [...dirtyPages.current]; dirtyPages.current.clear(); return d; }} onRead={() => {}}
            onHear={(r, sec) => hear(r, sec)} onClose={() => setFind(false)} />
        ) : null}
        {transcriptOpen && cur ? (
          <TranscriptPanel rec={recordings.find((x) => x.id === cur.id) ?? cur} busy={transcribing} pos={position * 1000} onMake={makeTranscript} onSeek={(ms) => { audio.seek(ms); audio.play(); }} onClose={() => setTranscriptOpen(false)} />
        ) : null}
        {calcLoaded ? (
          <View style={{ width: calc ? Math.min(460, width * 0.42) : 0, overflow: 'hidden', borderLeftWidth: calc ? 1 : 0, borderLeftColor: t.line }}>
            <Desmos compact onClose={() => setCalc(false)} />
          </View>
        ) : null}
        {study && doc ? <StudyPanel noteId={id} page={page.page} pageCount={doc.pages.length} canvas={canvas} absPath={absPath} onClose={() => setStudy(false)} /> : null}
      </View>

      {opts ? (
        <>
          <Pressable accessibilityLabel="Close pen options" onPress={() => setOpts(false)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0, top: ins.top + 56 }} />
          <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: ins.top + 52, alignItems: 'center', paddingHorizontal: 12 }}>
            <ToolStrip floating onPaste={paste} onTape={(w) => { setOpts(false); if (w === 'clear') canvas.current?.clearTape(); else canvas.current?.setAllTape(w === 'show'); }} />
          </View>
        </>
      ) : null}
      <MenuSheet visible={menu} onClose={() => setMenu(false)} title={meta?.title} items={[
        { label: 'Find in this note', icon: 'magnifyingglass', checked: find, onPress: () => { const was = find; closePanels(); setFind(!was); } },
        { label: second ? 'Second note' : 'Open another note beside', icon: 'rectangle.split.2x1', checked: !!second, onPress: () => { if (second) setSecond(null); else setPicking(true); } },
        { label: 'Focus mode', icon: 'arrow.up.left.and.arrow.down.right', onPress: () => setFocus(true) },
        { label: 'Change this page\'s paper', icon: 'doc.plaintext', onPress: () => { if (doc?.pages[page.page]?.bg.kind === 'paper') setPaperFor(page.page); else toast('This page is a PDF or photo, so it keeps its own background.'); } },
        ...(doc?.pages[page.page]?.bg.kind === 'image' ? [
          { label: 'Fix page quality (keep colours)', icon: 'wand.and.stars', onPress: () => enhancePage(page.page, 'color') },
          { label: 'Make it a clean B&W document', icon: 'doc.text.viewfinder', onPress: () => enhancePage(page.page, 'document') },
        ] : []),
        ...(meta?.hw ? [
          { label: 'Hand in to Classroom', icon: 'paperplane', onPress: handIn },
          { label: 'Open the assignment', icon: 'graduationcap', onPress: () => openAssignment(meta.hw!) },
        ] : []),
        { label: 'Share as PDF', icon: 'square.and.arrow.up', onPress: share },
        { label: 'Share this page as a picture', icon: 'photo', onPress: () => shareCurrentPage(page.page) },
        { label: meta?.drive ? 'Update in Google Drive' : 'Save to Google Drive', icon: 'icloud.and.arrow.up', onPress: () => saveDrive() },
        { label: 'Calculator', icon: 'function', checked: calc, onPress: () => { const was = calc; closePanels(); setCalcLoaded(true); setCalc(!was); } },
        { label: 'Study with AI', icon: 'sparkles', checked: study, onPress: () => { const was = study; closePanels(); setStudy(!was); } },
        { label: 'Ruler', icon: 'ruler', checked: ruler, onPress: () => setRuler((v) => !v) },
        { label: 'Rename', icon: 'pencil', onPress: () => setRenaming(true) },
      ]} />
      <MenuSheet visible={insert} onClose={() => setInsert(false)} title="Insert" items={[
        { label: 'Photo on this page', icon: 'photo', onPress: () => placePhoto('library') },
        { label: 'Take a photo', icon: 'camera', onPress: () => placePhoto('camera') },
        { label: 'Paste', icon: 'doc.on.clipboard', onPress: paste },
        { label: 'Blank page after this one', icon: 'doc.badge.plus', onPress: () => addPage(page.page) },
        ...(canScan() ? [{ label: 'Scan paper as new pages', icon: 'doc.viewfinder', onPress: () => addPictures('scan') }] : []),
        { label: 'Photos as new pages', icon: 'photo.on.rectangle', onPress: () => addPictures('photos') },
      ]} />
      <MenuSheet visible={pageMenu != null} onClose={() => setPageMenu(null)} title={`Page ${(pageMenu ?? 0) + 1}`} items={pageMenu == null || !doc ? [] : (() => { const i = pageMenu; const p = doc.pages[i]; return [
        { label: p?.mark ? 'Remove bookmark' : 'Bookmark', icon: p?.mark ? 'bookmark.slash' : 'bookmark', onPress: () => savePages(doc.pages.map((q, k) => { if (k !== i) return q; const { mark: _m, ...rest } = q; return p?.mark ? rest : { ...rest, mark: 1 as const }; })) },
        ...(i > 0 ? [{ label: 'Move up', icon: 'arrow.up', onPress: () => movePage(i, i - 1) }] : []),
        ...(i < doc.pages.length - 1 ? [{ label: 'Move down', icon: 'arrow.down', onPress: () => movePage(i, i + 1) }] : []),
        { label: 'Duplicate', icon: 'plus.square.on.square', onPress: () => duplicatePage(i) },
        { label: 'Add a page after', icon: 'doc.badge.plus', onPress: () => addPage(i) },
        ...(p?.bg.kind === 'paper' ? [{ label: 'Change paper', icon: 'doc.plaintext', onPress: () => setPaperFor(i) }] : []),
        { label: 'Share as a picture', icon: 'square.and.arrow.up', onPress: () => shareCurrentPage(i) },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => { if (doc.pages.length > 1) setDelPage(i); else toast('A note needs at least one page.'); } },
      ]; })()} />
      <PaperSheet visible={paperFor != null} title="Paper for this page" confirm="Use this paper"
        style={paperPageNow?.bg.kind === 'paper' ? paperPageNow.bg.style : undefined} color={paperPageNow?.bg.kind === 'paper' ? paperPageNow.bg.color : undefined}
        onClose={() => setPaperFor(null)}
        onDone={(style: PaperStyle, color: PaperColor) => { const i = paperFor; setPaperFor(null); if (doc && i != null) savePages(doc.pages.map((q, k) => (k === i ? { ...q, bg: { kind: 'paper' as const, style, color } } : q))); }} />
      <NotePicker visible={picking} exclude={id} onClose={() => setPicking(false)} onPick={(n) => { setPicking(false); setSecond(n.id); }} />
      <PromptSheet visible={jump} title="Go to page" initial={String(page.page + 1)} confirm="Go" onCancel={() => setJump(false)}
        onSubmit={(v) => { setJump(false); const n = parseInt(v, 10); if (n >= 1 && n <= page.count) canvas.current?.scrollToPage(n - 1); }} />
      <ConfirmSheet visible={delRec != null} title="Delete this recording?" message="Your writing stays. The audio and its transcript are removed." onCancel={() => setDelRec(null)}
        onConfirm={() => { const r = delRec; setDelRec(null); if (r) deleteRecording(r); }} />
      <Sheet visible={!!explain} onClose={() => setExplain(null)} title="Explain" width={520}>
        {explain?.busy ? <View style={{ padding: 30, alignItems: 'center' }}><ActivityIndicator color={t.accent} /></View> : <Markdown text={explain?.text ?? ''} />}
      </Sheet>
      <HandInSheet pdf={handInPdf} onClose={() => setHandInPdf(null)}
        onDrive={async () => { if (!handInPdf) return false; try { await ensureGoogle(); await uploadPdf(handInPdf); return true; } catch { return false; } }}
        onSave={() => handInPdf && sendToClassroom(handInPdf.path, handInPdf.title).catch((e) => toast(String(e?.message ?? e)))}
        onOpen={() => meta?.hw && openAssignment(meta.hw)} />
      <ConfirmSheet visible={delPage != null} title={`Delete page ${(delPage ?? 0) + 1}?`} message="Its writing is deleted too." onCancel={() => setDelPage(null)}
        onConfirm={() => { const i = delPage; setDelPage(null); if (i != null) removePage(i); }} />
      <PromptSheet visible={renaming} title="Rename note" initial={meta?.title ?? ''} onCancel={() => setRenaming(false)}
        onSubmit={(v) => { if (v.trim()) lib.updateNote(id, { title: v.trim() }); setRenaming(false); }} />
    </View>
  );
}
