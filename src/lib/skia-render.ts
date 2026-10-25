// Skia drawing for pages. Each page becomes two cached SkPictures (paper and
// ink) drawn under one transform, so the whole document is a handful of
// nodes on one Canvas and ink stays sharp at any zoom.
import { BlendMode, FilterMode, ImageFormat, MipmapMode, PaintStyle, Skia, type SkCanvas, type SkImage, type SkPaint, type SkParagraph, type SkPath, type SkPicture, StrokeCap, StrokeJoin } from '@shopify/react-native-skia';

import { fsx } from './fsx';
import { type Box, fin, textBox } from './geom';
import { strokeSvg } from './ink';
import type { ImageItem, Page, Stroke, TextItem } from './model';
import { notePath, pdfKey, renderDir } from './noteio';
import { paperMarks, paperOf } from './paper';
import { engine } from './pdf-engine';

// ---------- strokes ----------

// A stroke = one filled outline (perfect-freehand), cached per stroke object.
const pathCache = new WeakMap<Stroke, SkPath | null>();
export function skInk(s: Stroke): SkPath | null {
  if (pathCache.has(s)) return pathCache.get(s)!;
  let p: SkPath | null = null;
  try { const d = strokeSvg(s); p = d ? Skia.Path.MakeFromSVGString(d) : null; } catch { p = null; }
  pathCache.set(s, p);
  return p;
}

export function inkPaint(color: string, width: number, alpha = 1, blend?: BlendMode): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  if (alpha < 1) p.setAlphaf(alpha);
  if (blend != null) p.setBlendMode(blend);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(Math.max(0.1, width));
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  return p;
}

// Pencil strokes get a graphite grain: the ink colour masked by fractal noise.
let grainShader: ReturnType<typeof Skia.Shader.MakeFractalNoise> | null | undefined;
const grain = () => {
  if (grainShader === undefined) { try { grainShader = Skia.Shader.MakeFractalNoise(1.3, 1.3, 2, 11, 0, 0); } catch { grainShader = null; } }
  return grainShader;
};

/** The fill paint for a stroke (shared by saved strokes and the live stroke). */
export function inkFill(color: string, kind: string, alpha = 1, blend?: BlendMode): SkPaint {
  const p = paint(color, alpha, blend);
  if (kind === 'pencil') {
    const g = grain();
    if (g) {
      // Keep most of the line solid and let the grain thin it out a little.
      try { p.setShader(Skia.Shader.MakeBlend(BlendMode.DstIn, Skia.Shader.MakeColor(Skia.Color(color)), g)); } catch {}
      p.setAlphaf(Math.min(1, alpha * 1.9));
    } else p.setAlphaf(alpha * 0.8);
  }
  return p;
}

export function drawStroke(c: SkCanvas, s: Stroke, alpha: number, blend?: BlendMode) {
  const p = skInk(s);
  if (p) c.drawPath(p, inkFill(s.color, s.kind === 'hl' ? 'hl' : s.pen ?? 'fountain', alpha, blend));
}

export function livePath(d: string): SkPath | null {
  try { return d ? Skia.Path.MakeFromSVGString(d) : null; } catch { return null; }
}

const paint = (color: string, alpha = 1, blend?: BlendMode) => {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(Skia.Color(color));
  if (alpha < 1) p.setAlphaf(alpha);
  if (blend != null) p.setBlendMode(blend);
  return p;
};

export const HL_ALPHA = 0.38;

// ---------- text ----------

const paraCache = new WeakMap<TextItem, SkParagraph | null>();
export function paragraph(t: TextItem): SkParagraph | null {
  if (paraCache.has(t)) return paraCache.get(t)!;
  let para: SkParagraph | null = null;
  try {
    const b = Skia.ParagraphBuilder.Make({ textStyle: { color: Skia.Color(t.color), fontSize: fin(t.size, 18), fontFamilies: ['Helvetica Neue', 'Helvetica', 'Arial', 'Apple Color Emoji'] } });
    b.addText(t.text || ' ');
    para = b.build();
    para.layout(t.sticker ? 4000 : Math.max(20, fin(t.w, 200)));
  } catch { para = null; }
  paraCache.set(t, para);
  return para;
}

