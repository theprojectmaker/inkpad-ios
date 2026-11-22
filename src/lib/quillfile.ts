// A .quill file: one note packed into a single JSON document that carries
// everything needed to reopen it fully editable on another iPad — the pages,
// the native ink, the text boxes, the photos and the paper. Share one from any
// app (AirDrop, Files, Messages) and the other iPad opens it as a real note and
// can keep writing on it.
//
// It is also the exchange format with Scriptly. Scriptly writes (and reads) the
// vector `strokes` array below — the shared ink schema. A file that carries
// `strokes` but no native `files` bundle is rebuilt into editable Quill ink on
// import, keeping each stroke's colour, width and whether it's a highlighter.
//
// ── The shared ink schema (keep in step with the Scriptly side) ───────────────
//   strokes: QuillStroke[]
//   QuillStroke = {
//     page:  number        // which page (0-based)
//     pts:   number[]      // flat [x, y, pressure, x, y, pressure, …]
//                          //   x/y in PDF points from the page's top-left
//                          //   pressure 0..1 (use 0.5 if you have none)
//     color: string        // "#RRGGBB"
//     w:     number        // base width in points
//     hl?:   boolean       // true = highlighter (drawn translucent)
//     pen?:  PenType       // 'fountain' | 'ball' | 'brush' | 'marker' | 'pencil' | 'fine'
//   }
// ──────────────────────────────────────────────────────────────────────────────
import { File } from 'expo-file-system';

import { b64FromBytes } from './b64';
import { fsx } from './fsx';
import {
  type NoteDoc, type NoteKind, type NoteMeta, type Page, type PageBg, type PaperColor,
  type PaperStyle, type PageSizeId, type PenType, type Stroke, pageSizeOf, uid,
} from './model';
import { docFiles, noteDir, notePath } from './noteio';

export const QUILL_EXT = 'quill';
export const QUILL_UTI = 'com.solyapps.quill.note';
export const QUILL_MIME = 'application/vnd.quill.note+json';

export type QuillStroke = { page: number; pts: number[]; color: string; w: number; hl?: boolean; pen?: PenType };
type Blob = { text?: string; b64?: string };

export type QuillFile = {
  quill: 1;
  app: string;                 // 'quill' | 'scriptly' | …
  title: string;
  created?: number;
  updated?: number;
  paper: { style: PaperStyle; color: PaperColor; size?: PageSizeId };
  kind?: NoteKind;
  tags?: string[];
  label?: string;
  pages?: { w: number; h: number; bg?: PageBg }[];   // page geometry (for Scriptly)
  strokes?: QuillStroke[];                            // vector ink (the shared schema)
  files?: Record<string, Blob>;                      // the faithful Quill bundle
};

export const isQuillName = (name?: string | null) => !!name && new RegExp(`\\.${QUILL_EXT}$`, 'i').test(name);
export const isQuillShared = (f: { fileName?: string | null; path?: string; mimeType?: string }) =>
  isQuillName(f.fileName) || isQuillName(f.path) || /vnd\.quill/i.test(f.mimeType ?? '');

/** The whole of a file as base64, read in one go (assets are small). */
function readB64(relPath: string): string | null {
  try {
    const f = new File(fsx.uri(relPath));
    if (!f.exists) return null;
    const h = f.open();
    try {
      const total = h.size ?? f.size ?? 0;
      if (!total) return '';
      return b64FromBytes(h.readBytes(total));
    } finally { h.close(); }
  } catch { return null; }
}

/** The vector form of one note's ink, for apps (Scriptly) that read `strokes`. */
function vectorStrokes(doc: NoteDoc): QuillStroke[] {
  const out: QuillStroke[] = [];
  doc.pages.forEach((p, page) => {
    for (const s of p.strokes) {
      if (!s.pts?.length) continue;
      out.push({ page, pts: s.pts.slice(), color: s.color, w: s.w, ...(s.kind === 'hl' ? { hl: true } : {}), ...(s.pen ? { pen: s.pen } : {}) });
    }
  });
  return out;
}

