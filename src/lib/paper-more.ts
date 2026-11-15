// More paper templates. Each is drawn from plain rectangles and dots (see paper.ts), so the
// same marks show on screen, in thumbnails and in the exported PDF. Sizes are in points and
// every template lays itself out from the page's width and height, so it fits any page size.
import type { Mark } from './paper';

type Ink = { line: string; margin: string };

/** A small drawing kit over the list of marks. */
class Kit {
  out: Mark[] = [];
  constructor(readonly w: number, readonly h: number, readonly ink: Ink) {}
  /** A line across. */
  H(y: number, x0 = 0, x1 = this.w, t = 0.6, c = this.ink.line) { this.out.push({ x: x0, y: y - t / 2, w: x1 - x0, h: t, color: c }); }
  /** A line down. */
  V(x: number, y0 = 0, y1 = this.h, t = 0.6, c = this.ink.line) { this.out.push({ x: x - t / 2, y: y0, w: t, h: y1 - y0, color: c }); }
  /** The outline of a box. */
  R(x: number, y: number, w: number, h: number, t = 0.9, c = this.ink.line) {
    this.H(y, x, x + w, t, c); this.H(y + h, x, x + w, t, c); this.V(x, y, y + h, t, c); this.V(x + w, y, y + h, t, c);
  }
  D(x: number, y: number, r = 0.9, c = this.ink.line) { this.out.push({ cx: x, cy: y, r, color: c }); }
  F(x: number, y: number, w: number, h: number, c = this.ink.line) { this.out.push({ x, y, w, h, color: c }); }
  /** Writing lines from y0 down to y1. */
  rows(y0: number, y1: number, gap: number, x0 = 0, x1 = this.w, t = 0.6) { for (let y = y0; y <= y1 + 0.01; y += gap) this.H(y, x0, x1, t); }
  /** A dashed line across. */
  dash(y: number, x0 = 0, x1 = this.w, on = 5, off = 5, t = 0.6) { for (let x = x0; x < x1; x += on + off) this.H(y, x, Math.min(x1, x + on), t); }
  /** A table: `cols` are the column widths as shares of the whole. */
  table(x: number, y: number, w: number, h: number, cols: number[], rows: number, head = true) {
    this.R(x, y, w, h, 1, this.ink.margin);
    const total = cols.reduce((a, b) => a + b, 0);
    let cx = x;
    for (const c of cols.slice(0, -1)) { cx += (c / total) * w; this.V(cx, y, y + h); }
    const rh = h / rows;
    for (let i = 1; i < rows; i++) this.H(y + i * rh, x, x + w, i === 1 && head ? 1.1 : 0.6, i === 1 && head ? this.ink.margin : this.ink.line);
  }
  /** A square grid of lines inside a box. */
  grid(x: number, y: number, w: number, h: number, nx: number, ny: number, t = 0.6) {
    for (let i = 0; i <= nx; i++) this.V(x + (w * i) / nx, y, y + h, t);
    for (let j = 0; j <= ny; j++) this.H(y + (h * j) / ny, x, x + w, t);
  }
  /** A tick box with a line beside it. */
  check(x: number, y: number, x1: number, s = 13) { this.R(x, y - s - 3, s, s, 0.9); this.H(y, x + s + 10, x1); }
}

type Def = { id: string; name: string; group: string; draw: (k: Kit, w: number, h: number) => void };
const M = 36;   // the usual margin