// Real laid-out bounds when Skia has fonts, an estimate otherwise.
export function textBounds(t: TextItem): Box {
  const est = textBox(t);
  const p = paragraph(t);
  if (!p) return est;
  const h = p.getHeight();
  if (!(h > 0)) return est;
  const w = t.sticker ? Math.max(t.size, p.getMaxIntrinsicWidth()) : t.w;
  return { x: t.x, y: t.y, w, h };
}

// ---------- images (backgrounds + inserted pictures) ----------

type Entry = { img: SkImage | null; loading: boolean; used: number; failed?: boolean };

class ImageStore {
  private map = new Map<string, Entry>();
  private subs = new Set<() => void>();
  constructor(private capacity: number, private disposes: boolean) {}

  subscribe(fn: () => void) { this.subs.add(fn); return () => { this.subs.delete(fn); }; }
  private emit() { for (const s of this.subs) s(); }

  peek(key: string) { const e = this.map.get(key); if (e) e.used = Date.now(); return e?.img ?? null; }

  get(key: string, load: () => Promise<string>): SkImage | null {
    const e = this.map.get(key);
    if (e) { e.used = Date.now(); return e.img; }
    const ent: Entry = { img: null, loading: true, used: Date.now() };
    this.map.set(key, ent);
    (async () => {
      try {
        const uri = await load();
        const data = await Skia.Data.fromURI(uri);
        ent.img = Skia.Image.MakeImageFromEncoded(data);
      } catch (err) { ent.failed = true; if (__DEV__) console.warn('image load failed', key, String(err)); }
      ent.loading = false;
      this.evict();
      this.emit();
    })();
    return null;
  }

  private evict() {
    if (this.map.size <= this.capacity) return;
    const items = [...this.map.entries()].filter(([, e]) => !e.loading).sort((a, b) => a[1].used - b[1].used);
    while (this.map.size > this.capacity && items.length) {
      const [k, e] = items.shift()!;
      this.map.delete(k);
      this.later(e.img);
    }
  }

  // Free GPU memory a moment later, once no frame can still be drawing it.
  private later(img: SkImage | null) {
    if (!img || !this.disposes) return;
    setTimeout(() => { try { (img as any).dispose?.(); } catch {} }, 4000);
  }

  drop(prefix: string) {
    for (const [k, e] of [...this.map]) if (k.startsWith(prefix) && !e.loading) { this.map.delete(k); this.later(e.img); }
  }
}

export const bgImages = new ImageStore(7, true);
export const itemImages = new ImageStore(40, false);   // ink pictures keep their own reference

export const BG_TIERS = [1200, 2200];

/** The page's background image (PDF render or photo) at the given tier, or null while loading. */
export function bgImage(noteId: string, page: Page, px: number): SkImage | null {
  const bg = page.bg;
  if (bg.kind === 'paper') return null;
  if (bg.kind === 'image') return bgImages.get(`${noteId}|${bg.file}`, async () => fsx.uri(notePath(noteId, bg.file)));
  const key = `${noteId}|${bg.file}|${bg.index}|${px}`;
  return bgImages.get(key, async () => {
    const path = `${renderDir(noteId)}/${bg.file}_${bg.index}_${px}.jpg`;
    if (!fsx.exists(path)) {
      const r = await engine.render(pdfKey(noteId, bg.file), notePath(noteId, bg.file), bg.index, px);
      await fsx.writeBase64(path, r.b64);
    }
    return fsx.uri(path);
  });
}

/** Best already-loaded background: the wanted tier, else any other tier. */
export function bestBg(noteId: string, page: Page, px: number): SkImage | null {
  const want = bgImage(noteId, page, px);
  if (want || page.bg.kind !== 'pdf') return want;
  for (const t of BG_TIERS) {
    if (t === px) continue;
    const im = bgImages.peek(`${noteId}|${page.bg.file}|${page.bg.index}|${t}`);
    if (im) return im;
  }
  return null;
}

