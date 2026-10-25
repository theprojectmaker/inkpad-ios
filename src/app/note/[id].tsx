// Editor: a slim top bar and the PencilKit canvas. Apple's tool palette
// floats over the page (pen, marker, pencil, eraser, lasso, ruler, colours).
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { type CanvasHandle, type CanvasPage, type CanvasState, type LegacyStroke, PAGE_GAP, QuillCanvas } from '@/components/quill-canvas';
import { IconButton, PromptSheet, useToast } from '@/components/ui';
import { sharePdf } from '@/lib/export';
import { fsx } from '@/lib/fsx';
import { unpack } from '@/lib/geom';
import { useLibrary } from '@/lib/library';
import { type NoteDoc, type Page, paperPage, pageSizeOf } from '@/lib/model';
import { loadDoc, notePath, saveDoc } from '@/lib/noteio';
import { paperMarks, paperOf } from '@/lib/paper';
import { useTheme } from '@/lib/settings';

const DRAWING = 'drawing.pkd';
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
  const { id } = useLocalSearchParams<{ id: string }>();
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

  const onChange = useCallback((e: { nativeEvent: CanvasState }) => {
    setSt(e.nativeEvent);
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(makeThumb, 2500);
  }, [makeThumb]);

  const back = async () => {
    try { await canvas.current?.save(); } catch {}
    if (thumbTimer.current) { clearTimeout(thumbTimer.current); await makeThumb(); }
    if (router.canGoBack()) router.back(); else router.replace('/');
  };

  const addPage = async () => {
    if (!doc) return;
    const last = doc.pages[doc.pages.length - 1];
    const size = last && last.bg.kind === 'paper' ? { w: last.w, h: last.h } : pageSizeOf(doc.paper.size);
    const style = last?.bg.kind === 'paper' ? last.bg.style : doc.paper.style;
    const color = last?.bg.kind === 'paper' ? last.bg.color : doc.paper.color;
    const p: Page = paperPage(style, color, { w: size.w, h: size.h });
    const next = { ...doc, pages: [...doc.pages, p] };
    setDoc(next);
    await saveDoc(next);
    lib.updateNote(id, { pages: next.pages.length, updated: Date.now() });
    toast(`Page ${next.pages.length} added at the end`);
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

  return (
    <View style={{ flex: 1, backgroundColor: t.bar, paddingTop: ins.top }}>
      <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, borderBottomWidth: 1, borderBottomColor: t.line }}>
        <IconButton name="chevron.left" label="Back to notes" onPress={back} />
        <Pressable onPress={() => setRenaming(true)} style={{ flex: 1, paddingHorizontal: 8, height: 40, justifyContent: 'center' }} accessibilityLabel="Rename note">
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>{meta?.title ?? 'Note'}</Text>
        </Pressable>
        <IconButton name="arrow.uturn.backward" label="Undo" disabled={!st.canUndo} onPress={() => canvas.current?.undo()} />
        <IconButton name="arrow.uturn.forward" label="Redo" disabled={!st.canRedo} onPress={() => canvas.current?.redo()} />
        <View style={{ width: 1, height: 22, backgroundColor: t.line, marginHorizontal: 6 }} />
        <IconButton name="doc.badge.plus" label="Add page" onPress={addPage} />
        <IconButton name="square.and.arrow.up" label="Share as PDF" disabled={busy} onPress={share} />
      </View>
      {doc ? (
        <QuillCanvas ref={canvas} style={{ flex: 1 }} pages={pages} drawingPath={absPath(notePath(id, DRAWING))} legacy={legacy} onDrawingChange={onChange} />
      ) : <View style={{ flex: 1, backgroundColor: '#ECECEE' }} />}
      <PromptSheet visible={renaming} title="Rename note" initial={meta?.title ?? ''} onCancel={() => { setRenaming(false); canvas.current?.focus(); }}
        onSubmit={(v) => { if (v.trim()) lib.updateNote(id, { title: v.trim() }); setRenaming(false); canvas.current?.focus(); }} />
    </View>
  );
}
