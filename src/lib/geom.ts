// Pure ink geometry, shared by the on-screen renderer (Skia) and the PDF
// exporter (pdf-lib), so what you see is exactly what gets exported.
// Everything here guards against NaN: a single NaN in an SVG path makes Skia
// or pdf-lib drop the whole path (or crash), so bad input points are dropped.
import type { ImageItem, Stroke, TextItem } from './model';

export type Pt = { x: number; y: number; p: number };
export type Box = { x: number; y: number; w: number; h: number };

export const fin = (v: number, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, fin(v, lo)));
const f2 = (n: number) => (Math.round(fin(n) * 100) / 100).toString();

export function unpack(flat: number[]): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i + 1 < flat.length; i += 3) {
    const x = flat[i], y = flat[i + 1], p = flat[i + 2] ?? 0.5;
    if (Number.isFinite(x) && Number.isFinite(y)) out.push({ x, y, p: Number.isFinite(p) ? p : 0.5 });
  }
  return out;
}

export function pack(pts: Pt[]): number[] {
  const out: number[] = [];
  for (const q of pts) {
    if (!Number.isFinite(q.x) || !Number.isFinite(q.y)) continue;
    out.push(Math.round(q.x * 10) / 10, Math.round(q.y * 10) / 10, Math.round(clamp(q.p, 0, 1) * 100) / 100);
  }
  return out;
}

// ---------- ink ----------
//
// A stroke is drawn as the union of round "capsules": a circle at every
// sample point plus the tangent band joining neighbouring circles. Unlike a
// left/right outline it can never fold over itself, so tight curves, slow
// handwriting and pressure changes stay clean (no blots), and every sample is
// final as soon as it's made — the live stroke can grow piece by piece.
//
// Pipeline (all causal, so the live stroke and the saved stroke match):
//   filtered input points -> Catmull-Rom spline every ~1pt -> width with a
//   rate limit (it can only change gradually along the line) -> capsules.

/**
 * One Euro filter: steadies slow, small movements (hand jitter) and lets
 * fast movement through without lag. Page points in, seconds for time.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(public minCutoff = 12, public beta = 0.06, public dCutoff = 1.2) {}
  private static alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, tSec: number): number {
    if (!Number.isFinite(v)) return this.x ?? 0;
    if (this.x == null) { this.x = v; this.t = tSec; return v; }
    const dt = clamp(tSec - this.t, 0.002, 0.05);
    this.t = tSec;
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cut = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cut, dt) * (v - this.x);
    return this.x;
  }
}

/** Smoothing setting (0..1) -> filter. Low = raw and crisp, high = very steady. */
export const euroFor = (smoothing: number) => new OneEuro(24 - 17 * clamp(smoothing, 0, 1), 0.1);

/** Apple Pencil force (0..1 of max) -> pressure 0..1. Typical writing lands mid-range. */
export const pressureFromForce = (force: number) => clamp(Math.pow(clamp((force - 0.03) / 0.45, 0, 1), 0.85), 0, 1);

export type PenType = 'fountain' | 'ball';
export type InkMode = 'fountain' | 'ball' | 'finger' | 'even';
export type Sample = { x: number; y: number; r: number };

