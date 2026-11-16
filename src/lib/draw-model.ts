// The drawing board: what a drawing is, and how it is painted. Strokes stay vector (a list of points),
// which is what lets the ink be pushed, bent and moved after it is drawn.
import { AlphaType, BlendMode, BlurStyle, ColorType, ImageFormat, PaintStyle, Skia, StrokeCap, StrokeJoin, type SkCanvas, type SkPaint, type SkPath, type SkPicture } from '@shopify/react-native-skia';

import { fsx } from './fsx';
import { uid } from './model';

export type BrushId = 'pen' | 'pencil' | 'marker' | 'brush' | 'airbrush' | 'crayon' | 'ink' | 'neon' | 'dots' | 'spray' | 'taper' | 'dash' | 'chalk' | 'glow' | 'ribbon' | 'stitch' | 'hollow' | 'eraser';
export const BRUSHES: { id: BrushId; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: 'pen' },
  { id: 'pencil', label: 'Pencil', icon: 'pencil' },
  { id: 'marker', label: 'Marker', icon: 'highlighter' },
  { id: 'brush', label: 'Brush', icon: 'brush' },
  { id: 'airbrush', label: 'Airbrush', icon: 'airbrush' },
  { id: 'crayon', label: 'Crayon', icon: 'crayon' },
  { id: 'ink', label: 'Calligraphy', icon: 'ink' },
  { id: 'neon', label: 'Neon', icon: 'neon' },
  { id: 'dots', label: 'Dotted', icon: 'dots' },
  { id: 'spray', label: 'Spray', icon: 'spray' },
  { id: 'taper', label: 'Tapered', icon: 'taper' },
  { id: 'dash', label: 'Dashed', icon: 'dash' },
  { id: 'chalk', label: 'Chalk', icon: 'chalk' },
  { id: 'glow', label: 'Glow', icon: 'glow' },
  { id: 'ribbon', label: 'Ribbon', icon: 'ribbon' },
  { id: 'stitch', label: 'Stitch', icon: 'stitch' },
  { id: 'hollow', label: 'Outline', icon: 'hollow' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
];

export type DStroke = { id: string; brush: BrushId; color: string; width: number; alpha: number; pts: number[]; closed?: boolean; fill?: boolean; fillColor?: string };
export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay';
export type LayerMeta = { id: string; name: string; visible: boolean; opacity: number; blend: Blend; locked?: boolean };