// Small renders for the page sidebar, in their own store so they never push
// the full-size page images out.
export const thumbImages = new ImageStore(30, true);
const THUMB_PX = 280;
export function thumbBg(noteId: string, page: Page): SkImage | null {
  const bg = page.bg;
  if (bg.kind === 'paper') return null;
  if (bg.kind === 'image') return bgImages.peek(`${noteId}|${bg.file}`) ?? thumbImages.get(`${noteId}|${bg.file}`, async () => fsx.uri(notePath(noteId, bg.file)));
  return thumbImages.get(`${noteId}|${bg.file}|${bg.index}|t`, async () => {
    const path = `${renderDir(noteId)}/${bg.file}_${bg.index}_${THUMB_PX}.jpg`;
    if (!fsx.exists(path)) {
      const r = await engine.render(pdfKey(noteId, bg.file), notePath(noteId, bg.file), bg.index, THUMB_PX);
      await fsx.writeBase64(path, r.b64);
    }
    return fsx.uri(path);
  });
}

export function itemImage(noteId: string, im: ImageItem): SkImage | null {
  return itemImages.get(`${noteId}|${im.file}`, async () => fsx.uri(notePath(noteId, im.file)));
}

// ---------- pictures ----------

const paperCache = new Map<string, SkPicture>();
export function paperPicture(page: Page): SkPicture {
  const bg = page.bg;
  const key = bg.kind === 'paper' ? `${bg.style}|${bg.color}|${page.w}|${page.h}` : `plain|${page.w}|${page.h}`;
  const hit = paperCache.get(key);
  if (hit) return hit;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-8, -8, page.w + 16, page.h + 16));
  // Soft edge under the page.
  c.drawRect(Skia.XYWHRect(0.5, 1.5, page.w, page.h), paint('#000000', 0.10));
  const P = bg.kind === 'paper' ? paperOf(bg.color) : paperOf('white');
  c.drawRect(Skia.XYWHRect(0, 0, page.w, page.h), paint(P.bg));
  if (bg.kind === 'paper') {
    for (const m of paperMarks(bg.style, bg.color, page.w, page.h)) {
      if ('cx' in m) c.drawCircle(m.cx, m.cy, m.r, paint(m.color));
      else c.drawRect(Skia.XYWHRect(m.x, m.y, m.w, m.h), paint(m.color));
    }
  }
  const pic = rec.finishRecordingAsPicture();
  if (paperCache.size > 40) paperCache.clear();
  paperCache.set(key, pic);
  return pic;
}

export type Exclude = { strokes?: Set<string>; texts?: Set<string>; images?: Set<string> } | null;

/** While a recording plays, ink written later in it is drawn faint (Notability-style replay). */
export type Replay = { rec: string; ms: number } | null;
const FUTURE_ALPHA = 0.16;
const future = (s: Stroke, r: Replay) => !!r && !!s.rt && s.rt[0] === r.rec && s.rt[1] > r.ms;

export function drawInk(c: SkCanvas, noteId: string, page: Page, ex: Exclude, darkPaper: boolean, replay: Replay = null) {
  const hlBlend = darkPaper ? undefined : BlendMode.Multiply;
  for (const s of page.strokes) {
    if (s.kind !== 'hl' || ex?.strokes?.has(s.id)) continue;
    drawStroke(c, s, HL_ALPHA * (future(s, replay) ? FUTURE_ALPHA * 2 : 1), hlBlend);
  }
  for (const im of page.images) {
    if (ex?.images?.has(im.id)) continue;
    const img = itemImage(noteId, im);
    if (img) c.drawImageRectOptions(img, Skia.XYWHRect(0, 0, img.width(), img.height()), Skia.XYWHRect(im.x, im.y, im.w, im.h), FilterMode.Linear, MipmapMode.Linear, null);
    else {
      const ph = paint('#9AA0AA', 0.25);
      c.drawRect(Skia.XYWHRect(im.x, im.y, im.w, im.h), ph);
    }
  }
  for (const s of page.strokes) {
    if (s.kind !== 'pen' || ex?.strokes?.has(s.id)) continue;
    drawStroke(c, s, future(s, replay) ? FUTURE_ALPHA : 1);
  }
  for (const t of page.texts) {
    if (ex?.texts?.has(t.id)) continue;
    const para = paragraph(t);
    if (para) para.paint(c, t.x, t.y);
  }
}

