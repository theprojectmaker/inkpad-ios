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