export function polyLen(pts: { x: number; y: number }[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

export const inkMode = (s: { kind: 'pen' | 'hl'; pr?: 1; pen?: 'ball' }): InkMode =>
  s.kind === 'hl' ? 'even' : s.pen === 'ball' ? 'ball' : s.pr ? 'fountain' : 'finger';

/** Builds a stroke's samples as points arrive. */
export class InkBuilder {
  readonly pts: Pt[] = [];
  readonly samples: Sample[] = [];
  private done = 0;           // input segments already turned into samples
  private w = 0;              // current width (rate limited)
  private dist = 0;           // length drawn so far
  private finished = false;
  constructor(readonly base: number, readonly mode: InkMode) {}

  private target(p: number, gap: number) {
    const b = this.base;
    switch (this.mode) {
      case 'fountain': return b * (0.62 + 0.78 * Math.pow(clamp(p, 0, 1), 0.85));
      case 'ball': return b * (0.9 + 0.2 * clamp(p, 0, 1));
      case 'finger': return b * clamp(1.05 - (gap / Math.max(1, b)) * 0.012, 0.86, 1.05);
      default: return b;
    }
  }

  // Soft entry so strokes start fine, like a real nib touching down (a smooth multiplier).
  private entry(dist: number) {
    if (this.mode !== 'finger' && this.mode !== 'fountain') return 1;
    const ramp = this.base * (this.mode === 'finger' ? 2.5 : 1.5);
    return 0.65 + 0.35 * Math.min(1, dist / Math.max(0.01, ramp));
  }

  // Width may only change a little per point of travel: no sudden blobs.
  private step(x: number, y: number, p: number, gap: number, out: Sample[], st: { w: number; dist: number }) {
    const last = out.length ? out[out.length - 1] : this.samples[this.samples.length - 1];
    const d = last ? Math.hypot(x - last.x, y - last.y) : 0;
    st.dist += d;
    const tw = this.target(p, gap);
    if (this.mode === 'even') st.w = tw;
    else {
      const k = Math.max(0.04, this.base * 0.07) * Math.max(d, 0.25);
      st.w += clamp(tw - st.w, -k, k);
    }
    out.push({ x, y, r: Math.max(0.16, (st.w * this.entry(st.dist)) / 2) });
  }

  // Spline samples for input segment i (pts[i] -> pts[i+1]), excluding pts[i].
  private segment(i: number, out: Sample[], st: { w: number; dist: number }) {
    const P = this.pts, n = P.length;
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(n - 1, i + 2)];
    const seg = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const spacing = clamp(this.base * 0.35, 0.5, 1.6);
    const m = Math.max(1, Math.ceil(seg / spacing));
    for (let k = 1; k <= m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      this.step(cr(p0.x, p1.x, p2.x, p3.x), cr(p0.y, p1.y, p2.y, p3.y), p1.p + (p2.p - p1.p) * t, seg, out, st);
    }
  }

  add(q: Pt): boolean {
    if (this.finished || !Number.isFinite(q.x) || !Number.isFinite(q.y)) return false;
    const p = { x: q.x, y: q.y, p: Number.isFinite(q.p) ? clamp(q.p, 0, 1) : 0.5 };
    const last = this.pts[this.pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < Math.max(0.2, this.base * 0.08)) { last.p = Math.max(last.p, p.p); return false; }
    this.pts.push(p);
    if (this.pts.length === 1) {
      this.w = this.target(p.p, 0);
      this.samples.push({ x: p.x, y: p.y, r: Math.max(0.16, (this.w * this.entry(0)) / 2) });
      return true;
    }
    // A segment is final once the point after it is known (Catmull-Rom needs it).
    let grew = false;
    while (this.done < this.pts.length - 2) {
      const st = { w: this.w, dist: this.dist };
      this.segment(this.done, this.samples, st);
      this.w = st.w; this.dist = st.dist;
      this.done++;
      grew = true;
    }
    return grew;
  }

  /** Samples for the not-yet-final end of the stroke (redrawn every frame). */
  tail(): Sample[] {
    const out: Sample[] = [];
    const st = { w: this.w, dist: this.dist };
    for (let i = this.done; i < this.pts.length - 1; i++) this.segment(i, out, st);
    return out;
  }

  finish(): Sample[] {
    if (!this.finished) {
      const t = this.tail();
      this.samples.push(...t);
      this.done = Math.max(0, this.pts.length - 1);
      this.finished = true;
      // Finger strokes lift off with a short taper (the pencil's own pressure does this).
      if (this.mode === 'finger' && this.samples.length > 4) {
        const L = this.dist, len = Math.min(L * 0.2, this.base * 5);
        let d = 0;
        for (let i = this.samples.length - 1; i > 0 && d < len; i--) {
          const s = this.samples[i];
          s.r *= 0.5 + 0.5 * (d / Math.max(0.01, len));
          d += Math.hypot(s.x - this.samples[i - 1].x, s.y - this.samples[i - 1].y);
        }
      }
    }
    return this.samples;
  }
}

export function buildSamples(pts: Pt[], base: number, mode: InkMode): Sample[] {
  const b = new InkBuilder(clamp(base, 0.2, 200), mode);
  for (const q of pts) b.add(q);
  return b.finish();
}

/**
 * Stroke rendering: the centre line is stroked (round caps + round joins) in
 * "width bands" — each run of samples whose width falls in the same 5% band
 * is one smooth polyline drawn at that width. A stroke is a handful of
 * GPU-stroked lines: no polygons to crack, nothing to fold over, and
 * neighbouring bands overlap under their round caps so width changes are
 * seamless. Highlighters use a single band so their transparency stays even.
 */
export const BAND_STEP = 0.05;

export type BandSink = { moveTo: (x: number, y: number) => void; lineTo: (x: number, y: number) => void };

export class BandWriter {
  private last = -1;
  private lastPt: Sample | null = null;
  constructor(readonly base: number, readonly even: boolean, readonly sink: (band: number) => BandSink) {}

  band(r: number) {
    if (this.even) return Math.round(1 / BAND_STEP);
    return Math.max(1, Math.round((2 * r) / this.base / BAND_STEP));
  }

  /** Adds the segment a -> b (b is the new sample). */
  seg(a: Sample, b: Sample) {
    const k = this.band((a.r + b.r) / 2);
    const s = this.sink(k);
    if (k !== this.last || this.lastPt !== a) s.moveTo(a.x, a.y);
    s.lineTo(b.x, b.y);
    this.last = k;
    this.lastPt = b;
  }

  /** A stroke that is just a dot. */
  dot(a: Sample) {
    const s = this.sink(this.band(a.r));
    s.moveTo(a.x, a.y);
    s.lineTo(a.x + 0.01, a.y);
  }

  reset() { this.last = -1; this.lastPt = null; }
}

export const bandWidth = (band: number, base: number, even: boolean) => (even ? base : band * BAND_STEP * base);

export type Band = { w: number; d: string };

/** SVG polylines per width band, for the PDF exporter and the on-screen cache. */
export function samplesBands(s: Sample[], base: number, even: boolean): Band[] {
  const map = new Map<number, string>();
  const w = new BandWriter(base, even, (k) => ({
    moveTo: (x, y) => { map.set(k, (map.get(k) ?? '') + `M${f2(x)} ${f2(y)}`); },
    lineTo: (x, y) => { map.set(k, (map.get(k) ?? '') + `L${f2(x)} ${f2(y)}`); },
  }));
  if (s.length === 1) w.dot(s[0]);
  for (let i = 1; i < s.length; i++) w.seg(s[i - 1], s[i]);
  return [...map].sort((a, b) => a[0] - b[0]).map(([k, d]) => ({ w: bandWidth(k, base, even), d }));
}

export function strokeSamples(s: Stroke): Sample[] {
  return buildSamples(unpack(s.pts), s.w, inkMode(s));
}

export function strokeBands(s: Stroke): Band[] {
  return samplesBands(strokeSamples(s), clamp(s.w, 0.2, 200), s.kind === 'hl');
}


// ---------- boxes / hit tests ----------

export function strokeBox(s: Stroke): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i + 1 < s.pts.length; i += 3) {
    const x = s.pts[i], y = s.pts[i + 1];
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  if (x0 === Infinity) return { x: 0, y: 0, w: 0, h: 0 };
  const pad = s.w;
  return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + pad * 2, h: y1 - y0 + pad * 2 };
}

