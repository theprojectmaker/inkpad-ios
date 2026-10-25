// The stroke being drawn right now. It lives in its own tiny component inside
// the Skia canvas, so each Pencil movement redraws just this one path — the
// pages around it are not touched. The path grows piece by piece: finished
// samples are appended once to `stable`, and only the last few (still moving)
// samples plus a band to the pen tip are rebuilt each frame.
import { Group, Path, Skia, type SkPath, type SkPathBuilder, type Transforms3d } from '@shopify/react-native-skia';
import { useEffect, useState, type MutableRefObject } from 'react';

import { capsules, type InkBuilder, type Sample } from '@/lib/geom';
import { HL_ALPHA } from '@/lib/skia-render';

export function appendSamples(path: SkPathBuilder, s: Sample[], from: number, prev?: Sample) {
  capsules(s, from,
    (x, y, r) => { path.addCircle(x, y, r); },
    (q) => { path.addPoly([{ x: q[0], y: q[1] }, { x: q[2], y: q[3] }, { x: q[4], y: q[5] }, { x: q[6], y: q[7] }], true); },
    prev);
}

export type LiveStroke = {
  ink: InkBuilder;
  stable: SkPathBuilder;    // finished part of the stroke (grows, never rebuilt)
  stablePath: SkPath;       // snapshot of `stable`, refreshed when it grows
  drawn: number;            // samples already in `stable`
  tip: Sample | null;       // raw pen position (unsmoothed) so ink reaches the nib
  color: string;
  hl: boolean;
  multiply: boolean;
  transform: Transforms3d;
};

export function newLive(ink: InkBuilder, color: string, hl: boolean, multiply: boolean, transform: LiveStroke['transform']): LiveStroke {
  const stable = Skia.PathBuilder.Make();
  return { ink, stable, stablePath: stable.build(), drawn: 0, tip: null, color, hl, multiply, transform };
}

/** Moves newly finished samples into the stable path. */
export function growLive(l: LiveStroke) {
  const s = l.ink.samples;
  if (s.length > l.drawn) {
    appendSamples(l.stable, s, l.drawn, l.drawn > 0 ? s[l.drawn - 1] : undefined);
    l.drawn = s.length;
    l.stablePath = l.stable.build();
  }
}

/** Rebuilds the stroke from scratch (after it snapped to a shape). */
export function resetLive(l: LiveStroke, ink: InkBuilder) {
  l.ink = ink;
  l.stable = Skia.PathBuilder.Make();
  l.stablePath = l.stable.build();
  l.drawn = 0;
  l.tip = null;
  ink.finish();
  growLive(l);
}

function frame(l: LiveStroke): SkPath {
  const p = Skia.PathBuilder.MakeFromPath(l.stablePath);
  const s = l.ink.samples;
  const tail = l.ink.tail();
  const last = tail.length ? tail[tail.length - 1] : s[s.length - 1];
  if (l.tip && last && Math.hypot(l.tip.x - last.x, l.tip.y - last.y) > 0.3) tail.push({ x: l.tip.x, y: l.tip.y, r: last.r });
  if (tail.length) appendSamples(p, tail, 0, s[s.length - 1]);
  return p.detach();
}

export type LiveCtl = { draw?: (l: LiveStroke | null) => void };

export function LiveInk({ ctl }: { ctl: MutableRefObject<LiveCtl> }) {
  const [state, setState] = useState<{ path: SkPath; l: LiveStroke } | null>(null);
  useEffect(() => {
    ctl.current.draw = (l) => setState(l ? { path: frame(l), l } : null);
    return () => { ctl.current.draw = undefined; };
  }, [ctl]);
  if (!state) return null;
  const { l, path } = state;
  return (
    <Group transform={l.transform}>
      <Path path={path} color={l.color} opacity={l.hl ? HL_ALPHA : 1} blendMode={l.hl && l.multiply ? 'multiply' : 'srcOver'} />
    </Group>
  );
}
