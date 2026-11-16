// The drawing board's geometry: plain numbers, no drawing library, so it can be tested on its own.
// A stroke's points are a flat list: x, y, pressure, x, y, pressure, ...

export type Sym = 'off' | 'lr' | 'tb' | 'quad' | 'radial6' | 'radial8';
export const SYMMETRIES: { id: Sym; label: string }[] = [
  { id: 'off', label: 'Off' },
  { id: 'lr', label: 'Mirror left and right' },
  { id: 'tb', label: 'Mirror top and bottom' },
  { id: 'quad', label: 'Four ways' },
  { id: 'radial6', label: 'Kaleidoscope, 6' },
  { id: 'radial8', label: 'Kaleidoscope, 8' },
];

export type Box = { x: number; y: number; w: number; h: number };
type XY = [number, number];

/** Applies `f` to every point's position, keeping pressure. */
export function mapPts(pts: number[], f: (x: number, y: number) => XY): number[] {
  const out = pts.slice();
  for (let i = 0; i + 2 < out.length + 0; i += 3) {
    const [x, y] = f(out[i], out[i + 1]);
    out[i] = x;
    out[i + 1] = y;
  }
  return out;
}

/** The stroke and its copies for a symmetry, about the middle of the canvas. */
export function symmetric(pts: number[], mode: Sym, w: number, h: number): number[][] {
  const cx = w / 2, cy = h / 2;
  const list = [pts];
  if (mode === 'lr') list.push(mapPts(pts, (x, y) => [w - x, y]));
  else if (mode === 'tb') list.push(mapPts(pts, (x, y) => [x, h - y]));
  else if (mode === 'quad') list.push(mapPts(pts, (x, y) => [w - x, y]), mapPts(pts, (x, y) => [x, h - y]), mapPts(pts, (x, y) => [w - x, h - y]));
  else if (mode === 'radial6' || mode === 'radial8') {
    const n = mode === 'radial6' ? 6 : 8;
    for (let k = 1; k < n; k++) {
      const a = (2 * Math.PI * k) / n, ca = Math.cos(a), sa = Math.sin(a);
      list.push(mapPts(pts, (x, y) => [cx + (x - cx) * ca - (y - cy) * sa, cy + (x - cx) * sa + (y - cy) * ca]));
    }
  }
  return list;
}

/** The box around some points' positions (no stroke width). null if there are none. */
export function boundsOf(lists: number[][]): Box | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const pts of lists) {
    for (let i = 0; i + 2 < pts.length + 0; i += 3) {
      minX = Math.min(minX, pts[i]); maxX = Math.max(maxX, pts[i]);
      minY = Math.min(minY, pts[i + 1]); maxY = Math.max(maxY, pts[i + 1]);
    }
  }
  return minX === Infinity ? null : { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Is the point inside the loop (given as a flat x, y list)? */
export function inLoop(loop: number[], x: number, y: number): boolean {
  let inside = false;
  const n = loop.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = loop[i * 2], yi = loop[i * 2 + 1], xj = loop[j * 2], yj = loop[j * 2 + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** True when at least half of the stroke's points are inside the loop. */
export function mostlyInLoop(pts: number[], loop: number[]): boolean {
  const n = pts.length / 3;
  if (!n || loop.length < 6) return false;
  let inside = 0;
  for (let i = 0; i < n; i++) if (inLoop(loop, pts[i * 3], pts[i * 3 + 1])) inside++;
  return inside * 2 >= n;
}

/** Points close enough together (about `gap` apart) that bending them keeps a smooth line. */
export function densify(pts: number[], gap = 3): number[] {
  const n = pts.length / 3;
  if (n < 2) return pts;
  const out: number[] = [pts[0], pts[1], pts[2]];
  for (let i = 1; i < n; i++) {
    const x0 = pts[(i - 1) * 3], y0 = pts[(i - 1) * 3 + 1], p0 = pts[(i - 1) * 3 + 2];
    const x1 = pts[i * 3], y1 = pts[i * 3 + 1], p1 = pts[i * 3 + 2];
    const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / gap));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      out.push(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, p0 + (p1 - p0) * t);
    }
  }
  return out;
}

/** Pushes points near (x, y) along with the finger: the closer, the more. This is what morphs the ink. */
export function pushPts(pts: number[], x: number, y: number, dx: number, dy: number, radius: number): number[] | null {
  let hit = false;
  const out = pts.slice();
  for (let i = 0; i + 2 < out.length + 0; i += 3) {
    const d = Math.hypot(out[i] - x, out[i + 1] - y);
    if (d >= radius) continue;
    const k = (1 - d / radius) ** 2;
    out[i] += dx * k;
    out[i + 1] += dy * k;
    hit = true;
  }
  return hit ? out : null;
}

