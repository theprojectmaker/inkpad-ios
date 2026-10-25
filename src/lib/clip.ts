// In-app clipboard for lasso copy/paste (works across notes and pages).
import type { ImageItem, Stroke, TextItem } from './model';
import type { Box } from './geom';

export type Clip = { noteId: string; strokes: Stroke[]; texts: TextItem[]; images: ImageItem[]; box: Box };

let clip: Clip | null = null;
const subs = new Set<() => void>();

export const clipboard = {
  get: () => clip,
  set(c: Clip | null) { clip = c; for (const s of subs) s(); },
  subscribe(fn: () => void) { subs.add(fn); return () => { subs.delete(fn); }; },
};
