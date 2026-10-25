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

// ---------- input filter ----------

/**
 * One Euro filter: strong smoothing when the pen moves slowly (kills hand
 * jitter in small writing), almost none when it moves fast (no lag on quick
 * strokes). Values in page points, time in seconds.
 */
export class OneEuro {
  private x: number | null = null;
  private dx = 0;
  private t = 0;
  constructor(public minCutoff = 8, public beta = 0.04, public dCutoff = 1.2) {}
  private static alpha(cutoff: number, dt: number) { const tau = 1 / (2 * Math.PI * cutoff); return 1 / (1 + tau / dt); }
  filter(v: number, tSec: number): number {
    if (!Number.isFinite(v)) return this.x ?? 0;
    if (this.x == null) { this.x = v; this.t = tSec; return v; }
    const dt = clamp(tSec - this.t, 0.001, 0.1);
    this.t = tSec;
    const dv = (v - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dv - this.dx);
    const cut = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += OneEuro.alpha(cut, dt) * (v - this.x);
    return this.x;
  }
}

/** Smoothing setting (0..1) -> filter strength. */
export const euroFor = (smoothing: number) => new OneEuro(14 - 11 * clamp(smoothing, 0, 1), 0.05);

// ---------- outline ----------

export type PenType = 'fountain' | 'ball';

function dedupe(pts: Pt[], minGap: number): Pt[] {
  const out: Pt[] = [];
  for (const q of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(q.x - last.x, q.y - last.y) >= minGap) out.push({ ...q });
    else last.p = Math.max(last.p, q.p);
  }
  // Always keep the true end so the stroke reaches where the pen lifted.
  const end = pts[pts.length - 1];
  if (end && out.length > 1) out[out.length - 1] = { ...end };
  return out;
}

export function polyLen(pts: { x: number; y: number }[]) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return L;
}

function circle(cx: number, cy: number, r: number) {
  r = Math.max(0.2, fin(r, 1));
  return `M${f2(cx - r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(cx + r)} ${f2(cy)}A${f2(r)} ${f2(r)} 0 1 0 ${f2(cx - r)} ${f2(cy)}Z`;
}

// Catmull-Rom through the input points, resampled every `step` points, so
// curves come out round instead of as a chain of little straight pieces.
// Each output point keeps `sp`: how far apart the raw samples were (speed).
type SP = Pt & { sp: number };
function spline(pts: Pt[], step: number): SP[] {
  const n = pts.length;
  const out: SP[] = [{ ...pts[0], sp: n > 1 ? Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) : 0 }];
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(n - 1, i + 2)];
    const seg = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const m = Math.max(1, Math.ceil(seg / step));
    for (let k = 1; k <= m; k++) {
      const t = k / m, t2 = t * t, t3 = t2 * t;
      const cr = (a: number, b: number, c: number, d: number) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push({ x: cr(p0.x, p1.x, p2.x, p3.x), y: cr(p0.y, p1.y, p2.y, p3.y), p: p1.p + (p2.p - p1.p) * t, sp: seg });
    }
  }
  return out;
}

const easeOut = (t: number) => 1 - (1 - t) * (1 - t);

/** Width at each spline point. */
function widths(sp: SP[], base: number, mode: 'fountain' | 'ball' | 'finger' | 'even', openEnd = false): number[] {
  const n = sp.length;
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const p = clamp(sp[i].p, 0, 1);
    let k = 1;
    if (mode === 'fountain') k = 0.22 + 1.55 * Math.pow(p, 0.85);             // pressure drives the line
    else if (mode === 'ball') k = 0.78 + 0.42 * p;                             // gentle, like a ballpoint
    else if (mode === 'finger') k = clamp(1.18 - (sp[i].sp / Math.max(1, base)) * 0.045, 0.62, 1.18);  // faster = thinner
    w[i] = base * k;
  }
  if (mode === 'even') return w;
  // Moving average so the edge never wobbles.
  const r = 4;
  const sm = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) { s += w[j]; c++; }
    sm[i] = s / c;
  }
  // Tapers: pressure already thins pencil ends, so fingers get the stronger taper.
  const L = polyLen(sp);
  const startT = Math.min(L * 0.22, base * (mode === 'finger' ? 5 : 2.2));
  const endT = Math.min(L * 0.25, base * (mode === 'finger' ? 7 : 2.5));
  const floor = mode === 'ball' ? 0.7 : 0.18;
  let d = 0;
  for (let i = 0; i < n && d < startT; i++) {
    if (i) d += Math.hypot(sp[i].x - sp[i - 1].x, sp[i].y - sp[i - 1].y);
    sm[i] *= floor + (1 - floor) * easeOut(clamp(d / Math.max(0.01, startT), 0, 1));
  }
  d = 0;
  for (let i = n - 1; i >= 0 && d < endT && !openEnd; i--) {
    if (i < n - 1) d += Math.hypot(sp[i].x - sp[i + 1].x, sp[i].y - sp[i + 1].y);
    sm[i] *= floor + (1 - floor) * easeOut(clamp(d / Math.max(0.01, endT), 0, 1));
  }
  return sm.map((v) => Math.max(0.22, fin(v, base)));
}

