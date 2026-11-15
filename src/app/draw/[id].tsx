// The drawing board: a canvas with layers, brushes, symmetry, frames for animation, and ink that can be
// selected, bent and pushed around after it is drawn. Two fingers pinch to zoom and move the canvas.
import { Canvas, Group, Path, Picture, Rect, Skia } from '@shopify/react-native-skia';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type GestureResponderEvent, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Glass, Icon, MenuSheet, PromptSheet, Sheet, useToast } from '@/components/ui';
import { boundsOf, densify, mapPts, mostlyInLoop, outline, pushPts, symmetric, SYMMETRIES, WARPS, type Box, type Sym } from '@/lib/draw-geom';
import { type Blend, type Board, type BrushId, BRUSHES, type DStroke, frameJpeg, framePicture, framePixels, loadBoard, newLayer, polyPath, saveBoard } from '@/lib/draw-model';
import { fsx } from '@/lib/fsx';
import { encodeGif, toIndexes } from '@/lib/gif';
import { uid } from '@/lib/model';
import { pickColor } from '@/lib/ondevice';

type Tool = 'draw' | 'line' | 'rect' | 'ellipse' | 'select' | 'push';
type Mode = 'none' | 'stroke' | 'shape' | 'lasso' | 'move' | 'push' | 'pinch';

const BRUSH_ICON: Record<BrushId, string> = { pen: 'pencil.tip', pencil: 'pencil', marker: 'highlighter', brush: 'paintbrush.pointed', airbrush: 'aqi.medium', crayon: 'pencil.and.outline', eraser: 'eraser' };
const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'line', icon: 'line.diagonal', label: 'Line' },
  { id: 'rect', icon: 'rectangle', label: 'Rectangle' },
  { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
  { id: 'select', icon: 'lasso', label: 'Select and move' },
  { id: 'push', icon: 'hand.point.up.left', label: 'Push ink' },
];
const SWATCHES = ['#111111', '#FFFFFF', '#E5322D', '#F28C18', '#FFD60A', '#30A46C', '#0A84FF', '#6E56CF', '#E0408A', '#8B5E3C'];
const BLENDS: Blend[] = ['normal', 'multiply', 'screen', 'overlay'];
const FPS = [4, 8, 12, 24];
const DARK = '#1B1C20';

/** A tall slider, like the ones down the side of a painting app. */
function SideSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const h = useRef(1);
  const at = (e: GestureResponderEvent) => onChange(Math.max(0, Math.min(1, 1 - e.nativeEvent.locationY / h.current)));
  return (
    <View accessibilityLabel={label} style={{ width: 34, height: 150, borderRadius: 17, backgroundColor: 'rgba(255,255,255,0.14)', overflow: 'hidden', justifyContent: 'flex-end' }}
      onLayout={(e) => { h.current = Math.max(1, e.nativeEvent.layout.height); }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={at} onResponderMove={at}>
      <View pointerEvents="none" style={{ height: `${Math.max(4, value * 100)}%`, backgroundColor: 'rgba(255,255,255,0.75)' }} />
    </View>
  );
}

