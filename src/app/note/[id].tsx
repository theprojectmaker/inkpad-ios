// Editor, laid out like the recordings of Notability: the page fills the screen and everything floats over it. Back on the left, the
// tools in the middle, insert / audio / undo / redo / more on the right; the tool's
// options on a card; an optional page sidebar; the ink canvas; panels beside it.
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CanvasHandle, type CanvasPage, type CanvasState, type LegacyStroke, PAGE_GAP, QuillCanvas } from '@/components/quill-canvas';
import { AudioBar, ClassPanel, transcribe, useNoteAudio } from '@/components/audio-bar';
import { CommentSheet, firstLine } from '@/components/comment-sheet';
import { NoteTabs } from '@/components/note-tabs';
import { ShareLinkSheet } from '@/components/share-link';
import { graphLines } from '@/lib/graph';
import { ToolIcon } from '@/components/tool-icons';
import { openTab, useTabs } from '@/lib/tabs';
import { summarize, useLiveNotes } from '@/lib/livenotes';
import { FindPanel } from '@/components/find-panel';
import { currentTool, NoteToolbar, StylePopover } from '@/components/note-toolbar';
import { Markdown } from '@/components/markdown';
import { PaperSheet } from '@/components/paper-sheet';
import { NotePicker, SideNote } from '@/components/side-note';
import { PageSidebar } from '@/components/page-sidebar';
import { StudyPanel } from '@/components/study-panel';
import { HandInSheet } from '@/components/classroom-parts';
import { Desmos } from '@/components/desmos';
import { ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, Sheet, useToast } from '@/components/ui';
import { askStudy } from '@/lib/ai';
import { copyText, readText } from '@/lib/ondevice';
import { loadPageText, pageTextToSearch, readPages, snapPages } from '@/lib/handindex';
import { dueLabel, handIn as sendToClassroom, openAssignment } from '@/lib/classroom';
import { ensureGoogle, saveToDrive } from '@/lib/drive';
import { shareImage, sharePdf } from '@/lib/export';
import { fsx } from '@/lib/fsx';
import { unpack } from '@/lib/geom';
import { useLibrary } from '@/lib/library';
import { type NoteDoc, type Page, type PaperColor, type PaperStyle, paperPage, pageSizeOf, type Recording, uid } from '@/lib/model';
import { enhanceImage } from '@/lib/ondevice';
import { imagePages, listVersions, loadDoc, notePath, renderDir, restoreVersion, saveDoc, saveImage, saveVersion, scanPages } from '@/lib/noteio';
import { canScan, scanEnhanced } from '@/lib/scan';
import { paperMarks, paperOf } from '@/lib/paper';
import { useSettings, useTheme } from '@/lib/settings';