export function unionBox(a: Box | null, b: Box): Box {
  if (!a) return { ...b };
  const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export const inBox = (b: Box, x: number, y: number, pad = 0) => x >= b.x - pad && x <= b.x + b.w + pad && y >= b.y - pad && y <= b.y + b.h + pad;

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 ? ((px - ax) * dx + (py - ay) * dy) / L2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeHit(s: Stroke, x: number, y: number, r: number): boolean {
  const p = s.pts, rr = r + s.w / 2;
  if (p.length < 3) return false;
  if (p.length < 6) return Math.hypot(p[0] - x, p[1] - y) <= rr;
  for (let i = 3; i + 1 < p.length; i += 3) {
    if (segDist(x, y, p[i - 3], p[i - 2], p[i], p[i + 1]) <= rr) return true;
  }
  return false;
}

// Erasing a strip from (ax,ay) to (bx,by): checks the whole swept segment so
// fast eraser moves don't skip over thin lines.
export function strokeHitSwept(s: Stroke, ax: number, ay: number, bx: number, by: number, r: number): boolean {
  const L = Math.hypot(bx - ax, by - ay);
  const n = Math.max(1, Math.ceil(L / Math.max(1, r * 0.5)));
  for (let k = 0; k <= n; k++) {
    const t = k / n;
    if (strokeHit(s, ax + (bx - ax) * t, ay + (by - ay) * t, r)) return true;
  }
  return false;
}

function densify(pts: Pt[], step: number): Pt[] {
  if (pts.length < 2) return pts.slice();
  const out: Pt[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.floor(d / step);
    for (let k = 1; k < n; k++) {
      const t = k / n;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, p: a.p + (b.p - a.p) * t });
    }
    out.push(b);
  }
  return out;
}