const OUT_DIR = 'inkpad/out';
const safeName = (title: string) => (title || 'Note').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Note';

/**
 * Packs a note into a .quill file and returns its path (under inkpad/out).
 * Call `canvas.save()` first so the ink on disk is current.
 */
export async function exportNoteQuill(doc: NoteDoc, meta: NoteMeta): Promise<string> {
  const files: Record<string, Blob> = {};
  // note.json holds the authoritative pages/ink references.
  const noteJson = await fsx.readText(notePath(doc.id, 'note.json'));
  files['note.json'] = { text: noteJson ?? JSON.stringify(doc) };
  // The native ink and the text boxes / placed photos that live beside it.
  for (const side of ['drawing.qink', 'texts.json', 'extras.json', 'pagetext.json']) {
    if (!fsx.exists(notePath(doc.id, side))) continue;
    if (side.endsWith('.json')) { const t = await fsx.readText(notePath(doc.id, side)); if (t != null) files[side] = { text: t }; }
    else { const b = readB64(notePath(doc.id, side)); if (b != null) files[side] = { b64: b }; }
  }
  // Page backgrounds: imported PDFs and photos (not audio, not thumbnails).
  for (const f of docFiles(doc)) {
    if (!/\.(jpe?g|png|heic|heif|pdf)$/i.test(f)) continue;
    if (files[f]) continue;
    const b = readB64(notePath(doc.id, f));
    if (b != null) files[f] = { b64: b };
  }

  const qf: QuillFile = {
    quill: 1,
    app: 'quill',
    title: meta.title || 'Note',
    created: meta.created,
    updated: meta.updated,
    paper: doc.paper,
    kind: meta.kind,
    ...(meta.tags?.length ? { tags: meta.tags } : {}),
    ...(meta.label ? { label: meta.label } : {}),
    pages: doc.pages.map((p) => ({ w: p.w, h: p.h, bg: p.bg })),
    strokes: vectorStrokes(doc),
    files,
  };
  const out = `${OUT_DIR}/${safeName(meta.title)}.${QUILL_EXT}`;
  await fsx.writeText(out, JSON.stringify(qf));
  return out;
}

export function parseQuill(text: string): QuillFile | null {
  try {
    const q = JSON.parse(text) as QuillFile;
    if (!q || q.quill !== 1) return null;
    return q;
  } catch { return null; }
}

/** Reads a shared/picked .quill (any uri or app path) and parses it. */
export async function readQuillFromUri(uri: string): Promise<QuillFile> {
  const tmp = `inkpad/tmp/q-${Date.now()}.${QUILL_EXT}`;
  await fsx.copyIn(uri, tmp);
  try {
    const text = await fsx.readText(tmp);
    const q = text && parseQuill(text);
    if (!q) throw new Error('That file is not a Quill note.');
    return q;
  } finally { await fsx.remove(tmp).catch(() => {}); }
}

/** Builds pages from a vector (Scriptly) file: one Page per page index, strokes laid in, any bundled page image kept behind them. */
function pagesFromStrokes(qf: QuillFile, noteId: string): Page[] {
  const want = Math.max(
    1,
    qf.pages?.length ?? 0,
    ...(qf.strokes ?? []).map((s) => (s.page | 0) + 1),
  );
  const sz = pageSizeOf(qf.paper?.size);
  const pages: Page[] = [];
  for (let i = 0; i < want; i++) {
    const g = qf.pages?.[i];
    const paperBg: PageBg = { kind: 'paper', style: qf.paper?.style ?? 'blank', color: qf.paper?.color ?? 'white' };
    // A worksheet scan (or PDF page) behind the ink: keep it only if its file was bundled.
    let bg: PageBg = paperBg;
    if (g?.bg && (g.bg.kind === 'image' || g.bg.kind === 'pdf') && g.bg.file && fsx.exists(notePath(noteId, g.bg.file))) bg = g.bg;
    else if (g?.bg && g.bg.kind === 'paper') bg = g.bg;
    pages.push({ id: uid('p'), w: g?.w ?? sz.w, h: g?.h ?? sz.h, bg, strokes: [], texts: [], images: [] });
  }
  for (const s of qf.strokes ?? []) {
    const p = pages[Math.min(Math.max(0, s.page | 0), pages.length - 1)];
    if (!p || !s.pts?.length) continue;
    const stroke: Stroke = { id: uid('s'), kind: s.hl ? 'hl' : 'pen', color: s.color || '#111111', w: s.w || 2, pts: s.pts.slice() };
    if (s.pen) stroke.pen = s.pen;
    p.strokes.push(stroke);
  }
  return pages;
}

