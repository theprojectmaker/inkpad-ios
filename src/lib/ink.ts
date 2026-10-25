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
        ? { size: b * 1.1, thinning: 0.5, smoothing: 0.62, streamline, simulatePressure: false, start: start(b * 3), end: end(b * 5), last }
        : { size: b * 1.15, thinning: 0.45, smoothing: 0.62, streamline, simulatePressure: true, start: start(b * 5), end: end(b * 7), last };
    case 'ball':
      return { size: b * 1.1, thinning: 0.12, smoothing: 0.6, streamline, simulatePressure: false, start: start(0), end: end(0), last };
    case 'brush':
      // Very pressure-sensitive with long tapers, like a brush pen.
      return { size: b * 1.7, thinning: sim ? 0.7 : 0.75, smoothing: 0.72, streamline: streamline + 0.05, simulatePressure: sim, start: start(b * 5), end: end(b * 10), last };
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
  if (s.f) return outlineSvg(inkOutline2(unpack(s.pts), s.w, inkKindOf(s), !!s.pr, { last: true, cutStart: !!s.c0, cutEnd: !!s.c1 }));
  return outlineSvg(inkOutline(unpack(s.pts), s.w, inkKindOf(s), !!s.pr, { last: true, smoothing: s.sm ?? smoothing, cutStart: !!s.c0, cutEnd: !!s.c1 }));
}

// ---------- clean input (strokes drawn since the "smooth ink" update) ----------
// Raw Pencil points jitter by a pixel or so. Fed straight to perfect-freehand
// that jitter makes it add round caps wherever the direction flips (blobs),
// and its streamline makes the line lag and then catch up (chunks). Instead:
// 1. each point is pulled toward the last one by a distance-based filter
//    (tiny wiggles are absorbed, real movement is followed with a small,
//    constant lag), 2. the kept points are joined by a centripetal
//    Catmull-Rom curve sampled at even spacing, 3. that clean curve goes to
//    perfect-freehand with no streamline and no simulated pressure.
// Every step is local, so the live stroke can be drawn in frozen chunks and
// still match the saved stroke exactly.

/** How far (in page units) a wiggle must go before the line follows it. */
export const jitterK = (smoothing: number, zoom: number) => (0.25 + 1.5 * clamp(smoothing, 0, 1)) / Math.max(0.2, zoom || 1);

export function filterPt(prev: Pt | undefined, raw: Pt, k: number): Pt {
  if (!prev) return { x: raw.x, y: raw.y, p: raw.p };
  const d = Math.hypot(raw.x - prev.x, raw.y - prev.y);
  const a = d / (d + Math.max(1e-4, k));
  return { x: prev.x + (raw.x - prev.x) * a, y: prev.y + (raw.y - prev.y) * a, p: raw.p };
}

/** Evenly spaced points along a centripetal Catmull-Rom curve through pts[from..to]. */
export function densify(pts: Pt[], spacing: number, from = 0, to = pts.length - 1): Pt[] {
  const n = pts.length;
  from = Math.max(0, from); to = Math.min(n - 1, to);
  if (to <= from) return pts.slice(from, to + 1);
  const out: Pt[] = [pts[from]];
  const sp = Math.max(0.05, spacing);
  for (let i = from; i < to; i++) {
    const p1 = pts[i], p2 = pts[i + 1];
    const L = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const steps = Math.min(96, Math.ceil(L / sp));
    if (steps <= 1 || L < 1e-6) { out.push(p2); continue; }
    // Missing neighbours at the ends are mirrored, so the curve starts and ends straight.
    const p0 = i > 0 ? pts[i - 1] : { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, p: p1.p };
    const p3 = i + 2 < n ? pts[i + 2] : { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, p: p2.p };
    const kn = (a: Pt, b: Pt) => Math.max(1e-4, Math.sqrt(Math.hypot(b.x - a.x, b.y - a.y)));
    const t0 = 0, t1 = kn(p0, p1), t2 = t1 + kn(p1, p2), t3 = t2 + kn(p2, p3);
    for (let s = 1; s <= steps; s++) {
      const u = s / steps;
      if (s === steps) { out.push(p2); break; }
      const t = t1 + (t2 - t1) * u;
      const lerp = (a: Pt, b: Pt, ta: number, tb: number) => {
        const w = (t - ta) / (tb - ta);
        return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
      };
      const A1 = lerp(p0, p1 as Pt, t0, t1), A2 = lerp(p1, p2, t1, t2), A3 = lerp(p2, p3, t2, t3);
      const B1 = { x: A1.x + (A2.x - A1.x) * ((t - t0) / (t2 - t0)), y: A1.y + (A2.y - A1.y) * ((t - t0) / (t2 - t0)) };
      const B2 = { x: A2.x + (A3.x - A2.x) * ((t - t1) / (t3 - t1)), y: A2.y + (A3.y - A2.y) * ((t - t1) / (t3 - t1)) };
      const w = (t - t1) / (t2 - t1);
      const x = B1.x + (B2.x - B1.x) * w, y = B1.y + (B2.y - B1.y) * w;
      out.push({ x: Number.isFinite(x) ? x : p1.x + (p2.x - p1.x) * u, y: Number.isFinite(y) ? y : p1.y + (p2.y - p1.y) * u, p: p1.p + (p2.p - p1.p) * u });
    }
  }
  return out;
}

// perfect-freehand drops the last 3 units of a stroke and skips the first
// `size` units; working 8x finer keeps that well under a pixel at any zoom.
const FINE = 8;

/** Outline of a clean-input stroke, or of pts[from..to] when drawing it in chunks. */
export function inkOutline2(pts: Pt[], base: number, kind: InkKind, pressure: boolean, opts: { last: boolean; cutStart?: boolean; cutEnd?: boolean; from?: number; to?: number }): number[][] {
  const clean = pts.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y)).map((q) => ({ x: q.x, y: q.y, p: Number.isFinite(q.p) ? clamp(q.p, 0.02, 1) : 0.5 }));
  if (!clean.length) return [];
  const o = inkOptions(kind, pressure, base, { last: opts.last, cutStart: opts.cutStart, cutEnd: opts.cutEnd });
  const size = o.size ?? base;
  const dense = densify(clean, clamp(size * 0.18, 0.12, 1.2), opts.from ?? 0, opts.to ?? clean.length - 1);
  const scaleTaper = (t: number | boolean | undefined) => (typeof t === 'number' ? t * FINE : t);
  const fo: StrokeOptions = {
    ...o, size: size * FINE, streamline: 0, simulatePressure: false,
    start: { ...o.start, taper: scaleTaper(o.start?.taper) }, end: { ...o.end, taper: scaleTaper(o.end?.taper) },
  };
  let out: number[][];
  try { out = getStroke(dense.map((q) => [q.x * FINE, q.y * FINE, q.p]), fo); } catch { return []; }
  return out.filter((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])).map((p) => [p[0] / FINE, p[1] / FINE]);
}
