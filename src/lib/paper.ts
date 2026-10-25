// Paper templates: colours and the ruling marks, as plain rectangles/dots so
// the same marks are drawn on screen and written into the exported PDF.
import type { PaperColor, PaperStyle } from './model';

export const PAPERS: { id: PaperColor; name: string; bg: string; line: string; margin: string }[] = [
  { id: 'white', name: 'White', bg: '#FFFFFF', line: '#C7D3E6', margin: '#F1A9A9' },
  { id: 'ivory', name: 'Ivory', bg: '#FCF8EE', line: '#D9CFB8', margin: '#E9B1A4' },
  { id: 'yellow', name: 'Legal', bg: '#FFF7C9', line: '#A9C3DB', margin: '#E59A9A' },
  { id: 'gray', name: 'Gray', bg: '#F1F2F4', line: '#CDD1D8', margin: '#E3AFAF' },
  { id: 'blue', name: 'Blue', bg: '#EEF5FF', line: '#BBD0EE', margin: '#EFAFB8' },
  { id: 'dark', name: 'Dark', bg: '#202227', line: '#3A3F4A', margin: '#6B3B44' },
];

export const PAPER_STYLES: { id: PaperStyle; name: string }[] = [
  { id: 'blank', name: 'Blank' },
  { id: 'lined', name: 'Lined' },
  { id: 'narrow', name: 'Narrow' },
  { id: 'grid', name: 'Grid' },
  { id: 'dotted', name: 'Dotted' },
  { id: 'cornell', name: 'Cornell' },
  { id: 'todo', name: 'Checklist' },
];

export const paperOf = (c: PaperColor) => PAPERS.find((p) => p.id === c) ?? PAPERS[0];

export type Mark = { x: number; y: number; w: number; h: number; color: string } | { cx: number; cy: number; r: number; color: string };

export function paperMarks(style: PaperStyle, color: PaperColor, w: number, h: number): Mark[] {
  const P = paperOf(color);
  const out: Mark[] = [];
  const t = 0.6;
  if (style === 'lined' || style === 'narrow') {
    const gap = style === 'lined' ? 28 : 22;
    const top = style === 'lined' ? 84 : 72;
    for (let y = top; y < h - 24; y += gap) out.push({ x: 0, y, w, h: t, color: P.line });
    out.push({ x: 72, y: 0, w: 0.9, h, color: P.margin });
  } else if (style === 'grid') {
    const gap = 20;
    for (let y = gap; y < h; y += gap) out.push({ x: 0, y, w, h: 0.45, color: P.line });
    for (let x = gap; x < w; x += gap) out.push({ x, y: 0, w: 0.45, h, color: P.line });
  } else if (style === 'cornell') {
    // Title strip, cue column on the left, notes on the right, summary box at the bottom.
    const sum = h - 160;
    out.push({ x: 0, y: 72, w, h: 1.2, color: P.margin });
    out.push({ x: 170, y: 72, w: 1.2, h: sum - 72, color: P.margin });
    for (let y = 72 + 28; y < sum - 6; y += 28) out.push({ x: 178, y, w: w - 178, h: t, color: P.line });
    out.push({ x: 0, y: sum, w, h: 1.2, color: P.margin });
    for (let y = sum + 34; y < h - 20; y += 28) out.push({ x: 24, y, w: w - 48, h: t, color: P.line });
  } else if (style === 'todo') {
    const gap = 34;
    for (let y = 96; y < h - 30; y += gap) {
      out.push({ x: 72, y, w: w - 108, h: t, color: P.line });
      const s = 14, x = 42, by = y - s - 4;
      out.push({ x, y: by, w: s, h: 1, color: P.line }, { x, y: by + s, w: s + 1, h: 1, color: P.line }, { x, y: by, w: 1, h: s, color: P.line }, { x: x + s, y: by, w: 1, h: s, color: P.line });
    }
  } else if (style === 'dotted') {
    const gap = 20;
    for (let y = gap; y < h; y += gap) for (let x = gap; x < w; x += gap) out.push({ cx: x, cy: y, r: 0.9, color: P.line });
  }
  return out;
}

// Ruling as SVG paths grouped by colour (for the PDF exporter).
export function paperSvg(style: PaperStyle, color: PaperColor, w: number, h: number): { d: string; color: string }[] {
  const groups = new Map<string, string>();
  for (const m of paperMarks(style, color, w, h)) {
    let d: string;
    if ('cx' in m) d = `M${m.cx - m.r} ${m.cy}a${m.r} ${m.r} 0 1 0 ${m.r * 2} 0a${m.r} ${m.r} 0 1 0 ${-m.r * 2} 0Z`;
    else d = `M${m.x} ${m.y}h${m.w}v${m.h}h${-m.w}Z`;
    groups.set(m.color, (groups.get(m.color) ?? '') + d);
  }
  return [...groups].map(([c, d]) => ({ d, color: c }));
}
