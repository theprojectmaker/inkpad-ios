// Search that reads handwriting: each page is read once with Apple's Vision (on the
// iPad, offline) and kept next to the note. Only pages written on since they were
// last read are read again.
//   inkpad/n/<id>/pagetext.json   { [pageId]: { v: stamp, lines: OcrLine[] } }
import type { CanvasHandle } from '@/components/quill-canvas';

import { fsx } from './fsx';
import type { NoteDoc } from './model';
import { notePath, renderDir } from './noteio';
import { type OcrLine, readText } from './ondevice';

type PageText = Record<string, { lines: OcrLine[] }>;

const file = (id: string) => notePath(id, 'pagetext.json');

export async function loadPageText(id: string): Promise<PageText> {
  try { const s = await fsx.readText(file(id)); return s ? JSON.parse(s) : {}; } catch { return {}; }
}

/** All the text as one string, for the library's search. */
export const pageTextToSearch = (t: PageText, order: string[]) =>
  order.map((id) => (t[id]?.lines ?? []).map((l) => l.text).join(' ')).join(' ').slice(0, 12000);

/** Pictures of these pages now (needs the open note); reads them whenever it's ready. */
export async function snapPages(noteId: string, doc: NoteDoc, pages: number[], canvas: CanvasHandle | null, absPath: (p: string) => string) {
  const shots: { pageId: string; path: string }[] = [];
  for (const i of pages) {
    const p = doc.pages[i];
    if (!p || !canvas) continue;
    const path = `${renderDir(noteId)}/read_${p.id}.jpg`;
    try { if (await canvas.pageThumb(i, absPath(path), 900)) shots.push({ pageId: p.id, path }); } catch {}
  }
  return shots;
}

/** Reads the pictures and saves the text. Fine to run after the note has closed. */
export async function readPages(noteId: string, shots: { pageId: string; path: string }[], onStep?: (done: number, total: number) => void): Promise<PageText> {
  const t = await loadPageText(noteId);
  let done = 0;
  for (const s of shots) {
    try { t[s.pageId] = { lines: await readText(fsx.uri(s.path)) }; } catch {}
    fsx.remove(s.path);
    onStep?.(++done, shots.length);
  }
  if (shots.length) await fsx.writeText(file(noteId), JSON.stringify(t)).catch(() => {});
  return t;
}
