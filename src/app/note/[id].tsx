// Editor, laid out like Notability: back / pages / title on the left, the
// tools in the middle, undo / redo / more on the right; a thin strip below
// with the tool's options; an optional page sidebar; the PencilKit canvas.
import * as ImagePicker from 'expo-image-picker';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CanvasHandle, type CanvasPage, type CanvasState, type LegacyStroke, PAGE_GAP, QuillCanvas } from '@/components/quill-canvas';
import { currentTool, ToolButtons, ToolStrip } from '@/components/ink-bar';
import { PageSidebar } from '@/components/page-sidebar';
import { StudyPanel } from '@/components/study-panel';
import { HandInSheet } from '@/components/classroom-parts';
import { Desmos } from '@/components/desmos';
import { ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, useToast } from '@/components/ui';
import { handIn as sendToClassroom, openAssignment, openLink } from '@/lib/classroom';
import { ensureGoogle, NOTES_SITE, saveToDrive } from '@/lib/drive';
import { sharePdf } from '@/lib/export';
import { fsx } from '@/lib/fsx';
import { unpack } from '@/lib/geom';
import { useLibrary } from '@/lib/library';
import { type NoteDoc, type Page, paperPage, pageSizeOf } from '@/lib/model';
import { imagePages, loadDoc, notePath, saveDoc } from '@/lib/noteio';
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
  const tool = useMemo(() => currentTool(s), [s]);
  const [menu, setMenu] = useState(false);
  const [sidebar, setSidebar] = useState(false);
  const [study, setStudy] = useState(false);
  const [calc, setCalc] = useState(false);       // Desmos beside the page (kept loaded once opened)
  const [calcLoaded, setCalcLoaded] = useState(false);
  const [page, setPage] = useState({ page: 0, count: 1 });
  const [ver, setVer] = useState(0);            // bumps when ink changes (page thumbnails redraw)
  const [delPage, setDelPage] = useState<number | null>(null);
  const [handInPdf, setHandInPdf] = useState<{ path: string; title: string } | null>(null);
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

  // A fresh thumbnail for the library a moment after writing stops.
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const makeThumb = useCallback(async () => {
    const name = `thumb_${Date.now().toString(36)}.jpg`;
    try {
      if (!(await canvas.current?.snapshot(absPath(notePath(id, name)), 360))) return;
      const old = lib.meta(id)?.thumb;
      lib.updateNote(id, { thumb: name, updated: Date.now() });
      if (old && old !== name) fsx.remove(notePath(id, old));
    } catch {}
  }, [id, lib]);

  const changed = useRef(false);          // written on since it was opened (or last saved to Drive)
  const onChange = useCallback((e: { nativeEvent: CanvasState }) => {
    setSt(e.nativeEvent);
    changed.current = true;
    setVer((v) => v + 1);
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(makeThumb, 2500);
  }, [makeThumb]);

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
  const uploadPdf = async (pdf: { path: string; title: string }) => {
    const driveId = await saveToDrive(pdf.path, pdf.title, subject(), lib.meta(id)?.drive?.id);
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

  const back = async () => {
    try { await canvas.current?.save(); } catch {}
    if (thumbTimer.current) { clearTimeout(thumbTimer.current); await makeThumb(); }
    // Keep Drive up to date: the PDF is made here (it needs the page), the upload finishes in the background.
    let pending: { path: string; title: string } | null = null;
    if (changed.current && (s.driveSync || meta?.drive)) { try { pending = await makePdf(); } catch {} }
    if (router.canGoBack()) router.back(); else router.replace('/');
    if (pending) uploadPdf(pending).catch(() => toast("Couldn't update the copy in Google Drive. It'll try again next time."));
  };

  /** Puts new pages right after page `after` (or at the end); ink below them moves down. */
  const insertPages = async (add: Page[], after?: number) => {
    if (!doc || !add.length) return;
    let at = after == null || after >= doc.pages.length - 1 ? doc.pages.length : after + 1;
    const first = at;
    const list = [...doc.pages];
    for (const p of add) {
      if (at < list.length) await canvas.current?.insertPageSpace(at - 1, p.h);
      list.splice(at, 0, p);
      at++;
    }
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
    if (handin === '1' && doc && meta?.hw && !autoHandIn.current) { autoHandIn.current = true; setTimeout(handIn, 900); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handin, doc, meta?.hw]);

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

  const narrow = width < 900;
  return (
    <View style={{ flex: 1, backgroundColor: t.bar, paddingTop: ins.top }}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 }}>
        <IconButton name="chevron.left" label="Back to notes" onPress={back} />
        <IconButton name="sidebar.left" label={sidebar ? 'Hide pages' : 'Show pages'} active={sidebar} onPress={() => setSidebar((v) => !v)} />
        <Pressable onPress={() => setRenaming(true)} style={{ maxWidth: narrow ? Math.max(70, width / 2 - 250) : 260, paddingHorizontal: 6, height: 40, justifyContent: 'center' }} accessibilityLabel="Rename note">
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{meta?.title ?? 'Note'}</Text>
        </Pressable>
        <View style={{ flex: 1 }} />
        {meta?.hw ? (
          <Pressable onPress={handIn} accessibilityLabel="Hand in to Classroom"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 11, borderRadius: 17, marginRight: 4, backgroundColor: '#1E8E3E' }}>
            <Icon name="paperplane.fill" size={14} color="#fff" />
            {!narrow ? <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>Hand in</Text> : null}
          </Pressable>
        ) : null}
        <IconButton name="function" label={calc ? 'Hide calculator' : 'Graphing calculator'} active={calc} onPress={() => { setCalcLoaded(true); setCalc((v) => !v); setStudy(false); }} />
        <Pressable onPress={() => { setStudy((v) => !v); setCalc(false); }} accessibilityLabel="Study with AI"
          style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 34, paddingHorizontal: 11, borderRadius: 17, marginRight: 4, backgroundColor: study ? t.accent : t.accent + '1A' }}>
          <Icon name="sparkles" size={15} color={study ? '#fff' : t.accent} />
          {!narrow ? <Text style={{ color: study ? '#fff' : t.accent, fontSize: 14, fontWeight: '700' }}>Study</Text> : null}
        </Pressable>
        <IconButton name="arrow.uturn.backward" label="Undo" disabled={!st.canUndo} onPress={() => canvas.current?.undo()} />
        <IconButton name="arrow.uturn.forward" label="Redo" disabled={!st.canRedo} onPress={() => canvas.current?.redo()} />
        <IconButton name="ellipsis.circle" label="More" onPress={() => setMenu(true)} />
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
          <ToolButtons />
        </View>
      </View>
      <ToolStrip />
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {sidebar && doc ? (
          <PageSidebar noteId={id} pages={doc.pages} current={page.page} ver={ver} canvas={canvas} absPath={absPath}
            onJump={(i) => canvas.current?.scrollToPage(i)} onDelete={(i) => { if (doc.pages.length > 1) setDelPage(i); else toast("A note needs at least one page."); }} onAdd={() => addPage()} />
        ) : null}
        <View style={{ flex: 1 }}>
          {doc ? (
            <QuillCanvas ref={canvas} style={{ flex: 1 }} pages={pages} tool={tool} fingerDraws={!!s.fingerDraws} ruler={ruler}
              drawingPath={absPath(notePath(id, DRAWING))} textsPath={absPath(notePath(id, TEXTS))} legacy={legacy}
              onDrawingChange={onChange} onPageChange={(e) => setPage(e.nativeEvent)} />
          ) : <View style={{ flex: 1, backgroundColor: '#ECECEE' }} />}
          {page.count > 1 ? (
            <View pointerEvents="none" style={{ position: 'absolute', right: 14, bottom: 14, backgroundColor: 'rgba(20,22,28,0.72)', borderRadius: 12, paddingHorizontal: 10, height: 24, justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>{page.page + 1} / {page.count}</Text>
            </View>
          ) : null}
        </View>
        {calcLoaded ? (
          <View style={{ width: calc ? Math.min(460, width * 0.42) : 0, overflow: 'hidden', borderLeftWidth: calc ? 1 : 0, borderLeftColor: t.line }}>
            <Desmos compact onClose={() => setCalc(false)} />
          </View>
        ) : null}
        {study && doc ? <StudyPanel noteId={id} page={page.page} pageCount={doc.pages.length} canvas={canvas} absPath={absPath} onClose={() => setStudy(false)} /> : null}
      </View>

      <MenuSheet visible={menu} onClose={() => setMenu(false)} title={meta?.title} items={[
        { label: 'Insert a page after this one', icon: 'doc.badge.plus', onPress: () => addPage(page.page) },
        { label: 'Add a page at the end', icon: 'plus.rectangle.on.rectangle', onPress: () => addPage() },
        ...(canScan() ? [{ label: 'Scan paper into this note', icon: 'doc.viewfinder', onPress: () => addPictures('scan') }] : []),
        { label: 'Add photos as pages', icon: 'photo.on.rectangle', onPress: () => addPictures('photos') },
        ...(meta?.hw ? [
          { label: 'Hand in to Classroom', icon: 'paperplane', onPress: handIn },
          { label: 'Open the assignment', icon: 'graduationcap', onPress: () => openAssignment(meta.hw!) },
        ] : []),
        { label: meta?.drive ? 'Update in Google Drive' : 'Save to Google Drive', icon: 'icloud.and.arrow.up', onPress: () => saveDrive() },
        { label: 'Keep notes synced to Drive', icon: 'arrow.triangle.2.circlepath', checked: !!s.driveSync, onPress: () => set({ driveSync: !s.driveSync }) },
        { label: 'My notes online', icon: 'globe', onPress: () => openLink(NOTES_SITE) },
        { label: 'Share as PDF', icon: 'square.and.arrow.up', onPress: share },
        { label: ruler ? 'Hide the ruler' : 'Show the ruler', icon: 'ruler', checked: ruler, onPress: () => setRuler((v) => !v) },
        { label: 'Draw with finger', icon: 'hand.draw', checked: !!s.fingerDraws, onPress: () => set({ fingerDraws: !s.fingerDraws }) },
        { label: 'Rename', icon: 'pencil', onPress: () => setRenaming(true) },
      ]} />
      <HandInSheet pdf={handInPdf} onClose={() => setHandInPdf(null)}
        onDrive={async () => { if (!handInPdf) return false; try { await ensureGoogle(); await uploadPdf(handInPdf); return true; } catch (e) { toast("Couldn't save to Drive: " + String((e as Error)?.message ?? e)); return false; } }}
        onSave={() => handInPdf && sendToClassroom(handInPdf.path, handInPdf.title).catch((e) => toast(String(e?.message ?? e)))}
        onOpen={() => meta?.hw && openAssignment(meta.hw)} />
      <ConfirmSheet visible={delPage != null} title={`Delete page ${(delPage ?? 0) + 1}?`} message="Its writing is deleted too." onCancel={() => setDelPage(null)}
        onConfirm={() => { const i = delPage; setDelPage(null); if (i != null) removePage(i); }} />
      <PromptSheet visible={renaming} title="Rename note" initial={meta?.title ?? ''} onCancel={() => setRenaming(false)}
        onSubmit={(v) => { if (v.trim()) lib.updateNote(id, { title: v.trim() }); setRenaming(false); }} />
    </View>
  );
}
