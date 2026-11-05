// Where notes live on disk and the import flows that create pages.
//   inkpad/library.json            folders + note list (small, loads first)
//   inkpad/n/<id>/note.json        pages, ink, text, images
//   inkpad/n/<id>/pdf_*.pdf        imported PDFs   img_*.jpg  photos   thumb_*.jpg
//   inkpad/r/<id>/...              rendered PDF page images (a cache, safe to delete)
import * as ImageManipulator from 'expo-image-manipulator';
import { Image } from 'react-native';

import { fsx } from './fsx';
import { LETTER, type NoteDoc, type Page, uid } from './model';
import { pdfCover, pdfInfo, shrinkImage } from './ondevice';
import { engine } from './pdf-engine';

export const LIB_PATH = 'inkpad/library.json';
export const noteDir = (id: string) => `inkpad/n/${id}`;
export const notePath = (id: string, name: string) => `${noteDir(id)}/${name}`;
export const renderDir = (id: string) => `inkpad/r/${id}`;
export const pdfKey = (id: string, file: string) => `${id}/${file}`;

export const MAX_PDF_PAGES = 3000;

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
    if (p.bg.kind === 'image' && p.bg.orig) s.add(p.bg.orig);
    for (const im of p.images) s.add(im.file);
  }
  return [...s];
}

export async function duplicateDoc(doc: NoteDoc, newId: string): Promise<NoteDoc> {
  for (const f of docFiles(doc)) await fsx.copy(notePath(doc.id, f), notePath(newId, f));
  // The ink lives next to note.json (drawing.pkd: notes from before Quill's own ink engine).
  for (const ink of ['drawing.qink', 'drawing.pkd', 'texts.json', 'extras.json', 'pagetext.json']) {
    if (fsx.exists(notePath(doc.id, ink))) await fsx.copy(notePath(doc.id, ink), notePath(newId, ink));
  }
  // Photos placed on the pages.
  try {
    const extras = await fsx.readText(notePath(doc.id, 'extras.json'));
    for (const o of (extras ? JSON.parse(extras).pics ?? [] : []) as { file: string }[]) {
      if (fsx.exists(notePath(doc.id, o.file))) await fsx.copy(notePath(doc.id, o.file), notePath(newId, o.file));
    }
  } catch {}
  const copy: NoteDoc = JSON.parse(JSON.stringify(doc));
  copy.id = newId;
  await saveDoc(copy);
  return copy;
}

const VERSIONED = ['drawing.qink', 'texts.json', 'extras.json'];

/** Keeps a copy of how the note looks now (the last ten are kept). */
export async function saveVersion(id: string) {
  const at = String(Date.now());
  let any = false;
  for (const f of VERSIONED) {
    if (fsx.exists(notePath(id, f))) { await fsx.copy(notePath(id, f), notePath(id, `versions/${at}/${f}`)); any = true; }
  }
  if (!any) return;
  const old = listVersions(id).slice(10);
  for (const v of old) await fsx.remove(notePath(id, `versions/${v}`));
}

/** When each kept copy was made, newest first. */
export const listVersions = (id: string) => fsx.list(notePath(id, 'versions')).sort((a, b) => Number(b) - Number(a));

/** Puts the note back to a kept copy. The note must be closed on screen first. */
export async function restoreVersion(id: string, at: string) {
  for (const f of VERSIONED) {
    const from = notePath(id, `versions/${at}/${f}`);
    if (fsx.exists(from)) await fsx.copy(from, notePath(id, f));
    else await fsx.remove(notePath(id, f));
  }
}

/** Copies a PDF into the note and returns one page per PDF page, plus its text for search. */
export async function pdfPages(noteId: string, srcUri: string, onStep?: (msg: string) => void): Promise<{ pages: Page[]; text: string }> {
  const file = `pdf_${uid()}.pdf`;
  const path = notePath(noteId, file);
  onStep?.('Copying PDF…');
  await fsx.copyIn(srcUri, path);
  onStep?.('Reading pages…');
  let sizes: [number, number][];
  let text = '';
  try {
    const info = await pdfInfo(fsx.uri(path));
    if (info) { sizes = info.pages; text = info.text; }
    else {   // the browser preview
      sizes = await engine.info(pdfKey(noteId, file), path);
      text = await engine.text(pdfKey(noteId, file), path).catch(() => '');
    }
  } catch (e) { await fsx.remove(path); throw e; }
  if (!sizes.length) { await fsx.remove(path); throw new Error('That PDF has no pages.'); }
  if (sizes.length > MAX_PDF_PAGES) { await fsx.remove(path); throw new Error(`PDFs up to ${MAX_PDF_PAGES} pages are supported.`); }
  const pages: Page[] = sizes.map(([w, h], index) => ({
    id: uid('p'), w: w > 0 ? w : LETTER.w, h: h > 0 ? h : LETTER.h,
    bg: { kind: 'pdf', file, index }, strokes: [], texts: [], images: [],
  }));
  return { pages, text };
}

