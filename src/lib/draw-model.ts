// The drawing board: what a drawing is, and how it is painted. Strokes stay vector (a list of points),
// which is what lets the ink be pushed, bent and moved after it is drawn.
import { AlphaType, BlendMode, BlurStyle, ColorType, ImageFormat, PaintStyle, Skia, StrokeCap, StrokeJoin, type SkCanvas, type SkPaint, type SkPath, type SkPicture } from '@shopify/react-native-skia';

import { fsx } from './fsx';
import { uid } from './model';

export type BrushId = 'pen' | 'pencil' | 'marker' | 'brush' | 'airbrush' | 'crayon' | 'eraser';
export const BRUSHES: { id: BrushId; label: string; icon: string }[] = [
  { id: 'pen', label: 'Pen', icon: 'pen' },
  { id: 'pencil', label: 'Pencil', icon: 'pencil' },
  { id: 'marker', label: 'Marker', icon: 'highlighter' },
  { id: 'brush', label: 'Brush', icon: 'brush' },
  { id: 'airbrush', label: 'Airbrush', icon: 'airbrush' },
  { id: 'crayon', label: 'Crayon', icon: 'crayon' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser' },
];

export type DStroke = { id: string; brush: BrushId; color: string; width: number; alpha: number; pts: number[]; closed?: boolean; fill?: boolean };
export type Blend = 'normal' | 'multiply' | 'screen' | 'overlay';
export type LayerMeta = { id: string; name: string; visible: boolean; opacity: number; blend: Blend };
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
  if (s.fill && n > 2) c.drawPath(polyPath(s.pts, true), paintOf(s.color, s.alpha, PaintStyle.Fill));
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