const lattice = (k: Kit, gap: number, r: number) => { for (let y = gap; y < k.h; y += gap) for (let x = gap; x < k.w; x += gap) k.D(x, y, r); };
const squares = (k: Kit, gap: number, t = 0.45) => { for (let y = gap; y < k.h; y += gap) k.H(y, 0, k.w, t); for (let x = gap; x < k.w; x += gap) k.V(x, 0, k.h, t); };
/** Lines at log spacing: `decades` of them between a and b, along x (down) or y (across). */
const logLines = (k: Kit, a: number, b: number, decades: number, across: boolean, lo: number, hi: number) => {
  const span = (b - a) / decades;
  for (let d = 0; d < decades; d++) for (let n = 1; n <= 10; n++) {
    const at = a + (d + Math.log10(n)) * span;
    const t = n === 1 || n === 10 ? 1 : 0.45;
    if (across) k.H(across ? b - (at - a) : at, lo, hi, t); else k.V(at, lo, hi, t);
  }
};
const staff = (k: Kit, y: number, lines: number, gap: number, x0 = 40, x1 = k.w - 40) => { for (let i = 0; i < lines; i++) k.H(y + i * gap, x0, x1); };
/** Boxes in a grid, with a gap between them; `under` writing lines below each. */
const panels = (k: Kit, cols: number, rowsN: number, top: number, under = 0, gapX = 18, gapY = 18) => {
  const bw = (k.w - 2 * M - (cols - 1) * gapX) / cols;
  const cell = (k.h - top - M - (rowsN - 1) * gapY) / rowsN;
  const bh = cell - under * 18;
  for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) {
    const x = M + c * (bw + gapX), y = top + r * (cell + gapY);
    k.R(x, y, bw, bh, 1);
    for (let i = 1; i <= under; i++) k.H(y + bh + i * 18 - 4, x, x + bw);
  }
};
const title = (k: Kit, y = 64) => k.H(y, M, k.w - M, 1.2, k.ink.margin);