/** An outline made of straight pieces, as dense points at full pressure. */
export function outline(kind: 'line' | 'rect' | 'ellipse', a: XY, b: XY, lock = false): { pts: number[]; closed: boolean } {
  let [x1, y1] = a, [x2, y2] = b;
  if (lock) {
    if (kind === 'line') {
      const step = Math.PI / 12;
      const ang = Math.round(Math.atan2(y2 - y1, x2 - x1) / step) * step;
      const len = Math.hypot(x2 - x1, y2 - y1);
      x2 = x1 + Math.cos(ang) * len; y2 = y1 + Math.sin(ang) * len;
    } else {
      const side = Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
      x2 = x1 + (x2 >= x1 ? side : -side); y2 = y1 + (y2 >= y1 ? side : -side);
    }
  }
  const flat = (poly: XY[]) => poly.flatMap(([x, y]) => [x, y, 1]);
  if (kind === 'line') return { pts: densify(flat([[x1, y1], [x2, y2]])), closed: false };
  const l = Math.min(x1, x2), t = Math.min(y1, y2), r = Math.max(x1, x2), bt = Math.max(y1, y2);
  if (kind === 'rect') return { pts: densify(flat([[l, t], [r, t], [r, bt], [l, bt], [l, t]])), closed: true };
  const cx = (l + r) / 2, cy = (t + bt) / 2, rx = (r - l) / 2, ry = (bt - t) / 2;
  const steps = 72;
  const ring: XY[] = [];
  for (let i = 0; i <= steps; i++) {
    const ang = (i / steps) * Math.PI * 2 - Math.PI / 2;
    ring.push([cx + Math.cos(ang) * rx, cy + Math.sin(ang) * ry]);
  }
  return { pts: flat(ring), closed: true };
}

/** Ways to bend a group of points, given the box around the group. */
export const WARPS: { id: string; label: string; f: (x: number, y: number, b: Box) => XY }[] = [
  { id: 'slant', label: 'Slant', f: (x, y, b) => [x + (y - (b.y + b.h / 2)) * 0.35, y] },
  { id: 'wave', label: 'Wave', f: (x, y, b) => [x, y + Math.sin(((x - b.x) / Math.max(1, b.w)) * Math.PI * 4) * b.h * 0.07] },
  {
    id: 'bulge', label: 'Bulge', f: (x, y, b) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rad = Math.max(1, Math.max(b.w, b.h) / 2);
      const dx = x - cx, dy = y - cy;
      const d = Math.min(1, Math.hypot(dx, dy) / rad);
      const k = 1 + 0.45 * (1 - d) * (1 - d);
      return [cx + dx * k, cy + dy * k];
    },
  },
  {
    id: 'twist', label: 'Twist', f: (x, y, b) => {
      const cx = b.x + b.w / 2, cy = b.y + b.h / 2, rad = Math.max(1, Math.max(b.w, b.h) / 2);
      const dx = x - cx, dy = y - cy;
      const a = (1 - Math.min(1, Math.hypot(dx, dy) / rad)) * (Math.PI / 2);
      return [cx + dx * Math.cos(a) - dy * Math.sin(a), cy + dx * Math.sin(a) + dy * Math.cos(a)];
    },
  },
  {
    id: 'melt', label: 'Melt', f: (x, y, b) => [x + Math.sin((y - b.y) / 18) * 3, y + Math.pow(Math.max(0, (y - b.y) / Math.max(1, b.h)), 2) * b.h * 0.18],
  },
];

// ---------- more ways to change ink after it's drawn

/** The same line with exactly `n` evenly spaced points. */
export function resample(pts: number[], n: number): number[] {
  const m = pts.length / 3;
  if (m < 1) return [];
  if (m === 1 || n < 2) return [pts[0], pts[1], pts[2]];
  const len: number[] = [0];
  for (let i = 1; i < m; i++) len.push(len[i - 1] + Math.hypot(pts[i * 3] - pts[(i - 1) * 3], pts[i * 3 + 1] - pts[(i - 1) * 3 + 1]));
  const total = len[m - 1] || 1;
  const out: number[] = [];
  let j = 1;
  for (let k = 0; k < n; k++) {
    const want = (total * k) / (n - 1);
    while (j < m - 1 && len[j] < want) j++;
    const span = len[j] - len[j - 1] || 1;
    const t = Math.max(0, Math.min(1, (want - len[j - 1]) / span));
    for (let c = 0; c < 3; c++) out.push(pts[(j - 1) * 3 + c] + (pts[j * 3 + c] - pts[(j - 1) * 3 + c]) * t);
  }
  return out;
}

/** Irons the wobble out of a line: each point moves toward the average of its neighbours. The ends stay put. */
export function smoothPts(pts: number[], passes = 3): number[] {
  let cur = densify(pts, 4);
  const n = cur.length / 3;
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    for (let i = 1; i < n - 1; i++) {
      next[i * 3] = (cur[(i - 1) * 3] + cur[i * 3] * 2 + cur[(i + 1) * 3]) / 4;
      next[i * 3 + 1] = (cur[(i - 1) * 3 + 1] + cur[i * 3 + 1] * 2 + cur[(i + 1) * 3 + 1]) / 4;
    }
    cur = next;
  }
  return cur;
}

/** Shakes a line a little, the same way every time for the same line. */
export function roughenPts(pts: number[], amount = 2.5): number[] {
  const cur = densify(pts, 5);
  let seed = (Math.round(cur[0] * 31 + cur[1] * 17) | 0) || 7;
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff - 0.5; };
  for (let i = 3; i + 5 < cur.length; i += 3) { cur[i] += rnd() * amount * 2; cur[i + 1] += rnd() * amount * 2; }
  return cur;
}

