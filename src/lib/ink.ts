// Ink shapes, built with perfect-freehand (the stroke engine behind tldraw and
// Excalidraw). Each stroke becomes ONE closed outline polygon: pressure
// changes the width smoothly, ends taper to a fine point, and a single
// filled shape can't crack, seam or blot — on screen or in the exported PDF.
import { getStroke, type StrokeOptions } from 'perfect-freehand';

import { clamp, fin, type Pt, unpack } from './geom';
import type { PenType, Stroke } from './model';

export type { PenType };
/** A pen, or the highlighter. */
export type InkKind = PenType | 'hl';

export const PEN_TYPES: { id: PenType; name: string }[] = [
  { id: 'fountain', name: 'Fountain' },
  { id: 'ball', name: 'Ballpoint' },
  { id: 'brush', name: 'Brush' },
  { id: 'marker', name: 'Marker' },
  { id: 'pencil', name: 'Pencil' },
  { id: 'fine', name: 'Fineliner' },
];

export const inkKindOf = (s: Pick<Stroke, 'kind' | 'pen'>): InkKind => (s.kind === 'hl' ? 'hl' : s.pen ?? 'fountain');

const easeOutQuad = (t: number) => t * (2 - t);
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * perfect-freehand settings per pen. `pressure` = real Apple Pencil pressure
 * (otherwise width follows speed). `smoothing` is the user's 0..1 setting.
 */
export function inkOptions(kind: InkKind, pressure: boolean, base: number, opts: { last: boolean; smoothing?: number; cutStart?: boolean; cutEnd?: boolean }): StrokeOptions {
  const b = clamp(base, 0.2, 200);
  const sm = clamp(opts.smoothing ?? 0.4, 0, 1);
  const streamline = 0.18 + 0.4 * sm;           // how much the line is pulled straight (anti-wobble)
  const start = (taper: number) => ({ cap: true, taper: opts.cutStart ? 0 : taper, easing: easeOutQuad });
  const end = (taper: number) => ({ cap: true, taper: opts.cutEnd ? 0 : taper, easing: easeOutCubic });
  const last = opts.last;
  const sim = !pressure;
  switch (kind) {
    case 'fountain':
      // Width at normal pressure = the chosen size; light 0.4x, firm 1.6x. Short nib-like tapers.
      return pressure
        ? { size: b * 1.1, thinning: 0.6, smoothing: 0.62, streamline, simulatePressure: false, start: start(b * 3), end: end(b * 5), last }
        : { size: b * 1.15, thinning: 0.45, smoothing: 0.62, streamline, simulatePressure: true, start: start(b * 5), end: end(b * 7), last };
    case 'ball':
      return { size: b * 1.1, thinning: 0.12, smoothing: 0.6, streamline, simulatePressure: false, start: start(0), end: end(0), last };
    case 'brush':
      // Very pressure-sensitive with long tapers, like a brush pen.
      return { size: b * 1.7, thinning: sim ? 0.7 : 0.85, smoothing: 0.72, streamline: streamline + 0.05, simulatePressure: sim, start: start(b * 5), end: end(b * 10), last };
    case 'marker':
      // Broad, even and bold.
      return { size: b * 1.9, thinning: 0.03, smoothing: 0.55, streamline, simulatePressure: false, start: start(0), end: end(0), last };
    case 'pencil':
      // Fine and soft; drawn with a graphite grain (see skia-render).
      return { size: b * 0.95, thinning: sim ? 0.25 : 0.4, smoothing: 0.5, streamline: Math.max(0.12, streamline - 0.08), simulatePressure: sim, start: start(b * 2), end: end(b * 3), last };
    case 'fine':
      // Fineliner: crisp, even, no pressure.
      return { size: b * 0.85, thinning: 0, smoothing: 0.5, streamline, simulatePressure: false, start: start(0), end: end(0), last };
    case 'hl':
    default:
      return { size: b, thinning: 0, smoothing: 0.5, streamline: Math.max(0.3, streamline), simulatePressure: false, start: { cap: true, taper: 0 }, end: { cap: true, taper: 0 }, last };
  }
}

/** The outline polygon of a stroke from its raw points. */
export function inkOutline(pts: Pt[], base: number, kind: InkKind, pressure: boolean, opts: { last: boolean; smoothing?: number; cutStart?: boolean; cutEnd?: boolean }): number[][] {
  const input: number[][] = [];
  for (const q of pts) if (Number.isFinite(q.x) && Number.isFinite(q.y)) input.push([q.x, q.y, Number.isFinite(q.p) ? clamp(q.p, 0.02, 1) : 0.5]);
  if (!input.length) return [];
  let out: number[][];
  try { out = getStroke(input, inkOptions(kind, pressure, base, opts)); } catch { return []; }
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
  return outlineSvg(inkOutline(unpack(s.pts), s.w, inkKindOf(s), !!s.pr, { last: true, smoothing: s.sm ?? smoothing, cutStart: !!s.c0, cutEnd: !!s.c1 }));
}