export const MORE_STYLES = [
  // ---- Writing
  { id: 'wide', name: 'Wide ruled', group: 'Writing', draw: (k, w, h) => { k.rows(90, h - 24, 34); k.V(72, 0, h, 0.9, k.ink.margin); } },
  { id: 'college', name: 'College ruled', group: 'Writing', draw: (k, w, h) => { k.rows(80, h - 24, 25); k.V(90, 0, h, 0.9, k.ink.margin); } },
  { id: 'plainlines', name: 'Lines, no margin', group: 'Writing', draw: (k, w, h) => k.rows(72, h - 24, 28, M, w - M) },
  { id: 'legalpad', name: 'Legal pad', group: 'Writing', draw: (k, w, h) => { k.rows(96, h - 24, 28); k.V(86, 0, h, 0.9, k.ink.margin); k.V(90, 0, h, 0.9, k.ink.margin); k.H(64, 0, w, 1.4, k.ink.margin); } },
  { id: 'primary', name: 'Handwriting practice', group: 'Writing', draw: (k, w, h) => { for (let y = 90; y + 36 < h - 30; y += 62) { k.H(y, M, w - M, 0.9); k.dash(y + 18, M, w - M, 6, 5, 0.5); k.H(y + 36, M, w - M, 0.9, k.ink.margin); } } },
  { id: 'seyes', name: 'Seyes (French)', group: 'Writing', draw: (k, w, h) => { for (let y = 70, i = 0; y < h - 20; y += 5.67, i++) k.H(y, 0, w, i % 4 === 0 ? 0.8 : 0.3); for (let x = 96; x < w; x += 22.68) k.V(x, 64, h - 20, 0.4); k.V(96, 64, h - 20, 1, k.ink.margin); } },
  { id: 'twocol', name: 'Two columns', group: 'Writing', draw: (k, w, h) => { k.rows(84, h - 24, 28, M, w / 2 - 12); k.rows(84, h - 24, 28, w / 2 + 12, w - M); k.V(w / 2, 60, h - 24, 0.9, k.ink.margin); } },
  { id: 'threecol', name: 'Three columns', group: 'Writing', draw: (k, w, h) => { const c = (w - 2 * M) / 3; for (let i = 0; i < 3; i++) k.rows(84, h - 24, 28, M + i * c + (i ? 10 : 0), M + (i + 1) * c - (i < 2 ? 10 : 0)); k.V(M + c, 60, h - 24, 0.9, k.ink.margin); k.V(M + 2 * c, 60, h - 24, 0.9, k.ink.margin); } },
  { id: 'titled', name: 'Title and lines', group: 'Writing', draw: (k, w, h) => { title(k, 72); k.rows(108, h - 24, 28, M, w - M); } },
  { id: 'letter', name: 'Letter', group: 'Writing', draw: (k, w, h) => { k.rows(70, 126, 28, w - 220, w - M); k.rows(190, h - 120, 28, M, w - M); k.rows(h - 80, h - 52, 28, w - 220, w - M); } },
  { id: 'dotlined', name: 'Lines and dots', group: 'Writing', draw: (k, w, h) => { for (let y = 84; y < h - 24; y += 28) { k.H(y, 0, w, 0.5); for (let x = 28; x < w; x += 28) k.D(x, y - 14, 0.7); } } },

  // ---- Grids
  { id: 'gridsmall', name: 'Small grid', group: 'Grids', draw: (k) => squares(k, 12, 0.35) },
  { id: 'gridlarge', name: 'Large grid', group: 'Grids', draw: (k) => squares(k, 36, 0.55) },
  { id: 'gridmajor', name: 'Engineering grid', group: 'Grids', draw: (k, w, h) => { for (let y = 12, i = 1; y < h; y += 12, i++) k.H(y, 0, w, i % 5 === 0 ? 0.9 : 0.3); for (let x = 12, i = 1; x < w; x += 12, i++) k.V(x, 0, h, i % 5 === 0 ? 0.9 : 0.3); } },
  { id: 'mm', name: 'Metric grid', group: 'Grids', draw: (k, w, h) => { const g = 2.835; for (let y = g, i = 1; y < h; y += g, i++) if (i % 5 === 0) k.H(y, 0, w, i % 10 === 0 ? 0.7 : 0.3); for (let x = g, i = 1; x < w; x += g, i++) if (i % 5 === 0) k.V(x, 0, h, i % 10 === 0 ? 0.7 : 0.3); } },
  { id: 'quarterinch', name: 'Quarter inch', group: 'Grids', draw: (k) => squares(k, 18, 0.45) },
  { id: 'halfinch', name: 'Half inch', group: 'Grids', draw: (k) => squares(k, 36, 0.6) },
  { id: 'dotsmall', name: 'Fine dots', group: 'Grids', draw: (k) => lattice(k, 16, 0.7) },
  { id: 'dotlarge', name: 'Wide dots', group: 'Grids', draw: (k) => lattice(k, 30, 1.1) },
  { id: 'cross', name: 'Cross grid', group: 'Grids', draw: (k, w, h) => { for (let y = 28; y < h; y += 28) for (let x = 28; x < w; x += 28) { k.H(y, x - 3, x + 3, 0.6); k.V(x, y - 3, y + 3, 0.6); } } },
  { id: 'gridmargin', name: 'Grid with margin', group: 'Grids', draw: (k, w, h) => { for (let y = 60; y <= h - M; y += 20) k.H(y, M, w - M, 0.45); for (let x = M; x <= w - M + 0.1; x += 20) k.V(x, 60, h - M - ((h - M - 60) % 20), 0.45); } },
  { id: 'halfgrid', name: 'Grid and lines', group: 'Grids', draw: (k, w, h) => { const mid = Math.round(h * 0.45 / 20) * 20; k.grid(M, 60, Math.floor((w - 2 * M) / 20) * 20, mid - 60, Math.floor((w - 2 * M) / 20), (mid - 60) / 20, 0.45); k.rows(mid + 40, h - 24, 28, M, w - M); } },
  { id: 'semilog', name: 'Semi-log', group: 'Grids', draw: (k, w, h) => { logLines(k, 60, h - M, 3, true, M, w - M); for (let x = M; x <= w - M + 0.1; x += (w - 2 * M) / 20) k.V(x, 60, h - M, 0.45); } },
  { id: 'loglog', name: 'Log-log', group: 'Grids', draw: (k, w, h) => { logLines(k, 60, h - M, 3, true, M, w - M); logLines(k, M, w - M, 3, false, 60, h - M); } },

  // ---- Study
  { id: 'tchart', name: 'T-chart', group: 'Study', draw: (k, w, h) => { k.H(110, M, w - M, 1.3, k.ink.margin); k.V(w / 2, 70, h - M, 1.3, k.ink.margin); } },
  { id: 'kwl', name: 'KWL chart', group: 'Study', draw: (k, w, h) => k.table(M, 70, w - 2 * M, h - 70 - M, [1, 1, 1], Math.round((h - 70 - M) / 44)) },
  { id: 'frayer', name: 'Frayer model', group: 'Study', draw: (k, w, h) => { k.R(M, 70, w - 2 * M, h - 70 - M, 1.1, k.ink.margin); const cy = (70 + h - M) / 2; k.H(cy, M, w - M, 1); k.V(w / 2, 70, h - M, 1); const bw = 180, bh = 70; k.R(w / 2 - bw / 2, cy - bh / 2, bw, bh, 1.2, k.ink.margin); } },
  { id: 'vocab', name: 'Vocabulary table', group: 'Study', draw: (k, w, h) => k.table(M, 70, w - 2 * M, Math.floor((h - 70 - M) / 46) * 46, [2, 4, 4], Math.floor((h - 70 - M) / 46)) },
  { id: 'flashcards', name: 'Flashcards', group: 'Study', draw: (k) => panels(k, 2, 4, 60, 0, 16, 16) },
  { id: 'outline', name: 'Outline', group: 'Study', draw: (k, w, h) => { k.rows(84, h - 24, 28, M, w - M); for (const x of [M + 28, M + 56, M + 84]) for (let y = 70; y < h - 24; y += 8) k.D(x, y, 0.5); } },
  { id: 'essay', name: 'Essay planner', group: 'Study', draw: (k, w, h) => { title(k); const top = 84, bh = (h - top - M - 4 * 12) / 5; for (let i = 0; i < 5; i++) { const y = top + i * (bh + 12); k.R(M, y, w - 2 * M, bh, 1); k.rows(y + 30, y + bh - 8, 24, M + 12, w - M - 12, 0.4); } } },
  { id: 'labreport', name: 'Lab report', group: 'Study', draw: (k, w, h) => { title(k); const parts = [0.12, 0.14, 0.2, 0.32, 0.22]; let y = 84; const all = h - 84 - M; for (const p of parts) { k.R(M, y, w - 2 * M, all * p - 10, 1); y += all * p; } } },
  { id: 'readinglog', name: 'Reading log', group: 'Study', draw: (k, w, h) => k.table(M, 70, w - 2 * M, Math.floor((h - 70 - M) / 34) * 34, [2, 5, 3, 2, 2], Math.floor((h - 70 - M) / 34)) },
  { id: 'compare', name: 'Compare two things', group: 'Study', draw: (k, w, h) => { k.table(M, 70, w - 2 * M, h * 0.6 - 70, [1, 1], 2, false); k.H(110, M, w - M, 1.1, k.ink.margin); k.R(M, h * 0.6 + 16, w - 2 * M, h - M - h * 0.6 - 16, 1); } },
  { id: 'timeline', name: 'Timeline', group: 'Study', draw: (k, w, h) => { for (let y = 150; y < h - 60; y += 190) { k.H(y, M, w - M, 1.6, k.ink.margin); for (let x = M; x <= w - M + 0.1; x += (w - 2 * M) / 8) k.V(x, y - 9, y + 9, 1.2, k.ink.margin); } } },
  { id: 'mathwork', name: 'Problems and working', group: 'Study', draw: (k, w, h) => { const n = 4, bh = (h - 60 - M) / n; for (let i = 0; i < n; i++) { const y = 60 + i * bh; k.R(M, y + 4, 30, 24, 0.9, k.ink.margin); k.H(y + bh, M, w - M, 0.9); for (let gy = y + 40; gy < y + bh - 6; gy += 20) for (let gx = M + 20; gx < w - M; gx += 20) k.D(gx, gy, 0.6); } } },

  // ---- Planning
  { id: 'daily', name: 'Day planner', group: 'Planning', draw: (k, w, h) => { title(k); const n = 15, g = (h - 96 - M) / n; for (let i = 0; i <= n; i++) { k.H(96 + i * g, M, w * 0.62, 0.7); if (i < n) k.H(96 + i * g + g / 2, M + 44, w * 0.62, 0.3); } k.V(M + 44, 96, h - M, 0.8, k.ink.margin); for (let y = 122; y < h - M; y += 30) k.check(w * 0.62 + 20, y, w - M); } },
  { id: 'weekly', name: 'Week, rows', group: 'Planning', draw: (k, w, h) => { title(k); const g = (h - 84 - M) / 7; for (let i = 0; i <= 7; i++) k.H(84 + i * g, M, w - M, i % 7 === 0 ? 1 : 0.7); k.V(M + 90, 84, h - M, 0.8, k.ink.margin); k.V(M, 84, h - M, 1); k.V(w - M, 84, h - M, 1); } },
  { id: 'weekcols', name: 'Week, columns', group: 'Planning', draw: (k, w, h) => { k.table(M, 70, w - 2 * M, h - 70 - M, [1, 1, 1, 1, 1, 1, 1], 1, false); k.H(104, M, w - M, 1.1, k.ink.margin); } },
  { id: 'monthly', name: 'Month', group: 'Planning', draw: (k, w, h) => { title(k); k.grid(M, 84, w - 2 * M, 26, 7, 1, 0.9); k.grid(M, 110, w - 2 * M, h - 110 - M, 7, 6, 0.7); } },
  { id: 'yearly', name: 'Year', group: 'Planning', draw: (k, w, h) => { title(k); const bw = (w - 2 * M - 2 * 14) / 3, bh = (h - 84 - M - 3 * 14) / 4; for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) { const x = M + c * (bw + 14), y = 84 + r * (bh + 14); k.R(x, y, bw, bh, 0.9); k.grid(x, y + 24, bw, bh - 24, 7, 6, 0.3); } } },
  { id: 'habits', name: 'Habit tracker', group: 'Planning', draw: (k, w, h) => { title(k); const x0 = M + 130, cw = (w - M - x0) / 31, n = Math.floor((h - 100 - M) / 26); k.grid(x0, 100, cw * 31, n * 26, 31, n, 0.45); for (let i = 0; i <= n; i++) k.H(100 + i * 26, M, x0, 0.6); k.V(M, 100, 100 + n * 26); } },
  { id: 'todo2', name: 'Two checklists', group: 'Planning', draw: (k, w, h) => { for (let y = 100; y < h - 30; y += 32) { k.check(M, y, w / 2 - 14); k.check(w / 2 + 14, y, w - M); } } },
  { id: 'matrix', name: 'Priority matrix', group: 'Planning', draw: (k, w, h) => { k.R(M + 24, 84, w - 2 * M - 24, h - 84 - M, 1.2, k.ink.margin); k.H((84 + h - M) / 2, M + 24, w - M, 1.2, k.ink.margin); k.V((M + 24 + w - M) / 2, 84, h - M, 1.2, k.ink.margin); } },
  { id: 'kanban', name: 'Board, three columns', group: 'Planning', draw: (k, w, h) => { k.table(M, 70, w - 2 * M, h - 70 - M, [1, 1, 1], 1, false); k.H(108, M, w - M, 1.1, k.ink.margin); } },
  { id: 'meeting', name: 'Meeting notes', group: 'Planning', draw: (k, w, h) => { k.R(M, 60, w - 2 * M, 84, 1, k.ink.margin); k.H(102, M, w - M, 0.5); k.V(w / 2, 60, 144, 0.5); k.rows(180, h * 0.66, 28, M, w - M); k.H(h * 0.66 + 26, M, w - M, 1.1, k.ink.margin); for (let y = h * 0.66 + 62; y < h - 30; y += 32) k.check(M, y, w - M); } },
  { id: 'project', name: 'Project plan', group: 'Planning', draw: (k, w, h) => { title(k); k.table(M, 84, w - 2 * M, Math.floor((h - 84 - M) / 34) * 34, [5, 2, 2, 2], Math.floor((h - 84 - M) / 34)); } },
  { id: 'goals', name: 'Goals', group: 'Planning', draw: (k, w, h) => { title(k); const bh = (h - 84 - M - 2 * 14) / 3; for (let i = 0; i < 3; i++) { const y = 84 + i * (bh + 14); k.R(M, y, w - 2 * M, bh, 1); k.H(y + 34, M, w - M, 0.6); for (let cy = y + 66; cy < y + bh - 8; cy += 30) k.check(M + 14, cy, w - M - 14); } } },
  { id: 'budget', name: 'Budget', group: 'Planning', draw: (k, w, h) => { title(k); k.table(M, 84, w - 2 * M, Math.floor((h - 84 - M) / 28) * 28, [2, 6, 2, 2, 2], Math.floor((h - 84 - M) / 28)); } },
  { id: 'schedule', name: 'Class timetable', group: 'Planning', draw: (k, w, h) => { title(k); k.table(M, 84, w - 2 * M, h - 84 - M, [1.2, 2, 2, 2, 2, 2], 10); } },

  // ---- Maths and science
  { id: 'axes', name: 'Coordinate plane', group: 'Maths and science', draw: (k, w, h) => { const g = 20, nx = Math.floor((w - 2 * M) / g / 2) * 2, ny = Math.floor((h - 2 * M) / g / 2) * 2, x = (w - nx * g) / 2, y = (h - ny * g) / 2; k.grid(x, y, nx * g, ny * g, nx, ny, 0.4); k.H(y + (ny * g) / 2, x, x + nx * g, 1.4, k.ink.margin); k.V(x + (nx * g) / 2, y, y + ny * g, 1.4, k.ink.margin); } },
  { id: 'axes4', name: 'Four small planes', group: 'Maths and science', draw: (k, w, h) => { const g = 14, n = Math.floor(Math.min((w - 3 * M) / 2, (h - 3 * M) / 2) / g / 2) * 2, s = n * g; for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) { const x = (w - 2 * s) / 3 * (c + 1) + c * s, y = (h - 2 * s) / 3 * (r + 1) + r * s; k.grid(x, y, s, s, n, n, 0.35); k.H(y + s / 2, x, x + s, 1.2, k.ink.margin); k.V(x + s / 2, y, y + s, 1.2, k.ink.margin); } } },
  { id: 'quadrant1', name: 'First quadrant', group: 'Maths and science', draw: (k, w, h) => { const g = 20, nx = Math.floor((w - 2 * M - 10) / g), ny = Math.floor((h - 2 * M - 10) / g), x = M + 10, y = M; k.grid(x, y, nx * g, ny * g, nx, ny, 0.4); k.H(y + ny * g, x, x + nx * g, 1.5, k.ink.margin); k.V(x, y, y + ny * g, 1.5, k.ink.margin); } },
  { id: 'numberlines', name: 'Number lines', group: 'Maths and science', draw: (k, w, h) => { for (let y = 110; y < h - 50; y += 96) { k.H(y, M, w - M, 1.2, k.ink.margin); for (let i = 0; i <= 20; i++) { const x = M + 10 + (i * (w - 2 * M - 20)) / 20; k.V(x, y - (i % 5 === 0 ? 9 : 5), y + (i % 5 === 0 ? 9 : 5), i % 5 === 0 ? 1.1 : 0.7, k.ink.margin); } } } },
  { id: 'datatable', name: 'Data table', group: 'Maths and science', draw: (k, w, h) => k.table(M, 70, w - 2 * M, Math.floor((h - 70 - M) / 30) * 30, [1, 1, 1, 1, 1, 1], Math.floor((h - 70 - M) / 30)) },
  { id: 'graphnotes', name: 'Graph and notes', group: 'Maths and science', draw: (k, w, h) => { const g = 18, n = Math.floor((w * 0.55 - M) / g); k.grid(M, 70, n * g, n * g, n, n, 0.4); k.rows(96, h - 24, 28, M + n * g + 18, w - M); k.rows(70 + n * g + 44, h - 24, 28, M, M + n * g); } },
  { id: 'hundred', name: 'Hundred square', group: 'Maths and science', draw: (k, w, h) => { const s = Math.min(w - 2 * M, h - 2 * M); k.grid((w - s) / 2, (h - s) / 2, s, s, 10, 10, 0.6); k.R((w - s) / 2, (h - s) / 2, s, s, 1.3, k.ink.margin); } },
  { id: 'fractions', name: 'Fraction strips', group: 'Maths and science', draw: (k, w, h) => { const bh = Math.min(46, (h - 2 * M) / 12); for (let n = 1; n <= 12; n++) k.grid(M, M + 30 + (n - 1) * bh, w - 2 * M, bh - 6, n, 1, 0.8); } },

  // ---- Music
  { id: 'tab', name: 'Guitar tab', group: 'Music', draw: (k, w, h) => { for (let y = 84; y + 50 < h - 30; y += 104) { staff(k, y, 6, 10); k.V(40, y, y + 50, 1.2); k.V(w - 40, y, y + 50, 1.2); } } },
  { id: 'basstab', name: 'Bass tab', group: 'Music', draw: (k, w, h) => { for (let y = 84; y + 33 < h - 30; y += 86) { staff(k, y, 4, 11); k.V(40, y, y + 33, 1.2); k.V(w - 40, y, y + 33, 1.2); } } },
  { id: 'grandstaff', name: 'Grand staff', group: 'Music', draw: (k, w, h) => { for (let y = 84; y + 100 < h - 30; y += 156) { staff(k, y, 5, 7); staff(k, y + 72, 5, 7); k.V(40, y, y + 100, 1.4); k.V(w - 40, y, y + 100, 1); } } },
  { id: 'stafftab', name: 'Staff and tab', group: 'Music', draw: (k, w, h) => { for (let y = 84; y + 120 < h - 30; y += 176) { staff(k, y, 5, 7); staff(k, y + 70, 6, 10); k.V(40, y, y + 120, 1.2); k.V(w - 40, y, y + 120, 1); } } },
  { id: 'lyrics', name: 'Staff and lyrics', group: 'Music', draw: (k, w, h) => { for (let y = 84; y + 60 < h - 30; y += 96) { staff(k, y, 5, 7); k.dash(y + 52, 40, w - 40, 3, 4, 0.5); } } },
  { id: 'chords', name: 'Chord boxes', group: 'Music', draw: (k, w, h) => { const cols = 5, bw = 62, bh = 78, gx = (w - 2 * M - cols * bw) / (cols - 1); for (let y = 90; y + bh < h - 30; y += bh + 52) for (let c = 0; c < cols; c++) { const x = M + c * (bw + gx); k.grid(x, y, bw, bh, 5, 5, 0.7); k.H(y, x, x + bw, 2.4); } } },
  { id: 'largestaff', name: 'Large staves', group: 'Music', draw: (k, w, h) => { for (let y = 90; y + 44 < h - 30; y += 110) staff(k, y, 5, 11); } },

  // ---- Design
  { id: 'storyboard', name: 'Storyboard', group: 'Design', draw: (k) => panels(k, 2, 3, 60, 3) },
  { id: 'storyboard9', name: 'Storyboard, nine', group: 'Design', draw: (k) => panels(k, 3, 3, 60, 2, 14, 14) },
  { id: 'comic', name: 'Comic page', group: 'Design', draw: (k, w, h) => { const g = 10, iw = w - 2 * M, r = (h - 2 * M - 2 * g) / 3; k.R(M, M, iw * 0.6 - g / 2, r, 1.6); k.R(M + iw * 0.6 + g / 2, M, iw * 0.4 - g / 2, r, 1.6); k.R(M, M + r + g, iw, r, 1.6); for (let i = 0; i < 3; i++) k.R(M + i * ((iw - 2 * g) / 3 + g), M + 2 * (r + g), (iw - 2 * g) / 3, r, 1.6); } },
  { id: 'thumbnails', name: 'Thumbnail sketches', group: 'Design', draw: (k) => panels(k, 4, 5, 60, 0, 12, 12) },
  { id: 'phones', name: 'Phone screens', group: 'Design', draw: (k, w, h) => { const n = w > h ? 4 : 3, pw = Math.min(170, (w - 2 * M - (n - 1) * 20) / n), ph = Math.min(pw * 2.1, h - 2 * M - 30), gx = (w - n * pw) / (n + 1); for (let i = 0; i < n; i++) { const x = gx + i * (pw + gx), y = (h - ph) / 2; k.R(x, y, pw, ph, 1.6); k.H(y + 22, x, x + pw, 0.5); k.H(y + ph - 22, x, x + pw, 0.5); for (let dy = y + 40; dy < y + ph - 30; dy += 14) for (let dx = x + 14; dx < x + pw - 6; dx += 14) k.D(dx, dy, 0.45); } } },
  { id: 'browser', name: 'Web page', group: 'Design', draw: (k, w, h) => { k.R(M, 60, w - 2 * M, h - 60 - M, 1.6); k.H(92, M, w - M, 1); for (let i = 0; i < 3; i++) k.D(M + 16 + i * 14, 76, 4); k.R(M + 70, 68, w - 2 * M - 90, 16, 0.7); for (let y = 114; y < h - M - 8; y += 22) for (let x = M + 20; x < w - M - 8; x += 22) k.D(x, y, 0.5); } },
  { id: 'tablet', name: 'Tablet screen', group: 'Design', draw: (k, w, h) => { const iw = w - 2 * M, ih = Math.min(h - 2 * M - 60, iw * 1.33); k.R(M, (h - ih) / 2, iw, ih, 1.8); k.R(M + 14, (h - ih) / 2 + 14, iw - 28, ih - 28, 0.6); for (let y = (h - ih) / 2 + 36; y < (h + ih) / 2 - 20; y += 22) for (let x = M + 34; x < w - M - 20; x += 22) k.D(x, y, 0.5); } },
  { id: 'perspective', name: 'Horizon and thirds', group: 'Design', draw: (k, w, h) => { k.R(M, M, w - 2 * M, h - 2 * M, 1); k.H(M + (h - 2 * M) / 3, M, w - M, 0.4); k.H(M + (2 * (h - 2 * M)) / 3, M, w - M, 0.4); k.V(M + (w - 2 * M) / 3, M, h - M, 0.4); k.V(M + (2 * (w - 2 * M)) / 3, M, h - M, 0.4); } },

  // ---- Games
  { id: 'sudoku', name: 'Sudoku', group: 'Games', draw: (k, w, h) => { const s = Math.min(w - 2 * M, (h - 3 * M) / 2), n = h > w * 1.2 ? 2 : 1; for (let i = 0; i < n; i++) { const x = (w - s) / 2, y = n === 2 ? M + i * (s + M) : (h - s) / 2; k.grid(x, y, s, s, 9, 9, 0.5); k.grid(x, y, s, s, 3, 3, 1.8); } } },
  { id: 'tictactoe', name: 'Noughts and crosses', group: 'Games', draw: (k, w, h) => { const cols = 2, s = Math.min(200, (w - 3 * M) / 2), rowsN = Math.max(1, Math.floor((h - M) / (s + M))); for (let r = 0; r < rowsN; r++) for (let c = 0; c < cols; c++) { const x = (w - cols * s) / (cols + 1) * (c + 1) + c * s, y = M + r * (s + M) + (h - M - rowsN * (s + M)) / 2; for (const f of [1 / 3, 2 / 3]) { k.H(y + s * f, x, x + s, 2); k.V(x + s * f, y, y + s, 2); } } } },
  { id: 'dotsboxes', name: 'Dots and boxes', group: 'Games', draw: (k) => lattice(k, 36, 2.2) },
  { id: 'chess', name: 'Chessboard', group: 'Games', draw: (k, w, h) => { const s = Math.min(w, h) - 2 * M, x = (w - s) / 2, y = (h - s) / 2, c = s / 8; for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if ((r + f) % 2 === 1) k.F(x + f * c, y + r * c, c, c, k.ink.line); k.R(x, y, s, s, 1.6, k.ink.margin); } },
  { id: 'battleships', name: 'Battleships', group: 'Games', draw: (k, w, h) => { const s = Math.min(w - 2 * M, (h - 3 * M) / 2); for (let i = 0; i < 2; i++) { const x = (w - s) / 2, y = M + i * (s + M); k.grid(x, y, s, s, 10, 10, 0.6); k.R(x, y, s, s, 1.4, k.ink.margin); } } },
  { id: 'scores', name: 'Score sheet', group: 'Games', draw: (k, w, h) => k.table(M, 70, w - 2 * M, Math.floor((h - 70 - M) / 32) * 32, [3, 1, 1, 1, 1, 1, 1.4], Math.floor((h - 70 - M) / 32)) },
  { id: 'connect4', name: 'Four in a row', group: 'Games', draw: (k, w, h) => { const c = Math.min((w - 2 * M) / 7, (h - 2 * M) / 6), x = (w - 7 * c) / 2, y = (h - 6 * c) / 2; k.grid(x, y, 7 * c, 6 * c, 7, 6, 1); } },
  { id: 'hexmap', name: 'Map dots', group: 'Games', draw: (k, w, h) => { const gx = 34, gy = (gx * Math.sqrt(3)) / 2; for (let r = 0, y = gy; y < h; r++, y += gy) for (let x = ((r % 2) * gx) / 2 + gx / 2; x < w; x += gx) k.D(x, y, 1.4); } },
] as const satisfies readonly Def[];

export type MoreStyle = (typeof MORE_STYLES)[number]['id'];
export const MORE_GROUPS = ['Writing', 'Grids', 'Study', 'Planning', 'Maths and science', 'Music', 'Design', 'Games'] as const;

/** The marks for one of these templates; null if `style` isn't one of them. */
export function moreMarks(style: string, ink: Ink, w: number, h: number): Mark[] | null {
  const def = (MORE_STYLES as readonly Def[]).find((d) => d.id === style);
  if (!def) return null;
  const k = new Kit(w, h, ink);
  def.draw(k, w, h);
  // On a very small page a box can come out inside-out; those marks are left off.
  return k.out.filter((m) => ('cx' in m ? m.r > 0 : m.w > 0 && m.h > 0));
}