export default function DrawBoard() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const ins = useSafeAreaInsets();
  const { toast } = useToast();
  const [board, setBoardRaw] = useState<Board | null>(null);
  const boardRef = useRef<Board | null>(null);
  const [fi, setFi] = useState(0);
  const [layerId, setLayerId] = useState('');
  const [tool, setTool] = useState<Tool>('draw');
  const [brush, setBrush] = useState<BrushId>('pen');
  const [color, setColor] = useState('#111111');
  const [size, setSize] = useState(0.18);      // 0...1
  const [alpha, setAlpha] = useState(1);
  const [fill, setFill] = useState(false);
  const [sym, setSym] = useState<Sym>('off');
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState({ z: 1, tx: 0, ty: 0 });
  const [area, setArea] = useState({ w: 1, h: 1 });
  const [, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sheet, setSheet] = useState<null | 'layers' | 'more' | 'sym' | 'bend' | 'rename' | 'clear'>(null);
  const [busy, setBusy] = useState(false);
  const undo = useRef<Board[]>([]);
  const redo = useRef<Board[]>([]);
  const [, setHist] = useState(0);
  const live = useRef<number[]>([]);
  const mode = useRef<Mode>('none');
  const start = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const pinch = useRef({ d: 1, mx: 0, my: 0, z: 1, ox: 0, oy: 0, s: 1 });
  const raf = useRef<number | null>(null);
  const dirty = useRef(false);

  const widthPx = 1 + size * size * 79;   // 1...80 canvas points, finer at the small end

  // ---------- the board, its history and saving ----------

  const apply = (next: Board, record = true) => {
    if (record && boardRef.current) {
      undo.current.push(boardRef.current);
      if (undo.current.length > 60) undo.current.shift();
      redo.current = [];
      setHist((n) => n + 1);
    }
    boardRef.current = next;
    dirty.current = true;
    setBoardRaw(next);
  };
  const snapshot = () => {
    if (!boardRef.current) return;
    undo.current.push(boardRef.current);
    if (undo.current.length > 60) undo.current.shift();
    redo.current = [];
    setHist((n) => n + 1);
  };
  const step = (from: Board[], to: Board[]) => {
    const b = from.pop();
    if (!b || !boardRef.current) return;
    to.push(boardRef.current);
    setSel([]);
    setFi((f) => Math.min(f, b.frames.length - 1));
    if (!b.layers.some((l) => l.id === layerId)) setLayerId(b.layers[b.layers.length - 1].id);
    apply(b, false);
    setHist((n) => n + 1);
  };

  useEffect(() => {
    let alive = true;
    loadBoard(String(id)).then((b) => {
      if (!alive) return;
      if (!b) { toast("That drawing couldn't be opened."); router.back(); return; }
      boardRef.current = b;
      setBoardRaw(b);
      setLayerId(b.layers[b.layers.length - 1].id);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const save = async () => {
    const b = boardRef.current;
    if (!b || !dirty.current) return;
    dirty.current = false;
    try { await saveBoard(b, frameJpeg(b, 0, 360)); } catch { dirty.current = true; }
  };
  useEffect(() => {
    const i = setInterval(save, 4000);
    return () => { clearInterval(i); save(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!playing || !board) return;
    const i = setInterval(() => setFi((f) => (f + 1) % boardRef.current!.frames.length), 1000 / board.fps);
    return () => clearInterval(i);
  }, [playing, board?.fps, board?.frames.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- where the canvas sits on screen ----------

  const fit = board ? Math.min((area.w - 120) / board.w, (area.h - 40) / board.h) : 1;
  const s = Math.max(0.01, fit * view.z);
  const ox = board ? (area.w - board.w * s) / 2 + view.tx : 0;
  const oy = board ? (area.h - board.h * s) / 2 + view.ty : 0;
  const geo = useRef({ s, ox, oy });
  geo.current = { s, ox, oy };
  const toCanvas = (lx: number, ly: number) => ({ x: (lx - geo.current.ox) / geo.current.s, y: (ly - geo.current.oy) / geo.current.s });

  const strokesOf = (b: Board, f: number, l: string) => b.frames[f]?.strokes[l] ?? [];
  const setStrokes = (b: Board, f: number, l: string, list: DStroke[]): Board =>
    ({ ...b, frames: b.frames.map((fr, i) => (i === f ? { strokes: { ...fr.strokes, [l]: list } } : fr)) });

  const selBox = (): Box | null => {
    const b = boardRef.current;
    if (!b || !sel.length) return null;
    return boundsOf(strokesOf(b, fi, layerId).filter((x) => sel.includes(x.id)).map((x) => x.pts));
  };

  /** Changes the selected strokes; one undo step unless `record` is false (a drag records once, at its start). */
  const editSel = (f: (st: DStroke, box: Box) => DStroke, record = true) => {
    const b = boardRef.current, box = selBox();
    if (!b || !box) return;
    apply(setStrokes(b, fi, layerId, strokesOf(b, fi, layerId).map((x) => (sel.includes(x.id) ? f(x, box) : x))), record);
  };
  const about = (box: Box, f: (dx: number, dy: number) => [number, number]) => (x: number, y: number): [number, number] => {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const [nx, ny] = f(x - cx, y - cy);
    return [cx + nx, cy + ny];
  };
  const scaleSel = (k: number) => editSel((st, box) => ({ ...st, width: st.width * k, pts: mapPts(st.pts, about(box, (dx, dy) => [dx * k, dy * k])) }));
  const turnSel = (a: number) => editSel((st, box) => ({ ...st, pts: mapPts(st.pts, about(box, (dx, dy) => [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)])) }));
  const flipSel = () => editSel((st, box) => ({ ...st, pts: mapPts(st.pts, about(box, (dx, dy) => [-dx, dy])) }));
  const bendSel = (wid: string) => {
    const w = WARPS.find((x) => x.id === wid);
    if (w) editSel((st, box) => ({ ...st, pts: mapPts(densify(st.pts), (x, y) => w.f(x, y, box)) }));
  };
  const deleteSel = () => {
    const b = boardRef.current;
    if (!b) return;
    apply(setStrokes(b, fi, layerId, strokesOf(b, fi, layerId).filter((x) => !sel.includes(x.id))));
    setSel([]);
  };
  const duplicateSel = () => {
    const b = boardRef.current;
    if (!b) return;
    const copies = strokesOf(b, fi, layerId).filter((x) => sel.includes(x.id)).map((x) => ({ ...x, id: uid('s'), pts: mapPts(x.pts, (px, py) => [px + 24, py + 24]) }));
    apply(setStrokes(b, fi, layerId, [...strokesOf(b, fi, layerId), ...copies]));
    setSel(copies.map((c) => c.id));
  };

  // ---------- touches ----------

  const redraw = () => { if (raf.current == null) raf.current = requestAnimationFrame(() => { raf.current = null; setTick((n) => n + 1); }); };
  const two = (e: GestureResponderEvent) => {
    const t = e.nativeEvent.touches;
    const a = t[0], b = t[1];
    return { d: Math.max(1, Math.hypot(a.locationX - b.locationX, a.locationY - b.locationY)), mx: (a.locationX + b.locationX) / 2, my: (a.locationY + b.locationY) / 2 };
  };
  const pressure = (e: GestureResponderEvent) => { const f = (e.nativeEvent as { force?: number }).force; return f && f > 0 ? Math.max(0.05, Math.min(1, f)) : 0.5; };

  const onGrant = (e: GestureResponderEvent) => {
    const b = boardRef.current;
    if (!b || playing) return;
    if (e.nativeEvent.touches.length >= 2) { beginPinch(e); return; }
    const p = toCanvas(e.nativeEvent.locationX, e.nativeEvent.locationY);
    start.current = p;
    last.current = p;
    const layer = b.layers.find((l) => l.id === layerId);
    if (tool !== 'select' && layer && !layer.visible) { toast('That layer is hidden. Show it to draw on it.'); mode.current = 'none'; return; }
    if (tool === 'draw') { mode.current = 'stroke'; live.current = [p.x, p.y, pressure(e)]; }
    else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') { mode.current = 'shape'; live.current = []; }
    else if (tool === 'select') {
      const box = selBox();
      const m = 24 / geo.current.s;
      if (box && p.x > box.x - m && p.x < box.x + box.w + m && p.y > box.y - m && p.y < box.y + box.h + m) { mode.current = 'move'; snapshot(); }
      else { mode.current = 'lasso'; live.current = [p.x, p.y, 1]; setSel([]); }
    } else {
      // Pushing bends lines, so they are first given enough points to bend smoothly.
      mode.current = 'push';
      snapshot();
      apply(setStrokes(b, fi, layerId, strokesOf(b, fi, layerId).map((x) => (x.brush === 'eraser' ? x : { ...x, pts: densify(x.pts, 4) }))), false);
    }
    redraw();
  };

  const beginPinch = (e: GestureResponderEvent) => {
    // A second finger: whatever was being drawn is dropped, and the canvas moves instead.
    if (mode.current === 'move' || mode.current === 'push') { const b = undo.current.pop(); if (b) apply(b, false); }
    live.current = [];
    mode.current = 'pinch';
    const t = two(e);
    pinch.current = { ...t, z: view.z, ox: geo.current.ox, oy: geo.current.oy, s: geo.current.s };
    redraw();
  };

  const onMove = (e: GestureResponderEvent) => {
    const b = boardRef.current;
    if (!b) return;
    if (e.nativeEvent.touches.length >= 2) {
      if (mode.current !== 'pinch') { beginPinch(e); return; }
      const t = two(e), p0 = pinch.current;
      const z = Math.max(0.4, Math.min(16, p0.z * (t.d / p0.d)));
      const ns = fit * z;
      const cx = (p0.mx - p0.ox) / p0.s, cy = (p0.my - p0.oy) / p0.s;   // the canvas point under the fingers stays under them
      setView({ z, tx: t.mx - cx * ns - (area.w - b.w * ns) / 2, ty: t.my - cy * ns - (area.h - b.h * ns) / 2 });
      return;
    }
    if (mode.current === 'pinch' || mode.current === 'none') return;
    const p = toCanvas(e.nativeEvent.locationX, e.nativeEvent.locationY);
    const dx = p.x - last.current.x, dy = p.y - last.current.y;
    if (mode.current === 'stroke') {
      if (Math.hypot(dx, dy) * geo.current.s < 1.2) return;
      live.current.push(p.x, p.y, pressure(e));
    } else if (mode.current === 'lasso') {
      live.current.push(p.x, p.y, 1);
    } else if (mode.current === 'shape') {
      live.current = outline(tool as 'line' | 'rect' | 'ellipse', [start.current.x, start.current.y], [p.x, p.y]).pts;
    } else if (mode.current === 'move') {
      editSel((st) => ({ ...st, pts: mapPts(st.pts, (x, y) => [x + dx, y + dy]) }), false);
    } else if (mode.current === 'push') {
      const radius = 30 + widthPx * 2;
      apply(setStrokes(b, fi, layerId, strokesOf(b, fi, layerId).map((x) => {
        if (x.brush === 'eraser') return x;
        const moved = pushPts(x.pts, p.x, p.y, dx, dy, radius);
        return moved ? { ...x, pts: moved } : x;
      })), false);
    }
    last.current = p;
    redraw();
  };

  const onRelease = () => {
    const b = boardRef.current;
    const m = mode.current;
    mode.current = 'none';
    if (!b) return;
    const pts = live.current;
    live.current = [];
    if ((m === 'stroke' || m === 'shape') && pts.length >= 3) {
      const base = { brush, color, width: widthPx, alpha };
      const made: DStroke[] = symmetric(pts, sym, b.w, b.h).map((q) => ({ id: uid('s'), ...base, pts: q, closed: m === 'shape' && tool !== 'line', fill: m === 'shape' && tool !== 'line' && fill && brush !== 'eraser' }));
      apply(setStrokes(b, fi, layerId, [...strokesOf(b, fi, layerId), ...made]));
    } else if (m === 'lasso') {
      const loop: number[] = [];
      for (let i = 0; i + 2 < pts.length + 0; i += 3) loop.push(pts[i], pts[i + 1]);
      setSel(loop.length >= 8 ? strokesOf(b, fi, layerId).filter((x) => mostlyInLoop(x.pts, loop)).map((x) => x.id) : []);
    }
    redraw();
  };

  // ---------- layers and frames ----------

  const addLayer = () => {
    const b = boardRef.current;
    if (!b) return;
    const l = newLayer(`Layer ${b.layers.length + 1}`);
    apply({ ...b, layers: [...b.layers, l] });
    setLayerId(l.id);
    setSel([]);
  };
  const patchLayer = (lid: string, p: Partial<Board['layers'][number]>) => { const b = boardRef.current; if (b) apply({ ...b, layers: b.layers.map((l) => (l.id === lid ? { ...l, ...p } : l)) }); };
  const moveLayer = (lid: string, by: number) => {
    const b = boardRef.current;
    if (!b) return;
    const i = b.layers.findIndex((l) => l.id === lid), j = i + by;
    if (i < 0 || j < 0 || j >= b.layers.length) return;
    const list = b.layers.slice();
    [list[i], list[j]] = [list[j], list[i]];
    apply({ ...b, layers: list });
  };
  const removeLayer = (lid: string) => {
    const b = boardRef.current;
    if (!b || b.layers.length < 2) { toast('A drawing keeps at least one layer.'); return; }
    const layers = b.layers.filter((l) => l.id !== lid);
    apply({ ...b, layers, frames: b.frames.map((f) => { const st = { ...f.strokes }; delete st[lid]; return { strokes: st }; }) });
    if (layerId === lid) setLayerId(layers[layers.length - 1].id);
    setSel([]);
  };
  const addFrame = (copy: boolean) => {
    const b = boardRef.current;
    if (!b) return;
    if (b.frames.length >= 120) { toast('That is the most frames one drawing can hold.'); return; }
    const fresh = copy ? { strokes: { ...b.frames[fi].strokes } } : { strokes: {} };
    apply({ ...b, frames: [...b.frames.slice(0, fi + 1), fresh, ...b.frames.slice(fi + 1)] });
    setFi(fi + 1);
    setSel([]);
  };
  const removeFrame = () => {
    const b = boardRef.current;
    if (!b || b.frames.length < 2) { toast('A drawing keeps at least one frame.'); return; }
    apply({ ...b, frames: b.frames.filter((_, i) => i !== fi) });
    setFi(Math.max(0, fi - 1));
    setSel([]);
  };

  // ---------- sharing ----------

  const sharePicture = async () => {
    const b = boardRef.current;
    if (!b) return;
    try {
      const jpg = frameJpeg(b, fi, Math.min(2048, b.w * 2));
      if (!jpg) throw new Error("Couldn't make the picture.");
      const path = `inkpad/out/${b.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Drawing'}.jpg`;
      await fsx.writeBase64(path, jpg);
      await Sharing.shareAsync(fsx.uri(path), { mimeType: 'image/jpeg', UTI: 'public.jpeg' });
    } catch (e) { toast(String((e as Error)?.message ?? e)); }
  };
  const shareGif = async () => {
    const b = boardRef.current;
    if (!b) return;
    setBusy(true);
    try {
      await new Promise((r) => setTimeout(r, 30));   // lets "Making the GIF" show first
      const frames: Uint8Array[] = [];
      let w = 0, h = 0;
      for (let i = 0; i < b.frames.length; i++) {
        const px = framePixels(b, i, 480);
        if (!px) throw new Error("Couldn't make the animation.");
        w = px.w; h = px.h;
        frames.push(toIndexes(px.rgba, w, h));
      }
      const path = `inkpad/out/${b.name.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Drawing'}.gif`;
      await fsx.remove(path);
      await fsx.writeBytes(path, encodeGif(frames, w, h, Math.max(2, Math.round(100 / b.fps))));
      await Sharing.shareAsync(fsx.uri(path), { mimeType: 'image/gif', UTI: 'com.compuserve.gif' });
    } catch (e) { toast(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  // ---------- what's on screen ----------

  const picture = useMemo(() => (board ? framePicture(board, Math.min(fi, board.frames.length - 1), board.onion && !playing) : null), [board, fi, playing]);
  // Redrawn on every tick while a finger is down: the line being drawn, and its mirror images.
  const livePaths = !board || !live.current.length ? [] : mode.current === 'lasso' ? [polyPath(live.current)] : symmetric(live.current, sym, board.w, board.h).map((q) => polyPath(q));
  const box = selBox();
  const clip = useMemo(() => (board ? Skia.XYWHRect(0, 0, board.w, board.h) : undefined), [board?.w, board?.h]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!board || !picture) return <View style={{ flex: 1, backgroundColor: DARK }} />;

  const liveWidth = brush === 'marker' ? widthPx * 3.2 : brush === 'airbrush' ? widthPx * 2.2 : brush === 'eraser' ? widthPx * 2 : widthPx;
  const liveColor = brush === 'eraser' ? board.bg : color;
  const liveAlpha = brush === 'marker' ? 0.4 * alpha : brush === 'airbrush' ? 0.3 * alpha : alpha;
  const btn = (icon: string, label: string, onPress: () => void, on = false, off = false) => (
    <Pressable key={label} accessibilityLabel={label} disabled={off} onPress={onPress} style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.3 : pressed ? 0.6 : 1, backgroundColor: on ? 'rgba(10,132,255,0.28)' : 'transparent' })}>
      <Icon name={icon} size={19} color={on ? '#0A84FF' : '#F2F2F7'} />
    </Pressable>
  );
  const chip = (text: string, label: string, onPress: () => void, on = false) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ height: 34, paddingHorizontal: 12, borderRadius: 17, justifyContent: 'center', backgroundColor: on ? '#0A84FF' : 'rgba(255,255,255,0.14)', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );
  const bar = { backgroundColor: 'rgba(44,44,48,0.94)', borderRadius: 24 } as const;

  return (
    <View style={{ flex: 1, backgroundColor: DARK }}>
      <Stack.Screen options={{ gestureEnabled: false, statusBarHidden: true }} />
      <View style={{ flex: 1 }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Canvas style={{ flex: 1 }} pointerEvents="none">
          <Group transform={[{ translateX: ox }, { translateY: oy }, { scale: s }]}>
            <Rect x={-2 / s} y={-2 / s} width={board.w + 4 / s} height={board.h + 4 / s} color="rgba(0,0,0,0.35)" />
            <Group clip={clip}>
              <Picture picture={picture} />
              {mode.current !== 'lasso' ? livePaths.map((p, i) => <Path key={i} path={p} style="stroke" strokeWidth={liveWidth} strokeCap="round" strokeJoin="round" color={liveColor} opacity={liveAlpha} />) : null}
            </Group>
            {mode.current === 'lasso' && livePaths[0] ? <Path path={livePaths[0]} style="stroke" strokeWidth={1.5 / s} color="#0A84FF" /> : null}
            {box ? <Rect x={box.x - 8 / s} y={box.y - 8 / s} width={box.w + 16 / s} height={box.h + 16 / s} style="stroke" strokeWidth={1.5 / s} color="#0A84FF" /> : null}
          </Group>
        </Canvas>
        <View accessibilityLabel="Canvas" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderGrant={onGrant} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease} onResponderTerminationRequest={() => false} />

        {/* Top: leaving, undo, the brushes and tools, layers and more. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: ins.top + 8, left: 10, right: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 8 }}>
          <View style={[bar, { flexDirection: 'row', padding: 4 }]}>
            {btn('chevron.left', 'Back to the gallery', async () => { await save(); router.back(); })}
            {btn('arrow.uturn.backward', 'Undo', () => step(undo.current, redo.current), false, !undo.current.length)}
            {btn('arrow.uturn.forward', 'Redo', () => step(redo.current, undo.current), false, !redo.current.length)}
          </View>
          <View style={{ flex: 1, alignItems: 'center' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[bar, { flexGrow: 0, maxWidth: '100%' }]} contentContainerStyle={{ padding: 4, alignItems: 'center' }}>
              {BRUSHES.map((x) => btn(BRUSH_ICON[x.id], x.label, () => { setBrush(x.id); setTool('draw'); setSel([]); }, tool === 'draw' && brush === x.id))}
              <View style={{ width: 1, height: 22, backgroundColor: 'rgba(255,255,255,0.2)', marginHorizontal: 6 }} />
              {TOOLS.map((x) => btn(x.icon, x.label, () => { setTool(x.id); if (x.id !== 'select') setSel([]); }, tool === x.id))}
              {btn(fill ? 'square.fill' : 'square', fill ? 'Shapes are filled' : 'Shapes are outlines', () => setFill((v) => !v), fill)}
              {btn('circle.hexagongrid', 'Symmetry', () => setSheet('sym'), sym !== 'off')}
            </ScrollView>
          </View>
          <View style={[bar, { flexDirection: 'row', padding: 4 }]}>
            {btn('square.3.layers.3d', 'Layers', () => setSheet('layers'))}
            {btn('ellipsis', 'More', () => setSheet('more'))}
          </View>
        </View>

        {/* Left: size and strength. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 12, top: 0, bottom: 0, justifyContent: 'center' }}>
          <View style={[bar, { padding: 8, gap: 10, alignItems: 'center' }]}>
            <View style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: Math.max(3, Math.min(32, widthPx * 0.6)), height: Math.max(3, Math.min(32, widthPx * 0.6)), borderRadius: 16, backgroundColor: '#fff' }} />
            </View>
            <SideSlider label="Brush size" value={size} onChange={setSize} />
            <SideSlider label="Brush strength" value={alpha} onChange={(v) => setAlpha(Math.max(0.05, v))} />
          </View>
        </View>

        {/* Right: colours. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', right: 12, top: 0, bottom: 0, justifyContent: 'center' }}>
          <View style={[bar, { padding: 8, gap: 8, alignItems: 'center' }]}>
            {SWATCHES.map((c) => (
              <Pressable key={c} accessibilityLabel={`Colour ${c}`} onPress={() => setColor(c)} style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: c, borderWidth: color === c ? 3 : 1, borderColor: color === c ? '#0A84FF' : 'rgba(255,255,255,0.4)' }} />
            ))}
            <Pressable accessibilityLabel="Pick any colour" onPress={async () => { const c = await pickColor(color); if (c) setColor(c); }} style={{ width: 30, height: 30, borderRadius: 15, backgroundColor: color, borderWidth: 2, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="eyedropper" size={13} color={color.toUpperCase() === '#FFFFFF' ? '#111' : '#fff'} />
            </Pressable>
          </View>
        </View>

        {/* What can be done with the selected ink. */}
        {sel.length ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', bottom: 108, left: 0, right: 0, alignItems: 'center' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[bar, { flexGrow: 0, maxWidth: '94%' }]} contentContainerStyle={{ padding: 6, gap: 6, alignItems: 'center' }}>
              {chip('Bigger', 'Make the selection bigger', () => scaleSel(1.15))}
              {chip('Smaller', 'Make the selection smaller', () => scaleSel(1 / 1.15))}
              {chip('Turn left', 'Turn the selection left', () => turnSel(-Math.PI / 12))}
              {chip('Turn right', 'Turn the selection right', () => turnSel(Math.PI / 12))}
              {chip('Flip', 'Flip the selection', flipSel)}
              {chip('Bend…', 'Bend the selection', () => setSheet('bend'))}
              {chip('Recolour', 'Give the selection the current colour', () => editSel((st) => (st.brush === 'eraser' ? st : { ...st, color })))}
              {chip('Duplicate', 'Duplicate the selection', duplicateSel)}
              {chip('Delete', 'Delete the selection', deleteSel)}
              {chip('Done', 'Let go of the selection', () => setSel([]), true)}
            </ScrollView>
          </View>
        ) : null}

        {/* Bottom: the frames. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', bottom: ins.bottom + 10, left: 10, right: 10, alignItems: 'center' }}>
          <View style={[bar, { flexDirection: 'row', alignItems: 'center', padding: 6, gap: 6, maxWidth: '100%' }]}>
            {btn(playing ? 'pause.fill' : 'play.fill', playing ? 'Pause' : 'Play the animation', () => { setSel([]); setPlaying((v) => !v); }, playing, board.frames.length < 2)}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
              {board.frames.map((_, i) => (
                <Pressable key={i} accessibilityLabel={`Frame ${i + 1}`} onPress={() => { setPlaying(false); setSel([]); setFi(i); }} style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: i === fi ? '#0A84FF' : 'rgba(255,255,255,0.14)' }}>
                  <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{i + 1}</Text>
                </Pressable>
              ))}
            </ScrollView>
            {btn('plus', 'New empty frame', () => addFrame(false))}
            {btn('plus.square.on.square', 'Copy this frame into a new one', () => addFrame(true))}
            {btn('trash', 'Delete this frame', removeFrame, false, board.frames.length < 2)}
            {chip(`${board.fps} fps`, 'Animation speed', () => apply({ ...board, fps: FPS[(FPS.indexOf(board.fps) + 1) % FPS.length] }, false))}
            {chip('Onion', 'Show the frame before, faintly', () => apply({ ...board, onion: !board.onion }, false), board.onion)}
          </View>
        </View>

        {busy ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <Glass radius={18} style={{ paddingHorizontal: 22, paddingVertical: 14 }}><Text style={{ fontSize: 16, fontWeight: '600', color: '#15171C' }}>Making the GIF…</Text></Glass>
          </View>
        ) : null}
      </View>

      <MenuSheet visible={sheet === 'sym'} onClose={() => setSheet(null)} title="Symmetry" items={SYMMETRIES.map((x) => ({ label: x.label, icon: 'circle.hexagongrid', checked: sym === x.id, onPress: () => setSym(x.id) }))} />
      <MenuSheet visible={sheet === 'bend'} onClose={() => setSheet(null)} title="Bend the ink" items={WARPS.map((w) => ({ label: w.label, icon: 'wand.and.rays', onPress: () => bendSel(w.id) }))} />
      <MenuSheet topRight visible={sheet === 'more'} onClose={() => setSheet(null)} items={[
        { group: 1, label: 'Share this picture', icon: 'photo', onPress: sharePicture },
        { group: 1, label: 'Share as an animated GIF', sub: `${board.frames.length} ${board.frames.length === 1 ? 'frame' : 'frames'}`, icon: 'film', onPress: shareGif },
        { group: 2, label: 'Background colour', icon: 'paintpalette', onPress: async () => { const c = await pickColor(board.bg); if (c) apply({ ...boardRef.current!, bg: c }); } },
        { group: 2, label: 'Fit the canvas to the screen', icon: 'arrow.up.left.and.arrow.down.right', onPress: () => setView({ z: 1, tx: 0, ty: 0 }) },
        { group: 3, label: board.name, sub: 'Tap to rename', icon: 'pencil', onPress: () => setSheet('rename') },
        { group: 4, label: 'Clear this layer', icon: 'trash', danger: true, onPress: () => setSheet('clear') },
      ]} />
      <Sheet visible={sheet === 'layers'} onClose={() => setSheet(null)} title="Layers" width={440}>
        {board.layers.slice().reverse().map((l) => {
          const on = l.id === layerId;
          return (
            <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, backgroundColor: on ? '#E9EEFD' : 'transparent' }}>
              <Pressable accessibilityLabel={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} hitSlop={8} onPress={() => patchLayer(l.id, { visible: !l.visible })}><Icon name={l.visible ? 'eye' : 'eye.slash'} size={19} color={l.visible ? '#15171C' : '#9AA2B2'} /></Pressable>
              <Pressable accessibilityLabel={`Draw on ${l.name}`} onPress={() => { setLayerId(l.id); setSel([]); }} style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: on ? '700' : '500', color: '#15171C' }}>{l.name}</Text>
                <Text style={{ fontSize: 12, color: '#6B7385' }}>{strokesOf(board, fi, l.id).length} strokes</Text>
              </Pressable>
              <Pressable accessibilityLabel={`${l.name} strength ${Math.round(l.opacity * 100)} percent. Tap to change.`} onPress={() => patchLayer(l.id, { opacity: l.opacity <= 0.25 ? 1 : l.opacity - 0.25 })} style={{ height: 30, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: '#ECEDF1' }}><Text style={{ fontSize: 13, fontWeight: '600', color: '#15171C' }}>{Math.round(l.opacity * 100)}%</Text></Pressable>
              <Pressable accessibilityLabel={`${l.name} blend ${l.blend}. Tap to change.`} onPress={() => patchLayer(l.id, { blend: BLENDS[(BLENDS.indexOf(l.blend) + 1) % BLENDS.length] })} style={{ height: 30, width: 76, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEDF1' }}><Text style={{ fontSize: 13, fontWeight: '600', color: '#15171C' }}>{l.blend[0].toUpperCase() + l.blend.slice(1)}</Text></Pressable>
              <Pressable accessibilityLabel={`Move ${l.name} up`} hitSlop={6} onPress={() => moveLayer(l.id, 1)}><Icon name="chevron.up" size={15} color="#3B4252" /></Pressable>
              <Pressable accessibilityLabel={`Move ${l.name} down`} hitSlop={6} onPress={() => moveLayer(l.id, -1)}><Icon name="chevron.down" size={15} color="#3B4252" /></Pressable>
              <Pressable accessibilityLabel={`Delete ${l.name}`} hitSlop={6} onPress={() => removeLayer(l.id)}><Icon name="trash" size={16} color="#E5322D" /></Pressable>
            </View>
          );
        })}
        <Pressable accessibilityLabel="Add a layer" onPress={addLayer} style={{ height: 44, borderRadius: 12, marginTop: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF' }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Add a layer</Text>
        </Pressable>
      </Sheet>
      <PromptSheet visible={sheet === 'rename'} title="Rename drawing" initial={board.name} onCancel={() => setSheet(null)}
        onSubmit={(v) => { setSheet(null); if (v.trim()) apply({ ...boardRef.current!, name: v.trim() }, false); }} />
      <ConfirmSheet visible={sheet === 'clear'} title="Clear this layer?" message="Everything on this layer in this frame goes. Undo brings it back." confirm="Clear" onCancel={() => setSheet(null)}
        onConfirm={() => { setSheet(null); setSel([]); apply(setStrokes(boardRef.current!, fi, layerId, [])); }} />
    </View>
  );
}