export type Liquify = 'push' | 'pinch' | 'expand' | 'twirl';
/** Liquify: push ink along with the finger, pull it in to a point, push it away, or swirl it round. null if nothing was in reach. */
export function liquify(pts: number[], mode: Liquify, x: number, y: number, dx: number, dy: number, radius: number): number[] | null {
  if (mode === 'push') return pushPts(pts, x, y, dx, dy, radius);
  let hit = false;
  const out = pts.slice();
  for (let i = 0; i + 2 < out.length + 0; i += 3) {
    const ox = out[i] - x, oy = out[i + 1] - y;
    const d = Math.hypot(ox, oy);
    if (d >= radius) continue;
    const k = (1 - d / radius) ** 2;
    if (mode === 'twirl') {
      const a = 0.12 * k, ca = Math.cos(a), sa = Math.sin(a);
      out[i] = x + ox * ca - oy * sa;
      out[i + 1] = y + ox * sa + oy * ca;
    } else {
      const f = mode === 'pinch' ? 1 - 0.06 * k : 1 + 0.06 * k;
      out[i] = x + ox * f;
      out[i + 1] = y + oy * f;
    }
    hit = true;
  }
  return hit ? out : null;
}

/** What a hand-drawn line was probably meant to be: a straight line, an ellipse or a box. null: leave it as drawn. */
export function snapShape(pts: number[]): { pts: number[]; closed: boolean; kind: 'line' | 'ellipse' | 'rect' } | null {
  const n = pts.length / 3;
  const b = boundsOf([pts]);
  if (n < 6 || !b) return null;
  const diag = Math.hypot(b.w, b.h);
  if (diag < 40) return null;
  const x0 = pts[0], y0 = pts[1], x1 = pts[(n - 1) * 3], y1 = pts[(n - 1) * 3 + 1];
  const chord = Math.hypot(x1 - x0, y1 - y0);
  if (chord > diag * 0.75) {
    // A line: every point close to the straight line between the ends.
    let worst = 0;
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs((x1 - x0) * (y0 - pts[i * 3 + 1]) - (x0 - pts[i * 3]) * (y1 - y0)) / chord);
    return worst < chord * 0.06 ? { ...outline('line', [x0, y0], [x1, y1]), kind: 'line' } : null;
  }
  if (chord > diag * 0.25) return null;   // neither a line nor a closed loop
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
  let eErr = 0, rErr = 0;
  for (let i = 0; i < n; i++) {
    const px = pts[i * 3] - cx, py = pts[i * 3 + 1] - cy;
    const r = Math.hypot(px / (b.w / 2 || 1), py / (b.h / 2 || 1));
    eErr += Math.abs(r - 1) * Math.min(b.w, b.h) / 2;
    rErr += Math.min(Math.abs(Math.abs(px) - b.w / 2), Math.abs(Math.abs(py) - b.h / 2));
  }
  eErr /= n; rErr /= n;
  if (Math.min(eErr, rErr) > diag * 0.06) return null;
  const kind = eErr <= rErr ? 'ellipse' : 'rect';
  return { ...outline(kind, [b.x, b.y], [b.x + b.w, b.y + b.h]), kind };
}

// ---------- colour

const hex2 = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
export const rgbOf = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.padEnd(6, '0');
  return [parseInt(f.slice(0, 2), 16) || 0, parseInt(f.slice(2, 4), 16) || 0, parseInt(f.slice(4, 6), 16) || 0];
};
export const hexOf = (r: number, g: number, b: number) => `#${hex2(r)}${hex2(g)}${hex2(b)}`.toUpperCase();
export function hslOf(hex: string): [number, number, number] {
  const [r, g, b] = rgbOf(hex).map((v) => v / 255);
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d + 6) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
export function hexOfHsl(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s, hp = (((h % 360) + 360) % 360) / 60, x = c * (1 - Math.abs((hp % 2) - 1)), m = l - c / 2;
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  return hexOf((r + m) * 255, (g + m) * 255, (b + m) * 255);
}
/** Turns the hue, and scales how strong and how light the colour is. */
export function adjustColor(hex: string, turn: number, sat: number, light: number): string {
  const [h, s, l] = hslOf(hex);
  return hexOfHsl(h + turn, Math.max(0, Math.min(1, s * sat)), Math.max(0, Math.min(1, l + light)));
}
export const invertColor = (hex: string) => { const [r, g, b] = rgbOf(hex); return hexOf(255 - r, 255 - g, 255 - b); };
export const mixColor = (a: string, b: string, t: number) => { const p = rgbOf(a), q = rgbOf(b); return hexOf(p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t); };

/** A line part-way between two lines (0 = the first, 1 = the second). This is what morphs one drawing into another. */
export function tweenPts(a: number[], b: number[], t: number, n = 48): number[] {
  const p = resample(a, n), q = resample(b, n);
  return p.map((v, i) => v + (q[i] - v) * t);
}