/**
 * The filled outline of a stroke as an SVG path string (Skia draws it on
 * screen; pdf-lib draws the same string into the exported PDF).
 * `fast` = coarser resampling for the live stroke while the pen is down.
 */
export function outlinePath(pts0: Pt[], base: number, opts: { pressure: boolean; taper: boolean; even?: boolean; pen?: PenType; fast?: boolean; openEnd?: boolean }): string {
  const clean = pts0.filter((q) => Number.isFinite(q.x) && Number.isFinite(q.y));
  base = clamp(base, 0.2, 200);
  if (!clean.length) return '';
  const mode = opts.even ? 'even' : !opts.pressure ? (opts.pen === 'ball' ? 'ball' : 'finger') : opts.pen === 'ball' ? 'ball' : 'fountain';
  const L = polyLen(clean);
  if (clean.length < 2 || L < base * 0.35) {
    const c = clean[0];
    const k = mode === 'fountain' ? clamp(0.3 + 1.4 * c.p, 0.45, 1.8) : 1;
    return circle(c.x, c.y, base * 0.5 * k);
  }
  const pts = dedupe(clean, Math.max(0.3, base * 0.2));
  if (pts.length < 2) return circle(pts[0].x, pts[0].y, base * 0.5);
  let step = clamp(base * (opts.fast ? 0.45 : 0.28), 0.35, 2.5);
  if (L / step > 2400) step = L / 2400;
  const sp = spline(pts, step);
  const w = widths(sp, base, mode, opts.openEnd);
  const n = sp.length;
  const left: { x: number; y: number }[] = [], right: { x: number; y: number }[] = [];
  for (let i = 0; i < n; i++) {
    const a = sp[Math.max(0, i - 2)], b = sp[Math.min(n - 1, i + 2)];
    let dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy) || 1;
    dx /= len; dy /= len;
    const h = w[i] / 2;
    left.push({ x: sp[i].x - dy * h, y: sp[i].y + dx * h });
    right.push({ x: sp[i].x + dy * h, y: sp[i].y - dx * h });
  }
  const curve = (a: { x: number; y: number }[]) => {
    let s = '';
    for (let i = 1; i < a.length - 1; i++) s += `Q${f2(a[i].x)} ${f2(a[i].y)} ${f2((a[i].x + a[i + 1].x) / 2)} ${f2((a[i].y + a[i + 1].y) / 2)}`;
    return s + `L${f2(a[a.length - 1].x)} ${f2(a[a.length - 1].y)}`;
  };
  const back = right.slice().reverse();
  const re = w[n - 1] / 2, rs = w[0] / 2;
  let d = `M${f2(left[0].x)} ${f2(left[0].y)}` + curve(left);
  d += `A${f2(re)} ${f2(re)} 0 0 1 ${f2(back[0].x)} ${f2(back[0].y)}`;
  d += curve(back);
  d += `A${f2(rs)} ${f2(rs)} 0 0 1 ${f2(left[0].x)} ${f2(left[0].y)}Z`;
  return d;
}

export function strokePath(s: Stroke): string {
  const pts = unpack(s.pts);
  if (s.kind === 'hl') return outlinePath(pts, s.w, { pressure: false, taper: false, even: true });
  return outlinePath(pts, s.w, { pressure: !!s.pr, taper: !s.pr, pen: s.pen });
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
