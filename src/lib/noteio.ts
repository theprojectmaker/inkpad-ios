// Where notes live on disk and the import flows that create pages.
//   inkpad/library.json            folders + note list (small, loads first)
//   inkpad/n/<id>/note.json        pages, ink, text, images
//   inkpad/n/<id>/pdf_*.pdf        imported PDFs   img_*.jpg  photos   thumb_*.jpg
//   inkpad/r/<id>/...              rendered PDF page images (a cache, safe to delete)
import * as ImageManipulator from 'expo-image-manipulator';

import { fsx } from './fsx';
import { LETTER, type NoteDoc, type Page, uid } from './model';
import { engine } from './pdf-engine';

export const LIB_PATH = 'inkpad/library.json';
export const noteDir = (id: string) => `inkpad/n/${id}`;
export const notePath = (id: string, name: string) => `${noteDir(id)}/${name}`;
export const renderDir = (id: string) => `inkpad/r/${id}`;
export const pdfKey = (id: string, file: string) => `${id}/${file}`;

export const MAX_PDF_PAGES = 600;

export async function loadDoc(id: string): Promise<NoteDoc | null> {
  try {
    const s = await fsx.readText(notePath(id, 'note.json'));
    if (!s) return null;
    const d = JSON.parse(s) as NoteDoc;
    if (!d || !Array.isArray(d.pages)) return null;
    for (const p of d.pages) { p.strokes ??= []; p.texts ??= []; p.images ??= []; }
    return d;
  } catch { return null; }
}

export async function saveDoc(doc: NoteDoc) {
  await fsx.writeText(notePath(doc.id, 'note.json'), JSON.stringify(doc));
}

export async function deleteNoteFiles(id: string) {
  engine.close(id);
  await fsx.remove(noteDir(id));
  await fsx.remove(renderDir(id));
}

// Files a doc refers to (for duplicating / exporting).
export function docFiles(doc: NoteDoc): string[] {
  const s = new Set<string>();
  for (const r of doc.recordings ?? []) s.add(r.file);
  for (const p of doc.pages) {
    if (p.bg.kind === 'pdf' || p.bg.kind === 'image') s.add(p.bg.file);
    for (const im of p.images) s.add(im.file);
  }
  return [...s];
}

export async function duplicateDoc(doc: NoteDoc, newId: string): Promise<NoteDoc> {
  for (const f of docFiles(doc)) await fsx.copy(notePath(doc.id, f), notePath(newId, f));
  // The PencilKit ink lives next to note.json.
  if (fsx.exists(notePath(doc.id, 'drawing.pkd'))) await fsx.copy(notePath(doc.id, 'drawing.pkd'), notePath(newId, 'drawing.pkd'));
  const copy: NoteDoc = JSON.parse(JSON.stringify(doc));
  copy.id = newId;
  await saveDoc(copy);
  return copy;
}

/** Copies a PDF into the note and returns one page per PDF page, plus its text for search. */
export async function pdfPages(noteId: string, srcUri: string, onStep?: (msg: string) => void): Promise<{ pages: Page[]; text: string }> {
  const file = `pdf_${uid()}.pdf`;
  const path = notePath(noteId, file);
  onStep?.('Copying PDF…');
  await fsx.copyIn(srcUri, path);
  onStep?.('Reading pages…');
  let sizes: [number, number][];
  try { sizes = await engine.info(pdfKey(noteId, file), path); }
  catch (e) { await fsx.remove(path); throw e; }
  if (!sizes.length) { await fsx.remove(path); throw new Error('That PDF has no pages.'); }
  if (sizes.length > MAX_PDF_PAGES) { await fsx.remove(path); throw new Error(`PDFs up to ${MAX_PDF_PAGES} pages are supported.`); }
  let text = '';
  try { onStep?.('Indexing text…'); text = await engine.text(pdfKey(noteId, file), path); } catch {}
  const pages: Page[] = sizes.map(([w, h], index) => ({
    id: uid('p'), w: w > 0 ? w : LETTER.w, h: h > 0 ? h : LETTER.h,
    bg: { kind: 'pdf', file, index }, strokes: [], texts: [], images: [],
  }));
  return { pages, text };
}

/** Saves a picked image (downscaled) into the note; returns its file name and size. */
export async function saveImage(noteId: string, uri: string, maxSide = 2800): Promise<{ file: string; w: number; h: number }> {
  let r = await ImageManipulator.manipulateAsync(uri, [], { compress: 1 });
  const big = Math.max(r.width, r.height);
  if (big > maxSide) {
    const k = maxSide / big;
    r = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: Math.round(r.width * k), height: Math.round(r.height * k) } }], { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG });
  } else {
    r = await ImageManipulator.manipulateAsync(uri, [], { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG });
  }
  const file = `img_${uid()}.jpg`;
  await fsx.copyIn(r.uri, notePath(noteId, file));
  return { file, w: r.width || 1000, h: r.height || 1000 };
}

/** One page per photo, page width = Letter width. */
export async function imagePages(noteId: string, uris: string[]): Promise<Page[]> {
  const out: Page[] = [];
  for (const u of uris) {
    const im = await saveImage(noteId, u, 2200);
    const w = LETTER.w, h = Math.max(100, Math.min(4000, Math.round((LETTER.w * im.h) / Math.max(1, im.w))));
    out.push({ id: uid('p'), w, h, bg: { kind: 'image', file: im.file }, strokes: [], texts: [], images: [] });
  }
  return out;
}