const inkCache = new WeakMap<Page, { key: string; pic: SkPicture }>();
export function inkPicture(noteId: string, page: Page, ex: Exclude, imgVer: number, replay: Replay = null): SkPicture {
  const exKey = ex ? [...(ex.strokes ?? []), ...(ex.texts ?? []), ...(ex.images ?? [])].join(',') : '';
  // Only pages with ink from the playing recording depend on the playhead.
  const r = replay && page.strokes.some((s) => s.rt && s.rt[0] === replay.rec) ? replay : null;
  const key = `${imgVer}|${exKey}|${r ? r.rec + ':' + Math.floor(r.ms / 200) : ''}`;
  const hit = inkCache.get(page);
  if (hit && hit.key === key) return hit.pic;
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-page.w, -page.h, page.w * 3, page.h * 3));
  drawInk(c, noteId, page, ex, page.bg.kind === 'paper' && page.bg.color === 'dark', r);
  const pic = rec.finishRecordingAsPicture();
  inkCache.set(page, { key, pic });
  return pic;
}

// Selected items, drawn on their own so they can follow the finger.
export function selectionPicture(noteId: string, page: Page, sel: { strokes: Set<string>; texts: Set<string>; images: Set<string> }): SkPicture {
  const sub: Page = {
    ...page,
    strokes: page.strokes.filter((s) => sel.strokes.has(s.id)),
    texts: page.texts.filter((t) => sel.texts.has(t.id)),
    images: page.images.filter((i) => sel.images.has(i.id)),
  };
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-page.w, -page.h, page.w * 3, page.h * 3));
  drawInk(c, noteId, sub, null, page.bg.kind === 'paper' && page.bg.color === 'dark');
  return rec.finishRecordingAsPicture();
}

// ---------- offscreen (thumbnails, text for export) ----------

function surface(w: number, h: number) {
  return Skia.Surface.Make(Math.max(1, Math.round(w)), Math.max(1, Math.round(h))) ?? Skia.Surface.MakeOffscreen(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/** JPEG base64 of a page (paper + background + ink) at `width` px. */
export function renderPageImage(noteId: string, page: Page, width: number, bg: SkImage | null): string | null {
  const k = width / page.w;
  const h = page.h * k;
  const s = surface(width, h);
  if (!s) return null;
  const c = s.getCanvas();
  c.scale(k, k);
  c.drawPicture(paperPicture(page));
  if (bg) c.drawImageRectOptions(bg, Skia.XYWHRect(0, 0, bg.width(), bg.height()), Skia.XYWHRect(0, 0, page.w, page.h), FilterMode.Linear, MipmapMode.Linear, null);
  drawInk(c, noteId, page, null, page.bg.kind === 'paper' && page.bg.color === 'dark');
  s.flush();
  const img = s.makeImageSnapshot();
  return img.encodeToBase64(ImageFormat.JPEG, 82);
}

/** PNG base64 of one text box at 3x, plus its bounds. */
export function renderTextPng(t: TextItem): { b64: string; box: Box } | null {
  const para = paragraph(t);
  if (!para) return null;
  const box = textBounds(t);
  const k = 3;
  const s = surface(box.w * k + 4, box.h * k + 4);
  if (!s) return null;
  const c = s.getCanvas();
  c.clear(Skia.Color('transparent'));
  c.scale(k, k);
  para.paint(c, 0, 0);
  s.flush();
  return { b64: s.makeImageSnapshot().encodeToBase64(ImageFormat.PNG, 100), box: { ...box, w: box.w + 4 / k, h: box.h + 4 / k } };
}

export { PaintStyle };
