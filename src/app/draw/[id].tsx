// The drawing board. One thin bar across the top, two sliders down the side, and everything else a tap
// away in a menu: brushes, colours, layers, frames for animation, and ways to change ink after it's
// drawn. Two fingers pinch to zoom and move; two fingers tap to undo, three to redo.
import { Canvas, Group, Path, Picture, Rect, Skia } from '@shopify/react-native-skia';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type GestureResponderEvent, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Icon, type MenuItem, MenuSheet, PromptSheet, Sheet, useToast } from '@/components/ui';
import { adjustColor, boundsOf, densify, hexOfHsl, inLoop, invertColor, type Liquify, liquify, mapPts, mixColor, mostlyInLoop, outline, roughenPts, smoothPts, snapShape, symmetric, SYMMETRIES, tweenPts, WARPS, type Box, type Sym } from '@/lib/draw-geom';
import { type Blend, type Board, type BrushId, BRUSH_SETS, type BrushPreset, type DStroke, frameJpeg, framePicture, framePixels, layerPicture, loadBoard, newLayer, polyPath, saveBoard } from '@/lib/draw-model';
import { fsx } from '@/lib/fsx';
import { encodeGif, toIndexes } from '@/lib/gif';
import { uid } from '@/lib/model';
import { pickColor } from '@/lib/ondevice';

type Tool = 'draw' | 'line' | 'rect' | 'ellipse' | 'select' | 'liquify' | 'pick' | 'fill' | 'zap';
type Mode = 'none' | 'stroke' | 'shape' | 'lasso' | 'move' | 'liquify' | 'zap' | 'pinch';
type SheetName = null | 'actions' | 'adjust' | 'tools' | 'brushes' | 'colours' | 'layers' | 'sym' | 'bend' | 'rename' | 'clear' | 'layerMenu' | 'layerName' | 'liquify';

const TOOL_NAME: Record<Tool, string> = { draw: '', line: 'Line', rect: 'Rectangle', ellipse: 'Ellipse', select: 'Select', liquify: 'Liquify', pick: 'Pick a colour', fill: 'Fill', zap: 'Stroke eraser' };
const BLENDS: Blend[] = ['normal', 'multiply', 'screen', 'overlay'];
const FPS = [4, 8, 12, 24];
const DARK = '#161618';
const BAR = 'rgba(38,38,42,0.92)';
const HUES = [0, 18, 36, 52, 85, 140, 170, 195, 215, 245, 275, 315];
const SHADES: [number, number][] = [[0.9, 0.84], [0.85, 0.7], [0.8, 0.56], [0.78, 0.44], [0.72, 0.32], [0.65, 0.2]];
const GREYS = ['#FFFFFF', '#E6E6E6', '#C4C4C4', '#9A9A9A', '#6E6E6E', '#4A4A4A', '#2E2E2E', '#111111', '#000000', '#7B5B3A', '#C2A27A', '#F2D6B3'];
const PALETTE = [...SHADES.map(([s, l]) => HUES.map((h) => hexOfHsl(h, s, l))), GREYS];
const SAMPLE = (() => { const p: number[] = []; for (let i = 0; i <= 40; i++) { const t = i / 40; p.push(14 + t * 172, 22 + Math.sin(t * Math.PI * 2) * 11, 0.25 + 0.75 * Math.sin(Math.PI * t)); } return p; })();