/** The brush library: each one is a base brush with a size and strength that suit it. */
export type BrushPreset = { id: string; label: string; brush: BrushId; size: number; alpha: number };
export const BRUSH_SETS: { name: string; brushes: BrushPreset[] }[] = [
  { name: 'Sketching', brushes: [
    { id: 'hb', label: 'HB pencil', brush: 'pencil', size: 0.14, alpha: 0.8 },
    { id: '6b', label: '6B pencil', brush: 'pencil', size: 0.3, alpha: 1 },
    { id: 'sketchpen', label: 'Sketch pen', brush: 'pen', size: 0.1, alpha: 0.7 },
    { id: 'chalk', label: 'Chalk', brush: 'chalk', size: 0.34, alpha: 0.9 },
    { id: 'crayon', label: 'Crayon', brush: 'crayon', size: 0.26, alpha: 1 },
  ] },
  { name: 'Inking', brushes: [
    { id: 'studio', label: 'Studio pen', brush: 'pen', size: 0.18, alpha: 1 },
    { id: 'fine', label: 'Fine tip', brush: 'pen', size: 0.07, alpha: 1 },
    { id: 'tapered', label: 'Tapered ink', brush: 'taper', size: 0.24, alpha: 1 },
    { id: 'calli', label: 'Calligraphy', brush: 'ink', size: 0.3, alpha: 1 },
    { id: 'ribbon', label: 'Ribbon', brush: 'ribbon', size: 0.34, alpha: 1 },
    { id: 'hollow', label: 'Outline pen', brush: 'hollow', size: 0.3, alpha: 1 },
  ] },
  { name: 'Painting', brushes: [
    { id: 'round', label: 'Round brush', brush: 'brush', size: 0.32, alpha: 1 },
    { id: 'wash', label: 'Wash', brush: 'marker', size: 0.3, alpha: 0.6 },
    { id: 'marker', label: 'Marker', brush: 'marker', size: 0.2, alpha: 1 },
    { id: 'gouache', label: 'Gouache', brush: 'brush', size: 0.5, alpha: 0.85 },
  ] },
  { name: 'Airbrush', brushes: [
    { id: 'softair', label: 'Soft airbrush', brush: 'airbrush', size: 0.36, alpha: 0.6 },
    { id: 'hardair', label: 'Hard airbrush', brush: 'airbrush', size: 0.2, alpha: 1 },
    { id: 'spray', label: 'Spray paint', brush: 'spray', size: 0.3, alpha: 1 },
  ] },
  { name: 'Light', brushes: [
    { id: 'neon', label: 'Neon', brush: 'neon', size: 0.2, alpha: 1 },
    { id: 'glow', label: 'Glow', brush: 'glow', size: 0.3, alpha: 0.9 },
    { id: 'lightpen', label: 'Light pen', brush: 'neon', size: 0.08, alpha: 1 },
  ] },
  { name: 'Patterns', brushes: [
    { id: 'dots', label: 'Dotted', brush: 'dots', size: 0.2, alpha: 1 },
    { id: 'dash', label: 'Dashed', brush: 'dash', size: 0.14, alpha: 1 },
    { id: 'stitch', label: 'Stitch', brush: 'stitch', size: 0.16, alpha: 1 },
  ] },
];
export type Frame = { strokes: Record<string, DStroke[]> };
export type Board = {
  v: 1; id: string; name: string; w: number; h: number; bg: string; fps: number; onion: boolean;
  layers: LayerMeta[]; frames: Frame[]; created: number; updated: number;
};

export const CANVAS_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: 'square', label: 'Square', w: 1024, h: 1024 },
  { id: 'portrait', label: 'Portrait', w: 768, h: 1024 },
  { id: 'landscape', label: 'Landscape', w: 1280, h: 960 },
  { id: 'wide', label: 'Widescreen', w: 1280, h: 720 },
  { id: 'animation', label: 'Animation', w: 960, h: 540 },
  { id: 'sticker', label: 'Sticker', w: 512, h: 512 },
];

export const newLayer = (name: string): LayerMeta => ({ id: uid('l'), name, visible: true, opacity: 1, blend: 'normal' });

export function newBoard(name: string, w: number, h: number): Board {
  const layer = newLayer('Layer 1');
  const now = Date.now();
  return { v: 1, id: uid('d'), name, w, h, bg: '#FFFFFF', fps: 8, onion: true, layers: [layer], frames: [{ strokes: { [layer.id]: [] } }], created: now, updated: now };
}

// ---------- painting ----------

function paintOf(color: string, alpha: number, style: PaintStyle = PaintStyle.Stroke, width = 1): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  p.setAlphaf(Math.max(0, Math.min(1, alpha)));
  p.setStyle(style);
  p.setStrokeWidth(Math.max(0.1, width));
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  return p;
}

/** The points as one smooth line. */
export function polyPath(pts: number[], closed = false): SkPath {
  const p = Skia.Path.Make();
  const n = Math.floor(pts.length / 3);
  if (!n) return p;
  const x = (i: number) => pts[i * 3], y = (i: number) => pts[i * 3 + 1];
  p.moveTo(x(0), y(0));
  if (n === 1) { p.lineTo(x(0) + 0.01, y(0)); return p; }
  for (let i = 1; i < n - 1; i++) p.quadTo(x(i), y(i), (x(i) + x(i + 1)) / 2, (y(i) + y(i + 1)) / 2);
  p.lineTo(x(n - 1), y(n - 1));
  if (closed) p.close();
  return p;
}