// Partial erase: returns the pieces of the stroke left after rubbing out a
// circle at (x,y), or null when the eraser didn't touch it.
export function eraseSplit(s: Stroke, x: number, y: number, r: number): Pt[][] | null {
  if (!strokeHit(s, x, y, r)) return null;
  const pts = densify(unpack(s.pts), Math.max(0.6, r / 3));
  const rr = r + s.w * 0.3;
  const pieces: Pt[][] = [];
  let cur: Pt[] = [];
  for (const q of pts) {
    if (Math.hypot(q.x - x, q.y - y) <= rr) {
      if (cur.length) pieces.push(cur);
      cur = [];
    } else cur.push(q);
  }
  if (cur.length) pieces.push(cur);
  return pieces.filter((pc) => pc.length >= 2 && polyLen(pc) > s.w * 0.6);
}

// ---------- lasso ----------

export function pointInPoly(x: number, y: number, poly: { x: number; y: number }[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi || 1e-9) + xi) inside = !inside;
  }
  return inside;
}

export function strokeInLasso(s: Stroke, poly: { x: number; y: number }[]) {
  let n = 0, inside = 0;
  for (let i = 0; i + 1 < s.pts.length; i += 3) {
    n++;
    if (pointInPoly(s.pts[i], s.pts[i + 1], poly)) inside++;
  }
  return n > 0 && inside / n >= 0.6;
}

export function textBox(t: TextItem): Box {
  if (t.sticker) return { x: t.x, y: t.y, w: t.size * 1.25, h: t.size * 1.25 };
  const lines = Math.max(1, t.text.split('\n').reduce((n, ln) => n + Math.max(1, Math.ceil((ln.length * t.size * 0.52) / Math.max(20, t.w))), 0));
  return { x: t.x, y: t.y, w: t.w, h: lines * t.size * 1.3 + 4 };
}

export const imageBox = (im: ImageItem): Box => ({ x: im.x, y: im.y, w: im.w, h: im.h });

// ---------- transforms ----------

export type Xf = { dx: number; dy: number; s: number; ox: number; oy: number };
export const xfPoint = (t: Xf, x: number, y: number) => ({ x: t.ox + (x - t.ox) * t.s + t.dx, y: t.oy + (y - t.oy) * t.s + t.dy });

export function xfStroke(s: Stroke, t: Xf): Stroke {
  const pts = s.pts.slice();
  for (let i = 0; i + 1 < pts.length; i += 3) {
    const q = xfPoint(t, pts[i], pts[i + 1]);
    pts[i] = Math.round(q.x * 10) / 10; pts[i + 1] = Math.round(q.y * 10) / 10;
  }
  return { ...s, pts, w: clamp(s.w * Math.sqrt(t.s), 0.3, 120) };
}

export function xfText(tx: TextItem, t: Xf): TextItem {
  const q = xfPoint(t, tx.x, tx.y);
  return { ...tx, x: q.x, y: q.y, w: Math.max(30, tx.w * t.s), size: clamp(tx.size * t.s, 6, 400) };
}

export function xfImage(im: ImageItem, t: Xf): ImageItem {
  const q = xfPoint(t, im.x, im.y);
  return { ...im, x: q.x, y: q.y, w: Math.max(8, im.w * t.s), h: Math.max(8, im.h * t.s) };
}

// ---------- shapes ----------
// Hold the pen still at the end of a stroke and it snaps to a clean shape.