/** A tall slider, like the ones down the side of a painting app. */
function SideSlider({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const h = useRef(1);
  const at = (e: GestureResponderEvent) => onChange(Math.max(0, Math.min(1, 1 - e.nativeEvent.locationY / h.current)));
  return (
    <View accessibilityLabel={label} style={{ width: 26, height: 132, borderRadius: 13, backgroundColor: 'rgba(255,255,255,0.12)', overflow: 'hidden', justifyContent: 'flex-end' }}
      onLayout={(e) => { h.current = Math.max(1, e.nativeEvent.layout.height); }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={at} onResponderMove={at}>
      <View pointerEvents="none" style={{ height: `${Math.max(4, value * 100)}%`, backgroundColor: 'rgba(255,255,255,0.7)' }} />
    </View>
  );
}

/** How a brush looks, drawn with the brush itself. */
function BrushPreview({ preset, on }: { preset: BrushPreset; on: boolean }) {
  const pic = useMemo(() => layerPicture([{ id: preset.id, brush: preset.brush, color: '#FFFFFF', width: 2 + preset.size * 14, alpha: preset.alpha, pts: SAMPLE }], 200, 44), [preset]);
  return (
    <View style={{ borderRadius: 12, borderCurve: 'continuous', backgroundColor: on ? '#0A84FF' : '#2A2A2E', paddingHorizontal: 10, paddingTop: 8, paddingBottom: 4 }}>
      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{preset.label}</Text>
      <Canvas style={{ width: 200, height: 44 }} pointerEvents="none"><Picture picture={pic} /></Canvas>
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
  const [presetId, setPresetId] = useState('studio');
  const [color, setColor] = useState('#111111');
  const [size, setSize] = useState(0.18);      // 0...1
  const [alpha, setAlpha] = useState(1);
  const [fill, setFill] = useState(false);
  const [sym, setSym] = useState<Sym>('off');
  const [liq, setLiq] = useState<Liquify>('push');
  const [sel, setSel] = useState<string[]>([]);
  const [view, setView] = useState({ z: 1, tx: 0, ty: 0 });
  const [area, setArea] = useState({ w: 1, h: 1 });
  const [, setTick] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sheet, setSheet] = useState<SheetName>(null);
  const [layerTarget, setLayerTarget] = useState('');
  const [steady, setSteady] = useState(false);
  const [snap, setSnap] = useState(false);
  const [guide, setGuide] = useState<'off' | 'grid' | 'thirds'>('off');
  const [anim, setAnim] = useState(false);
  const [bounce, setBounce] = useState(false);
  const [replay, setReplay] = useState<number | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const smooth = useRef({ x: 0, y: 0 });
  const undo = useRef<Board[]>([]);
  const redo = useRef<Board[]>([]);
  const clip = useRef<DStroke[]>([]);
  const [, setHist] = useState(0);
  const live = useRef<number[]>([]);
  const mode = useRef<Mode>('none');
  const start = useRef({ x: 0, y: 0 });
  const last = useRef({ x: 0, y: 0 });
  const pinch = useRef({ d: 1, mx: 0, my: 0, z: 1, ox: 0, oy: 0, s: 1 });
  const tap = useRef({ at: 0, fingers: 0, moved: 0 });
  const dir = useRef(1);
  const raf = useRef<number | null>(null);
  const dirty = useRef(false);

  const widthPx = 1 + size * size * 79;   // 1...80 canvas points, finer at the small end
  const erasing = tool === 'draw' && brush === 'eraser';

  // ---------- the board, its history and saving ----------

  const apply = (next: Board, record = true) => {
    if (record && boardRef.current) {
      undo.current.push(boardRef.current);
      if (undo.current.length > 80) undo.current.shift();
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
    if (undo.current.length > 80) undo.current.shift();
    redo.current = [];
    setHist((n) => n + 1);
  };
  const step = (from: Board[], to: Board[]) => {
    const b = from.pop();
    if (!b || !boardRef.current) return false;
    to.push(boardRef.current);
    setSel([]);
    setFi((f) => Math.min(f, b.frames.length - 1));
    if (!b.layers.some((l) => l.id === layerId)) setLayerId(b.layers[b.layers.length - 1].id);
    apply(b, false);
    setHist((n) => n + 1);
    return true;
  };
  const doUndo = () => { if (!step(undo.current, redo.current)) toast('Nothing to undo'); };
  const doRedo = () => { if (!step(redo.current, undo.current)) toast('Nothing to redo'); };

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
    const i = setInterval(() => setFi((f) => {
      const n = boardRef.current!.frames.length;
      if (!bounce) return (f + 1) % n;
      if (f + dir.current < 0 || f + dir.current >= n) dir.current = -dir.current;
      return Math.max(0, Math.min(n - 1, f + dir.current));
    }), 1000 / board.fps);
    return () => clearInterval(i);
  }, [playing, bounce, board?.fps, board?.frames.length]);   // eslint-disable-line react-hooks/exhaustive-deps

  // Replaying the drawing: the strokes come back a few at a time.
  const total = board ? board.layers.reduce((n, l) => n + (board.frames[fi]?.strokes[l.id]?.length ?? 0), 0) : 0;
  useEffect(() => {
    if (replay == null) return;
    if (replay >= total) { const t = setTimeout(() => setReplay(null), 700); return () => clearTimeout(t); }
    const t = setTimeout(() => setReplay((n) => (n == null ? null : n + Math.max(1, Math.ceil(total / 150)))), 33);
    return () => clearTimeout(t);
  }, [replay, total]);

  // ---------- where the canvas sits on screen ----------

  const fit = board ? Math.min((area.w - 110) / board.w, (area.h - 130) / board.h) : 1;
  const s = Math.max(0.01, fit * view.z);
  const ox = board ? (area.w - board.w * s) / 2 + view.tx : 0;
  const oy = board ? (area.h - board.h * s) / 2 + view.ty : 0;
  const geo = useRef({ s, ox, oy });
  geo.current = { s, ox, oy };
  const toCanvas = (lx: number, ly: number) => ({ x: (lx - geo.current.ox) / geo.current.s, y: (ly - geo.current.oy) / geo.current.s });

  const strokesOf = (b: Board, f: number, l: string) => b.frames[f]?.strokes[l] ?? [];
  const setStrokes = (b: Board, f: number, l: string, list: DStroke[]): Board =>
    ({ ...b, frames: b.frames.map((fr, i) => (i === f ? { strokes: { ...fr.strokes, [l]: list } } : fr)) });
  const layerNow = () => boardRef.current?.layers.find((l) => l.id === layerId);
  const canEdit = () => {
    const l = layerNow();
    if (!l) return false;
    if (!l.visible) { toast('That layer is hidden. Show it to draw on it.'); return false; }
    if (l.locked) { toast('That layer is locked. Unlock it in Layers.'); return false; }
    return true;
  };

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
  /** Changes the selection if there is one, otherwise every stroke on the layer. */
  const editInk = (f: (st: DStroke) => DStroke) => {
    const b = boardRef.current;
    if (!b || !canEdit()) return;
    const list = strokesOf(b, fi, layerId);
    if (!list.length) { toast('There is nothing on this layer yet.'); return; }
    apply(setStrokes(b, fi, layerId, list.map((x) => (x.brush !== 'eraser' && (!sel.length || sel.includes(x.id)) ? f(x) : x))));
  };
  const about = (box: Box, f: (dx: number, dy: number) => [number, number]) => (x: number, y: number): [number, number] => {
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const [nx, ny] = f(x - cx, y - cy);
    return [cx + nx, cy + ny];
  };
  const scaleSel = (k: number) => editSel((st, box) => ({ ...st, width: st.width * k, pts: mapPts(st.pts, about(box, (dx, dy) => [dx * k, dy * k])) }));
  const turnSel = (a: number) => editSel((st, box) => ({ ...st, pts: mapPts(st.pts, about(box, (dx, dy) => [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)])) }));
  const flipSel = (up: boolean) => editSel((st, box) => ({ ...st, pts: mapPts(st.pts, about(box, (dx, dy) => (up ? [dx, -dy] : [-dx, dy]))) }));
  const centreSel = () => { const b = boardRef.current; if (b) editSel((st, box) => ({ ...st, pts: mapPts(st.pts, (x, y) => [x + b.w / 2 - (box.x + box.w / 2), y + b.h / 2 - (box.y + box.h / 2)]) })); };
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
  const copySel = () => { const b = boardRef.current; if (!b) return; clip.current = strokesOf(b, fi, layerId).filter((x) => sel.includes(x.id)); toast(`Copied ${clip.current.length} ${clip.current.length === 1 ? 'stroke' : 'strokes'}. Paste is in Actions.`); };
  const paste = (shift = 24) => {
    const b = boardRef.current;
    if (!b || !clip.current.length) { toast('Nothing copied yet. Select some ink and tap Copy.'); return; }
    if (!canEdit()) return;
    const copies = clip.current.map((x) => ({ ...x, id: uid('s'), pts: mapPts(x.pts, (px, py) => [px + shift, py + shift]) }));
    apply(setStrokes(b, fi, layerId, [...strokesOf(b, fi, layerId), ...copies]));
    setTool('select');
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
  const zapAt = (p: { x: number; y: number }) => {
    const b = boardRef.current;
    if (!b) return;
    const reach = Math.max(10 / geo.current.s, widthPx);
    const list = strokesOf(b, fi, layerId);
    const kept = list.filter((x) => { for (let i = 0; i + 2 < x.pts.length + 0; i += 3) if (Math.hypot(x.pts[i] - p.x, x.pts[i + 1] - p.y) < reach + x.width / 2) return false; return true; });
    if (kept.length !== list.length) apply(setStrokes(b, fi, layerId, kept), false);
  };

  const onGrant = (e: GestureResponderEvent) => {
    const b = boardRef.current;
    if (!b || playing || replay != null) return;
    tap.current = { at: Date.now(), fingers: e.nativeEvent.touches.length, moved: 0 };
    if (e.nativeEvent.touches.length >= 2) { beginPinch(e); return; }
    const p = toCanvas(e.nativeEvent.locationX, e.nativeEvent.locationY);
    start.current = p;
    last.current = p;
    if (tool === 'pick') {
      // The topmost ink under the finger gives its colour.
      const reach = 14 / geo.current.s;
      for (const l of b.layers.slice().reverse()) {
        if (!l.visible) continue;
        const hit = strokesOf(b, fi, l.id).slice().reverse().find((x) => {
          if (x.brush === 'eraser') return false;
          for (let i = 0; i + 2 < x.pts.length + 0; i += 3) if (Math.hypot(x.pts[i] - p.x, x.pts[i + 1] - p.y) < Math.max(reach, x.width)) return true;
          return false;
        });
        if (hit) { setColor(hit.color); setTool('draw'); toast('Colour picked'); break; }
      }
      mode.current = 'none';
      return;
    }
    if (tool !== 'select' && !canEdit()) { mode.current = 'none'; return; }
    if (tool === 'fill') {
      // The topmost closed shape around the finger is filled with the colour in hand.
      const list = strokesOf(b, fi, layerId);
      const loopOf = (x: DStroke) => { const o: number[] = []; for (let i = 0; i + 2 < x.pts.length + 0; i += 3) o.push(x.pts[i], x.pts[i + 1]); return o; };
      const hit = list.slice().reverse().find((x) => x.brush !== 'eraser' && x.pts.length >= 12 && inLoop(loopOf(x), p.x, p.y));
      if (hit) apply(setStrokes(b, fi, layerId, list.map((x) => (x === hit ? { ...x, fill: true, fillColor: color } : x))));
      else toast('Tap inside a shape on this layer to fill it.');
      mode.current = 'none';
      return;
    }
    if (tool === 'draw') { mode.current = 'stroke'; live.current = [p.x, p.y, pressure(e)]; smooth.current = p; }
    else if (tool === 'line' || tool === 'rect' || tool === 'ellipse') { mode.current = 'shape'; live.current = []; }
    else if (tool === 'zap') { mode.current = 'zap'; snapshot(); zapAt(p); }
    else if (tool === 'select') {
      const box = selBox();
      const m = 24 / geo.current.s;
      if (box && p.x > box.x - m && p.x < box.x + box.w + m && p.y > box.y - m && p.y < box.y + box.h + m) { mode.current = 'move'; snapshot(); }
      else { mode.current = 'lasso'; live.current = [p.x, p.y, 1]; setSel([]); }
    } else {
      // Liquify bends lines, so they are first given enough points to bend smoothly.
      mode.current = 'liquify';
      snapshot();
      apply(setStrokes(b, fi, layerId, strokesOf(b, fi, layerId).map((x) => (x.brush === 'eraser' ? x : { ...x, pts: densify(x.pts, 4) }))), false);
    }
    redraw();
  };

  const beginPinch = (e: GestureResponderEvent) => {
    // A second finger: whatever was being drawn is dropped, and the canvas moves instead.
    if (mode.current === 'move' || mode.current === 'liquify' || mode.current === 'zap') { const b = undo.current.pop(); if (b) apply(b, false); }
    live.current = [];
    mode.current = 'pinch';
    tap.current.fingers = Math.max(tap.current.fingers, e.nativeEvent.touches.length);
    const t = two(e);
    pinch.current = { ...t, z: view.z, ox: geo.current.ox, oy: geo.current.oy, s: geo.current.s };
    redraw();
  };

  const onMove = (e: GestureResponderEvent) => {
    const b = boardRef.current;
    if (!b) return;
    if (e.nativeEvent.touches.length >= 2) {
      if (mode.current !== 'pinch') { beginPinch(e); return; }
      tap.current.fingers = Math.max(tap.current.fingers, e.nativeEvent.touches.length);
      const t = two(e), p0 = pinch.current;
      tap.current.moved = Math.max(tap.current.moved, Math.abs(t.d - p0.d), Math.hypot(t.mx - p0.mx, t.my - p0.my));
      if (tap.current.moved < 8) return;   // still might be a tap
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
      // Steady hand: the line follows a little behind the finger, which irons out the wobble.
      const q = steady ? { x: smooth.current.x + (p.x - smooth.current.x) * 0.28, y: smooth.current.y + (p.y - smooth.current.y) * 0.28 } : p;
      smooth.current = q;
      live.current.push(q.x, q.y, pressure(e));
    } else if (mode.current === 'lasso') {
      live.current.push(p.x, p.y, 1);
    } else if (mode.current === 'shape') {
      live.current = outline(tool as 'line' | 'rect' | 'ellipse', [start.current.x, start.current.y], [p.x, p.y]).pts;
    } else if (mode.current === 'move') {
      editSel((st) => ({ ...st, pts: mapPts(st.pts, (x, y) => [x + dx, y + dy]) }), false);
    } else if (mode.current === 'zap') {
      zapAt(p);
    } else if (mode.current === 'liquify') {
      const radius = 30 + widthPx * 2;
      apply(setStrokes(b, fi, layerId, strokesOf(b, fi, layerId).map((x) => {
        if (x.brush === 'eraser') return x;
        const moved = liquify(x.pts, liq, p.x, p.y, dx, dy, radius);
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
    if (m === 'pinch') {
      // Two fingers tapped together undo; three redo.
      if (Date.now() - tap.current.at < 320 && tap.current.moved < 8) { if (tap.current.fingers >= 3) doRedo(); else doUndo(); }
      redraw();
      return;
    }
    let pts = live.current;
    live.current = [];
    if ((m === 'stroke' || m === 'shape') && pts.length >= 3) {
      let closed = m === 'shape' && tool !== 'line';
      if (m === 'stroke' && snap && brush !== 'eraser') {
        const shape = snapShape(pts);
        if (shape) { pts = shape.pts; closed = shape.closed; }
      }
      const base = { brush, color, width: widthPx, alpha };
      const made: DStroke[] = symmetric(pts, sym, b.w, b.h).map((q) => ({ id: uid('s'), ...base, pts: q, closed, fill: m === 'shape' && tool !== 'line' && fill && brush !== 'eraser' }));
      apply(setStrokes(b, fi, layerId, [...strokesOf(b, fi, layerId), ...made]));
      if (brush !== 'eraser') setRecent((r) => [color, ...r.filter((c) => c !== color)].slice(0, 12));
    } else if (m === 'lasso') {
      const loop: number[] = [];
      for (let i = 0; i + 2 < pts.length + 0; i += 3) loop.push(pts[i], pts[i + 1]);
      const list = strokesOf(b, fi, layerId);
      if (loop.length >= 12) setSel(list.filter((x) => mostlyInLoop(x.pts, loop)).map((x) => x.id));
      else {
        // A tap: the stroke under the finger.
        const reach = 14 / geo.current.s;
        const hit = list.slice().reverse().find((x) => { for (let i = 0; i + 2 < x.pts.length + 0; i += 3) if (Math.hypot(x.pts[i] - start.current.x, x.pts[i + 1] - start.current.y) < Math.max(reach, x.width)) return true; return false; });
        setSel(hit ? [hit.id] : []);
      }
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
  const duplicateLayer = (lid: string) => {
    const b = boardRef.current, src = b?.layers.find((l) => l.id === lid);
    if (!b || !src) return;
    const copy = { ...newLayer(src.name + ' copy'), opacity: src.opacity, blend: src.blend };
    const at = b.layers.findIndex((l) => l.id === lid) + 1;
    apply({ ...b, layers: [...b.layers.slice(0, at), copy, ...b.layers.slice(at)], frames: b.frames.map((f) => ({ strokes: { ...f.strokes, [copy.id]: (f.strokes[lid] ?? []).map((x) => ({ ...x, id: uid('s') })) } })) });
    setLayerId(copy.id);
    setSel([]);
  };
  const mergeDown = (lid: string) => {
    const b = boardRef.current;
    if (!b) return;
    const i = b.layers.findIndex((l) => l.id === lid);
    if (i <= 0) { toast('There is no layer under that one.'); return; }
    const under = b.layers[i - 1].id;
    apply({ ...b, layers: b.layers.filter((l) => l.id !== lid), frames: b.frames.map((f) => { const st = { ...f.strokes, [under]: [...(f.strokes[under] ?? []), ...(f.strokes[lid] ?? [])] }; delete st[lid]; return { strokes: st }; }) });
    setLayerId(under);
    setSel([]);
  };
  const flipCanvas = () => {
    const b = boardRef.current;
    if (!b) return;
    const st: Record<string, DStroke[]> = {};
    for (const l of b.layers) st[l.id] = strokesOf(b, fi, l.id).map((x) => ({ ...x, pts: mapPts(x.pts, (px, py) => [b.w - px, py]) }));
    apply({ ...b, frames: b.frames.map((f, i) => (i === fi ? { strokes: st } : f)) });
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
  const shiftFrame = (by: number) => {
    const b = boardRef.current;
    if (!b) return;
    const j = fi + by;
    if (j < 0 || j >= b.frames.length) return;
    const list = b.frames.slice();
    [list[fi], list[j]] = [list[j], list[fi]];
    apply({ ...b, frames: list });
    setFi(j);
  };
  /** In-between frames: each stroke glides from where it is in this frame to where it is in the next. */
  const tween = (count: number) => {
    const b = boardRef.current;
    if (!b) return;
    if (fi >= b.frames.length - 1) { toast('Go to a frame that has another after it. The new frames go between the two.'); return; }
    if (b.frames.length + count > 120) { toast('That would be more frames than one drawing can hold.'); return; }
    const A = b.frames[fi], B = b.frames[fi + 1];
    const made = Array.from({ length: count }, (_, k) => {
      const t = (k + 1) / (count + 1);
      const strokes: Record<string, DStroke[]> = {};
      for (const l of b.layers) {
        const a = A.strokes[l.id] ?? [], z = B.strokes[l.id] ?? [];
        const n = Math.min(a.length, z.length);
        const list: DStroke[] = [];
        for (let i = 0; i < n; i++) list.push({ ...a[i], id: uid('s'), pts: tweenPts(a[i].pts, z[i].pts, t), width: a[i].width + (z[i].width - a[i].width) * t, alpha: a[i].alpha + (z[i].alpha - a[i].alpha) * t, color: mixColor(a[i].color, z[i].color, t) });
        // Strokes with no partner: the first frame's stay for the first half, the second's arrive for the rest.
        for (const x of (t < 0.5 ? a : z).slice(n)) list.push({ ...x, id: uid('s') });
        strokes[l.id] = list;
      }
      return { strokes };
    });
    apply({ ...b, frames: [...b.frames.slice(0, fi + 1), ...made, ...b.frames.slice(fi + 1)] });
    setAnim(true);
    toast(`${count} in-between frames added. Press play.`);
  };

  // ---------- sharing ----------

  const safeName = () => (boardRef.current?.name ?? 'Drawing').replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Drawing';
  const sharePicture = async () => {
    const b = boardRef.current;
    if (!b) return;
    try {
      const jpg = frameJpeg(b, fi, Math.min(2048, b.w * 2));
      if (!jpg) throw new Error("Couldn't make the picture.");
      const path = `inkpad/out/${safeName()}.jpg`;
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
      const path = `inkpad/out/${safeName()}.gif`;
      await fsx.remove(path);
      await fsx.writeBytes(path, encodeGif(frames, w, h, Math.max(2, Math.round(100 / b.fps))));
      await Sharing.shareAsync(fsx.uri(path), { mimeType: 'image/gif', UTI: 'com.compuserve.gif' });
    } catch (e) { toast(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  // ---------- what's on screen ----------

  const shown = useMemo(() => {
    if (!board) return null;
    if (replay == null) return board;
    // Replaying: only the first so-many strokes, layer by layer from the bottom.
    let left = replay;
    const strokes: Record<string, DStroke[]> = {};
    for (const l of board.layers) { const list = board.frames[fi]?.strokes[l.id] ?? []; strokes[l.id] = list.slice(0, Math.max(0, left)); left -= list.length; }
    return { ...board, frames: board.frames.map((f, i) => (i === fi ? { strokes } : f)) };
  }, [board, replay, fi]);
  const picture = useMemo(() => (shown ? framePicture(shown, Math.min(fi, shown.frames.length - 1), shown.onion && !playing && replay == null) : null), [shown, fi, playing, replay]);
  // Redrawn on every tick while a finger is down: the line being drawn, and its mirror images.
  const livePaths = !board || !live.current.length ? [] : mode.current === 'lasso' ? [polyPath(live.current)] : symmetric(live.current, sym, board.w, board.h).map((q) => polyPath(q));
  const box = selBox();
  const guidePath = useMemo(() => {
    const p = Skia.Path.Make();
    if (!board || guide === 'off') return p;
    if (guide === 'thirds') {
      for (const f of [1 / 3, 2 / 3]) { p.moveTo(board.w * f, 0); p.lineTo(board.w * f, board.h); p.moveTo(0, board.h * f); p.lineTo(board.w, board.h * f); }
      return p;
    }
    const g = Math.max(32, Math.round(Math.min(board.w, board.h) / 12));
    for (let x = g; x < board.w; x += g) { p.moveTo(x, 0); p.lineTo(x, board.h); }
    for (let y = g; y < board.h; y += g) { p.moveTo(0, y); p.lineTo(board.w, y); }
    return p;
  }, [board?.w, board?.h, guide]);   // eslint-disable-line react-hooks/exhaustive-deps
  const symPath = useMemo(() => {
    const p = Skia.Path.Make();
    if (!board || sym === 'off') return p;
    if (sym !== 'tb') { p.moveTo(board.w / 2, 0); p.lineTo(board.w / 2, board.h); }
    if (sym !== 'lr') { p.moveTo(0, board.h / 2); p.lineTo(board.w, board.h / 2); }
    return p;
  }, [board?.w, board?.h, sym]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clipRect = useMemo(() => (board ? Skia.XYWHRect(0, 0, board.w, board.h) : undefined), [board?.w, board?.h]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!board || !picture) return <View style={{ flex: 1, backgroundColor: DARK }} />;

  const liveWidth = brush === 'neon' ? widthPx * 1.4 : brush === 'marker' ? widthPx * 3.2 : brush === 'airbrush' || brush === 'glow' ? widthPx * 2.2 : brush === 'eraser' ? widthPx * 2 : widthPx;
  const liveColor = brush === 'eraser' ? board.bg : color;
  const liveAlpha = brush === 'marker' ? 0.4 * alpha : brush === 'airbrush' ? 0.3 * alpha : alpha;
  const showFrames = anim || board.frames.length > 1;
  const pickBrush = (p: BrushPreset) => { setPresetId(p.id); setBrush(p.brush); setSize(p.size); setAlpha(p.alpha); setTool('draw'); setSel([]); setSheet(null); };
  const pickTool = (t: Tool) => { setTool(t); if (t !== 'select') setSel([]); };

  const icon = (name: string, label: string, onPress: () => void, on = false, off = false) => (
    <Pressable key={label} accessibilityLabel={label} disabled={off} onPress={onPress} hitSlop={4} style={({ pressed }) => ({ width: 40, height: 40, alignItems: 'center', justifyContent: 'center', opacity: off ? 0.28 : pressed ? 0.5 : 1 })}>
      <Icon name={name} size={20} color={on ? '#0A84FF' : '#F2F2F7'} />
    </Pressable>
  );
  const chip = (text: string, label: string, onPress: () => void, on = false) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ height: 32, paddingHorizontal: 12, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? '#0A84FF' : 'rgba(255,255,255,0.12)', opacity: pressed ? 0.6 : 1 })}>
      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>{text}</Text>
    </Pressable>
  );
  const float = { backgroundColor: BAR, borderRadius: 20, borderCurve: 'continuous' } as const;
  const scope = sel.length ? 'the selection' : 'this layer';

  const actions: MenuItem[] = [
    { group: 1, label: 'Symmetry', sub: SYMMETRIES.find((x) => x.id === sym)?.label, icon: 'circle.hexagongrid', onPress: () => setSheet('sym') },
    { group: 1, label: 'Shape snapping', sub: 'A rough line, circle or box comes out clean', icon: 'square.on.circle', checked: snap, onPress: () => setSnap((v) => !v) },
    { group: 1, label: 'Steady hand', sub: 'Smooths wobbly lines as you draw', icon: 'scribble', checked: steady, onPress: () => setSteady((v) => !v) },
    { group: 1, label: guide === 'off' ? 'Show a guide' : guide === 'grid' ? 'Guide: grid' : 'Guide: thirds', sub: 'Tap to change. It is not part of the picture', icon: 'grid', checked: guide !== 'off', onPress: () => setGuide((g) => (g === 'off' ? 'grid' : g === 'grid' ? 'thirds' : 'off')) },
    { group: 2, label: 'Paste', sub: clip.current.length ? `${clip.current.length} copied` : 'Nothing copied yet', icon: 'doc.on.clipboard', onPress: () => paste() },
    { group: 2, label: 'Flip the canvas', icon: 'arrow.left.and.right.righttriangle.left.righttriangle.right', onPress: flipCanvas },
    { group: 2, label: 'Fit the canvas to the screen', icon: 'arrow.up.left.and.arrow.down.right', onPress: () => setView({ z: 1, tx: 0, ty: 0 }) },
    { group: 2, label: 'Background colour', icon: 'paintpalette', onPress: async () => { const c = await pickColor(board.bg); if (c) apply({ ...boardRef.current!, bg: c }); } },
    { group: 3, label: 'Animation', sub: 'Frames along the bottom', icon: 'film', checked: showFrames, onPress: () => setAnim((v) => !v) },
    { group: 3, label: 'Add in-between frames', sub: 'Morphs this frame into the next', icon: 'wand.and.rays', onPress: () => tween(3) },
    { group: 3, label: 'Replay this drawing', sub: 'Watch it being drawn', icon: 'play.circle', onPress: () => { setSel([]); setReplay(0); } },
    { group: 4, label: 'Share this picture', icon: 'photo', onPress: sharePicture },
    { group: 4, label: 'Share as an animated GIF', sub: `${board.frames.length} ${board.frames.length === 1 ? 'frame' : 'frames'}`, icon: 'square.and.arrow.up', onPress: shareGif },
    { group: 5, label: board.name, sub: `${board.w} × ${board.h} · ${board.layers.length} ${board.layers.length === 1 ? 'layer' : 'layers'} · ${total} strokes. Tap to rename`, icon: 'pencil', onPress: () => setSheet('rename') },
  ];
  const adjust: MenuItem[] = [
    { group: 1, label: 'Warmer hue', icon: 'sun.max', onPress: () => editInk((x) => ({ ...x, color: adjustColor(x.color, -25, 1, 0), fillColor: x.fillColor && adjustColor(x.fillColor, -25, 1, 0) })) },
    { group: 1, label: 'Cooler hue', icon: 'snowflake', onPress: () => editInk((x) => ({ ...x, color: adjustColor(x.color, 25, 1, 0), fillColor: x.fillColor && adjustColor(x.fillColor, 25, 1, 0) })) },
    { group: 1, label: 'Brighter', icon: 'plus.circle', onPress: () => editInk((x) => ({ ...x, color: adjustColor(x.color, 0, 1, 0.08), fillColor: x.fillColor && adjustColor(x.fillColor, 0, 1, 0.08) })) },
    { group: 1, label: 'Darker', icon: 'minus.circle', onPress: () => editInk((x) => ({ ...x, color: adjustColor(x.color, 0, 1, -0.08), fillColor: x.fillColor && adjustColor(x.fillColor, 0, 1, -0.08) })) },
    { group: 1, label: 'More vivid', icon: 'drop.fill', onPress: () => editInk((x) => ({ ...x, color: adjustColor(x.color, 0, 1.3, 0) })) },
    { group: 1, label: 'Greyer', icon: 'drop', onPress: () => editInk((x) => ({ ...x, color: adjustColor(x.color, 0, 0.6, 0) })) },
    { group: 1, label: 'Invert the colours', icon: 'circle.lefthalf.filled', onPress: () => editInk((x) => ({ ...x, color: invertColor(x.color), fillColor: x.fillColor && invertColor(x.fillColor) })) },
    { group: 1, label: 'Use the colour in hand', icon: 'paintbrush', onPress: () => editInk((x) => ({ ...x, color })) },
    { group: 2, label: 'Thicker lines', icon: 'lineweight', onPress: () => editInk((x) => ({ ...x, width: Math.min(120, x.width * 1.25) })) },
    { group: 2, label: 'Thinner lines', icon: 'line.diagonal', onPress: () => editInk((x) => ({ ...x, width: Math.max(0.5, x.width / 1.25) })) },
    { group: 2, label: 'Smooth the lines', icon: 'scribble.variable', onPress: () => editInk((x) => ({ ...x, pts: smoothPts(x.pts) })) },
    { group: 2, label: 'Roughen the lines', icon: 'waveform.path', onPress: () => editInk((x) => ({ ...x, pts: roughenPts(x.pts) })) },
    { group: 2, label: 'Fainter', icon: 'circle.dotted', onPress: () => editInk((x) => ({ ...x, alpha: Math.max(0.1, x.alpha - 0.15) })) },
    { group: 2, label: 'Stronger', icon: 'circle.fill', onPress: () => editInk((x) => ({ ...x, alpha: Math.min(1, x.alpha + 0.15) })) },
    { group: 3, label: 'Liquify', sub: 'Push, pinch, expand or twirl the ink', icon: 'hand.point.up.left', onPress: () => setSheet('liquify') },
  ];
  const tools: MenuItem[] = [
    { group: 1, label: 'Line', icon: 'line.diagonal', checked: tool === 'line', onPress: () => pickTool('line') },
    { group: 1, label: 'Rectangle', icon: 'rectangle', checked: tool === 'rect', onPress: () => pickTool('rect') },
    { group: 1, label: 'Ellipse', icon: 'circle', checked: tool === 'ellipse', onPress: () => pickTool('ellipse') },
    { group: 1, label: 'Filled shapes', icon: 'square.fill', checked: fill, onPress: () => setFill((v) => !v) },
    { group: 2, label: 'Fill a closed shape', sub: 'Tap inside it', icon: 'drop.fill', checked: tool === 'fill', onPress: () => pickTool('fill') },
    { group: 2, label: 'Pick a colour from the drawing', icon: 'eyedropper', checked: tool === 'pick', onPress: () => pickTool('pick') },
    { group: 2, label: 'Stroke eraser', sub: 'Rub out whole strokes at a touch', icon: 'trash', checked: tool === 'zap', onPress: () => pickTool('zap') },
  ];

  return (
    <View style={{ flex: 1, backgroundColor: DARK }}>
      <Stack.Screen options={{ gestureEnabled: false, statusBarHidden: true }} />
      <View style={{ flex: 1 }} onLayout={(e) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <Canvas style={{ flex: 1 }} pointerEvents="none">
          <Group transform={[{ translateX: ox }, { translateY: oy }, { scale: s }]}>
            <Group clip={clipRect}>
              <Picture picture={picture} />
              {guide !== 'off' ? <Path path={guidePath} style="stroke" strokeWidth={1 / s} color="rgba(10,132,255,0.35)" /> : null}
              {sym !== 'off' ? <Path path={symPath} style="stroke" strokeWidth={1 / s} color="rgba(255,69,58,0.45)" /> : null}
              {mode.current !== 'lasso' ? livePaths.map((p, i) => <Path key={i} path={p} style="stroke" strokeWidth={liveWidth} strokeCap="round" strokeJoin="round" color={liveColor} opacity={liveAlpha} />) : null}
            </Group>
            {mode.current === 'lasso' && livePaths[0] ? <Path path={livePaths[0]} style="stroke" strokeWidth={1.5 / s} color="#0A84FF" /> : null}
            {box ? <Rect x={box.x - 8 / s} y={box.y - 8 / s} width={box.w + 16 / s} height={box.h + 16 / s} style="stroke" strokeWidth={1.5 / s} color="#0A84FF" /> : null}
          </Group>
        </Canvas>
        <View accessibilityLabel="Canvas" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
          onResponderGrant={onGrant} onResponderMove={onMove} onResponderRelease={onRelease} onResponderTerminate={onRelease} onResponderTerminationRequest={() => false} />

        {/* The one bar: where you came from and the menus on the left; what you draw with on the right. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', top: ins.top + 4, left: 8, right: 8, height: 44, flexDirection: 'row', alignItems: 'center' }}>
          <Pressable accessibilityLabel="Back to the gallery" onPress={async () => { await save(); router.back(); }} hitSlop={6} style={({ pressed }) => ({ height: 40, paddingHorizontal: 10, justifyContent: 'center', opacity: pressed ? 0.5 : 1 })}>
            <Text style={{ color: '#F2F2F7', fontSize: 16, fontWeight: '600' }}>Gallery</Text>
          </Pressable>
          {icon('wrench.and.screwdriver', 'Actions', () => setSheet('actions'))}
          {icon('wand.and.stars', 'Adjust the ink', () => setSheet('adjust'))}
          {icon('lasso', 'Select', () => pickTool(tool === 'select' ? 'draw' : 'select'), tool === 'select')}
          {icon('square.on.circle', 'Shapes and other tools', () => setSheet('tools'), tool !== 'draw' && tool !== 'select' && tool !== 'liquify')}
          <View pointerEvents="none" style={{ flex: 1, alignItems: 'center' }}>
            {replay != null ? <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' }}>Replaying…</Text>
              : TOOL_NAME[tool] ? <Text style={{ color: 'rgba(255,255,255,0.7)', fontSize: 13, fontWeight: '600' }}>{tool === 'liquify' ? `Liquify · ${liq[0].toUpperCase() + liq.slice(1)}` : TOOL_NAME[tool]}</Text> : null}
          </View>
          {icon('paintbrush.pointed', tool === 'draw' && !erasing ? 'Brush library' : 'Brush', () => { if (tool === 'draw' && !erasing) setSheet('brushes'); else { if (erasing) pickBrush(BRUSH_SETS.flatMap((x) => x.brushes).find((p) => p.id === presetId) ?? BRUSH_SETS[1].brushes[0]); else pickTool('draw'); } }, tool === 'draw' && !erasing)}
          {icon('eraser', 'Eraser', () => { setBrush('eraser'); setTool('draw'); setSel([]); }, erasing)}
          {icon('square.2.layers.3d', 'Layers', () => setSheet('layers'))}
          <Pressable accessibilityLabel="Colours" onPress={() => setSheet('colours')} hitSlop={6} style={{ width: 40, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: color, borderWidth: 2, borderColor: 'rgba(255,255,255,0.85)' }} />
          </Pressable>
        </View>

        {/* Down the side: size, strength, undo and redo. */}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 10, top: 0, bottom: 0, justifyContent: 'center' }}>
          <View style={[float, { paddingVertical: 10, paddingHorizontal: 7, gap: 10, alignItems: 'center' }]}>
            <View style={{ width: 26, height: 26, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: Math.max(2, Math.min(26, widthPx * 0.5)), height: Math.max(2, Math.min(26, widthPx * 0.5)), borderRadius: 13, backgroundColor: '#fff', opacity: 0.35 + 0.65 * alpha }} />
            </View>
            <SideSlider label="Brush size" value={size} onChange={setSize} />
            <SideSlider label="Brush strength" value={alpha} onChange={(v) => setAlpha(Math.max(0.05, v))} />
            <Pressable accessibilityLabel="Undo" disabled={!undo.current.length} onPress={doUndo} hitSlop={6} style={{ opacity: undo.current.length ? 1 : 0.28, paddingVertical: 4 }}><Icon name="arrow.uturn.backward" size={18} color="#F2F2F7" /></Pressable>
            <Pressable accessibilityLabel="Redo" disabled={!redo.current.length} onPress={doRedo} hitSlop={6} style={{ opacity: redo.current.length ? 1 : 0.28, paddingVertical: 4 }}><Icon name="arrow.uturn.forward" size={18} color="#F2F2F7" /></Pressable>
          </View>
        </View>

        {/* What can be done with the selected ink. */}
        {sel.length ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', bottom: (showFrames ? 78 : 16) + ins.bottom, left: 0, right: 0, alignItems: 'center' }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={[float, { flexGrow: 0, maxWidth: '92%' }]} contentContainerStyle={{ padding: 6, gap: 6, alignItems: 'center' }}>
              {chip('Bigger', 'Make the selection bigger', () => scaleSel(1.15))}
              {chip('Smaller', 'Make the selection smaller', () => scaleSel(1 / 1.15))}
              {chip('Turn left', 'Turn the selection left', () => turnSel(-Math.PI / 12))}
              {chip('Turn right', 'Turn the selection right', () => turnSel(Math.PI / 12))}
              {chip('Flip', 'Flip the selection left to right', () => flipSel(false))}
              {chip('Flip up', 'Flip the selection upside down', () => flipSel(true))}
              {chip('Centre', 'Put the selection in the middle of the canvas', centreSel)}
              {chip('Bend', 'Bend the selection', () => setSheet('bend'))}
              {chip('Copy', 'Copy the selection', copySel)}
              {chip('Duplicate', 'Duplicate the selection', () => { copySel(); paste(); })}
              {chip('Delete', 'Delete the selection', deleteSel)}
              {chip('Done', 'Let go of the selection', () => setSel([]), true)}
            </ScrollView>
          </View>
        ) : null}

        {/* The frames, only when animating. */}
        {showFrames ? (
          <View pointerEvents="box-none" style={{ position: 'absolute', bottom: ins.bottom + 10, left: 10, right: 10, alignItems: 'center' }}>
            <View style={[float, { flexDirection: 'row', alignItems: 'center', padding: 5, gap: 4, maxWidth: '100%' }]}>
              {icon(playing ? 'pause.fill' : 'play.fill', playing ? 'Pause' : 'Play the animation', () => { setSel([]); dir.current = 1; setPlaying((v) => !v); }, playing, board.frames.length < 2)}
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 1 }} contentContainerStyle={{ gap: 5, alignItems: 'center' }}>
                {board.frames.map((_, i) => (
                  <Pressable key={i} accessibilityLabel={`Frame ${i + 1}`} onPress={() => { setPlaying(false); setSel([]); setFi(i); }} style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: i === fi ? '#0A84FF' : 'rgba(255,255,255,0.12)' }}>
                    <Text style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{i + 1}</Text>
                  </Pressable>
                ))}
              </ScrollView>
              {icon('plus', 'New empty frame', () => addFrame(false))}
              {icon('plus.square.on.square', 'Copy this frame into a new one', () => addFrame(true))}
              {icon('chevron.left', 'Move this frame earlier', () => shiftFrame(-1), false, fi === 0)}
              {icon('chevron.right', 'Move this frame later', () => shiftFrame(1), false, fi >= board.frames.length - 1)}
              {icon('trash', 'Delete this frame', removeFrame, false, board.frames.length < 2)}
              {chip(`${board.fps} fps`, 'Animation speed', () => apply({ ...board, fps: FPS[(FPS.indexOf(board.fps) + 1) % FPS.length] }, false))}
              {chip(bounce ? 'Back and forth' : 'Loop', 'How the animation repeats', () => setBounce((v) => !v), bounce)}
              {chip('Onion', 'Show the frame before, faintly', () => apply({ ...board, onion: !board.onion }, false), board.onion)}
            </View>
          </View>
        ) : null}

        {busy ? (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.4)' }}>
            <View style={[float, { paddingHorizontal: 22, paddingVertical: 14 }]}><Text style={{ fontSize: 16, fontWeight: '600', color: '#fff' }}>Making the GIF…</Text></View>
          </View>
        ) : null}
      </View>

      <MenuSheet visible={sheet === 'actions'} onClose={() => setSheet(null)} title="Actions" items={actions} />
      <MenuSheet visible={sheet === 'adjust'} onClose={() => setSheet(null)} title={`Adjust ${scope}`} items={adjust} />
      <MenuSheet visible={sheet === 'tools'} onClose={() => setSheet(null)} title="Shapes and tools" items={tools} />
      <MenuSheet visible={sheet === 'sym'} onClose={() => setSheet(null)} title="Symmetry" items={SYMMETRIES.map((x) => ({ label: x.label, icon: 'circle.hexagongrid', checked: sym === x.id, onPress: () => setSym(x.id) }))} />
      <MenuSheet visible={sheet === 'bend'} onClose={() => setSheet(null)} title="Bend the ink" items={WARPS.map((w) => ({ label: w.label, icon: 'wand.and.rays', onPress: () => bendSel(w.id) }))} />
      <MenuSheet visible={sheet === 'liquify'} onClose={() => setSheet(null)} title="Liquify" items={([['push', 'Push', 'Drag ink along with your finger'], ['pinch', 'Pinch', 'Pull ink in toward your finger'], ['expand', 'Expand', 'Push ink away from your finger'], ['twirl', 'Twirl', 'Swirl ink round your finger']] as const).map(([m, label, sub]) => (
        { label, sub, icon: 'hand.point.up.left', checked: tool === 'liquify' && liq === m, onPress: () => { setLiq(m); pickTool('liquify'); } }))} />

      <Sheet visible={sheet === 'brushes'} onClose={() => setSheet(null)} title="Brushes" width={500}>
        {BRUSH_SETS.map((set) => (
          <View key={set.name} style={{ marginBottom: 14 }}>
            <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: '#6B7385', marginBottom: 8 }}>{set.name}</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {set.brushes.map((p) => (
                <Pressable key={p.id} accessibilityLabel={p.label} accessibilityState={{ selected: presetId === p.id && !erasing }} onPress={() => pickBrush(p)}>
                  <BrushPreview preset={p} on={presetId === p.id && !erasing} />
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </Sheet>

      <Sheet visible={sheet === 'colours'} onClose={() => setSheet(null)} title="Colours" width={470}>
        {PALETTE.map((row, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
            {row.map((c) => (
              <Pressable key={c + i} accessibilityLabel={`Colour ${c}`} onPress={() => { setColor(c); setSheet(null); }} style={{ flex: 1, aspectRatio: 1, borderRadius: 7, backgroundColor: c, borderWidth: c === color ? 3 : c === '#FFFFFF' ? 1 : 0, borderColor: c === color ? '#0A84FF' : '#D5D9E2' }} />
            ))}
          </View>
        ))}
        {recent.length ? (
          <>
            <Text style={{ fontSize: 13, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', color: '#6B7385', marginTop: 12, marginBottom: 8 }}>Used in this drawing</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {recent.map((c) => <Pressable key={c} accessibilityLabel={`Recent colour ${c}`} onPress={() => { setColor(c); setSheet(null); }} style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: c, borderWidth: 1, borderColor: '#D5D9E2' }} />)}
            </View>
          </>
        ) : null}
        <Pressable accessibilityLabel="Pick any colour" onPress={async () => { setSheet(null); const c = await pickColor(color); if (c) setColor(c); }} style={{ height: 44, borderRadius: 12, marginTop: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF' }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Any colour…</Text>
        </Pressable>
      </Sheet>

      <Sheet visible={sheet === 'layers'} onClose={() => setSheet(null)} title="Layers" width={460}>
        {board.layers.slice().reverse().map((l) => {
          const on = l.id === layerId;
          return (
            <View key={l.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: 8, borderRadius: 12, backgroundColor: on ? '#E5F0FF' : 'transparent' }}>
              <Pressable accessibilityLabel={l.visible ? `Hide ${l.name}` : `Show ${l.name}`} hitSlop={8} onPress={() => patchLayer(l.id, { visible: !l.visible })}><Icon name={l.visible ? 'eye' : 'eye.slash'} size={19} color={l.visible ? '#15171C' : '#9AA2B2'} /></Pressable>
              <Pressable accessibilityLabel={l.locked ? `Unlock ${l.name}` : `Lock ${l.name}`} hitSlop={8} onPress={() => patchLayer(l.id, { locked: !l.locked })}><Icon name={l.locked ? 'lock.fill' : 'lock.open'} size={17} color={l.locked ? '#E8590C' : '#9AA2B2'} /></Pressable>
              <Pressable accessibilityLabel={`Draw on ${l.name}`} onPress={() => { setLayerId(l.id); setSel([]); }} style={{ flex: 1 }}>
                <Text numberOfLines={1} style={{ fontSize: 16, fontWeight: on ? '700' : '500', color: '#15171C' }}>{l.name}</Text>
                <Text style={{ fontSize: 12, color: '#6B7385' }}>{strokesOf(board, fi, l.id).length} strokes</Text>
              </Pressable>
              <Pressable accessibilityLabel={`${l.name} strength ${Math.round(l.opacity * 100)} percent. Tap to change.`} onPress={() => patchLayer(l.id, { opacity: l.opacity <= 0.25 ? 1 : l.opacity - 0.25 })} style={{ height: 30, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: '#ECEDF1' }}><Text style={{ fontSize: 13, fontWeight: '600', color: '#15171C' }}>{Math.round(l.opacity * 100)}%</Text></Pressable>
              <Pressable accessibilityLabel={`${l.name} blend ${l.blend}. Tap to change.`} onPress={() => patchLayer(l.id, { blend: BLENDS[(BLENDS.indexOf(l.blend) + 1) % BLENDS.length] })} style={{ height: 30, width: 76, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEDF1' }}><Text style={{ fontSize: 13, fontWeight: '600', color: '#15171C' }}>{l.blend[0].toUpperCase() + l.blend.slice(1)}</Text></Pressable>
              <Pressable accessibilityLabel={`Move ${l.name} up`} hitSlop={6} onPress={() => moveLayer(l.id, 1)}><Icon name="chevron.up" size={15} color="#3B4252" /></Pressable>
              <Pressable accessibilityLabel={`Move ${l.name} down`} hitSlop={6} onPress={() => moveLayer(l.id, -1)}><Icon name="chevron.down" size={15} color="#3B4252" /></Pressable>
              <Pressable accessibilityLabel={`More for ${l.name}`} hitSlop={6} onPress={() => { setLayerTarget(l.id); setSheet('layerMenu'); }}><Icon name="ellipsis.circle" size={18} color="#3B4252" /></Pressable>
            </View>
          );
        })}
        <Pressable accessibilityLabel="Add a layer" onPress={addLayer} style={{ height: 44, borderRadius: 12, marginTop: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007AFF' }}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Add a layer</Text>
        </Pressable>
      </Sheet>
      <MenuSheet visible={sheet === 'layerMenu'} onClose={() => setSheet(null)} title={board.layers.find((l) => l.id === layerTarget)?.name} items={[
        { label: 'Rename', icon: 'pencil', onPress: () => setSheet('layerName') },
        { label: 'Duplicate', icon: 'plus.square.on.square', onPress: () => duplicateLayer(layerTarget) },
        { label: 'Merge into the layer below', icon: 'arrow.down.to.line', onPress: () => mergeDown(layerTarget) },
        { label: 'Select everything on it', icon: 'lasso', onPress: () => { setLayerId(layerTarget); setTool('select'); setSel(strokesOf(boardRef.current!, fi, layerTarget).map((x) => x.id)); } },
        { label: 'Show only this layer', icon: 'eye', onPress: () => apply({ ...boardRef.current!, layers: boardRef.current!.layers.map((l) => ({ ...l, visible: l.id === layerTarget })) }) },
        { label: 'Clear it', icon: 'xmark.circle', danger: true, onPress: () => { setLayerId(layerTarget); setSheet('clear'); } },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => removeLayer(layerTarget) },
      ]} />
      <PromptSheet visible={sheet === 'layerName'} title="Rename layer" initial={board.layers.find((l) => l.id === layerTarget)?.name ?? ''} onCancel={() => setSheet(null)}
        onSubmit={(v) => { setSheet(null); if (v.trim()) patchLayer(layerTarget, { name: v.trim() }); }} />
      <PromptSheet visible={sheet === 'rename'} title="Rename drawing" initial={board.name} onCancel={() => setSheet(null)}
        onSubmit={(v) => { setSheet(null); if (v.trim()) apply({ ...boardRef.current!, name: v.trim() }, false); }} />
      <ConfirmSheet visible={sheet === 'clear'} title="Clear this layer?" message="Everything on this layer in this frame goes. Undo brings it back." confirm="Clear" onCancel={() => setSheet(null)}
        onConfirm={() => { setSheet(null); setSel([]); apply(setStrokes(boardRef.current!, fi, layerId, [])); }} />
    </View>
  );
}
