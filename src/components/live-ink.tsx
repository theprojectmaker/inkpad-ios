// The stroke being drawn right now, rendered without React: every Pencil
// movement records a tiny SkPicture of the stroke's outline and hands it to a
// Reanimated shared value, which Skia draws on the UI thread straight away.
// The outline is the same perfect-freehand shape the saved stroke uses (with
// the open end still following the nib), plus a short predicted segment to
// hide touch latency.
import { BlendMode, Skia, type SkPath, type SkPicture } from '@shopify/react-native-skia';

import type { Pt } from '@/lib/geom';
import { type InkKind, inkOutline, inkOutline2, outlineSvg } from '@/lib/ink';
import { HL_ALPHA, inkFill } from '@/lib/skia-render';

export type LiveStroke = {
  pts: Pt[];
  base: number;
  kind: InkKind;
  pressure: boolean;        // real Apple Pencil pressure
  laser?: boolean;          // laser pointer: glows, then fades away (never saved)
  fade?: number;            // 0..1 while the laser fades out
  extra?: Pt[][];           // more polylines drawn the same way (e.g. an arrow's head)
  smoothing: number;
  color: string;
  multiply: boolean;
  tf: { tx: number; ty: number; z: number };   // page -> screen
  pred: { x: number; y: number } | null;       // predicted nib position a frame ahead
  v2?: boolean;             // clean-input ink (pts are filtered; see inkOutline2)
  raw?: Pt | null;          // the nib's latest unfiltered position (the line reaches it)
  frozen?: SkPath | null;   // finished chunks of a long stroke, never recomputed
  from?: number;            // pts index where the unfrozen tail starts
};

/** Appends an outline polygon to a path (smooth quadratic curves through the midpoints). */
export function addOutline(path: SkPath, poly: number[][]) {
  const n = poly.length;
  if (n < 3) return;
  const mx = (i: number) => (poly[i][0] + poly[(i + 1) % n][0]) / 2, my = (i: number) => (poly[i][1] + poly[(i + 1) % n][1]) / 2;
  path.moveTo(mx(n - 1), my(n - 1));
  for (let i = 0; i < n; i++) path.quadTo(poly[i][0], poly[i][1], mx(i), my(i));
  path.close();
}

// Once the tail is long, everything but its last couple of points is final:
// turn it into a frozen chunk so each frame only redoes a short tail.
const CHUNK = 36;
function freezeChunks(l: LiveStroke) {
  const from = l.from ?? 0, n = l.pts.length;
  if (n - from < CHUNK) return;
  const to = n - 2;
  if (from === 0) {
    // Let the start taper finish inside the first chunk.
    let L = 0;
    for (let i = 1; i <= to; i++) L += Math.hypot(l.pts[i].x - l.pts[i - 1].x, l.pts[i].y - l.pts[i - 1].y);
    if (L < l.base * 12 + 6) return;
  }
  const poly = inkOutline2(l.pts, l.base, l.kind, l.pressure, { last: false, from, to, cutStart: from > 0, cutEnd: true });
  if (!l.frozen) l.frozen = Skia.Path.Make();
  addOutline(l.frozen, poly);
  l.from = to;
}

function livePath2(l: LiveStroke): SkPath {
  freezeChunks(l);
  const from = l.from ?? 0;
  // The tail (plus one point before it, so the curve bends the same way) up to the nib.
  const s0 = Math.max(0, from - 1);
  const tail = l.pts.slice(s0);
  const end = tail[tail.length - 1];
  if (l.raw && end && Math.hypot(l.raw.x - end.x, l.raw.y - end.y) > 0.02) tail.push(l.raw);
  const nib = tail[tail.length - 1];
  if (l.pred && nib) tail.push({ x: l.pred.x, y: l.pred.y, p: nib.p });
  const path = l.frozen ? l.frozen.copy() : Skia.Path.Make();
  addOutline(path, inkOutline2(tail, l.base, l.kind, l.pressure, { last: false, from: from - s0, cutStart: from > 0, cutEnd: true }));
  return path;
}

let EMPTY: SkPicture | null = null;
export function emptyPicture(): SkPicture {
  if (!EMPTY) { const r = Skia.PictureRecorder(); r.beginRecording(Skia.XYWHRect(0, 0, 1, 1)); EMPTY = r.finishRecordingAsPicture(); }
  return EMPTY;
}

/** Records the current frame of the live stroke. */
export function liveFrame(l: LiveStroke): SkPicture {
  const rec = Skia.PictureRecorder();
  const c = rec.beginRecording(Skia.XYWHRect(-1e5, -1e5, 2e5, 2e5));
  c.translate(l.tf.tx, l.tf.ty);
  c.scale(l.tf.z, l.tf.z);
  let path: SkPath | null;
  if (l.v2) path = livePath2(l);
  else {
    const last = l.pts[l.pts.length - 1];
    const pts = l.pred && last ? [...l.pts, { x: l.pred.x, y: l.pred.y, p: last.p }] : l.pts;
    let d = outlineSvg(inkOutline(pts, l.base, l.kind, l.pressure, { last: false, smoothing: l.smoothing }));
    for (const part of l.extra ?? []) d += outlineSvg(inkOutline(part, l.base, l.kind, false, { last: true, smoothing: 0 }));
    path = d ? Skia.Path.MakeFromSVGString(d) : null;
  }
  if (path) {
    if (l.laser) {
      // A soft glow under a bright core.
      const glow = Skia.Paint();
      glow.setAntiAlias(true);
      glow.setColor(Skia.Color(l.color));
      glow.setAlphaf(0.35 * (l.fade ?? 1));
      glow.setMaskFilter(Skia.MaskFilter.MakeBlur(0 /* normal */, l.base * 1.6, true));
      c.drawPath(path, glow);
      c.drawPath(path, inkFill('#FFFFFF', 'fine', 0.9 * (l.fade ?? 1)));
    } else if (l.kind === 'hl') c.drawPath(path, inkFill(l.color, 'hl', HL_ALPHA, l.multiply ? BlendMode.Multiply : undefined));
    else c.drawPath(path, inkFill(l.color, l.kind));
  }
  return rec.finishRecordingAsPicture();
}
