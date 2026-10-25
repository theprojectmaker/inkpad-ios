// Vertical page layout + the screen<->page transform for the note canvas.
import { clamp } from './geom';
import type { Page } from './model';

export const GAP = 24;
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
  const z = clamp(v.z, z0 * 0.45, z0 * 6);
  const cw = L.w * z, ch = L.h * z;
  const tx = cw <= W - 24 ? (W - cw) / 2 : clamp(v.tx, W - cw - 24, 24);
  const ty = ch + TOP * 2 <= H ? TOP : clamp(v.ty, H - ch - 120, TOP);
  return { z, tx: Number.isFinite(tx) ? tx : 0, ty: Number.isFinite(ty) ? ty : TOP };
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