function solid(c: SkCanvas, alpha: number, draw: () => void) {
  // Solid strokes are drawn in pieces; at less than full strength they go through one layer so the joins don't darken.
  if (alpha >= 0.999) { draw(); return; }
  const lp = Skia.Paint();
  lp.setAlphaf(alpha);
  c.saveLayer(lp);
  draw();
  c.restore();
}

export function drawStroke(c: SkCanvas, s: DStroke) {
  const n = Math.floor(s.pts.length / 3);
  if (!n) return;
  const w = s.width;
  if (s.fill && n > 2) c.drawPath(polyPath(s.pts, true), paintOf(s.fillColor ?? s.color, s.alpha, PaintStyle.Fill));
  switch (s.brush) {
    case 'pen':
    case 'brush': {
      solid(c, s.alpha, () => {
        const p = paintOf(s.color, 1, PaintStyle.Stroke, w);
        if (n === 1) { p.setStyle(PaintStyle.Fill); c.drawCircle(s.pts[0], s.pts[1], Math.max(0.5, w * 0.5), p); return; }
        for (let i = 1; i < n; i++) {
          const pr = (s.pts[i * 3 + 2] + s.pts[(i - 1) * 3 + 2]) / 2;
          const k = s.brush === 'pen' ? 0.45 + 0.8 * pr : 0.12 + 1.7 * Math.pow(pr, 1.4);
          p.setStrokeWidth(Math.max(0.3, w * k));
          c.drawLine(s.pts[(i - 1) * 3], s.pts[(i - 1) * 3 + 1], s.pts[i * 3], s.pts[i * 3 + 1], p);
        }
      });
      return;
    }
    case 'pencil': {
      const p = paintOf(s.color, s.alpha * 0.85, PaintStyle.Stroke, w * 0.7);
      p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, 0.35, true));
      p.setPathEffect(Skia.PathEffect.MakeDiscrete(2, 0.5, 7));
      c.drawPath(polyPath(s.pts), p);
      return;
    }
    case 'marker':
      c.drawPath(polyPath(s.pts), paintOf(s.color, s.alpha * 0.4, PaintStyle.Stroke, w * 3.2));
      return;
    case 'airbrush': {
      const path = polyPath(s.pts);
      [[3.4, 0.07], [2.2, 0.09], [1.1, 0.12]].forEach(([k, a]) => {
        const p = paintOf(s.color, s.alpha * a * 2, PaintStyle.Stroke, w * k);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(1, w * 0.9), true));
        c.drawPath(path, p);
      });
      return;
    }
    case 'crayon': {
      const p = paintOf(s.color, s.alpha * 0.85, PaintStyle.Stroke, w * 1.5);
      p.setPathEffect(Skia.PathEffect.MakeDiscrete(1.6, 1.4, 3));
      c.drawPath(polyPath(s.pts), p);
      return;
    }
    case 'ink': {
      // A broad nib held at a slant: thick one way, a hairline the other.
      solid(c, s.alpha, () => {
        const p = paintOf(s.color, 1, PaintStyle.Stroke, w);
        if (n === 1) { p.setStyle(PaintStyle.Fill); c.drawCircle(s.pts[0], s.pts[1], Math.max(0.5, w * 0.4), p); return; }
        for (let i = 1; i < n; i++) {
          const dx = s.pts[i * 3] - s.pts[(i - 1) * 3], dy = s.pts[i * 3 + 1] - s.pts[(i - 1) * 3 + 1];
          const len = Math.hypot(dx, dy) || 1;
          const across = Math.abs((dx / len) * -Math.SQRT1_2 + (dy / len) * Math.SQRT1_2);
          p.setStrokeWidth(Math.max(0.4, w * (0.18 + 1.25 * across)));
          c.drawLine(s.pts[(i - 1) * 3], s.pts[(i - 1) * 3 + 1], s.pts[i * 3], s.pts[i * 3 + 1], p);
        }
      });
      return;
    }
    case 'neon': {
      const path = polyPath(s.pts, s.closed);
      const glow = paintOf(s.color, s.alpha * 0.55, PaintStyle.Stroke, w * 3);
      glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(2, w * 1.3), true));
      c.drawPath(path, glow);
      c.drawPath(path, paintOf(s.color, s.alpha, PaintStyle.Stroke, w * 1.1));
      c.drawPath(path, paintOf('#FFFFFF', s.alpha * 0.85, PaintStyle.Stroke, Math.max(0.6, w * 0.4)));
      return;
    }
    case 'dots': {
      const p = paintOf(s.color, s.alpha, PaintStyle.Stroke, w);
      p.setPathEffect(Skia.PathEffect.MakeDash([0.01, w * 2.3], 0));
      c.drawPath(polyPath(s.pts, s.closed), p);
      return;
    }
    case 'spray': {
      // A scatter of specks around the line; the same every time it's drawn.
      const p = paintOf(s.color, s.alpha * 0.7, PaintStyle.Fill);
      let seed = (Math.round(s.pts[0] * 7 + s.pts[1] * 13) | 0) || 1;
      const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      for (let i = 0; i < n; i++) {
        for (let k = 0; k < 5; k++) {
          const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * w * 2.2;
          c.drawCircle(s.pts[i * 3] + Math.cos(a) * r, s.pts[i * 3 + 1] + Math.sin(a) * r, Math.max(0.35, w * 0.09), p);
        }
      }
      return;
    }
    case 'taper': {
      // Thin at both ends and full in the middle, whatever the pressure.
      solid(c, s.alpha, () => {
        const p = paintOf(s.color, 1, PaintStyle.Stroke, w);
        if (n === 1) { p.setStyle(PaintStyle.Fill); c.drawCircle(s.pts[0], s.pts[1], Math.max(0.5, w * 0.4), p); return; }
        for (let i = 1; i < n; i++) {
          const t = i / (n - 1);
          p.setStrokeWidth(Math.max(0.3, w * (0.12 + 1.3 * Math.sin(Math.PI * t))));
          c.drawLine(s.pts[(i - 1) * 3], s.pts[(i - 1) * 3 + 1], s.pts[i * 3], s.pts[i * 3 + 1], p);
        }
      });
      return;
    }
    case 'ribbon': {
      // The calligraphy nib turned the other way.
      solid(c, s.alpha, () => {
        const p = paintOf(s.color, 1, PaintStyle.Stroke, w);
        if (n === 1) { p.setStyle(PaintStyle.Fill); c.drawCircle(s.pts[0], s.pts[1], Math.max(0.5, w * 0.4), p); return; }
        for (let i = 1; i < n; i++) {
          const dx = s.pts[i * 3] - s.pts[(i - 1) * 3], dy = s.pts[i * 3 + 1] - s.pts[(i - 1) * 3 + 1];
          const len = Math.hypot(dx, dy) || 1;
          const across = Math.abs((dx / len) * Math.SQRT1_2 + (dy / len) * Math.SQRT1_2);
          p.setStrokeWidth(Math.max(0.4, w * (0.15 + 1.4 * across)));
          c.drawLine(s.pts[(i - 1) * 3], s.pts[(i - 1) * 3 + 1], s.pts[i * 3], s.pts[i * 3 + 1], p);
        }
      });
      return;
    }
    case 'dash': {
      const p = paintOf(s.color, s.alpha, PaintStyle.Stroke, w);
      p.setStrokeCap(StrokeCap.Butt);
      p.setPathEffect(Skia.PathEffect.MakeDash([w * 3, w * 2.2], 0));
      c.drawPath(polyPath(s.pts, s.closed), p);
      return;
    }
    case 'chalk': {
      const path = polyPath(s.pts, s.closed);
      [[1.6, 0.5, 3], [1.2, 0.45, 11]].forEach(([k, a, seed]) => {
        const p = paintOf(s.color, s.alpha * a, PaintStyle.Stroke, w * k);
        p.setPathEffect(Skia.PathEffect.MakeDiscrete(1.2, 1.8, seed));
        c.drawPath(path, p);
      });
      return;
    }
    case 'glow': {
      const path = polyPath(s.pts, s.closed);
      [[4, 0.18, 2.2], [2.2, 0.3, 1.1], [1, 0.75, 0.3]].forEach(([k, a, blur]) => {
        const p = paintOf(s.color, s.alpha * a, PaintStyle.Stroke, w * k);
        p.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, Math.max(0.5, w * blur), true));
        c.drawPath(path, p);
      });
      return;
    }
    case 'stitch': {
      // Short marks across the line, like a row of stitches.
      const p = paintOf(s.color, s.alpha, PaintStyle.Stroke, Math.max(0.6, w * 0.3));
      let run = 0;
      for (let i = 1; i < n; i++) {
        const dx = s.pts[i * 3] - s.pts[(i - 1) * 3], dy = s.pts[i * 3 + 1] - s.pts[(i - 1) * 3 + 1];
        const len = Math.hypot(dx, dy);
        run += len;
        if (run < w * 1.6 || !len) continue;
        run = 0;
        const nx = (-dy / len) * w, ny = (dx / len) * w;
        c.drawLine(s.pts[i * 3] - nx, s.pts[i * 3 + 1] - ny, s.pts[i * 3] + nx, s.pts[i * 3 + 1] + ny, p);
      }
      return;
    }
    case 'hollow': {
      // A line with its middle taken out. (The middle clears the layer under it, like the eraser.)
      const path = polyPath(s.pts, s.closed);
      c.drawPath(path, paintOf(s.color, s.alpha, PaintStyle.Stroke, w * 1.6));
      const inner = paintOf('#000000', 1, PaintStyle.Stroke, w * 0.9);
      inner.setBlendMode(BlendMode.Clear);
      c.drawPath(path, inner);
      return;
    }
    case 'eraser': {
      const p = paintOf('#000000', 1, PaintStyle.Stroke, w * 2);
      p.setBlendMode(BlendMode.Clear);
      c.drawPath(polyPath(s.pts), p);
      return;
    }
  }
}

