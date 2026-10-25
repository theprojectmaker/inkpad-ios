// The stroke being drawn right now, rendered without React: every Pencil
// movement records a tiny SkPicture of the stroke's outline and hands it to a
// Reanimated shared value, which Skia draws on the UI thread straight away.
// The outline is the same perfect-freehand shape the saved stroke uses (with
// the open end still following the nib), plus a short predicted segment to
// hide touch latency.
import { BlendMode, Skia, type SkPicture } from '@shopify/react-native-skia';

import type { Pt } from '@/lib/geom';
import { type InkKind, inkOutline, outlineSvg } from '@/lib/ink';
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
};

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
  const last = l.pts[l.pts.length - 1];
  const pts = l.pred && last ? [...l.pts, { x: l.pred.x, y: l.pred.y, p: last.p }] : l.pts;
  let d = outlineSvg(inkOutline(pts, l.base, l.kind, l.pressure, { last: false, smoothing: l.smoothing }));
  for (const part of l.extra ?? []) d += outlineSvg(inkOutline(part, l.base, l.kind, false, { last: true, smoothing: 0 }));
  const path = d ? Skia.Path.MakeFromSVGString(d) : null;
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
