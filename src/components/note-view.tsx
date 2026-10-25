// The note canvas: every visible page drawn on ONE Skia canvas, with our own
// multi-touch handling on top (RN responder, no gesture worklets):
//   • Apple Pencil (touch.force > 0 on iPad; fingers always report 0) draws.
//     While the pencil is down every finger is ignored = palm rejection.
//   • Fingers: two fingers pan + pinch-zoom; one finger draws, or scrolls when
//     "Pencil only" is on (turned on automatically the first time a pencil is seen).
//   • Two-finger tap = undo, three-finger tap = redo.
// All state the touch code reads lives in refs, so handlers never go stale.
import { Canvas, Circle, DashPathEffect, Group, Image as SkImageNode, Path, Picture, Rect, Skia, type SkPicture, type Transforms3d } from '@shopify/react-native-skia';
import * as Haptics from 'expo-haptics';
import * as ImagePicker from 'expo-image-picker';
import { useCallback, useEffect, useImperativeHandle, useMemo, useReducer, useRef, useState, type Ref } from 'react';
import { AppState, type GestureResponderEvent, Keyboard, PixelRatio, Platform, Pressable, Text, TextInput, View } from 'react-native';
import { useSharedValue } from 'react-native-reanimated';

import { clipboard } from '@/lib/clip';
import { exportNotePdf, sharePdf } from '@/lib/export';
import { fsx } from '@/lib/fsx';
import {
  type Box, clamp, pressureFromForce, eraseSplit, unpack, fin, imageBox, inBox, pack, pointInPoly, type Pt, recognizeShape, strokeBox, strokeHit,
  strokeHitSwept, strokeInLasso, unionBox, xfImage, xfStroke, xfText, type Xf,
} from '@/lib/geom';
import { clampView, fitZoom, GAP, layoutDoc, MAX_ZOOM, MIN_ZOOM, pageAt, softClampView, TOP, type View as ViewT, visiblePages } from '@/lib/layout';
import { useLibrary } from '@/lib/library';
import { docText, LETTER, pageSizeOf, type PageSizeId, type ImageItem, type NoteDoc, type Page, paperPage, type Recording, type Stroke, type TextItem, uid } from '@/lib/model';
import { imagePages, loadDoc, notePath, pdfKey, pdfPages, saveDoc, saveImage } from '@/lib/noteio';
import { engine } from '@/lib/pdf-engine';
import { useSettings, useTheme } from '@/lib/settings';
import { BG_TIERS, bestBg, bgImages, HL_ALPHA, inkPicture, itemImages, livePath, paperPicture, renderPageImage, type Replay, selectionPicture, textBounds } from '@/lib/skia-render';
import type { InkKind } from '@/lib/ink';
import { emptyPicture, liveFrame, type LiveStroke } from './live-ink';
import { useToast } from './ui';

export type Tool = 'pen' | 'hl' | 'eraser' | 'lasso' | 'text' | 'hand' | 'laser';

export type NoteViewHandle = {
  undo: () => void;
  redo: () => void;
  gotoPage: (i: number) => void;
  addPage: (after?: number) => void;
  deletePage: (i: number) => void;
  duplicatePage: (i: number) => void;
  movePage: (i: number, dir: -1 | 1) => void;
  insertImage: () => Promise<void>;
  insertSticker: (emoji: string) => void;
  insertPdf: (uri: string) => Promise<void>;
  insertPhotosAsPages: () => Promise<void>;
  paste: () => void;
  exportPdf: () => Promise<void>;
  flush: () => Promise<void>;
  setPaper: (style: Page['bg'] & { kind: 'paper' }) => void;
  setPageSize: (size: PageSizeId) => void;
  addRecording: (r: Recording) => void;
  removeRecording: (id: string) => void;
};

export type NoteViewState = { canUndo: boolean; canRedo: boolean; page: number; pages: number; selection: boolean; zoom: number; doc: NoteDoc | null; drawing: boolean };

type Sel = { page: number; strokes: Set<string>; texts: Set<string>; images: Set<string>; box: Box };
type Editing = { page: number; item: TextItem; isNew: boolean };
type Touch = { id: string; x: number; y: number; sx: number; sy: number; t0: number; pencil: boolean };
type Drawer = {
  touch: string; page: number; pencil: boolean; t0: number;
  hold: ReturnType<typeof setTimeout> | null; anchor: { x: number; y: number }; snapped: boolean;
  rt?: [string, number] | null;
  fp: number;
  pts: Pt[]; live: LiveStroke;
  lastRaw?: { x: number; y: number; t: number };
};
type Mode = 'idle' | 'pending' | 'draw' | 'nav' | 'ignore';

const HOLD_MS = 520;
const TAP_MS = 240;
const TAP_SLOP = 8;

const tierFor = (screenPx: number) => (screenPx > BG_TIERS[0] * 1.2 ? BG_TIERS[1] : BG_TIERS[0]);