const layerCache = new WeakMap<DStroke[], SkPicture>();
/** One layer's strokes as a picture, kept until the strokes change (an edit makes a new list). */
export function layerPicture(strokes: DStroke[], w: number, h: number): SkPicture {
  const hit = layerCache.get(strokes);
  if (hit) return hit;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, w, h));
  c.saveLayer();   // the eraser clears within the layer only
  for (const s of strokes) drawStroke(c, s);
  c.restore();
  const pic = rec.finishRecordingAsPicture();
  layerCache.set(strokes, pic);
  return pic;
}

const blendOf = (b: Blend) => (b === 'multiply' ? BlendMode.Multiply : b === 'screen' ? BlendMode.Screen : b === 'overlay' ? BlendMode.Overlay : BlendMode.SrcOver);

function drawLayers(c: SkCanvas, b: Board, fi: number) {
  for (const L of b.layers) {
    if (!L.visible) continue;
    const strokes = b.frames[fi]?.strokes[L.id];
    if (!strokes || !strokes.length) continue;
    const lp = Skia.Paint();
    lp.setAlphaf(L.opacity);
    lp.setBlendMode(blendOf(L.blend));
    c.saveLayer(lp);
    c.drawPicture(layerPicture(strokes, b.w, b.h));
    c.restore();
  }
}

