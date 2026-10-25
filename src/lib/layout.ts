// Vertical page layout + the screen<->page transform for the note canvas.
import { clamp } from './geom';
import type { Page } from './model';

export const GAP = 24;
/** Zoom limits, relative to "page fits the width". */
export const MIN_ZOOM = 0.4;
export const MAX_ZOOM = 10;
export const TOP = 20;

export type DocLayout = { tops: number[]; xs: number[]; w: number; h: number };

export function layoutDoc(pages: Page[]): DocLayout {
  const w = pages.reduce((m, p) => Math.max(m, p.w), 1);
  const tops: number[] = [], xs: number[] = [];
  let y = 0;
  for (const p of pages) { tops.push(y); xs.push((w - p.w) / 2); y += p.h + GAP; }
  return { tops, xs, w, h: Math.max(1, y - GAP) };
}

export type View = { z: number; tx: number; ty: number };

export const fitZoom = (L: DocLayout, W: number) => clamp((W - 40) / L.w, 0.15, 6);

export function clampView(v: View, L: DocLayout, W: number, H: number): View {
  const z0 = fitZoom(L, W);
  const z = clamp(v.z, z0 * MIN_ZOOM, z0 * MAX_ZOOM);
  const cw = L.w * z, ch = L.h * z;
  const tx = cw <= W - 24 ? (W - cw) / 2 : clamp(v.tx, W - cw - 24, 24);
  const ty = ch + TOP * 2 <= H ? TOP : clamp(v.ty, H - ch - 120, TOP);
  return { z, tx: Number.isFinite(tx) ? tx : 0, ty: Number.isFinite(ty) ? ty : TOP };
}

// Past an edge (or a zoom limit) the page follows with resistance and springs
// back on release, instead of stopping dead.
const rubber = (v: number, lo: number, hi: number, k = 0.32) => (v < lo ? lo - (lo - v) * k : v > hi ? hi + (v - hi) * k : v);
export function softClampView(v: View, L: DocLayout, W: number, H: number): View {
  const z0 = fitZoom(L, W), zmin = z0 * MIN_ZOOM, zmax = z0 * MAX_ZOOM;
  const z = v.z < zmin ? zmin * Math.pow(v.z / zmin, 0.3) : v.z > zmax ? zmax * Math.pow(v.z / zmax, 0.3) : v.z;
  const cw = L.w * z, ch = L.h * z;
  const [xl, xh] = cw <= W - 24 ? [(W - cw) / 2, (W - cw) / 2] : [W - cw - 24, 24];
  const [yl, yh] = ch + TOP * 2 <= H ? [TOP, TOP] : [H - ch - 120, TOP];
  const tx = rubber(v.tx, xl, xh), ty = rubber(v.ty, yl, yh);
  return { z: Number.isFinite(z) ? z : z0, tx: Number.isFinite(tx) ? tx : 0, ty: Number.isFinite(ty) ? ty : TOP };
}

export function pageAt(L: DocLayout, pages: Page[], docY: number): number {
  for (let i = 0; i < pages.length; i++) if (docY < L.tops[i] + pages[i].h + GAP / 2) return i;
  return Math.max(0, pages.length - 1);
}

export function visiblePages(L: DocLayout, pages: Page[], v: View, H: number, margin = 80): number[] {
  const out: number[] = [];
  for (let i = 0; i < pages.length; i++) {
    const y0 = v.ty + L.tops[i] * v.z, y1 = y0 + pages[i].h * v.z;
    if (y1 >= -margin && y0 <= H + margin) out.push(i);
  }
  return out;
}
