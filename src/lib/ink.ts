// Ink shapes, built with perfect-freehand (the stroke engine behind tldraw and
// Excalidraw). Each stroke becomes ONE closed outline polygon: pressure
// changes the width smoothly, ends taper to a fine point, and a single
// filled shape can't crack, seam or blot — on screen or in the exported PDF.
import { getStroke, type StrokeOptions } from 'perfect-freehand';

import { clamp, fin, type Pt, unpack } from './geom';
import type { Stroke } from './model';

export type InkStyle = 'fountain' | 'ball' | 'finger' | 'hl';

export const inkStyleOf = (s: Pick<Stroke, 'kind' | 'pr' | 'pen'>): InkStyle =>
  s.kind === 'hl' ? 'hl' : s.pen === 'ball' ? 'ball' : s.pr ? 'fountain' : 'finger';

const easeOutQuad = (t: number) => t * (2 - t);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/** perfect-freehand settings per pen. `smoothing` is the user's 0..1 setting. */
export function inkOptions(style: InkStyle, base: number, opts: { last: boolean; smoothing?: number; cutStart?: boolean; cutEnd?: boolean }): StrokeOptions {
  const b = clamp(base, 0.2, 200);
  const sm = clamp(opts.smoothing ?? 0.4, 0, 1);
  const streamline = 0.18 + 0.4 * sm;           // how much the line is pulled straight (anti-wobble)
  const start = (taper: number) => ({ cap: true, taper: opts.cutStart ? 0 : taper, easing: easeOutQuad });
  const end = (taper: number) => ({ cap: true, taper: opts.cutEnd ? 0 : taper, easing: easeOutCubic });
  switch (style) {
    case 'fountain':
      // Real Apple Pencil pressure; ends get a short, sharp taper like a nib.
      // Width at normal pressure = the chosen size; light 0.4x, firm 1.6x.
      return { size: b * 1.1, thinning: 0.6, smoothing: 0.62, streamline, simulatePressure: false, start: start(b * 3), end: end(b * 5), last: opts.last };
    case 'ball':
      return { size: b * 1.1, thinning: 0.12, smoothing: 0.6, streamline, simulatePressure: false, start: start(0), end: end(0), last: opts.last };
    case 'finger':
      // No pressure: width follows speed, both ends taper.
      return { size: b * 1.15, thinning: 0.45, smoothing: 0.62, streamline, simulatePressure: true, start: start(b * 5), end: end(b * 7), last: opts.last };
    case 'hl':
    default:
      return { size: b, thinning: 0, smoothing: 0.5, streamline: Math.max(0.3, streamline), simulatePressure: false, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last: opts.last };
  }
}

/** The outline polygon of a stroke from its raw points. */
export function inkOutline(pts: Pt[], base: number, style: InkStyle, opts: { last: boolean; smoothing?: number; cutStart?: boolean; cutEnd?: boolean }): number[][] {
  const input: number[][] = [];
  for (const q of pts) if (Number.isFinite(q.x) && Number.isFinite(q.y)) input.push([q.x, q.y, Number.isFinite(q.p) ? clamp(q.p, 0.02, 1) : 0.5]);
  if (!input.length) return [];
  let out: number[][];
  try { out = getStroke(input, inkOptions(style, base, opts)); } catch { return []; }
  return out.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1]));
}

const f2 = (n: number) => (Math.round(fin(n) * 100) / 100).toString();

/** Closed, smooth SVG path through the outline (quadratic curves via midpoints). */
export function outlineSvg(poly: number[][]): string {
  const n = poly.length;
  if (n < 3) return '';
  const mid = (a: number[], b: number[]) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const m0 = mid(poly[n - 1], poly[0]);
  let d = `M${f2(m0[0])} ${f2(m0[1])}`;
  for (let i = 0; i < n; i++) {
    const p = poly[i], m = mid(p, poly[(i + 1) % n]);
    d += `Q${f2(p[0])} ${f2(p[1])} ${f2(m[0])} ${f2(m[1])}`;
  }
  return d + 'Z';
}

/** SVG of a saved stroke (screen cache + PDF export). */
export function strokeSvg(s: Stroke, smoothing = 0.4): string {
  return outlineSvg(inkOutline(unpack(s.pts), s.w, inkStyleOf(s), { last: true, smoothing: s.sm ?? smoothing, cutStart: !!s.c0, cutEnd: !!s.c1 }));
}