/** The whole picture for one frame: the background, then the layers, with the frame before it faint underneath if asked. */
export function framePicture(b: Board, fi: number, onion = false): SkPicture {
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(0, 0, b.w, b.h));
  c.drawRect(Skia.XYWHRect(0, 0, b.w, b.h), paintOf(b.bg, 1, PaintStyle.Fill));
  if (onion && fi > 0) {
    const lp = Skia.Paint();
    lp.setAlphaf(0.28);
    c.saveLayer(lp);
    drawLayers(c, b, fi - 1);
    c.restore();
  }
  drawLayers(c, b, fi);
  return rec.finishRecordingAsPicture();
}

/** RGBA pixels of a frame, scaled so it is at most `maxW` wide. */
export function framePixels(b: Board, fi: number, maxW: number): { rgba: Uint8Array; w: number; h: number } | null {
  const k = Math.min(1, maxW / b.w);
  const w = Math.max(1, Math.round(b.w * k)), h = Math.max(1, Math.round(b.h * k));
  const s = Skia.Surface.Make(w, h);
  if (!s) return null;
  const c = s.getCanvas();
  c.scale(k, k);
  c.drawPicture(framePicture(b, fi, false));
  s.flush();
  const px = s.makeImageSnapshot().readPixels(0, 0, { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul });
  return px ? { rgba: new Uint8Array(px.buffer, px.byteOffset, px.byteLength), w, h } : null;
}

