// The stroke being drawn right now, rendered without React: every Pencil
// movement records a tiny SkPicture of the stroke's outline and hands it to a
// Reanimated shared value, which Skia draws on the UI thread straight away.
// The outline is the same perfect-freehand shape the saved stroke uses (with
// the open end still following the nib), plus a short predicted segment to
// hide touch latency.
import { BlendMode, Skia, type SkPicture } from '@shopify/react-native-skia';

import type { Pt } from '@/lib/geom';
import { inkOutline, type InkStyle, outlineSvg } from '@/lib/ink';
import { HL_ALPHA } from '@/lib/skia-render';

export type LiveStroke = {
  pts: Pt[];
  base: number;
  style: InkStyle;
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
  const d = outlineSvg(inkOutline(pts, l.base, l.style, { last: false, smoothing: l.smoothing }));
  const path = d ? Skia.Path.MakeFromSVGString(d) : null;
  if (path) {
    const p = Skia.Paint();
    p.setAntiAlias(true);
    p.setColor(Skia.Color(l.color));
    if (l.style === 'hl') {
      p.setAlphaf(HL_ALPHA);
      if (l.multiply) p.setBlendMode(BlendMode.Multiply);
    }
    c.drawPath(path, p);
  }
  return rec.finishRecordingAsPicture();
}