export function NoteView({ noteId, tool, active, onActivate, onState, onRequestTool, handleRef, stamp, replay = null, onSeek, onPageBadge }: {
  noteId: string; tool: Tool; active: boolean; onActivate?: () => void; onState?: (s: NoteViewState) => void;
  onRequestTool?: (t: Tool) => void; handleRef?: Ref<NoteViewHandle>;
  /** While recording: returns [recording id, ms] to stamp new ink with. */
  stamp?: () => [string, number] | null;
  /** While playing a recording: ink written after the playhead is drawn faint. */
  replay?: Replay;
  /** Tap on ink written during a recording jumps the audio there. */
  onSeek?: (rec: string, ms: number) => void;
  /** Tap on the "3 / 12" page badge. */
  onPageBadge?: () => void;
}) {
  const th = useTheme();
  const { s: S, set: setSettings } = useSettings();
  const lib = useLibrary();
  const { toast, busy } = useToast();
  const [, force] = useReducer((n: number) => n + 1, 0);

  // ----- document + history -----
  const [doc, setDoc] = useState<NoteDoc | null>(null);
  const [failed, setFailed] = useState(false);
  const docRef = useRef<NoteDoc | null>(null);
  const undoRef = useRef<Page[][]>([]);
  const redoRef = useRef<Page[][]>([]);

  // ----- view -----
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  const viewRef = useRef<ViewT>({ z: 1, tx: 0, ty: TOP });
  const [view, setViewState] = useState<ViewT>(viewRef.current);
  const [settledZ, setSettledZ] = useState(1);
  const fitted = useRef(false);
  const rootRef = useRef<View>(null);
  const origin = useRef({ x: 0, y: 0 });

  // ----- interaction -----
  const toolRef = useRef(tool); toolRef.current = tool;
  const stampRef = useRef(stamp); stampRef.current = stamp;
  const replayRef = useRef(replay); replayRef.current = replay;
  const seekRef = useRef(onSeek); seekRef.current = onSeek;
  const [zoomBadge, setZoomBadge] = useState(false);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const SRef = useRef(S); SRef.current = S;
  const touches = useRef(new Map<string, Touch>());
  const mode = useRef<Mode>('idle');
  const drawer = useRef<Drawer | null>(null);
  const nav = useRef<{ cx: number; cy: number; dist: number; v: ViewT; n: number; samples: { x: number; y: number; t: number }[]; maxN: number; t0: number; moved: number } | null>(null);
  const momentum = useRef<number | null>(null);
  const eraseRef = useRef<{ page: number; last: { x: number; y: number } | null; before: Page[]; changed: boolean } | null>(null);
  const lassoRef = useRef<{ page: number; pts: { x: number; y: number }[] } | null>(null);
  const [sel, setSelState] = useState<Sel | null>(null);
  const selRef = useRef<Sel | null>(null);
  const dragRef = useRef<{ kind: 'move' | 'scale'; sx: number; sy: number; xf: Xf } | null>(null);
  const [editing, setEditingState] = useState<Editing | null>(null);
  const [navigating, setNavigating] = useState(false);
  const navigatingRef = useRef(false);
  const zoomBadgeRef = useRef(false);
  // A sharp render of just the visible part of the current PDF page, made after zooming in.
  const [tile, setTile] = useState<{ pageId: string; x: number; y: number; w: number; h: number; img: ReturnType<typeof Skia.Image.MakeImageFromEncoded> } | null>(null);
  const tileGen = useRef(0);
  const editingRef = useRef<Editing | null>(null);
  const [imgVer, setImgVer] = useState(0);
  const cursor = useRef<{ page: number; x: number; y: number; r: number } | null>(null);

  const setSel = (s: Sel | null) => { selRef.current = s; setSelState(s); };
  const setEditing = (e: Editing | null) => { editingRef.current = e; setEditingState(e); };

  const L = useMemo(() => layoutDoc(doc?.pages ?? []), [doc]);
  const LRef = useRef(L); LRef.current = L;

  // ----- load -----
  useEffect(() => {
    let alive = true;
    fitted.current = false;
    loadDoc(noteId).then((d) => {
      if (!alive) return;
      if (!d) { setFailed(true); return; }
      docRef.current = d; undoRef.current = []; redoRef.current = [];
      setDoc(d);
      lib.updateNote(noteId, { opened: Date.now() });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // Images finishing loading -> redraw.
  useEffect(() => {
    const a = bgImages.subscribe(() => force());
    const b = itemImages.subscribe(() => setImgVer((v) => v + 1));
    return () => { a(); b(); };
  }, []);

  // Pan/zoom move one transform on the UI thread (no React render per frame);
  // React catches up ~10x a second to load newly visible pages and overlays.
  const viewTf = useSharedValue<Transforms3d>([{ translateX: 0 }, { translateY: TOP }, { scale: 1 }]);
  const viewTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const setView = useCallback((v: ViewT, settle = false, soft = false) => {
    const c = (soft ? softClampView : clampView)(v, LRef.current, sizeRef.current.w, sizeRef.current.h);
    viewRef.current = c;
    viewTf.value = [{ translateX: c.tx }, { translateY: c.ty }, { scale: c.z }];
    if (settle) {
      if (viewTimer.current) { clearTimeout(viewTimer.current); viewTimer.current = null; }
      setViewState(c);
      setSettledZ(c.z);
    } else if (!viewTimer.current) {
      viewTimer.current = setTimeout(() => { viewTimer.current = null; setViewState(viewRef.current); }, 220);
    }
  }, [viewTf]);

  // Fit width once we know both the size and the doc.
  useEffect(() => {
    if (!doc || !size.w || fitted.current) return;
    fitted.current = true;
    const z = fitZoom(L, size.w);
    setView({ z, tx: (size.w - L.w * z) / 2, ty: TOP }, true);
  }, [doc, size.w, L, setView]);

  // Keep the view valid when the pane resizes (rotation, split view).
  const lastW = useRef(0);
  useEffect(() => {
    if (!size.w || !doc) return;
    if (lastW.current && Math.abs(lastW.current - size.w) > 2) {
      const ratio = fitZoom(L, size.w) / fitZoom(L, lastW.current);
      const v = viewRef.current;
      setView({ z: v.z * ratio, tx: v.tx, ty: v.ty * ratio }, true);
    }
    lastW.current = size.w;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w]);

  // ----- saving -----
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thumbTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);

  const makeThumb = useCallback(async () => {
    const d = docRef.current;
    if (!d || !d.pages.length) return;
    try {
      const p = d.pages[0];
      const bg = p.bg.kind === 'paper' ? null : bestBg(d.id, p, BG_TIERS[0]);
      if (p.bg.kind !== 'paper' && !bg) { thumbTimer.current = setTimeout(makeThumb, 2500); return; }
      const b64 = renderPageImage(d.id, p, 360, bg);
      if (!b64) return;
      const name = `thumb_${Date.now().toString(36)}.jpg`;
      await fsx.writeBase64(notePath(d.id, name), b64);
      const old = lib.meta(d.id)?.thumb;
      lib.updateNote(d.id, { thumb: name });
      if (old && old !== name) fsx.remove(notePath(d.id, old));
    } catch (e) { if (__DEV__) console.warn('thumb', e); }
  }, [lib]);

  const flush = useCallback(async () => {
    if (saveTimer.current) { clearTimeout(saveTimer.current); saveTimer.current = null; }
    const d = docRef.current;
    if (!d || !dirty.current) return;
    dirty.current = false;
    try {
      await saveDoc(d);
      lib.updateNote(d.id, { updated: Date.now(), pages: d.pages.length, text: docText(d) });
    } catch (e) { dirty.current = true; toast("Couldn't save: " + String((e as Error)?.message ?? e)); }
  }, [lib, toast]);

  const scheduleSave = useCallback(() => {
    dirty.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, 700);
    if (thumbTimer.current) clearTimeout(thumbTimer.current);
    thumbTimer.current = setTimeout(makeThumb, 2200);
  }, [flush, makeThumb]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active') { flush(); } });
    return () => {
      sub.remove();
      flush();
      if (thumbTimer.current) { clearTimeout(thumbTimer.current); makeThumb(); }
      bgImages.drop(noteId + '|');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  // First open of a note with no thumbnail yet.
  useEffect(() => {
    if (doc && !lib.meta(noteId)?.thumb) { if (thumbTimer.current) clearTimeout(thumbTimer.current); thumbTimer.current = setTimeout(makeThumb, 1800); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc]);

  /** Replace the pages; `history` pushes the previous pages onto the undo stack. */
  const commit = useCallback((pages: Page[], history: Page[] | null = docRef.current?.pages ?? null) => {
    const d = docRef.current;
    if (!d) return;
    if (history) {
      undoRef.current.push(history);
      if (undoRef.current.length > 120) undoRef.current.shift();
      redoRef.current = [];
    }
    const nd = { ...d, pages };
    docRef.current = nd;
    setDoc(nd);
    scheduleSave();
  }, [scheduleSave]);

  const setPage = useCallback((i: number, fn: (p: Page) => Page, history: Page[] | null = docRef.current?.pages ?? null) => {
    const d = docRef.current;
    if (!d || !d.pages[i]) return;
    const pages = d.pages.slice();
    pages[i] = fn(pages[i]);
    commit(pages, history);
  }, [commit]);

  // ----- coordinates -----
  const toDoc = (sx: number, sy: number) => { const v = viewRef.current; return { x: (sx - v.tx) / v.z, y: (sy - v.ty) / v.z }; };
  const toPage = (i: number, sx: number, sy: number) => { const d = toDoc(sx, sy); return { x: d.x - LRef.current.xs[i], y: d.y - LRef.current.tops[i] }; };
  const pageUnder = (sx: number, sy: number) => {
    const d = docRef.current;
    if (!d || !d.pages.length) return -1;
    return pageAt(LRef.current, d.pages, toDoc(sx, sy).y);
  };
  const pageToScreen = (i: number, x: number, y: number) => {
    const v = viewRef.current;
    return { x: v.tx + (LRef.current.xs[i] + x) * v.z, y: v.ty + (LRef.current.tops[i] + y) * v.z };
  };

  // ----- selection helpers -----
  const selBox = (p: Page, s: { strokes: Set<string>; texts: Set<string>; images: Set<string> }): Box | null => {
    let b: Box | null = null;
    for (const st of p.strokes) if (s.strokes.has(st.id)) b = unionBox(b, strokeBox(st));
    for (const t of p.texts) if (s.texts.has(t.id)) b = unionBox(b, textBounds(t));
    for (const im of p.images) if (s.images.has(im.id)) b = unionBox(b, imageBox(im));
    return b;
  };

  const selectItems = (page: number, strokes: string[], texts: string[], images: string[]) => {
    const p = docRef.current?.pages[page];
    if (!p) return;
    const s = { strokes: new Set(strokes), texts: new Set(texts), images: new Set(images) };
    const box = selBox(p, s);
    setSel(box ? { page, ...s, box } : null);
  };

  const applyXf = (xf: Xf) => {
    const s = selRef.current;
    if (!s) return;
    setPage(s.page, (p) => ({
      ...p,
      strokes: p.strokes.map((st) => (s.strokes.has(st.id) ? xfStroke(st, xf) : st)),
      texts: p.texts.map((t) => (s.texts.has(t.id) ? xfText(t, xf) : t)),
      images: p.images.map((im) => (s.images.has(im.id) ? xfImage(im, xf) : im)),
    }));
    const p2 = docRef.current?.pages[s.page];
    const box = p2 ? selBox(p2, s) : null;
    setSel(box ? { ...s, box } : null);
  };

  const deleteSel = () => {
    const s = selRef.current;
    if (!s) return;
    setPage(s.page, (p) => ({ ...p, strokes: p.strokes.filter((x) => !s.strokes.has(x.id)), texts: p.texts.filter((x) => !s.texts.has(x.id)), images: p.images.filter((x) => !s.images.has(x.id)) }));
    setSel(null);
  };

  const copySel = () => {
    const s = selRef.current;
    const p = s && docRef.current?.pages[s.page];
    if (!s || !p) return;
    clipboard.set({ noteId, strokes: p.strokes.filter((x) => s.strokes.has(x.id)), texts: p.texts.filter((x) => s.texts.has(x.id)), images: p.images.filter((x) => s.images.has(x.id)), box: s.box });
  };

  const placeItems = async (page: number, items: { strokes: Stroke[]; texts: TextItem[]; images: ImageItem[] }, xf: Xf, fromNote: string) => {
    // Images from another note are copied into this one.
    const images: ImageItem[] = [];
    for (const im of items.images) {
      let file = im.file;
      if (fromNote !== noteId) { file = `img_${uid()}.jpg`; await fsx.copy(notePath(fromNote, im.file), notePath(noteId, file)); }
      images.push(xfImage({ ...im, id: uid('i'), file }, xf));
    }
    const strokes = items.strokes.map((s) => xfStroke({ ...s, id: uid('s') }, xf));
    const texts = items.texts.map((t) => xfText({ ...t, id: uid('t') }, xf));
    setPage(page, (p) => ({ ...p, strokes: [...p.strokes, ...strokes], texts: [...p.texts, ...texts], images: [...p.images, ...images] }));
    onRequestTool?.('lasso');
    selectItems(page, strokes.map((x) => x.id), texts.map((x) => x.id), images.map((x) => x.id));
  };

  const duplicateSel = () => {
    const s = selRef.current;
    const p = s && docRef.current?.pages[s.page];
    if (!s || !p) return;
    placeItems(s.page, { strokes: p.strokes.filter((x) => s.strokes.has(x.id)), texts: p.texts.filter((x) => s.texts.has(x.id)), images: p.images.filter((x) => s.images.has(x.id)) }, { dx: 24, dy: 24, s: 1, ox: 0, oy: 0 }, noteId);
  };

  const recolorSel = (color: string) => {
    const s = selRef.current;
    if (!s) return;
    setPage(s.page, (p) => ({ ...p, strokes: p.strokes.map((x) => (s.strokes.has(x.id) ? { ...x, color } : x)), texts: p.texts.map((x) => (s.texts.has(x.id) && !x.sticker ? { ...x, color } : x)) }));
    const p2 = docRef.current?.pages[s.page];
    const box = p2 ? selBox(p2, s) : null;
    setSel(box ? { ...s, box } : null);
  };

  // The page nearest the middle of the screen.
  const currentPage = () => {
    const d = docRef.current;
    if (!d || !d.pages.length) return 0;
    return pageAt(LRef.current, d.pages, toDoc(sizeRef.current.w / 2, sizeRef.current.h * 0.4).y);
  };

  // Centre of the visible part of a page, in page coordinates.
  const visibleCentre = (i: number) => {
    const p = docRef.current!.pages[i];
    const c = toPage(i, sizeRef.current.w / 2, sizeRef.current.h / 2);
    return { x: clamp(c.x, 40, p.w - 40), y: clamp(c.y, 40, p.h - 40) };
  };

  // ----- text editing -----
  const commitEditing = () => {
    const e = editingRef.current;
    if (!e) return;
    setEditing(null);
    const text = e.item.text.replace(/\s+$/, '');
    const d = docRef.current;
    if (!d) return;
    const p = d.pages[e.page];
    if (!p) return;
    const existing = p.texts.find((t) => t.id === e.item.id);
    if (!text) { if (existing) setPage(e.page, (pg) => ({ ...pg, texts: pg.texts.filter((t) => t.id !== e.item.id) })); return; }
    if (existing && existing.text === text && existing.color === e.item.color && existing.size === e.item.size) { force(); return; }
    const item = { ...e.item, text };
    setPage(e.page, (pg) => ({ ...pg, texts: existing ? pg.texts.map((t) => (t.id === item.id ? item : t)) : [...pg.texts, item] }));
  };

  const startText = (page: number, x: number, y: number) => {
    const p = docRef.current?.pages[page];
    if (!p) return;
    const hit = [...p.texts].reverse().find((t) => !t.sticker && inBox(textBounds(t), x, y, 6));
    if (hit) { setEditing({ page, item: { ...hit }, isNew: false }); return; }
    const size = SRef.current.textSize;
    const w = clamp(p.w - x - 24, 120, 420);
    setEditing({ page, item: { id: uid('t'), x: clamp(x, 4, p.w - 60), y: clamp(y - size * 0.65, 0, p.h - size), w, text: '', size, color: SRef.current.penColor }, isNew: true });
  };

  // ----- erasing -----
  const eraseAt = (ax: number, ay: number, bx: number, by: number) => {
    const er = eraseRef.current;
    const d = docRef.current;
    if (!er || !d) return;
    const p = d.pages[er.page];
    if (!p) return;
    const r = SRef.current.eraserSize / viewRef.current.z;
    const box = { x: Math.min(ax, bx) - r, y: Math.min(ay, by) - r, w: Math.abs(bx - ax) + r * 2, h: Math.abs(by - ay) + r * 2 };
    const near = (s: Stroke) => { const b = strokeBox(s); return !(b.x > box.x + box.w || b.x + b.w < box.x || b.y > box.y + box.h || b.y + b.h < box.y); };
    let changed = false;
    let strokes: Stroke[];
    if (SRef.current.eraser === 'stroke') {
      strokes = p.strokes.filter((s) => { const hit = near(s) && strokeHitSwept(s, ax, ay, bx, by, r); if (hit) changed = true; return !hit; });
    } else {
      const L2 = Math.hypot(bx - ax, by - ay);
      const n = Math.max(1, Math.ceil(L2 / Math.max(1, r * 0.5)));
      strokes = [];
      for (const s of p.strokes) {
        if (!near(s)) { strokes.push(s); continue; }
        let parts: Stroke[] = [s];
        for (let k = 0; k <= n; k++) {
          const x = ax + ((bx - ax) * k) / n, y = ay + ((by - ay) * k) / n;
          const next: Stroke[] = [];
          for (const part of parts) {
            const pieces = eraseSplit(part, x, y, r);
            if (!pieces) { next.push(part); continue; }
            changed = true;
            const p0 = unpack(part.pts);
            const same = (a?: Pt, b?: Pt) => !!a && !!b && Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
            for (const pc of pieces) {
              // Ends made by the eraser stay full width (no taper): the rest of the ink looks unchanged.
              const c0 = same(pc[0], p0[0]) ? part.c0 : 1, c1 = same(pc[pc.length - 1], p0[p0.length - 1]) ? part.c1 : 1;
              next.push({ ...part, id: uid('s'), pts: pack(pc), ...(c0 ? { c0: 1 as const } : { c0: undefined }), ...(c1 ? { c1: 1 as const } : { c1: undefined }) });
            }
          }
          parts = next;
        }
        strokes.push(...parts);
      }
    }
    if (changed) { er.changed = true; setPage(er.page, (pg) => ({ ...pg, strokes }), null); }
  };

  // ----- strokes -----
  const livePic = useSharedValue<SkPicture>(emptyPicture());
  const liveGen = useRef(0);
  const drawLive = (l: LiveStroke | null) => { livePic.value = l ? liveFrame(l) : emptyPicture(); };

  const kindFor = (hl: boolean, laser: boolean): InkKind => (hl ? 'hl' : laser ? 'fine' : SRef.current.penType ?? 'fountain');
  const pressureFor = (pencil: boolean, snapped = false) => pencil && SRef.current.pressure && !snapped;

  // The laser pointer glows while you draw, then fades away; nothing is saved.
  const fadeLaser = (l: LiveStroke, gen: number) => {
    const t0 = Date.now(), hold = 700, dur = 450;
    const step = () => {
      if (liveGen.current !== gen) return;
      const k = Date.now() - t0;
      if (k < hold) { requestAnimationFrame(step); return; }
      const f = 1 - Math.min(1, (k - hold) / dur);
      l.fade = f;
      drawLive(f > 0 ? l : null);
      if (f > 0) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  };

  const addPoint = (dr: Drawer, sx: number, sy: number, force: number, ts?: number) => {
    const q = toPage(dr.page, sx, sy);
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) return;
    const tSec = (Number.isFinite(ts) ? (ts as number) : Date.now()) / 1000;
    // Raw positions: perfect-freehand's streamline does the smoothing, the same way live and saved.
    // Pressure is smoothed a little so a twitchy force reading never makes a blob.
    const raw = dr.pencil && SRef.current.pressure ? pressureFromForce(force) : 0.5;
    dr.fp = dr.pts.length ? dr.fp + (raw - dr.fp) * 0.35 : raw;
    const lastP = dr.pts[dr.pts.length - 1];
    if (lastP && Math.hypot(q.x - lastP.x, q.y - lastP.y) < 0.15) { lastP.p = Math.max(lastP.p, dr.fp); return; }
    dr.pts.push({ x: q.x, y: q.y, p: dr.fp });
    // Predict where the nib will be one frame from now and draw up to there:
    // hides most of the touch-to-screen delay. Replaced by real points next move.
    const lr = dr.lastRaw;
    dr.lastRaw = { x: q.x, y: q.y, t: tSec };
    if (lr) {
      const dt = tSec - lr.t;
      if (dt > 0.002 && dt < 0.05) {
        let vx = (q.x - lr.x) / dt, vy = (q.y - lr.y) / dt;
        const lead = 0.018, cap = dr.live.base * 3 + 6;
        let px = vx * lead, py = vy * lead;
        const m = Math.hypot(px, py);
        if (m > cap) { px *= cap / m; py *= cap / m; }
        dr.live.pred = m > 0.4 ? { x: q.x + px, y: q.y + py } : null;
      } else dr.live.pred = null;
    }
  };

  // The pencil was recognised late: redo the stroke with pressure.
  const rebuildInk = (dr: Drawer) => {
    dr.live.pressure = pressureFor(dr.pencil);
  };

  const armHold = (dr: Drawer) => {
    if (dr.hold) clearTimeout(dr.hold);
    if (!SRef.current.holdToShape || dr.snapped) return;
    dr.hold = setTimeout(() => {
      const cur = drawer.current;
      if (cur !== dr || dr.snapped || dr.pts.length < 6) return;
      const shape = recognizeShape(dr.pts);
      if (!shape) return;
      dr.snapped = true;
      dr.pts = shape.pts;
      dr.live.pts = shape.pts;
      dr.live.pred = null;
      dr.live.pressure = false;
      try { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light); } catch {}
      drawLive(dr.live);
    }, HOLD_MS);
  };

  const finishStroke = (dr: Drawer, cancel = false) => {
    if (dr.hold) clearTimeout(dr.hold);
    drawer.current = null;
    const gen = ++liveGen.current;
    // Keep the live stroke up until the saved one has drawn, so nothing flickers.
    const clearLive = (ms: number) => setTimeout(() => { if (liveGen.current === gen) drawLive(null); }, ms);
    if (cancel || !dr.pts.length) { clearLive(0); force(); return; }
    if (dr.live.laser) { fadeLaser(dr.live, gen); return; }
    const t = toolRef.current;
    const hl = t === 'hl';
    let pts = dr.pts;
    // Highlighter swipes that are nearly straight become perfectly straight.
    if (hl && SRef.current.hlStraight && !dr.snapped) {
      const shape = recognizeShape(pts);
      if (shape?.kind === 'line') pts = shape.pts;
    }
    const st: Stroke = {
      id: uid('s'), kind: hl ? 'hl' : 'pen', color: hl ? SRef.current.hlColor : SRef.current.penColor,
      w: hl ? SRef.current.hlWidth : SRef.current.penWidth, pts: pack(pts),
      ...(dr.pencil && SRef.current.pressure && !hl && !dr.snapped ? { pr: 1 as const } : {}),
      ...(dr.rt ? { rt: dr.rt } : {}),
      ...(!hl && SRef.current.penType && SRef.current.penType !== 'fountain' ? { pen: SRef.current.penType } : {}),
      sm: Math.round(SRef.current.smoothing * 100) / 100,
    };
    if (st.pts.length < 3) { clearLive(0); force(); return; }
    setPage(dr.page, (p) => ({ ...p, strokes: [...p.strokes, st] }));
    clearLive(50);
  };

  // ----- tool start / move / end (one pointer) -----
  const toolStart = (t: Touch) => {
    const tl = toolRef.current;
    const page = pageUnder(t.sx, t.sy);
    if (page < 0) return;
    if (tl === 'pen' || tl === 'hl' || tl === 'laser') {
      const hl = tl === 'hl', laser = tl === 'laser';
      const S0 = SRef.current;
      const v = viewRef.current;
      const pg = docRef.current!.pages[page];
      const dark = pg.bg.kind === 'paper' && pg.bg.color === 'dark';
      const pts: Pt[] = [];
      const live: LiveStroke = {
        pts, base: hl ? S0.hlWidth : laser ? 3 : S0.penWidth, kind: kindFor(hl, laser), pressure: !laser && pressureFor(t.pencil), smoothing: S0.smoothing,
        color: hl ? S0.hlColor : laser ? '#FF2D55' : S0.penColor, multiply: !dark, pred: null, laser,
        tf: { tx: v.tx + LRef.current.xs[page] * v.z, ty: v.ty + LRef.current.tops[page] * v.z, z: v.z },
      };
      const dr: Drawer = { touch: t.id, page, pencil: t.pencil, t0: Date.now(), hold: null, anchor: { x: t.sx, y: t.sy }, snapped: false, fp: 0.5, pts, live };
      ++liveGen.current;
      try { dr.rt = stampRef.current?.() ?? null; } catch { dr.rt = null; }
      addPoint(dr, t.sx, t.sy, (t as any).force ?? 0, (t as any).ts0);
      drawer.current = dr;
      armHold(dr);
      if (selRef.current) setSel(null);
      drawLive(live);
    } else if (tl === 'eraser') {
      eraseRef.current = { page, last: null, before: docRef.current!.pages, changed: false };
      const q = toPage(page, t.sx, t.sy);
      eraseAt(q.x, q.y, q.x, q.y);
      eraseRef.current.last = q;
      cursor.current = { page, x: q.x, y: q.y, r: SRef.current.eraserSize / viewRef.current.z };
      force();
    } else if (tl === 'lasso') {
      const s = selRef.current;
      if (s) {
        const q = toPage(s.page, t.sx, t.sy);
        const z = viewRef.current.z;
        const hx = s.box.x + s.box.w, hy = s.box.y + s.box.h;
        if (Math.hypot(q.x - hx, q.y - hy) < 26 / z) { dragRef.current = { kind: 'scale', sx: t.sx, sy: t.sy, xf: { dx: 0, dy: 0, s: 1, ox: s.box.x, oy: s.box.y } }; return; }
        if (inBox(s.box, q.x, q.y, 10 / z)) { dragRef.current = { kind: 'move', sx: t.sx, sy: t.sy, xf: { dx: 0, dy: 0, s: 1, ox: s.box.x, oy: s.box.y } }; return; }
      }
      setSel(null);
      lassoRef.current = { page, pts: [toPage(page, t.sx, t.sy)] };
    }
  };

  const toolMove = (t: Touch, force0: number) => {
    const tl = toolRef.current;
    const dr = drawer.current;
    if (dr && dr.touch === t.id) {
      if (dr.snapped) return;
      if (Math.hypot(t.x - dr.anchor.x, t.y - dr.anchor.y) > 3) { dr.anchor = { x: t.x, y: t.y }; armHold(dr); }
      addPoint(dr, t.x, t.y, force0, (t as any).ts);
      drawLive(dr.live);
      return;
    }
    if (tl === 'eraser' && eraseRef.current) {
      const er = eraseRef.current;
      const q = toPage(er.page, t.x, t.y);
      const last = er.last ?? q;
      eraseAt(last.x, last.y, q.x, q.y);
      er.last = q;
      cursor.current = { page: er.page, x: q.x, y: q.y, r: SRef.current.eraserSize / viewRef.current.z };
      force();
      return;
    }
    const dg = dragRef.current, s = selRef.current;
    if (dg && s) {
      const z = viewRef.current.z;
      if (dg.kind === 'move') dg.xf = { ...dg.xf, dx: (t.x - dg.sx) / z, dy: (t.y - dg.sy) / z };
      else {
        const q = toPage(s.page, t.x, t.y);
        const d0 = Math.hypot(s.box.w, s.box.h) || 1;
        const d1 = Math.hypot(q.x - s.box.x, q.y - s.box.y);
        dg.xf = { ...dg.xf, s: clamp(d1 / d0, 0.08, 12) };
      }
      force();
      return;
    }
    const la = lassoRef.current;
    if (la) {
      const q = toPage(la.page, t.x, t.y);
      const last = la.pts[la.pts.length - 1];
      if (!last || Math.hypot(q.x - last.x, q.y - last.y) * viewRef.current.z > 2) { la.pts.push(q); force(); }
    }
  };

  // During playback, tapping ink from the recording seeks to when it was written.
  const trySeek = (t: Touch) => {
    const r = replayRef.current;
    if (!r || !seekRef.current) return false;
    const page = pageUnder(t.sx, t.sy);
    const p = docRef.current?.pages[page];
    if (!p) return false;
    const q = toPage(page, t.sx, t.sy);
    const rr = 12 / viewRef.current.z;
    const hit = [...p.strokes].reverse().find((s) => s.rt && s.rt[0] === r.rec && strokeHit(s, q.x, q.y, rr));
    if (!hit?.rt) return false;
    seekRef.current(hit.rt[0], Math.max(0, hit.rt[1] - 1500));
    return true;
  };

  const tapAt = (t: Touch) => {
    const tl = toolRef.current;
    const page = pageUnder(t.sx, t.sy);
    if (page < 0) return;
    const q = toPage(page, t.sx, t.sy);
    if (tl === 'text') { startText(page, q.x, q.y); return; }
    if (tl === 'lasso') {
      const p = docRef.current!.pages[page];
      const r = 10 / viewRef.current.z;
      const im = [...p.images].reverse().find((x) => inBox(imageBox(x), q.x, q.y));
      const tx = [...p.texts].reverse().find((x) => inBox(textBounds(x), q.x, q.y, 4));
      const st = [...p.strokes].reverse().find((x) => strokeHit(x, q.x, q.y, r));
      if (tx) selectItems(page, [], [tx.id], []);
      else if (st) selectItems(page, [st.id], [], []);
      else if (im) selectItems(page, [], [], [im.id]);
      else setSel(null);
    }
  };

  const toolEnd = (t: Touch, cancel: boolean) => {
    const dr = drawer.current;
    if (dr && dr.touch === t.id) {
      // End exactly where the pen lifted (the smoothed points lag a little behind).
      if (!cancel && !dr.snapped) {
        const q = toPage(dr.page, t.x, t.y);
        if (Number.isFinite(q.x) && Number.isFinite(q.y)) dr.pts.push({ x: q.x, y: q.y, p: dr.fp });
        dr.live.pred = null;
      }
      finishStroke(dr, cancel);
      return;
    }
    if (eraseRef.current) {
      const er = eraseRef.current;
      eraseRef.current = null;
      cursor.current = null;
      if (er.changed) {
        undoRef.current.push(er.before);
        if (undoRef.current.length > 120) undoRef.current.shift();
        redoRef.current = [];
      }
      force();
      return;
    }
    const dg = dragRef.current;
    if (dg) {
      dragRef.current = null;
      const still = dg.kind === 'move' ? Math.hypot(dg.xf.dx, dg.xf.dy) < 0.5 : Math.abs(dg.xf.s - 1) < 0.005;
      if (!still) applyXf(dg.xf);
      force();
      return;
    }
    const la = lassoRef.current;
    if (la) {
      lassoRef.current = null;
      const p = docRef.current?.pages[la.page];
      if (p && la.pts.length > 4) {
        const poly = la.pts;
        const strokes = p.strokes.filter((s) => strokeInLasso(s, poly)).map((s) => s.id);
        const texts = p.texts.filter((x) => { const b = textBounds(x); return pointInPoly(b.x + b.w / 2, b.y + b.h / 2, poly); }).map((x) => x.id);
        const images = p.images.filter((x) => pointInPoly(x.x + x.w / 2, x.y + x.h / 2, poly)).map((x) => x.id);
        if (strokes.length + texts.length + images.length) selectItems(la.page, strokes, texts, images);
      }
      force();
    }
  };

  // ----- navigation -----
  const animateView = (to: ViewT, dur = 240) => {
    stopMomentumOnly();
    const from = viewRef.current;
    const end = clampView(to, LRef.current, sizeRef.current.w, sizeRef.current.h);
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      const v = { z: from.z + (end.z - from.z) * e, tx: from.tx + (end.tx - from.tx) * e, ty: from.ty + (end.ty - from.ty) * e };
      if (k < 1) { setView(v, false, true); momentum.current = requestAnimationFrame(step); }
      else { momentum.current = null; setView(end, true); }
    };
    momentum.current = requestAnimationFrame(step);
  };
  // Zoom by a factor around a screen point (keeps that point still).
  const zoomAround = (factor: number, cx = sizeRef.current.w / 2, cy = sizeRef.current.h / 2, absolute?: number) => {
    const v = viewRef.current;
    const z0 = fitZoom(LRef.current, sizeRef.current.w);
    const z = clamp(absolute ?? v.z * factor, z0 * MIN_ZOOM, z0 * MAX_ZOOM);
    const dx = (cx - v.tx) / v.z, dy = (cy - v.ty) / v.z;
    animateView({ z, tx: cx - dx * z, ty: cy - dy * z });
  };
  const fitWidth = () => {
    const z0 = fitZoom(LRef.current, sizeRef.current.w);
    const v = viewRef.current, cy = sizeRef.current.h / 2;
    const dy = (cy - v.ty) / v.z;
    animateView({ z: z0, tx: (sizeRef.current.w - LRef.current.w * z0) / 2, ty: cy - dy * z0 });
  };
  const stopMomentumOnly = () => { if (momentum.current != null) { cancelAnimationFrame(momentum.current); momentum.current = null; } };
  const lastTap = useRef<{ t: number; x: number; y: number } | null>(null);
  // Little label in the middle of the screen ("Undo", "Redo"...).
  const [hud, setHud] = useState<{ text: string; n: number } | null>(null);
  const hudTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showHud = (text: string) => {
    if (hudTimer.current) clearTimeout(hudTimer.current);
    setHud((h) => ({ text, n: (h?.n ?? 0) + 1 }));
    hudTimer.current = setTimeout(() => setHud(null), 900);
  };

  const stopMomentum = () => { if (momentum.current != null) { cancelAnimationFrame(momentum.current); momentum.current = null; setView(viewRef.current, true); } };

  const navBegin = () => {
    const pts = [...touches.current.values()].filter((t) => !t.pencil).slice(0, 2);
    if (!pts.length) return;
    const cx = pts.reduce((a, t) => a + t.x, 0) / pts.length, cy = pts.reduce((a, t) => a + t.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    const prev = nav.current;
    nav.current = { cx, cy, dist, v: viewRef.current, n: pts.length, samples: prev?.samples ?? [], maxN: Math.max(prev?.maxN ?? 0, touches.current.size), t0: prev?.t0 ?? Date.now(), moved: prev?.moved ?? 0 };
  };

  const navMove = () => {
    const nv = nav.current;
    if (!nv) return;
    const pts = [...touches.current.values()].filter((t) => !t.pencil).slice(0, 2);
    if (pts.length !== nv.n) { navBegin(); return; }
    const cx = pts.reduce((a, t) => a + t.x, 0) / pts.length, cy = pts.reduce((a, t) => a + t.y, 0) / pts.length;
    let z = nv.v.z;
    if (pts.length > 1 && nv.dist > 10) z = nv.v.z * (Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) / nv.dist);
    if (!Number.isFinite(z) || z <= 0) z = nv.v.z;
    // Keep the doc point under the fingers' centre fixed.
    const dx = (nv.cx - nv.v.tx) / nv.v.z, dy = (nv.cy - nv.v.ty) / nv.v.z;
    nv.moved = Math.max(nv.moved, Math.hypot(cx - nv.cx, cy - nv.cy));
    nv.samples.push({ x: cx, y: cy, t: Date.now() });
    if (nv.samples.length > 6) nv.samples.shift();
    setView({ z, tx: cx - dx * z, ty: cy - dy * z }, false, true);
    if (!navigatingRef.current) { navigatingRef.current = true; setNavigating(true); }
    if (pts.length > 1 && !zoomBadgeRef.current) { if (badgeTimer.current) clearTimeout(badgeTimer.current); zoomBadgeRef.current = true; setZoomBadge(true); }
  };

  const navEnd = () => {
    const nv = nav.current;
    nav.current = null;
    if (!nv) return;
    const now = Date.now();
    // Multi-finger tap: 2 = undo, 3 = redo.
    if (nv.maxN >= 2 && now - nv.t0 < 300 && nv.moved < 10) {
      if (nv.maxN === 2) { const ok = undoRef.current.length > 0; doUndo(); showHud(ok ? 'Undo' : 'Nothing to undo'); }
      else { const ok = redoRef.current.length > 0; doRedo(); showHud(ok ? 'Redo' : 'Nothing to redo'); }
      try { Haptics.selectionAsync(); } catch {}
      return;
    }
    // One-finger double-tap (when fingers scroll): zoom in there, or back to fit.
    if (nv.maxN === 1 && now - nv.t0 < 250 && nv.moved < 8) {
      const tp = { t: now, x: nv.cx, y: nv.cy };
      const lt = lastTap.current;
      if (lt && now - lt.t < 320 && Math.hypot(lt.x - tp.x, lt.y - tp.y) < 40) {
        lastTap.current = null;
        const z0 = fitZoom(LRef.current, sizeRef.current.w);
        if (viewRef.current.z < z0 * 1.6) zoomAround(1, tp.x, tp.y, z0 * 2.5); else fitWidth();
        return;
      }
      lastTap.current = tp;
    }
    navigatingRef.current = false; setNavigating(false);
    if (badgeTimer.current) clearTimeout(badgeTimer.current);
    badgeTimer.current = setTimeout(() => { zoomBadgeRef.current = false; setZoomBadge(false); }, 1600);
    // Pulled past an edge or a zoom limit: spring back.
    const cur = viewRef.current;
    const target = clampView(cur, LRef.current, sizeRef.current.w, sizeRef.current.h);
    if (Math.abs(target.z - cur.z) > 1e-3 || Math.abs(target.tx - cur.tx) > 0.5 || Math.abs(target.ty - cur.ty) > 0.5) {
      // Spring about the fingers' last centre so zooming back stays put under them.
      const last = nv.samples[nv.samples.length - 1];
      const fx = last?.x ?? sizeRef.current.w / 2, fy = last?.y ?? sizeRef.current.h / 2;
      const dxp = (fx - cur.tx) / cur.z, dyp = (fy - cur.ty) / cur.z;
      const zEnd = target.z;
      const end = clampView({ z: zEnd, tx: fx - dxp * zEnd, ty: fy - dyp * zEnd }, LRef.current, sizeRef.current.w, sizeRef.current.h);
      const t0 = Date.now(), dur = 240;
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / dur), e = 1 - Math.pow(1 - k, 3);
        const v = { z: cur.z + (end.z - cur.z) * e, tx: cur.tx + (end.tx - cur.tx) * e, ty: cur.ty + (end.ty - cur.ty) * e };
        if (k < 1) { setView(v, false, true); momentum.current = requestAnimationFrame(step); }
        else { momentum.current = null; setView(end, true); }
      };
      momentum.current = requestAnimationFrame(step);
      return;
    }
    setView(viewRef.current, true);
    const sm = nv.samples.filter((s) => now - s.t < 90);
    if (sm.length >= 2) {
      const a = sm[0], b = sm[sm.length - 1];
      const dt = Math.max(8, b.t - a.t);
      let vx = ((b.x - a.x) / dt) * 16, vy = ((b.y - a.y) / dt) * 16;
      if (Math.hypot(vx, vy) > 2) {
        const step = () => {
          vx *= 0.94; vy *= 0.94;
          const v = viewRef.current;
          setView({ z: v.z, tx: v.tx + vx, ty: v.ty + vy });
          const more = Math.hypot(vx, vy) > 0.4;
          momentum.current = more ? requestAnimationFrame(step) : null;
          if (!more) setView(viewRef.current, true);
        };
        momentum.current = requestAnimationFrame(step);
      }
    }
  };

  // ----- responder -----
  const pencilSeen = () => {
    if (!SRef.current.pencilSeen) {
      setSettings({ pencilSeen: true, pencilOnly: true });
      toast('Apple Pencil detected — fingers now scroll and zoom. Change it in the ⋯ menu.');
    }
  };

  const enterNav = () => {
    // A finger stroke that only just started is cancelled; the user meant to pinch.
    const dr = drawer.current;
    if (dr && !dr.pencil) finishStroke(dr, Date.now() - dr.t0 < 260);
    if (lassoRef.current && !lassoRef.current.pts.length) lassoRef.current = null;
    mode.current = 'nav';
    navBegin();
  };

  const sync = (e: GestureResponderEvent, phase: 'start' | 'move' | 'end' | 'cancel') => {
    const ev = e.nativeEvent;
    const list = (phase === 'end' || phase === 'cancel') && !ev.touches?.length ? [] : (ev.touches ?? []);
    const now = Date.now();
    const seen = new Set<string>();
    const ox = origin.current.x, oy = origin.current.y;
    // Moved / new touches.
    for (const raw of list as any[]) {
      const id = String(raw.identifier);
      seen.add(id);
      // Position relative to the canvas, straight from the event (the canvas is
      // the touch target and fills this view). The measured offset is only a fallback:
      // it is measured asynchronously and can be stale for the first touch.
      const lx = raw.locationX, ly = raw.locationY;
      const okLoc = Number.isFinite(lx) && Number.isFinite(ly);
      const sx = okLoc ? lx : fin(raw.pageX) - ox, sy = okLoc ? ly : fin(raw.pageY) - oy;
      const f = fin(raw.force, 0);
      const t = touches.current.get(id);
      if (t) {
        t.x = sx; t.y = sy;
        (t as any).ts = Number.isFinite(raw.timestamp) ? raw.timestamp : now;
        (t as any).force = f;
        if (!t.pencil && f > 0 && now - t.t0 < 150 && Platform.OS === 'ios') { t.pencil = true; onPencilLate(t); }
        else onTouchMove(t, f);
      } else {
        const nt: Touch = { id, x: sx, y: sy, sx, sy, t0: now, pencil: Platform.OS === 'ios' && f > 0 };
        (nt as any).force = f;
        // Event timestamps (ms) drive the ink filter; keep one clock for the whole stroke.
        (nt as any).ts = (nt as any).ts0 = Number.isFinite(raw.timestamp) ? raw.timestamp : now;
        touches.current.set(id, nt);
        onTouchStart(nt);
      }
    }
    // Lifted touches.
    for (const [id, t] of [...touches.current]) {
      if (!seen.has(id)) { touches.current.delete(id); onTouchEnd(t, phase === 'cancel'); }
    }
    if (!touches.current.size) mode.current = 'idle';
  };

  const pendingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingTouch = useRef<Touch | null>(null);

  const promotePending = () => {
    if (pendingTimer.current) { clearTimeout(pendingTimer.current); pendingTimer.current = null; }
    const t = pendingTouch.current;
    pendingTouch.current = null;
    if (!t || mode.current !== 'pending') return;
    mode.current = 'draw';
    toolStart({ ...t, x: t.sx, y: t.sy });
    if (t.x !== t.sx || t.y !== t.sy) toolMove(t, 0);
  };

  const onTouchStart = (t: Touch) => {
    stopMomentum();
    if (editingRef.current) { Keyboard.dismiss(); commitEditing(); mode.current = 'ignore'; return; }
    if (!active) onActivate?.();
    if (mode.current === 'ignore') return;
    if (t.pencil) {
      pencilSeen();
      if (mode.current === 'draw' && drawer.current?.pencil) return;
      // Pencil wins over anything the fingers were doing.
      if (mode.current === 'nav') { nav.current = null; setSettledZ(viewRef.current.z); }
      if (mode.current === 'pending') { pendingTouch.current = null; if (pendingTimer.current) clearTimeout(pendingTimer.current); }
      const dr = drawer.current;
      if (dr && !dr.pencil) finishStroke(dr, true);
      mode.current = 'draw';
      if (toolRef.current === 'hand') { mode.current = 'nav'; return; }
      toolStart(t);
      return;
    }
    // A finger.
    const pencilActive = [...touches.current.values()].some((x) => x.pencil);
    if (pencilActive) return; // palm while writing
    const fingers = [...touches.current.values()].filter((x) => !x.pencil).length;
    if (mode.current === 'idle') {
      const fingerDraws = !SRef.current.pencilOnly && toolRef.current !== 'hand';
      if (fingerDraws && fingers === 1) {
        mode.current = 'pending';
        pendingTouch.current = t;
        pendingTimer.current = setTimeout(promotePending, 110);
      } else { mode.current = 'nav'; navBegin(); }
      return;
    }
    if (mode.current === 'pending') {
      pendingTouch.current = null;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      enterNav();
      return;
    }
    if (mode.current === 'draw') {
      const dr = drawer.current;
      if (dr?.pencil) return;
      if (dragRef.current || eraseRef.current || lassoRef.current) {
        // Second finger during a finger-driven tool: end it and start zooming.
        const first = [...touches.current.values()].find((x) => x.id !== t.id);
        if (first) toolEnd(first, false);
      }
      enterNav();
      return;
    }
    if (mode.current === 'nav') navBegin();
  };

  // The pencil's first event can report zero force; once it shows up as a
  // pencil, undo whatever the "finger" started and draw from where it landed.
  const onPencilLate = (t: Touch) => {
    if (mode.current === 'pending' && pendingTouch.current?.id === t.id) {
      pendingTouch.current = null;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
    } else if (mode.current === 'nav' && touches.current.size === 1) {
      nav.current = null;
    } else if (mode.current === 'draw' && drawer.current?.touch === t.id) {
      drawer.current.pencil = true;
      rebuildInk(drawer.current);
      return;
    } else return;
    pencilSeen();
    mode.current = 'draw';
    if (toolRef.current === 'hand') { mode.current = 'nav'; return; }
    toolStart(t);
    toolMove(t, (t as any).force ?? 0);
  };

  const onTouchMove = (t: Touch, f: number) => {
    if (mode.current === 'ignore') return;
    if (mode.current === 'pending' && pendingTouch.current?.id === t.id) {
      if (Math.hypot(t.x - t.sx, t.y - t.sy) > 4) promotePending();
      return;
    }
    if (mode.current === 'draw') {
      if (t.pencil || !drawer.current?.pencil) toolMove(t, f);
      return;
    }
    if (mode.current === 'nav' && !t.pencil) {
      // One-finger scroll waits for a little movement so a resting palm doesn't scroll.
      const nv = nav.current;
      if (nv && nv.n === 1 && nv.moved < 1 && Math.hypot(t.x - t.sx, t.y - t.sy) < 7) return;
      navMove();
    }
  };

  const onTouchEnd = (t: Touch, cancel: boolean) => {
    if (mode.current === 'ignore') return;
    const quick = Date.now() - t.t0 < TAP_MS && Math.hypot(t.x - t.sx, t.y - t.sy) < TAP_SLOP;
    if (mode.current === 'pending' && pendingTouch.current?.id === t.id) {
      // A quick finger tap.
      pendingTouch.current = null;
      if (pendingTimer.current) clearTimeout(pendingTimer.current);
      mode.current = 'idle';
      const tl = toolRef.current;
      if (quick && trySeek(t)) return;
      if (quick && (tl === 'text' || tl === 'lasso')) { tapAt(t); return; }
      mode.current = 'draw';
      toolStart(t);
      toolEnd(t, false);
      return;
    }
    if (mode.current === 'draw') {
      const tl = toolRef.current;
      if (quick && !dragRef.current && replayRef.current && trySeek(t)) {
        const dr = drawer.current;
        if (dr) finishStroke(dr, true);
        lassoRef.current = null;
        if (eraseRef.current) { eraseRef.current = null; cursor.current = null; }
        force();
        return;
      }
      if (quick && (tl === 'text' || tl === 'lasso') && !dragRef.current) {
        lassoRef.current = null;
        tapAt(t);
        force();
        return;
      }
      toolEnd(t, cancel);
      return;
    }
    if (mode.current === 'nav') {
      const left = [...touches.current.values()].filter((x) => !x.pencil).length;
      if (left === 0) navEnd(); else navBegin();
    }
  };

  const measure = () => rootRef.current?.measureInWindow?.((x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) origin.current = { x, y }; });

  const responders = {
    onStartShouldSetResponder: () => true,
    onMoveShouldSetResponder: () => true,
    onResponderTerminationRequest: () => false,
    onResponderGrant: (e: GestureResponderEvent) => { measure(); sync(e, 'start'); },
    onResponderStart: (e: GestureResponderEvent) => sync(e, 'start'),
    onResponderMove: (e: GestureResponderEvent) => sync(e, 'move'),
    onResponderEnd: (e: GestureResponderEvent) => sync(e, 'end'),
    onResponderRelease: (e: GestureResponderEvent) => sync(e, 'end'),
    onResponderTerminate: (e: GestureResponderEvent) => sync(e, 'cancel'),
  };

  // Mouse wheel scroll on web (preview testing).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const el = rootRef.current as any;
    const node: HTMLElement | null = el && (el instanceof (globalThis as any).HTMLElement ? el : null);
    if (!node) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const v = viewRef.current;
      if (e.ctrlKey) {
        const r = node.getBoundingClientRect();
        const cx = e.clientX - r.left, cy = e.clientY - r.top;
        const z = v.z * Math.exp(-e.deltaY * 0.01);
        const dx = (cx - v.tx) / v.z, dy = (cy - v.ty) / v.z;
        setView({ z, tx: cx - dx * z, ty: cy - dy * z }, true);
      } else setView({ z: v.z, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
    };
    node.addEventListener('wheel', onWheel, { passive: false });
    return () => node.removeEventListener('wheel', onWheel);
  }, [doc, setView]);

  // ----- history -----
  const doUndo = () => {
    const d = docRef.current;
    const prev = undoRef.current.pop();
    if (!d || !prev) return;
    redoRef.current.push(d.pages);
    setSel(null);
    commit(prev, null);
  };
  const doRedo = () => {
    const d = docRef.current;
    const next = redoRef.current.pop();
    if (!d || !next) return;
    undoRef.current.push(d.pages);
    setSel(null);
    commit(next, null);
  };

  // ----- handle -----
  const gotoPage = (i: number) => {
    const d = docRef.current;
    if (!d || !d.pages[i]) return;
    stopMomentum();
    const v = viewRef.current;
    setView({ z: v.z, tx: v.tx, ty: TOP - LRef.current.tops[i] * v.z }, true);
  };

  const api: NoteViewHandle = {
    undo: doUndo,
    redo: doRedo,
    gotoPage,
    addPage: (after) => {
      const d = docRef.current;
      if (!d) return;
      const i = after ?? currentPage();
      const ref = d.pages[i];
      const sz = d.paper.size ? pageSizeOf(d.paper.size) : ref && ref.bg.kind === 'paper' ? ref : LETTER;
      const np = paperPage(d.paper.style, d.paper.color, { w: sz.w, h: sz.h });
      const pages = d.pages.slice();
      pages.splice(i + 1, 0, np);
      setSel(null);
      commit(pages);
      setTimeout(() => gotoPage(i + 1), 30);
    },
    deletePage: (i) => {
      const d = docRef.current;
      if (!d || d.pages.length <= 1) { toast('A note needs at least one page.'); return; }
      commit(d.pages.filter((_, k) => k !== i));
      setSel(null);
    },
    duplicatePage: (i) => {
      const d = docRef.current;
      if (!d || !d.pages[i]) return;
      const p = d.pages[i];
      const copy: Page = { ...p, id: uid('p'), strokes: p.strokes.map((s) => ({ ...s, id: uid('s') })), texts: p.texts.map((t) => ({ ...t, id: uid('t') })), images: p.images.map((m) => ({ ...m, id: uid('i') })) };
      const pages = d.pages.slice();
      pages.splice(i + 1, 0, copy);
      commit(pages);
    },
    movePage: (i, dir) => {
      const d = docRef.current;
      const j = i + dir;
      if (!d || j < 0 || j >= d.pages.length) return;
      const pages = d.pages.slice();
      [pages[i], pages[j]] = [pages[j], pages[i]];
      setSel(null);
      commit(pages);
    },
    insertImage: async () => {
      const d = docRef.current;
      if (!d) return;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (res.canceled || !res.assets?.[0]) return;
      busy('Adding photo…');
      try {
        const im = await saveImage(d.id, res.assets[0].uri, 1800);
        const i = currentPage();
        const p = docRef.current!.pages[i];
        const w = Math.min(p.w * 0.6, im.w), h = (w * im.h) / Math.max(1, im.w);
        const c = visibleCentre(i);
        const item: ImageItem = { id: uid('i'), x: clamp(c.x - w / 2, 0, p.w - w), y: clamp(c.y - h / 2, 0, Math.max(0, p.h - h)), w, h, file: im.file };
        setPage(i, (pg) => ({ ...pg, images: [...pg.images, item] }));
        onRequestTool?.('lasso');
        selectItems(i, [], [], [item.id]);
      } catch (e) { toast("Couldn't add that photo."); }
      finally { busy(null); }
    },
    insertSticker: (emoji) => {
      const d = docRef.current;
      if (!d) return;
      const i = currentPage();
      const c = visibleCentre(i);
      const t: TextItem = { id: uid('t'), x: c.x - 32, y: c.y - 32, w: 80, text: emoji, size: 56, color: '#000000', sticker: 1 };
      setPage(i, (p) => ({ ...p, texts: [...p.texts, t] }));
      onRequestTool?.('lasso');
      selectItems(i, [], [t.id], []);
    },
    insertPdf: async (uri) => {
      const d = docRef.current;
      if (!d) return;
      busy('Adding PDF pages…');
      try {
        const { pages, text } = await pdfPages(d.id, uri, (m) => busy(m));
        if (text) lib.updateNote(d.id, { pdfText: ((lib.meta(d.id)?.pdfText ?? '') + ' ' + text).slice(0, 24000) });
        const i = currentPage();
        const next = docRef.current!.pages.slice();
        next.splice(i + 1, 0, ...pages);
        commit(next);
        toast(`Added ${pages.length} page${pages.length === 1 ? '' : 's'}.`);
      } catch (e) { toast(String((e as Error)?.message ?? e)); }
      finally { busy(null); }
    },
    insertPhotosAsPages: async () => {
      const d = docRef.current;
      if (!d) return;
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1, selectionLimit: 30 });
      if (res.canceled || !res.assets?.length) return;
      busy('Adding pages…');
      try {
        const pages = await imagePages(d.id, res.assets.map((a) => a.uri));
        const i = currentPage();
        const next = docRef.current!.pages.slice();
        next.splice(i + 1, 0, ...pages);
        commit(next);
      } catch { toast("Couldn't add those photos."); }
      finally { busy(null); }
    },
    paste: () => {
      const c = clipboard.get();
      const d = docRef.current;
      if (!c || !d) return;
      const i = currentPage();
      const ctr = visibleCentre(i);
      placeItems(i, c, { dx: ctr.x - (c.box.x + c.box.w / 2), dy: ctr.y - (c.box.y + c.box.h / 2), s: 1, ox: 0, oy: 0 }, c.noteId);
    },
    exportPdf: async () => {
      commitEditing();
      await flush();
      const d = docRef.current;
      if (!d) return;
      const title = lib.meta(d.id)?.title ?? 'Note';
      busy('Making PDF…');
      try {
        const out = await exportNotePdf(d, title, (k, n) => busy(`Making PDF… page ${k} of ${n}`));
        busy(null);
        await sharePdf(out, title);
      } catch (e) { busy(null); toast("Couldn't export: " + String((e as Error)?.message ?? e)); }
    },
    flush: async () => { commitEditing(); await flush(); },
    addRecording: (r) => {
      const d = docRef.current;
      if (!d) return;
      const nd = { ...d, recordings: [...(d.recordings ?? []), r] };
      docRef.current = nd; setDoc(nd); scheduleSave();
      lib.updateNote(d.id, { audio: nd.recordings.length });
    },
    removeRecording: (id) => {
      const d = docRef.current;
      if (!d) return;
      const r = d.recordings?.find((x) => x.id === id);
      const rest = (d.recordings ?? []).filter((x) => x.id !== id);
      const pages = d.pages.map((p) => (p.strokes.some((s) => s.rt?.[0] === id) ? { ...p, strokes: p.strokes.map((s) => (s.rt?.[0] === id ? (({ rt: _, ...k }) => k)(s) : s)) } : p));
      const nd = { ...d, recordings: rest, pages };
      docRef.current = nd; setDoc(nd); scheduleSave();
      undoRef.current = []; redoRef.current = [];
      lib.updateNote(d.id, { audio: rest.length });
      if (r) fsx.remove(notePath(d.id, r.file));
    },
    setPageSize: (size) => {
      const d = docRef.current;
      if (!d) return;
      const nd = { ...d, paper: { ...d.paper, size } };
      docRef.current = nd; setDoc(nd); scheduleSave();
      toast(`New pages will be ${pageSizeOf(size).name}`);
    },
    setPaper: (bg) => {
      const d = docRef.current;
      if (!d) return;
      const nd = { ...d, paper: { style: bg.style, color: bg.color } };
      docRef.current = nd;
      commit(d.pages.map((p) => (p.bg.kind === 'paper' ? { ...p, bg: { kind: 'paper', style: bg.style, color: bg.color } } : p)));
    },
  };
  useImperativeHandle(handleRef, () => api);

  // After the view settles, re-render the visible part of a zoomed-in PDF page at screen sharpness.
  useEffect(() => {
    const gen = ++tileGen.current;
    const d = docRef.current;
    if (!d || !size.w || navigating) return;
    const timer = setTimeout(async () => {
      const v = viewRef.current;
      const i = currentPage();
      const p = d.pages[i];
      if (!p || p.bg.kind !== 'pdf') { setTile(null); return; }
      const scale = v.z * PixelRatio.get();
      if (p.w * scale <= BG_TIERS[1] * 1.08) { setTile(null); return; }   // the page image is sharp enough
      const a = toPage(i, 0, 0), b = toPage(i, sizeRef.current.w, sizeRef.current.h);
      const x = clamp(a.x, 0, p.w), y = clamp(a.y, 0, p.h), w = clamp(b.x, 0, p.w) - x, h = clamp(b.y, 0, p.h) - y;
      if (w < 4 || h < 4) return;
      let s = scale;
      const maxPx = 3.2e6;
      if (w * h * s * s > maxPx) s = Math.sqrt(maxPx / (w * h));
      try {
        const r = await engine.region(pdfKey(noteId, p.bg.file), notePath(noteId, p.bg.file), p.bg.index, s, { x, y, w, h });
        if (gen !== tileGen.current) return;
        const img = Skia.Image.MakeImageFromEncoded(Skia.Data.fromBase64(r.b64));
        if (img) setTile({ pageId: p.id, x, y, w, h, img });
      } catch {}
    }, 260);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, size.w, size.h, navigating, doc?.pages.length]);

  // Report state up to the toolbar.
  const curPage = doc ? currentPage() : 0;
  const lastState = useRef('');
  const lastDoc = useRef<NoteDoc | null>(null);
  useEffect(() => {
    const drawingNow = !!drawer.current || !!eraseRef.current || !!lassoRef.current;
    const key = [undoRef.current.length > 0, redoRef.current.length > 0, curPage, doc?.pages.length ?? 0, !!sel, Math.round(view.z * 100), doc ? 1 : 0, drawingNow, doc?.recordings?.length ?? 0].join('|');
    if (key === lastState.current && lastDoc.current === doc) return;
    lastState.current = key;
    lastDoc.current = doc;
    onState?.({ canUndo: undoRef.current.length > 0, canRedo: redoRef.current.length > 0, page: curPage, pages: doc?.pages.length ?? 0, selection: !!sel, zoom: view.z / Math.max(0.01, fitZoom(L, size.w || 1)), doc, drawing: drawingNow });
  });

  // Leaving the lasso tool drops the selection; leaving text commits it.
  useEffect(() => { if (tool !== 'lasso') setSel(null); if (tool !== 'text') commitEditing(); }, [tool]); // eslint-disable-line react-hooks/exhaustive-deps

  // ----- render -----
  if (failed) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: th.desk }}><Text style={{ color: th.sub, fontSize: 16 }}>This note couldn't be opened.</Text></View>;
  }

  const pages = doc?.pages ?? [];
  // A screen of margin above and below, so fast scrolling never shows blank pages.
  const vis = doc && size.w ? visiblePages(L, pages, view, size.h, size.h) : [];
  const dpr = PixelRatio.get();
  const dr = drawer.current;
  const la = lassoRef.current;
  const dg = dragRef.current;
  const cur = cursor.current;

  let lassoPath = null as ReturnType<typeof livePath>;
  if (la && la.pts.length > 1) {
    const p = Skia.PathBuilder.Make();
    p.moveTo(la.pts[0].x, la.pts[0].y);
    for (const q of la.pts) p.lineTo(q.x, q.y);
    lassoPath = p.detach();
  }
  const selPage = sel ? pages[sel.page] : null;
  const selPic = sel && selPage ? selectionPicture(noteId, selPage, sel) : null;
  const exclude = sel ? { strokes: sel.strokes, texts: sel.texts, images: sel.images } : editing ? { texts: new Set([editing.item.id]) } : null;
  const z = view.z;
  const darkPaperOf = (p: Page) => p.bg.kind === 'paper' && p.bg.color === 'dark';

  // Selection box on screen (for the floating menu).
  let selScreen: { x: number; y: number; w: number; h: number } | null = null;
  if (sel && !dg) {
    const a = pageToScreen(sel.page, sel.box.x, sel.box.y);
    selScreen = { x: a.x, y: a.y, w: sel.box.w * z, h: sel.box.h * z };
  }
  const last = pages.length - 1;
  const addBtn = doc && size.w ? pageToScreen(last, pages[last].w / 2, pages[last].h + GAP * 0.5) : null;

  return (
    <View ref={rootRef} style={{ flex: 1, backgroundColor: th.desk, overflow: 'hidden' }}
      onLayout={(e) => { const { width, height } = e.nativeEvent.layout; sizeRef.current = { w: width, h: height }; setSize({ w: width, h: height }); measure(); }}
      {...responders}>
      {size.w > 0 && doc ? (
        <Canvas style={{ position: 'absolute', left: 0, top: 0, width: size.w, height: size.h }} pointerEvents="none">
          <Group transform={viewTf}>
          {vis.map((i) => {
            const p = pages[i];
            const want = i === curPage ? tierFor(p.w * settledZ * dpr) : BG_TIERS[0];
            const bg = p.bg.kind === 'paper' ? null : bestBg(noteId, p, want);
            return (
              <Group key={p.id} transform={[{ translateX: L.xs[i] }, { translateY: L.tops[i] }]}>
                <Picture picture={paperPicture(p)} />
                {bg ? <SkImageNode image={bg} x={0} y={0} width={p.w} height={p.h} fit="fill" /> : null}
                {tile && tile.pageId === p.id && tile.img ? <SkImageNode image={tile.img} x={tile.x} y={tile.y} width={tile.w} height={tile.h} fit="fill" /> : null}
                <Picture picture={inkPicture(noteId, p, sel?.page === i || editing?.page === i ? exclude : null, imgVer, replay)} />
                {selPic && sel?.page === i ? (
                  <Group transform={dg ? [{ translateX: dg.xf.ox + dg.xf.dx }, { translateY: dg.xf.oy + dg.xf.dy }, { scale: dg.xf.s }, { translateX: -dg.xf.ox }, { translateY: -dg.xf.oy }] : []}>
                    <Picture picture={selPic} />
                    <Rect x={sel.box.x - 4 / z} y={sel.box.y - 4 / z} width={sel.box.w + 8 / z} height={sel.box.h + 8 / z} style="stroke" strokeWidth={1.4 / z} color={th.accent}>
                      <DashPathEffect intervals={[6 / z, 4 / z]} />
                    </Rect>
                    <Circle cx={sel.box.x + sel.box.w + 4 / z} cy={sel.box.y + sel.box.h + 4 / z} r={8 / z} color={th.accent} />
                    <Circle cx={sel.box.x + sel.box.w + 4 / z} cy={sel.box.y + sel.box.h + 4 / z} r={4.5 / z} color="#ffffff" />
                  </Group>
                ) : null}
                {lassoPath && la?.page === i ? (
                  <Path path={lassoPath} style="stroke" strokeWidth={1.5 / z} color={th.accent}>
                    <DashPathEffect intervals={[7 / z, 5 / z]} />
                  </Path>
                ) : null}
                {cur && cur.page === i ? <Circle cx={cur.x} cy={cur.y} r={cur.r} style="stroke" strokeWidth={1.2 / z} color="#7A7F8A" /> : null}
              </Group>
            );
          })}
          </Group>
          <Picture picture={livePic} />
        </Canvas>
      ) : null}

      {!navigating && addBtn && addBtn.y < size.h + 40 && addBtn.y > -40 ? (
        <Pressable onPress={() => api.addPage(last)}
          style={({ pressed }) => ({ position: 'absolute', left: addBtn.x - 70, top: addBtn.y - 2, width: 140, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? th.chip : th.card, borderWidth: 1, borderColor: th.line })}>
          <Text style={{ color: th.sub, fontSize: 14, fontWeight: '600' }}>+ Add page</Text>
        </Pressable>
      ) : null}

      {!navigating && selScreen && sel ? (
        <View style={{ position: 'absolute', left: clamp(selScreen.x + selScreen.w / 2 - 170, 8, Math.max(8, size.w - 348)), top: selScreen.y - 56 < 6 ? Math.min(size.h - 54, selScreen.y + selScreen.h + 14) : selScreen.y - 56,
          flexDirection: 'row', alignItems: 'center', gap: 2, backgroundColor: th.elev, borderRadius: 14, paddingHorizontal: 6, height: 44, shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, borderWidth: th.dark ? 1 : 0, borderColor: th.line }}>
          <SelBtn label="Copy" onPress={() => { copySel(); toast('Copied'); }} />
          <SelBtn label="Cut" onPress={() => { copySel(); deleteSel(); }} />
          <SelBtn label="Duplicate" onPress={duplicateSel} />
          <SelBtn label="Delete" danger onPress={deleteSel} />
          {['#111111', '#1E5EFF', '#E5322D', '#0AA35B', '#F28C18', '#8E44EC'].map((c) => (
            <Pressable key={c} onPress={() => recolorSel(c)} hitSlop={4} style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: c, marginHorizontal: 2, borderWidth: 2, borderColor: th.elev }} />
          ))}
        </View>
      ) : null}

      {editing ? (() => {
        const a = pageToScreen(editing.page, editing.item.x, editing.item.y);
        return (
          <TextInput
            value={editing.item.text}
            onChangeText={(text) => setEditing({ ...editing, item: { ...editing.item, text } })}
            onBlur={commitEditing}
            autoFocus multiline scrollEnabled={false}
            placeholder="Type…" placeholderTextColor={th.faint}
            style={{ position: 'absolute', left: a.x - 4, top: a.y - 4, width: editing.item.w * z + 8, minHeight: editing.item.size * z * 1.4 + 8,
              fontSize: editing.item.size * z, lineHeight: editing.item.size * z * 1.18, color: editing.item.color, padding: 4, paddingTop: 4,
              fontFamily: Platform.OS === 'ios' ? 'Helvetica Neue' : undefined, borderWidth: 1.5, borderColor: th.accent, borderRadius: 6, backgroundColor: 'rgba(37,99,235,0.05)' }}
          />
        );
      })() : null}

      {zoomBadge && doc ? (
        <Pressable onPress={() => { const z0 = fitZoom(L, size.w); setView({ z: z0, tx: (size.w - L.w * z0) / 2, ty: TOP - L.tops[curPage] * z0 }, true); setZoomBadge(false); }}
          style={{ position: 'absolute', top: 12, alignSelf: 'center', flexDirection: 'row', gap: 8, alignItems: 'center', backgroundColor: th.dark ? 'rgba(40,41,46,0.95)' : 'rgba(28,29,33,0.88)', borderRadius: 16, paddingHorizontal: 14, height: 32 }}>
          <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{Math.round((view.z / Math.max(0.01, fitZoom(L, size.w || 1))) * 100)}%</Text>
          <Text style={{ color: '#ffffffaa', fontSize: 13 }}>Tap to fit</Text>
        </Pressable>
      ) : null}

      {hud ? (
        <View pointerEvents="none" style={{ position: 'absolute', top: '38%', alignSelf: 'center', backgroundColor: th.dark ? 'rgba(240,241,244,0.95)' : 'rgba(24,25,29,0.86)', borderRadius: 20, paddingHorizontal: 22, height: 44, justifyContent: 'center' }}>
          <Text key={hud.n} style={{ color: th.dark ? '#111' : '#fff', fontSize: 17, fontWeight: '700' }}>{hud.text}</Text>
        </View>
      ) : null}

      {doc && !navigating ? (
        <View style={{ position: 'absolute', left: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', backgroundColor: th.dark ? 'rgba(40,41,46,0.92)' : 'rgba(255,255,255,0.94)', borderRadius: 15, height: 30, borderWidth: 1, borderColor: th.line }}>
          <Pressable onPress={() => zoomAround(1 / 1.35)} accessibilityLabel="Zoom out" hitSlop={6} style={{ width: 34, height: 30, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: th.sub, fontSize: 18, fontWeight: '600' }}>−</Text>
          </Pressable>
          <Pressable onPress={fitWidth} accessibilityLabel="Fit page width" style={{ paddingHorizontal: 4, height: 30, justifyContent: 'center' }}>
            <Text style={{ color: th.sub, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'], minWidth: 40, textAlign: 'center' }}>{Math.round((view.z / Math.max(0.01, fitZoom(L, size.w || 1))) * 100)}%</Text>
          </Pressable>
          <Pressable onPress={() => zoomAround(1.35)} accessibilityLabel="Zoom in" hitSlop={6} style={{ width: 34, height: 30, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: th.sub, fontSize: 18, fontWeight: '600' }}>+</Text>
          </Pressable>
        </View>
      ) : null}

      {doc ? (
        <Pressable onPress={onPageBadge} accessibilityLabel="Pages" hitSlop={8}
          style={{ position: 'absolute', right: 12, bottom: 12, backgroundColor: th.dark ? 'rgba(40,41,46,0.92)' : 'rgba(255,255,255,0.94)', borderRadius: 14, paddingHorizontal: 12, height: 30, justifyContent: 'center', borderWidth: 1, borderColor: th.line }}>
          <Text style={{ color: th.sub, fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{curPage + 1} / {pages.length}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

function SelBtn({ label, onPress, danger }: { label: string; onPress: () => void; danger?: boolean }) {
  const th = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ paddingHorizontal: 9, height: 34, borderRadius: 9, justifyContent: 'center', backgroundColor: pressed ? th.chip : 'transparent' })}>
      <Text style={{ color: danger ? th.danger : th.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}