function rdp(pts: Pt[], eps: number): Pt[] {
  if (pts.length < 3) return pts.slice();
  let idx = 0, dmax = 0;
  const a = pts[0], b = pts[pts.length - 1];
  for (let i = 1; i < pts.length - 1; i++) {
    const d = segDist(pts[i].x, pts[i].y, a.x, a.y, b.x, b.y);
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  const l = rdp(pts.slice(0, idx + 1), eps), r = rdp(pts.slice(idx), eps);
  return l.slice(0, -1).concat(r);
}

function line(a: { x: number; y: number }, b: { x: number; y: number }, p: number, step = 3): Pt[] {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const n = Math.max(1, Math.ceil(d / step));
  const out: Pt[] = [];
  for (let k = 0; k <= n; k++) out.push({ x: a.x + (b.x - a.x) * (k / n), y: a.y + (b.y - a.y) * (k / n), p });
  return out;
}

function poly(corners: { x: number; y: number }[], p: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < corners.length; i++) {
    const seg = line(corners[i], corners[(i + 1) % corners.length], p);
    out.push(...(i ? seg.slice(1) : seg));
  }
  return out;
}

export type ShapeKind = 'line' | 'rect' | 'ellipse' | 'triangle' | 'polygon';

export function recognizeShape(raw: Pt[]): { kind: ShapeKind; pts: Pt[] } | null {
  const pts = raw.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  if (pts.length < 4) return null;
  const L = polyLen(pts);
  if (L < 18) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, pSum = 0;
  for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); pSum += q.p; }
  const p = pSum / pts.length;
  const diag = Math.hypot(x1 - x0, y1 - y0) || 1;
  const a = pts[0], b = pts[pts.length - 1];
  const gap = Math.hypot(b.x - a.x, b.y - a.y);

  // Straight line: every point close to the chord.
  let maxDev = 0;
  for (const q of pts) maxDev = Math.max(maxDev, segDist(q.x, q.y, a.x, a.y, b.x, b.y));
  if (gap > diag * 0.75 && maxDev < Math.max(4, gap * 0.06)) {
    // Snap near-horizontal / near-vertical lines.
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const snap = Math.PI / 4;
    const near = Math.round(ang / snap) * snap;
    let end = b;
    if (Math.abs(ang - near) < 0.08) end = { x: a.x + Math.cos(near) * gap, y: a.y + Math.sin(near) * gap, p: b.p };
    return { kind: 'line', pts: line(a, end, p) };
  }

  const closed = gap < Math.max(14, L * 0.16);
  if (!closed) return null;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2;
  if (rx < 4 || ry < 4) return null;

  const simple = rdp(pts.concat([pts[0]]), diag * 0.07);
  let corners = simple.slice(0, -1);
  // Merge a corner that duplicates the start.
  if (corners.length > 1 && Math.hypot(corners[0].x - corners[corners.length - 1].x, corners[0].y - corners[corners.length - 1].y) < diag * 0.12) corners = corners.slice(0, -1);

  // Ellipse: points sit at a steady normalised radius.
  let err = 0;
  for (const q of pts) err += Math.abs(Math.hypot((q.x - cx) / rx, (q.y - cy) / ry) - 1);
  err /= pts.length;
  if (err < 0.09 && corners.length >= 5 || err < 0.06) {
    const n = Math.max(24, Math.round((Math.PI * (rx + ry)) / 3));
    const out: Pt[] = [];
    for (let k = 0; k <= n; k++) { const t = (k / n) * Math.PI * 2; out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry, p }); }
    return { kind: 'ellipse', pts: out };
  }
  if (corners.length === 3) return { kind: 'triangle', pts: poly(corners, p) };
  if (corners.length === 4) {
    // Nearly axis-aligned quads become a true rectangle.
    let aligned = true;
    for (let i = 0; i < 4; i++) {
      const c = corners[i], d = corners[(i + 1) % 4];
      const ang = Math.abs(Math.atan2(d.y - c.y, d.x - c.x)) % (Math.PI / 2);
      if (Math.min(ang, Math.PI / 2 - ang) > 0.2) aligned = false;
    }
    if (aligned) return { kind: 'rect', pts: poly([{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], p) };
    return { kind: 'polygon', pts: poly(corners, p) };
  }
  if (corners.length >= 5 && corners.length <= 8 && err > 0.09) return { kind: 'polygon', pts: poly(corners, p) };
  if (err < 0.14) {
    const n = Math.max(24, Math.round((Math.PI * (rx + ry)) / 3));
    const out: Pt[] = [];
    for (let k = 0; k <= n; k++) { const t = (k / n) * Math.PI * 2; out.push({ x: cx + Math.cos(t) * rx, y: cy + Math.sin(t) * ry, p }); }
    return { kind: 'ellipse', pts: out };
  }
  return null;
}
