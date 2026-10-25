// The note data model. Everything a note holds is plain JSON so it can be
// saved as one file per note. Page coordinates are PDF points (1/72 inch),
// so ink lines up 1:1 with the PDF page when it is exported.

export type PenType = 'fountain' | 'ball' | 'brush' | 'marker' | 'pencil' | 'fine';
export type PaperStyle = 'blank' | 'lined' | 'narrow' | 'grid' | 'dotted' | 'cornell' | 'todo' | 'music' | 'iso';
export type PaperColor = 'white' | 'ivory' | 'yellow' | 'gray' | 'blue' | 'dark';

export type Stroke = {
  id: string;
  kind: 'pen' | 'hl';
  color: string;
  w: number;            // base width in points
  pts: number[];        // flat [x, y, pressure, x, y, pressure, ...]
  pr?: 1;               // 1 = pressure values are real (Apple Pencil)
  pen?: PenType;        // pen style (missing = fountain)
  rt?: [string, number]; // written during recording [recording id, ms into it] (for replay)
  sm?: number;          // smoothing it was drawn with (0..1)
  c0?: 1; c1?: 1;       // start / end were cut by the eraser (no taper there)
  f?: 1;                // points are already filtered: drawn with the clean-input ink (inkOutline2)
};

export type TextItem = {
  id: string;
  x: number;
  y: number;
  w: number;            // wrap width
  text: string;
  size: number;
  color: string;
  sticker?: 1;          // an emoji sticker (no wrap box, drawn big)
};

export type ImageItem = { id: string; x: number; y: number; w: number; h: number; file: string };

/** Study tape: covers part of the page; tap it to reveal what's underneath. */
export type Tape = { id: string; x: number; y: number; w: number; h: number; color: string; shown?: 1 };

export type ShapeKind = 'line' | 'arrow' | 'rect' | 'ellipse';
export type FavPen = { type: PenType; color: string; width: number };

export type PageBg =
  | { kind: 'paper'; style: PaperStyle; color: PaperColor }
  | { kind: 'pdf'; file: string; index: number }   // file = a PDF inside the note folder
  | { kind: 'image'; file: string };

export type Page = {
  id: string;
  w: number;
  h: number;
  bg: PageBg;
  strokes: Stroke[];
  texts: TextItem[];
  images: ImageItem[];
  tapes?: Tape[];
};

export type Recording = { id: string; file: string; dur: number; created: number };

export type NoteDoc = {
  v: 1;
  id: string;
  paper: { style: PaperStyle; color: PaperColor; size?: PageSizeId };
  pages: Page[];
  recordings?: Recording[];
};

export type NoteKind = 'paper' | 'pdf' | 'image';

export type NoteMeta = {
  id: string;
  title: string;
  folderId: string | null;
  created: number;
  updated: number;
  opened?: number;
  fav?: boolean;
  pages: number;
  kind: NoteKind;
  thumb?: string;        // thumbnail file name inside the note folder
  text?: string;         // typed text, for search
  pdfText?: string;      // text inside imported PDFs, for search
  audio?: number;        // number of recordings
};

export type Folder = { id: string; name: string; color: string; created: number };

export type Library = { v: 1; folders: Folder[]; notes: NoteMeta[] };

export const LETTER = { w: 612, h: 792 };

export type PageSizeId = 'letter' | 'a4' | 'landscape' | 'tall';
export const PAGE_SIZES: { id: PageSizeId; name: string; w: number; h: number }[] = [
  { id: 'letter', name: 'Letter', w: 612, h: 792 },
  { id: 'a4', name: 'A4', w: 595, h: 842 },
  { id: 'landscape', name: 'Landscape', w: 792, h: 612 },
  { id: 'tall', name: 'Tall', w: 612, h: 1584 },   // two pages long, for long notes
];
export const pageSizeOf = (id?: PageSizeId) => PAGE_SIZES.find((p) => p.id === id) ?? PAGE_SIZES[0];

let counter = 0;
export function uid(prefix = ''): string {
  counter = (counter + 1) % 1296;
  return prefix + Date.now().toString(36) + counter.toString(36).padStart(2, '0') + Math.random().toString(36).slice(2, 6);
}

export function paperPage(style: PaperStyle, color: PaperColor, size = LETTER): Page {
  return { id: uid('p'), w: size.w, h: size.h, bg: { kind: 'paper', style, color }, strokes: [], texts: [], images: [] };
}

export function emptyNote(id: string, style: PaperStyle, color: PaperColor, size?: PageSizeId): NoteDoc {
  const sz = pageSizeOf(size);
  return { v: 1, id, paper: { style, color, size }, pages: [paperPage(style, color, { w: sz.w, h: sz.h })] };
}

export const FOLDER_COLORS = ['#E5484D', '#F76B15', '#FFC53D', '#30A46C', '#12A594', '#0090FF', '#6E56CF', '#D6409F', '#8D8D86'];

export const INK_COLORS = ['#111111', '#5A5F6B', '#1E5EFF', '#0AA35B', '#E5322D', '#F28C18', '#8E44EC', '#E0408A', '#0BB5C9', '#FFFFFF'];
export const HL_COLORS = ['#FFE14D', '#7CF27C', '#6FD3FF', '#FF8FD0', '#FFB45C', '#B9A1FF'];
export const PEN_WIDTHS = [1, 1.8, 2.8, 4.2, 6.5];
export const PEN_RANGE = [0.5, 24] as const;     // the size slider
export const HL_WIDTHS = [12, 20, 32];
export const HL_RANGE = [6, 64] as const;
export const ERASER_SIZES = [6, 14, 30];
export const TEXT_SIZES = [14, 18, 24, 32];
export const TAPE_COLORS = ['#F7B731', '#45AAF2', '#26DE81', '#FC5C65', '#A55EEA', '#4B4B4B'];
export const STICKERS = ['⭐', '✅', '❗', '❓', '💡', '📌', '🔥', '❤️', '👍', '🎯', '📝', '📅', '⚠️', '✏️', '🧠', '🚀', '😀', '🎉'];

// Doc text for search: every typed text box, trimmed.
export function docText(doc: NoteDoc): string {
  const parts: string[] = [];
  for (const p of doc.pages) for (const t of p.texts) if (!t.sticker && t.text.trim()) parts.push(t.text.trim());
  return parts.join(' ').slice(0, 2000);
}