/** A frame as a JPEG (base64), `width` pixels across. */
export function frameJpeg(b: Board, fi: number, width: number): string | null {
  const k = width / b.w;
  const w = Math.max(1, Math.round(width)), h = Math.max(1, Math.round(b.h * k));
  const s = Skia.Surface.Make(w, h);
  if (!s) return null;
  const c = s.getCanvas();
  c.scale(k, k);
  c.drawPicture(framePicture(b, fi, false));
  s.flush();
  return s.makeImageSnapshot().encodeToBase64(ImageFormat.JPEG, 88);
}

// ---------- saving ----------

const DIR = 'draw';
export type DrawMeta = { id: string; name: string; updated: number; frames: number };
export const thumbPath = (id: string) => `${DIR}/${id}/thumb.jpg`;

async function readIndex(): Promise<DrawMeta[]> {
  try { const t = await fsx.readText(`${DIR}/index.json`); return t ? (JSON.parse(t) as DrawMeta[]) : []; } catch { return []; }
}

export async function listBoards(): Promise<DrawMeta[]> {
  return (await readIndex()).sort((a, b) => b.updated - a.updated);
}

export async function loadBoard(id: string): Promise<Board | null> {
  try { const t = await fsx.readText(`${DIR}/${id}/board.json`); return t ? (JSON.parse(t) as Board) : null; } catch { return null; }
}

export async function saveBoard(b: Board, thumb: string | null) {
  const now = Date.now();
  const text = JSON.stringify({ ...b, updated: now }, (k, v) => (k === 'pts' && Array.isArray(v) ? v.map((n: number) => Math.round(n * 10) / 10) : v));
  await fsx.writeText(`${DIR}/${b.id}/board.json`, text);
  if (thumb) await fsx.writeBase64(thumbPath(b.id), thumb);
  const list = (await readIndex()).filter((m) => m.id !== b.id);
  list.push({ id: b.id, name: b.name, updated: now, frames: b.frames.length });
  await fsx.writeText(`${DIR}/index.json`, JSON.stringify(list));
}

export async function deleteBoard(id: string) {
  await fsx.remove(`${DIR}/${id}`);
  await fsx.writeText(`${DIR}/index.json`, JSON.stringify((await readIndex()).filter((m) => m.id !== id)));
}

export async function renameBoard(id: string, name: string) {
  const b = await loadBoard(id);
  if (b) await saveBoard({ ...b, name }, null);
}

export async function duplicateBoard(id: string): Promise<string | null> {
  const b = await loadBoard(id);
  if (!b) return null;
  const copy: Board = { ...b, id: uid('d'), name: b.name + ' copy', created: Date.now() };
  let thumb: string | null = null;
  try { thumb = frameJpeg(copy, 0, 360); } catch {}
  await saveBoard(copy, thumb);
  return copy.id;
}