const DRAWING = 'drawing.pkd';
const TEXTS = 'texts.json';
/** Absolute file path for the native side (fsx gives file:// uris). */
const absPath = (path: string) => decodeURIComponent(fsx.uri(path).replace(/^file:\/\//, ''));

function TopBtn({ icon, label, onPress, active, disabled }: { icon: string; label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} disabled={disabled} hitSlop={3}
      style={({ pressed }) => ({ width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.3 : 1, backgroundColor: active ? '#E9EEFD' : pressed ? '#F0F1F4' : 'transparent' })}>
      <ToolIcon name={icon} size={19} color={active ? '#3F6AF2' : '#3B4252'} />
    </Pressable>
  );
}

/** Text cut to fit pages of typed notes. */
function pageChunks(text: string, perPage = 44, perLine = 86): string[] {
  const out: string[] = [];
  let cur: string[] = [], used = 0;
  for (const line of text.split('\n')) {
    const need = Math.max(1, Math.ceil(line.length / perLine));
    if (used + need > perPage && cur.length) { out.push(cur.join('\n')); cur = []; used = 0; }
    cur.push(line);
    used += need;
  }
  if (cur.length) out.push(cur.join('\n'));
  return out;
}

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
  const { id, handin, record } = useLocalSearchParams<{ id: string; handin?: string; record?: string }>();
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const lib = useLibrary();
  const { toast, busy: tbusy } = useToast();
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
    [s.inkKind, s.tk, s.eraser, s.lassoBox, s.textFont, s.textBold, s.textItalic, s.textUnderline, s.nibAngle, s.nibSteady, s.measureMode]);
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
  const [selStyle, setSelStyle] = useState<{ color: string; width: number } | null>(null);
  const [comment, setComment] = useState<{ id: string; text: string } | null>(null);
  const [shareOpen, setShareOpen] = useState(false);
  const [commentsList, setCommentsList] = useState<{ id: string; text: string; page: number }[] | null>(null);
  const [zoomWin, setZoomWin] = useState(false);
  const [convert, setConvert] = useState<{ kind: string; busy: boolean; text: string } | null>(null);
  const [calibrate, setCalibrate] = useState<null | { need: boolean; length?: number }>(null);
  const [calValue, setCalValue] = useState('');
  const [calUnit, setCalUnit] = useState('Feet');
  const [versions, setVersions] = useState(false);
  const [viewMenu, setViewMenu] = useState(false);
  const [canvasKey, setCanvasKey] = useState(0);
  const [exportMenu, setExportMenu] = useState(false);
  const audio = useNoteAudio(id, toast);
  const [notesMode, setNotesMode] = useState(false);
  const tabs = useTabs();
  const [tabsOpen, setTabsOpen] = useState(false);
  useEffect(() => { openTab(id); }, [id]);
  const pageOf = useCallback(() => pageNow.current, []);
  const live = useLiveNotes(notesMode && !!audio.rec, id, canvas, pageOf, absPath);
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
  const back = () => leave();
  const leave = async (to?: string) => {
    if (leaving.current) return;
    leaving.current = true;
    if (audio.rec) await stopRecording();
    try { await canvas.current?.save(); } catch {}
    if (changed.current) saveVersion(id).catch(() => {});
    // Handwriting search: pictures of what changed now, and they're read after the note closes.
    let shots: { pageId: string; path: string }[] = [];
    try {
      if (doc) {
        const have = await loadPageText(id);
        const unread = doc.pages.flatMap((p, i) => (have[p.id] || p.bg.kind !== 'image' ? [] : [i])).slice(0, 6);
        shots = await snapPages(id, doc, [...new Set([...dirtyPages.current, ...unread])], canvas.current, absPath);
      }
    } catch {}
    if (thumbStale.current || !meta?.thumb) { thumbStale.current = false; await makeThumb(); }
    // Keep Drive up to date: the PDF is made here (it needs the page), the upload finishes in the background.
    let pending: { path: string; title: string } | null = null;
    if (changed.current && (s.driveSync || meta?.drive)) { try { pending = await makePdf(); } catch {} }
    if (to) router.replace(`/note/${to}`);
    else if (router.canGoBack()) router.back(); else router.replace('/');
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
      let add: Page[] = [];
      if (from === 'scan') {
        const scans = await scanEnhanced((m) => tbusy(m || null));
        tbusy(scans.length ? 'Adding your pages…' : null);
        add = await scanPages(id, scans);
      } else {
        const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, selectionLimit: 20 });
        if (!r.canceled) add = await imagePages(id, r.assets.map((x) => x.uri));
      }
      tbusy(null);
      if (!add.length || !doc) return;
      // The first one goes on the page you're on if nothing's on it, otherwise on the next
      // page if that's empty; only then does it take a new page.
      let target = -1;
      for (const i of [page.page, page.page + 1]) {
        const q = doc.pages[i];
        if (q?.bg.kind === 'paper' && (await canvas.current?.pageIsEmpty(i))) { target = i; break; }
      }
      let first: number | undefined;
      if (target >= 0) {
        const old = doc.pages[target];
        const delta = add[0].h - old.h;
        if (delta) await canvas.current?.resizePage(target, delta);
        // Pages after the filled one go in right behind it.
        const rest = add.slice(1);
        const restH = rest.reduce((h, p) => h + p.h + PAGE_GAP, 0);
        if (rest.length && target < doc.pages.length - 1) await canvas.current?.insertPageSpace(target, restH - PAGE_GAP);
        const pages = [...doc.pages];
        pages.splice(target, 1, { ...add[0], id: old.id + 's' }, ...rest);
        const next = { ...doc, pages };
        setDoc(next);
        await saveDoc(next);
        lib.updateNote(id, { pages: pages.length, updated: Date.now() });
        setVer((v) => v + 1);
        first = target;
      } else {
        first = await insertPages(add, page.page);
      }
      toast(add.length === 1 ? `On page ${(first ?? 0) + 1}` : `${add.length} pages added`);
      if (first != null) { const f = first; setTimeout(() => canvas.current?.scrollToPage(f), 400); }
    } catch (e) { tbusy(null); toast("Couldn't add that: " + String((e as Error)?.message ?? e)); }
  };

  /** A blank page like the one it follows, added at the end or right after page `after`. */
  const addPage = async (after?: number, quiet = false) => {
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
    if (!quiet) toast(at === next.pages.length - 1 ? `Page ${at + 1} added at the end` : `New page ${at + 1} inserted`);
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
    tbusy('Cleaning up this page…');
    try {
      // Always works from the original photo, so cleaning up twice never makes it worse.
      const old = p.bg.file, source = p.bg.orig ?? old, name = `img_${uid()}.jpg`;
      await enhanceImage(fsx.uri(notePath(id, source)), fsx.uri(notePath(id, name)), mode);
      const next = { ...doc, pages: doc.pages.map((q, k) => (k === i ? { ...q, bg: { kind: 'image' as const, file: name, orig: source } } : q)) };
      setDoc(next);
      await saveDoc(next);
      lib.updateNote(id, { updated: Date.now() });
      setVer((v) => v + 1);
      if (old !== source && !next.pages.some((q) => q.bg.kind === 'image' && (q.bg.file === old || q.bg.orig === old))) fsx.remove(notePath(id, old));
      toast(mode === 'document' ? `Page ${i + 1} is now black and white` : `Page ${i + 1} cleaned up`);
    } catch (e) { toast("Couldn't improve that page: " + String((e as Error)?.message ?? e)); }
    finally { tbusy(null); setBusy(false); }
  };

  /** Puts a cleaned-up page back to the photo it came from. */
  const restorePhoto = async (i: number) => {
    const p = doc?.pages[i];
    if (!doc || !p || p.bg.kind !== 'image' || !p.bg.orig) return;
    const old = p.bg.file, file = p.bg.orig;
    const next = { ...doc, pages: doc.pages.map((q, k) => (k === i ? { ...q, bg: { kind: 'image' as const, file } } : q)) };
    setDoc(next);
    await saveDoc(next);
    setVer((v) => v + 1);
    if (!next.pages.some((q) => q.bg.kind === 'image' && (q.bg.file === old || q.bg.orig === old))) fsx.remove(notePath(id, old));
    toast(`Page ${i + 1} is back to the original`);
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
  const startRecording = async (toNotes = false) => {
    setNotesMode(toNotes);
    live.reset();
    if (await audio.start()) {
      setAudioOpen(true);
      audio.unload();
      if (toNotes) { closePanels(); setTranscriptOpen(true); }
    }
  };
  const stopRecording = async () => {
    const r = await audio.stop();
    if (!r || !doc) return;
    let rec = r;
    let pagesToAdd: Page[] = [];
    let writes: { at: number; text: string }[] = [];
    if (notesMode) {
      tbusy('Writing your notes…');
      const notes = await live.finish();
      const summary = await summarize(notes).catch(() => '');
      rec = { ...r, notes, summary };
      if (summary) {
        // They go on the empty last page if there is one, and on new pages after that.
        const when = new Date(r.created).toLocaleDateString([], { month: 'long', day: 'numeric' });
        const chunks = pageChunks(`Class notes, ${when}\n\n${summary}`);
        const lastAt = doc.pages.length - 1;
        const lastFree = doc.pages[lastAt]?.bg.kind === 'paper' && !!(await canvas.current?.pageIsEmpty(lastAt).catch(() => false));
        const from = lastFree ? lastAt : doc.pages.length;
        const size = pageSizeOf(doc.paper.size);
        pagesToAdd = chunks.slice(lastFree ? 1 : 0).map(() => paperPage('blank', doc.paper.color, { w: size.w, h: size.h }));
        writes = chunks.map((text, i) => ({ at: from + i, text }));
      }
      tbusy(null);
    }
    const list = [...(doc.recordings ?? []), rec];
    const next = { ...doc, recordings: list, pages: [...doc.pages, ...pagesToAdd] };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { audio: list.length, pages: next.pages.length, said: list.flatMap((x) => (x.transcript ?? []).map((l) => l.text)).join(' ').slice(0, 12000) });
    setVer((v) => v + 1);
    audio.load(rec);
    if (writes.length) {
      await new Promise((ok) => setTimeout(ok, 500));   // the canvas has to have the new pages first
      for (const w of writes) await canvas.current?.addPageText(w.at, w.text);
      toast(`Your notes are on page ${writes[0].at + 1}.`);
    }
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
  const onSelectionAction = async (e: { nativeEvent: { action: string; id?: string; path?: string; text?: string; width?: number; height?: number } }) => {
    const { action, path, text } = e.nativeEvent;
    if (action === 'message' && text) toast(text);
    else if (action === 'zoomClosed') setZoomWin(false);
    else if (action === 'convert' && path) {
      const kind = text ?? 'text';
      setConvert({ kind, busy: true, text: '' });
      try {
        let out = '';
        if (kind === 'text') out = (await readText('file://' + path)).map((l) => l.text).join('\n');
        else {
          const question = kind === 'math'
            ? 'Copy this handwritten math exactly as typed text, using plain Unicode math symbols like ², √, ×, ÷, π. Only the math, nothing else.'
            : 'Read this handwritten function and give only the equation to graph, written like y = x^2 + 1. Nothing else.';
          out = (await askStudy('ask', ['file://' + path], { question })).text?.trim() ?? '';
        }
        setConvert({ kind, busy: false, text: out || "Couldn't read any writing there." });
      } catch (err) { setConvert({ kind, busy: false, text: String((err as Error)?.message ?? err) }); }
    }
    else if (action === 'measured') {
      const scale = s.measureScale;
      const mode = text;
      const w = e.nativeEvent.width ?? 0, h = e.nativeEvent.height ?? 0;
      if (!scale) { setCalValue(''); setCalibrate({ need: false, length: mode === 'area' ? w : w }); }
      else if (mode === 'area') toast(`${(w * scale.perPoint * h * scale.perPoint).toFixed(2)} square ${scale.unit.toLowerCase()}`);
      else toast(`${(w * scale.perPoint).toFixed(2)} ${scale.unit.toLowerCase()}`);
    }
    else if (action === 'comment' && e.nativeEvent.id) setComment({ id: e.nativeEvent.id, text: text ?? '' });
    else if (action === 'style') setSelStyle({ color: text ?? '#000000', width: e.nativeEvent.width ?? 2 });
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
  // Came from Home's Record a lecture: start once the page is up.
  const autoRecord = useRef(false);
  useEffect(() => {
    if (record === '1' && doc && !autoRecord.current) { autoRecord.current = true; setAudioOpen(true); startRecording(true); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [record, doc]);
  const closePanels = () => { setCalc(false); setStudy(false); setFind(false); setTranscriptOpen(false); };
  const paperPageNow = paperFor != null ? doc?.pages[paperFor] : null;

  const narrow = width < 1000;   // labels hide, so the three parts of the bar never touch
  const subjectName = lib.lib.folders.find((f) => f.id === meta?.folderId)?.name;
  return (
    <View style={{ flex: 1, backgroundColor: '#F4F5F8' }}>
      <StatusBar hidden />
      <Stack.Screen options={{ gestureEnabled: false, statusBarHidden: true }} />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {sidebar && doc ? (
          <PageSidebar noteId={id} pages={doc.pages} current={page.page} ver={ver} canvas={canvas} absPath={absPath}
            onJump={(i) => canvas.current?.scrollToPage(i)} onMenu={setPageMenu} onAdd={() => addPage()} />
        ) : null}
        <View style={{ flex: 1 }}>
          {doc ? (
            <QuillCanvas key={canvasKey} scribble={s.scribble !== false} zoomWindow={zoomWin} ref={canvas} style={{ flex: 1 }} pages={pages} tool={tool} fingerDraws={!!s.fingerDraws} inkStats={!!s.inkStats} shapeSnap={s.holdToShape !== false} ruler={ruler}
              onPencilTap={onPencilTap} onSelectionAction={onSelectionAction} autoPage={s.autoPage !== false} onLastPageUsed={() => addPage(undefined, true)}
              inkTaps={audioOpen && !audio.rec && recordings.length > 0}
              onInkTapped={(e) => { const ms = e.nativeEvent.ts * 1000; const r = recordings.find((x) => ms >= x.created && ms <= x.created + x.dur); if (r) hear(r, (ms - r.created) / 1000); }}
              drawingPath={absPath(notePath(id, DRAWING))} textsPath={absPath(notePath(id, TEXTS))} legacy={legacy}
              onDrawingChange={onChange} onPageChange={(e) => setPage(e.nativeEvent)} />
          ) : <View style={{ flex: 1, backgroundColor: '#ECECEE' }} />}
          {page.count > 1 || doc?.pages.length ? (
            <View pointerEvents="box-none" style={{ position: 'absolute', right: 12, bottom: audioOpen ? 80 : 16 }}>
              <View style={{ width: 30, borderRadius: 11, backgroundColor: '#fff', alignItems: 'center', paddingVertical: 4, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
                <Pressable accessibilityLabel="Previous page" hitSlop={8} onPress={() => canvas.current?.scrollToPage(Math.max(0, page.page - 1))} style={{ padding: 5 }}><ToolIcon name="up" size={13} /></Pressable>
                <Pressable accessibilityLabel="Go to page" onPress={() => setJump(true)} style={{ paddingVertical: 2, alignItems: 'center' }}>
                  <Text style={{ color: '#3B4252', fontSize: 11, fontWeight: '600' }}>{page.page + 1}</Text>
                  <View style={{ width: 12, height: 1, backgroundColor: '#9AA2B2', marginVertical: 2 }} />
                  <Text style={{ color: '#7A8294', fontSize: 11 }}>{page.count}</Text>
                </Pressable>
                <Pressable accessibilityLabel="Next page" hitSlop={8} onPress={() => canvas.current?.scrollToPage(Math.min(page.count - 1, page.page + 1))} style={{ padding: 5 }}><ToolIcon name="down" size={13} /></Pressable>
              </View>
            </View>
          ) : null}
          {audioOpen ? (
            <AudioBar audio={audio} noteId={id} recs={recordings} toNotes={notesMode} onStartRec={startRecording} onStopRec={stopRecording} panelOpen={transcriptOpen} onPanel={() => { const was = transcriptOpen; closePanels(); setTranscriptOpen(!was); }} onDelete={setDelRec}
              onClose={() => { audio.unload(); setAudioOpen(false); setTranscriptOpen(false); }} />
          ) : null}
        </View>
        {second ? <View style={{ flex: 1 }}><SideNote noteId={second} tool={tool} fingerDraws={!!s.fingerDraws} onSwap={() => setPicking(true)} onClose={() => setSecond(null)} /></View> : null}
        {find && doc ? (
          <FindPanel noteId={id} doc={doc} canvas={canvas} absPath={absPath} stale={() => { const d = [...dirtyPages.current]; dirtyPages.current.clear(); return d; }} onRead={() => {}}
            onHear={(r, sec) => hear(r, sec)} onClose={() => setFind(false)} />
        ) : null}
        {transcriptOpen && (cur || audio.rec) ? (
          <ClassPanel live={audio.rec ? live : null} toNotes={notesMode} rec={cur ? recordings.find((x) => x.id === cur.id) ?? cur : null} busy={transcribing} pos={position * 1000} marks={audio.rec ? audio.marks : cur?.marks} onMake={makeTranscript} onSeek={(ms) => { audio.seek(ms); audio.play(); }} onClose={() => setTranscriptOpen(false)} />
        ) : null}
        {calcLoaded ? (
          <View style={{ width: calc ? Math.min(460, width * 0.42) : 0, overflow: 'hidden', borderLeftWidth: calc ? 1 : 0, borderLeftColor: t.line }}>
            <Desmos compact onClose={() => setCalc(false)} />
          </View>
        ) : null}
        {study && doc ? <StudyPanel noteId={id} page={page.page} pageCount={doc.pages.length} canvas={canvas} absPath={absPath} onClose={() => setStudy(false)} /> : null}
      </View>

      {!focus ? (
        <>
          <NoteToolbar recording={!!audio.rec} hasAudio={recordings.length > 0} ruler={ruler} zoom={zoomWin} onInsert={() => setInsert(true)} onAudio={() => setAudioOpen((v) => !v || !!audio.rec)}
            onRuler={setRuler} onCompass={(what) => canvas.current?.compass(what)} onZoom={() => setZoomWin((v) => !v)} onCalibrate={() => { if (!s.measureScale) setCalibrate({ need: true }); }} onSettings={() => router.push('/settings')} onPaste={paste} onTape={(w) => { if (w === 'clear') canvas.current?.clearTape(); else canvas.current?.setAllTape(w === 'show'); }} />
          <View style={{ position: 'absolute', top: 10, left: 12, flexDirection: 'row', padding: 2, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
            <TopBtn icon="back" label="Back to notes" onPress={back} />
            {tabs.length > 1 ? <TopBtn icon="tabs" label="Open notes" active={tabsOpen} onPress={() => setTabsOpen(true)} /> : null}
          </View>
          <View style={{ position: 'absolute', top: 10, right: 12, flexDirection: 'row', borderRadius: 12, backgroundColor: '#fff', padding: 2, shadowColor: '#000', shadowOpacity: 0.09, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
            <TopBtn icon="undo" label="Undo" disabled={!st.canUndo} onPress={() => canvas.current?.undo()} />
            <TopBtn icon="redo" label="Redo" disabled={!st.canRedo} onPress={() => canvas.current?.redo()} />
            <TopBtn icon="share" label="Share" onPress={share} />
            <TopBtn icon="more" label="More" onPress={() => setMenu(true)} />
            <TopBtn icon="ai" label="Study with AI" active={study} onPress={() => { const was = study; closePanels(); setStudy(!was); }} />
            <TopBtn icon="pages" label={sidebar ? 'Hide pages' : 'Show pages'} active={sidebar} onPress={() => { setVer((v) => v + 1); setSidebar((v) => !v); }} />
          </View>
          {meta?.hw ? (
            <View style={{ position: 'absolute', top: 70, left: 12, flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 6, borderRadius: 18, backgroundColor: '#fff', maxWidth: 220, shadowColor: '#000', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
              <Pressable onPress={() => openAssignment(meta.hw!)} accessibilityLabel="Assignment" style={{ flexShrink: 1, paddingHorizontal: 6 }}>
                <Text numberOfLines={1} style={{ color: '#3B4252', fontSize: 12.5, fontWeight: '600' }}>{meta.hw.title}{meta.hw.due ? ` · ${dueLabel(meta.hw.due)}` : ''}</Text>
              </Pressable>
              <Pressable onPress={handIn} accessibilityLabel="Hand in to Classroom" style={{ height: 26, paddingHorizontal: 10, borderRadius: 13, justifyContent: 'center', backgroundColor: '#1E8E3E' }}>
                <Text style={{ color: '#fff', fontSize: 12.5, fontWeight: '700' }}>Hand in</Text>
              </Pressable>
            </View>
          ) : null}
        </>
      ) : (
        <View style={{ position: 'absolute', top: 12, right: 12, flexDirection: 'row', borderRadius: 14, backgroundColor: '#fff', paddingHorizontal: 2 }}>
          <IconButton name="arrow.uturn.backward" label="Undo" disabled={!st.canUndo} onPress={() => canvas.current?.undo()} />
          <IconButton name="arrow.down.right.and.arrow.up.left" label="Leave focus mode" onPress={() => setFocus(false)} />
        </View>
      )}
      {selStyle ? <StylePopover color={selStyle.color} width={selStyle.width} onClose={() => setSelStyle(null)}
        onChange={(p) => canvas.current?.styleSelection(p.color ?? '', p.width ?? 0, p.line ?? '')} /> : null}
      <MenuSheet topRight visible={menu} onClose={() => setMenu(false)} items={[
        { group: 1, label: 'Share settings', sub: meta?.link ? 'Link is on' : undefined, icon: 'person.badge.plus', onPress: () => setShareOpen(true) },
        { group: 1, label: 'Quick export', sub: 'PDF, All pages', icon: 'square.and.arrow.up', onPress: share },
        { group: 1, label: 'Export as…', icon: 'square.and.arrow.up.on.square', onPress: () => setExportMenu(true) },
        { group: 2, label: 'Comments', icon: 'bubble.left', onPress: async () => { setCommentsList((await canvas.current?.commentList()) ?? []); } },
        { group: 2, label: 'Start study session', icon: 'timer', checked: study, onPress: () => { const was = study; closePanels(); setStudy(!was); } },
        { group: 3, label: 'Template settings', icon: 'doc.plaintext', onPress: () => { if (doc?.pages[page.page]?.bg.kind === 'paper') setPaperFor(page.page); else toast('This page is a PDF or photo, so it keeps its own background.'); } },
        { group: 3, label: 'View settings', icon: 'chevron.right', onPress: () => setViewMenu(true) },
        { group: 4, label: meta?.title ?? 'Note', sub: 'Tap to rename', icon: 'chevron.right', onPress: () => setRenaming(true) },
        { group: 5, label: 'Version history', icon: 'clock.arrow.circlepath', onPress: () => setVersions(true) },
        ...(doc?.pages[page.page]?.bg.kind === 'image' ? [
          { group: 6, label: 'Clean up this page', icon: 'wand.and.stars', onPress: () => enhancePage(page.page, 'color') },
          { group: 6, label: 'Make it black and white', icon: 'doc.text.viewfinder', onPress: () => enhancePage(page.page, 'document') },
          ...((doc.pages[page.page].bg as { orig?: string }).orig ? [{ group: 6, label: 'Back to the original photo', icon: 'arrow.uturn.backward', onPress: () => restorePhoto(page.page) }] : []),
        ] : []),
        ...(meta?.hw ? [
          { group: 7, label: 'Hand in to Classroom', icon: 'paperplane', onPress: handIn },
          { group: 7, label: 'Open the assignment', icon: 'graduationcap', onPress: () => openAssignment(meta.hw!) },
        ] : []),
        { group: 8, label: 'Find in this note', icon: 'magnifyingglass', checked: find, onPress: () => { const was = find; closePanels(); setFind(!was); } },
        { group: 8, label: second ? 'Second note' : 'Open another note beside', icon: 'rectangle.split.2x1', checked: !!second, onPress: () => { if (second) setSecond(null); else setPicking(true); } },
        { group: 8, label: 'Calculator', icon: 'function', checked: calc, onPress: () => { const was = calc; closePanels(); setCalcLoaded(true); setCalc(!was); } },
        { group: 8, label: meta?.drive ? 'Update in Google Drive' : 'Save to Google Drive', icon: 'icloud.and.arrow.up', onPress: () => saveDrive() },
        { group: 9, label: 'Settings', icon: 'gearshape', onPress: () => router.push('/settings') },
      ]} />
      <MenuSheet topRight visible={exportMenu} onClose={() => setExportMenu(false)} items={[
        { group: 1, label: 'PDF', sub: 'All pages', icon: 'doc.richtext', onPress: share },
        { group: 1, label: 'Picture', sub: 'This page', icon: 'photo', onPress: () => shareCurrentPage(page.page) },
      ]} />
      <MenuSheet topRight visible={viewMenu} onClose={() => setViewMenu(false)} items={[
        { group: 1, label: 'Focus mode', sub: 'Hides the toolbars', icon: 'arrow.up.left.and.arrow.down.right', onPress: () => setFocus(true) },
        { group: 1, label: 'Fit page to width', icon: 'arrow.left.and.right', onPress: () => canvas.current?.fitWidth() },
      ]} />
      <MenuSheet visible={versions} onClose={() => setVersions(false)} title="Version history" items={(() => {
        const list = versions ? listVersions(id) : [];
        return list.length ? list.map((v) => ({ label: new Date(Number(v)).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }), icon: 'clock', onPress: async () => {
          await canvas.current?.save();
          await saveVersion(id);
          await restoreVersion(id, v);
          setCanvasKey((k) => k + 1);
          toast('Note restored. The version before this was kept too.');
        } })) : [{ label: 'Versions appear after you leave a note you changed', onPress: () => {} }];
      })()} />
      <Sheet visible={!!calibrate} onClose={() => setCalibrate(null)} title="Calibrate scale" width={420}>
        {calibrate?.need ? (
          <>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>Select something with a known length</Text>
            <Text style={{ color: t.sub, fontSize: 15, marginTop: 6 }}>Drag across it on the page. We'll use it to calibrate the measurement scale.</Text>
          </>
        ) : (
          <>
            <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>What is the length of the selected object?</Text>
            <Text style={{ color: t.sub, fontSize: 14, marginTop: 6 }}>Length</Text>
            <TextInput accessibilityLabel="Length" value={calValue} onChangeText={setCalValue} keyboardType="decimal-pad" autoFocus style={{ height: 44, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingHorizontal: 12, color: t.text, fontSize: 17, marginTop: 4 }} />
            <Text style={{ color: t.sub, fontSize: 14, marginTop: 12 }}>Unit</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
              {['Inches', 'Feet', 'Centimeters', 'Meters'].map((u) => (
                <Pressable key={u} accessibilityLabel={u} onPress={() => setCalUnit(u)} style={{ height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: calUnit === u ? '#E9EEFD' : t.chip }}><Text style={{ color: t.text, fontSize: 14 }}>{u}</Text></Pressable>
              ))}
            </View>
          </>
        )}
        <Pressable accessibilityLabel="Continue" onPress={() => {
          const v = parseFloat(calValue);
          if (!calibrate?.need && calibrate?.length && v > 0) { set({ measureScale: { perPoint: v / calibrate.length, unit: calUnit } }); toast('Scale set. Drag on the page to measure.'); }
          setCalibrate(null);
        }} style={{ height: 44, borderRadius: 10, marginTop: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#3F6AF2' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Continue</Text></Pressable>
      </Sheet>
      <MenuSheet visible={insert} onClose={() => setInsert(false)} title="Insert" items={[
        { label: 'Photo on this page', icon: 'photo', onPress: () => placePhoto('library') },
        { label: 'Take a photo', icon: 'camera', onPress: () => placePhoto('camera') },
        { label: 'Paste', icon: 'doc.on.clipboard', onPress: paste },
        { label: 'Blank page after this one', icon: 'doc.badge.plus', onPress: () => addPage(page.page) },
        ...(canScan() ? [{ label: 'Scan paper', icon: 'doc.viewfinder', onPress: () => addPictures('scan') }] : []),
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
      <ShareLinkSheet visible={shareOpen} noteId={id} title={meta?.title || 'Note'} onSendPdf={share} onClose={() => setShareOpen(false)}
        makePdf={async () => {
          try { await canvas.current?.save(); } catch {}
          const path = `inkpad/out/share_${id}.pdf`;
          await canvas.current?.exportPdf(absPath(path));
          return path;
        }} />
      <CommentSheet raw={comment ? comment.text : null} onClose={() => setComment(null)}
        onSave={(next) => { if (comment) canvas.current?.setComment(comment.id, next); }} />
      <MenuSheet visible={!!commentsList} onClose={() => setCommentsList(null)} title="Comments" items={[
        { label: 'Add a comment', icon: 'plus.bubble', onPress: () => set({ inkKind: 'comment', lastTool: s.inkKind }) },
        ...(commentsList ?? []).map((c) => ({ label: firstLine(c.text) || 'Comment', sub: `Page ${c.page + 1}`, icon: 'bubble.left', onPress: () => { canvas.current?.scrollToPage(c.page); setComment({ id: c.id, text: c.text }); } })),
      ]} />
      {tabsOpen ? <NoteTabs current={id} onClose={() => setTabsOpen(false)} onPick={(n) => { setTabsOpen(false); leave(n); }} /> : null}
      <PromptSheet visible={jump} title="Go to page" initial={String(page.page + 1)} confirm="Go" onCancel={() => setJump(false)}
        onSubmit={(v) => { setJump(false); const n = parseInt(v, 10); if (n >= 1 && n <= page.count) canvas.current?.scrollToPage(n - 1); }} />
      <ConfirmSheet visible={delRec != null} title="Delete this recording?" message="Your writing stays. The audio and its transcript are removed." onCancel={() => setDelRec(null)}
        onConfirm={() => { const r = delRec; setDelRec(null); if (r) deleteRecording(r); }} />
      <Sheet visible={!!convert} onClose={() => setConvert(null)} title="Preview" width={560}>
        {convert?.busy ? <View style={{ padding: 40, alignItems: 'center' }}><ActivityIndicator color={t.accent} /></View> : (
          <>
            <TextInput accessibilityLabel="Converted text" multiline value={convert?.text ?? ''} onChangeText={(v) => setConvert((c) => (c ? { ...c, text: v } : c))}
              style={{ minHeight: 140, padding: 12, borderRadius: 10, borderWidth: 1, borderColor: t.line, color: t.text, fontSize: 18, textAlignVertical: 'top' }} />
            <Text style={{ color: t.sub, fontSize: 13, marginTop: 8 }}>{convert?.kind === 'graph' ? 'Write it like y = x^2 + 1. Your writing becomes this graph, and Undo brings it back.' : 'You can fix anything here first. Undo brings your writing back.'}</Text>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 14 }}>
              <Pressable accessibilityLabel="Cancel convert" onPress={() => setConvert(null)} style={{ height: 40, paddingHorizontal: 16, justifyContent: 'center' }}><Text style={{ color: t.text, fontSize: 16 }}>Cancel</Text></Pressable>
              <Pressable accessibilityLabel="Convert now" onPress={() => {
                const c = convert;
                setConvert(null);
                if (!c?.text.trim()) return;
                if (c.kind === 'graph') {
                  const g = graphLines(c.text);
                  if (g) canvas.current?.replaceSelectionWithGraph(g.axes, g.curve, g.caption);
                  else { copyText(c.text); closePanels(); setCalcLoaded(true); setCalc(true); toast("Couldn't plot that here. It's copied, ready to paste into the calculator."); }
                }
                else canvas.current?.replaceSelection(c.text);
              }} style={{ height: 40, paddingHorizontal: 18, borderRadius: 10, justifyContent: 'center', backgroundColor: '#3F6AF2' }}><Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Convert</Text></Pressable>
            </View>
          </>
        )}
      </Sheet>
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