/** Gives up on a step that never answers, rather than leaving the app waiting for ever. */
export function inTime<T>(work: Promise<T>, ms: number, what: string): Promise<T> {
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(what)), ms);
    work.then((v) => { clearTimeout(t); ok(v); }, (e) => { clearTimeout(t); no(e); });
  });
}

/** A picture of an imported page for the note's card, so it shows from the start. Its file name, or null. */
export async function makeCover(noteId: string, page: Page | undefined): Promise<string | null> {
  const bg = page?.bg;
  if (bg?.kind !== 'pdf' && bg?.kind !== 'image') return null;
  const name = `thumb_${uid()}.jpg`;
  try {
    const src = fsx.uri(notePath(noteId, bg.file));
    if (bg.kind === 'pdf') return (await pdfCover(src, fsx.uri(notePath(noteId, name)), 360)) ? name : null;
    if (await shrinkImage(src, fsx.uri(notePath(noteId, name)), 480, 0.8)) return name;
    const r = await inTime(ImageManipulator.manipulateAsync(src, [{ resize: { width: 360 } }], { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG }), 6000, 'cover');
    await fsx.copyIn(r.uri, notePath(noteId, name));
    return name;
  } catch { return null; }
}

/** Saves a picked image (downscaled) into the note; returns its file name and size. */
export async function saveImage(noteId: string, uri: string, maxSide = 2800): Promise<{ file: string; w: number; h: number }> {
  const named = `img_${uid()}.jpg`;
  const quick = await shrinkImage(uri, fsx.uri(notePath(noteId, named)), maxSide, 0.88);
  if (quick) return { file: named, w: quick.w || 1000, h: quick.h || 1000 };
  const WAIT = "That picture took too long to open. Try again.";
  let r = await inTime(ImageManipulator.manipulateAsync(uri, [], { compress: 1 }), 30000, WAIT);
  const big = Math.max(r.width, r.height);
  if (big > maxSide) {
    const k = maxSide / big;
    r = await inTime(ImageManipulator.manipulateAsync(uri, [{ resize: { width: Math.round(r.width * k), height: Math.round(r.height * k) } }], { compress: 0.86, format: ImageManipulator.SaveFormat.JPEG }), 30000, WAIT);
  } else {
    r = await inTime(ImageManipulator.manipulateAsync(uri, [], { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG }), 30000, WAIT);
  }
  const file = `img_${uid()}.jpg`;
  await fsx.copyIn(r.uri, notePath(noteId, file));
  return { file, w: r.width || 1000, h: r.height || 1000 };
}

const sizeOf = (uri: string) => new Promise<{ w: number; h: number }>((ok, no) => Image.getSize(uri, (w, h) => ok({ w, h }), no));

/** Scanned pages, kept exactly as they are (no shrinking, no second round of compression), with their originals. */
export async function scanPages(noteId: string, scans: { uri: string; raw: string }[]): Promise<Page[]> {
  const out: Page[] = [];
  for (const sc of scans) {
    const { w: iw, h: ih } = await sizeOf(sc.uri);
    const file = `img_${uid()}.jpg`;
    await fsx.copyIn(sc.uri, notePath(noteId, file));
    let orig: string | undefined;
    if (sc.raw !== sc.uri) { orig = `img_${uid()}.jpg`; await fsx.copyIn(sc.raw, notePath(noteId, orig)); }
    const h = Math.max(100, Math.min(4000, Math.round((LETTER.w * ih) / Math.max(1, iw))));
    out.push({ id: uid('p'), w: LETTER.w, h, bg: { kind: 'image', file, orig }, strokes: [], texts: [], images: [] });
  }
  return out;
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