type Lib = {
  createNote: (o: { id?: string; folderId: string | null; title?: string; kind: NoteKind; pages?: Page[]; paper?: { style: PaperStyle; color: PaperColor; size?: PageSizeId } }) => Promise<string>;
  updateNote: (id: string, patch: Partial<NoteMeta>) => void;
};

/**
 * Brings a .quill into the library as a new, fully editable note.
 *  • A Quill bundle (has `files`) is restored file-for-file, so the native ink
 *    and everything else reopen exactly as they were.
 *  • A vector file (Scriptly's `strokes`, no bundle) is rebuilt into Quill ink.
 */
export async function importQuillFile(qf: QuillFile, lib: Lib, opts: { folderId?: string | null } = {}): Promise<{ id: string; title: string; pages: number }> {
  const id = uid('n');
  const title = (qf.title || 'Imported note').slice(0, 120);
  const folderId = opts.folderId ?? null;
  try {
    if (qf.files && qf.files['note.json']?.text) {
      // Faithful bundle: write every file beside the new note, then register it.
      for (const [name, blob] of Object.entries(qf.files)) {
        if (name === 'note.json' || name.includes('..') || name.startsWith('/')) continue;
        if (blob.text != null) await fsx.writeText(notePath(id, name), blob.text);
        else if (blob.b64 != null) await fsx.writeBase64(notePath(id, name), blob.b64);
      }
      const doc = JSON.parse(qf.files['note.json'].text) as NoteDoc;
      // createNote writes note.json with the new id; the bundled drawing.qink gives the editable ink.
      await lib.createNote({ id, folderId, title, kind: qf.kind ?? 'paper', pages: doc.pages, paper: doc.paper });
      if (qf.tags?.length || qf.label) lib.updateNote(id, { ...(qf.tags?.length ? { tags: qf.tags } : {}), ...(qf.label ? { label: qf.label } : {}) });
      return { id, title, pages: doc.pages.length };
    }
    // Vector file (Scriptly): write any bundled page images, then rebuild editable ink from `strokes`.
    for (const [name, blob] of Object.entries(qf.files ?? {})) {
      if (name === 'note.json' || name.includes('..') || name.startsWith('/')) continue;
      if (blob.text != null) await fsx.writeText(notePath(id, name), blob.text);
      else if (blob.b64 != null) await fsx.writeBase64(notePath(id, name), blob.b64);
    }
    const pages = pagesFromStrokes(qf, id);
    const kind: NoteKind = pages.some((p) => p.bg.kind === 'image') ? 'image' : pages.some((p) => p.bg.kind === 'pdf') ? 'pdf' : 'paper';
    await lib.createNote({ id, folderId, title, kind, pages, paper: qf.paper ?? { style: 'blank', color: 'white' } });
    if (qf.tags?.length || qf.label) lib.updateNote(id, { ...(qf.tags?.length ? { tags: qf.tags } : {}), ...(qf.label ? { label: qf.label } : {}) });
    return { id, title, pages: pages.length };
  } catch (e) {
    await fsx.remove(noteDir(id)).catch(() => {});
    throw e;
  }
}
