// The stroke being drawn right now, rendered without React: every Pencil
// movement records a tiny SkPicture and hands it to a Reanimated shared
// value, which Skia draws on the UI thread straight away. Finished samples
// are written into per-band path builders once; only the moving tail (plus a
// short predicted segment ahead of the nib, to hide latency) is rebuilt.
import { BlendMode, Skia, type SkPath, type SkPathBuilder, type SkPicture } from '@shopify/react-native-skia';

import { BAND_STEP, BandWriter, bandWidth, type InkBuilder, type Sample } from '@/lib/geom';
import { HL_ALPHA, inkPaint } from '@/lib/skia-render';

export type LiveStroke = {
  ink: InkBuilder;
  color: string;
  hl: boolean;
  multiply: boolean;
  tf: { tx: number; ty: number; z: number };   // page -> screen
  builders: Map<number, SkPathBuilder>;
  snaps: Map<number, SkPath>;
  writer: BandWriter;
  drawn: number;            // samples already written into the builders
  tip: { x: number; y: number } | null;    // raw nib position
  pred: { x: number; y: number } | null;   // predicted position a frame ahead
};

let EMPTY: SkPicture | null = null;
export function emptyPicture(): SkPicture {
  if (!EMPTY) { const r = Skia.PictureRecorder(); r.beginRecording(Skia.XYWHRect(0, 0, 1, 1)); EMPTY = r.finishRecordingAsPicture(); }
  return EMPTY;
}

export function newLive(ink: InkBuilder, color: string, hl: boolean, multiply: boolean, tf: LiveStroke['tf']): LiveStroke {
  const builders = new Map<number, SkPathBuilder>();
  return {
    ink, color, hl, multiply, tf, builders, snaps: new Map(), drawn: 0, tip: null, pred: null,
    writer: new BandWriter(ink.base, hl, (k) => {
      let b = builders.get(k);
      if (!b) { b = Skia.PathBuilder.Make(); builders.set(k, b); }
      return b;
    }),
  };
}

/** Writes newly finished samples into the band paths. */
export function growLive(l: LiveStroke) {
  const s = l.ink.samples;
  if (s.length <= l.drawn) return;
  const touched = new Set<number>();
  for (let i = Math.max(1, l.drawn); i < s.length; i++) {
    l.writer.seg(s[i - 1], s[i]);
    touched.add(l.writer.band((s[i - 1].r + s[i].r) / 2));
  }
  // Refresh snapshots of the bands that grew (a cheap native copy).
  for (const k of touched) { const b = l.builders.get(k); if (b) l.snaps.set(k, b.build()); }
  l.drawn = s.length;
}

/** Switches the live stroke to a new builder (e.g. the pencil was recognised late). */
export function restartLive(l: LiveStroke, ink: InkBuilder) {
  l.ink = ink;
  l.builders.clear();
  l.snaps.clear();
  l.writer.reset();
  l.drawn = 0;
  growLive(l);
}

/** Starts the stroke over from new samples (after it snapped to a shape). */
export function resetLive(l: LiveStroke, ink: InkBuilder) {
  ink.finish();
  l.tip = null;
  l.pred = null;
  restartLive(l, ink);
}

const segPath = (pts: { x: number; y: number }[], into?: SkPathBuilder) => {
  const b = into ?? Skia.PathBuilder.Make();
  for (let i = 1; i < pts.length; i++) { b.moveTo(pts[i - 1].x, pts[i - 1].y); b.lineTo(pts[i].x, pts[i].y); }
  return b;
};

/** Records the current frame of the live stroke. */
export function liveFrame(l: LiveStroke): SkPicture {
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5));
  c.translate(l.tf.tx, l.tf.ty);
  c.scale(l.tf.z, l.tf.z);
  const s = l.ink.samples;
  const base = l.ink.base;
  const last0 = s[s.length - 1];
  const ext: Sample[] = l.ink.tail();
  const last = ext.length ? ext[ext.length - 1] : last0;
  if (last && l.tip && Math.hypot(l.tip.x - last.x, l.tip.y - last.y) > 0.25) ext.push({ x: l.tip.x, y: l.tip.y, r: last.r });
  if (last && l.pred) ext.push({ x: l.pred.x, y: l.pred.y, r: (ext[ext.length - 1] ?? last).r });
  const chain = last0 ? [last0, ...ext] : ext;

  if (l.hl) {
    // One single path so the transparency stays even where it overlaps itself.
    const snap = l.snaps.get(Math.round(1 / BAND_STEP));
    const b = snap ? Skia.PathBuilder.MakeFromPath(snap) : Skia.PathBuilder.Make();
    if (s.length === 1 && chain.length < 2) { b.moveTo(s[0].x, s[0].y); b.lineTo(s[0].x + 0.01, s[0].y); }
    segPath(chain, b);
    c.drawPath(b.detach(), inkPaint(l.color, base, HL_ALPHA, l.multiply ? BlendMode.Multiply : undefined));
  } else {
    for (const [k, p] of l.snaps) c.drawPath(p, inkPaint(l.color, bandWidth(k, base, false)));
    if (s.length === 1 && chain.length < 2) {
      const d = Skia.PathBuilder.Make(); d.moveTo(s[0].x, s[0].y); d.lineTo(s[0].x + 0.01, s[0].y);
      c.drawPath(d.detach(), inkPaint(l.color, s[0].r * 2));
    }
    // The tail goes into width bands too, so it joins the finished part seamlessly.
    const tmp = new Map<number, SkPathBuilder>();
    const w = new BandWriter(base, false, (k) => { let b = tmp.get(k); if (!b) { b = Skia.PathBuilder.Make(); tmp.set(k, b); } return b; });
    for (let i = 1; i < chain.length; i++) w.seg(chain[i - 1], chain[i]);
    for (const [k, b] of tmp) c.drawPath(b.detach(), inkPaint(l.color, bandWidth(k, base, false)));
  }
  return rec.finishRecordingAsPicture();
}
