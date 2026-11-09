// A zip full of documents into Quill: every PDF and picture becomes a note. Folders in the zip become
// subjects (an existing subject with the same name is used); loose files go in a subject named after
// the zip. Anything else (Word, PowerPoint…) is listed as skipped.
import { requireNativeModule } from 'expo-modules-core';

import { fsx } from './fsx';
import type { Library, NoteKind, Page } from './model';
import { uid } from './model';
import { imagePages, pdfPages } from './noteio';

type Native = { unzip(zipPath: string, rel: string): Promise<string[]> };
let native: Native | null = null;
try { native = requireNativeModule<Native>('QuillCanvas'); } catch { native = null; }

const DOC = /\.(pdf|png|jpe?g|heic|heif)$/i;
const base = (p: string) => p.split('/').pop() ?? p;
const stem = (p: string) => base(p).replace(/\.[^.]+$/, '');

/** Where each file goes: its subject (folder) and its title. Pure, so it can be tested. */
export function planZip(zipName: string, entries: string[]) {
  const files = entries.filter((e) => !e.split('/').some((s) => s.startsWith('.') || s === '__MACOSX')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  // A zip that holds one folder with everything inside: that folder is just packaging.
  const tops = new Set(files.map((f) => (f.includes('/') ? f.split('/')[0] : '')));
  const strip = tops.size === 1 && !tops.has('') && files.every((f) => f.split('/').length > 1);
  const fallback = stem(zipName) || 'Imported';
  const docs: { path: string; folder: string; title: string }[] = [];
  const skipped: string[] = [];
  for (const f of files) {
    const parts = f.split('/');
    const inner = strip ? parts.slice(1) : parts;
    const folder = inner.length > 1 ? inner[0] : (strip ? parts[0] : fallback);
    if (DOC.test(f)) docs.push({ path: f, folder, title: stem(f) });
    else skipped.push(base(f));
  }
  return { docs, skipped };
}

type Lib = {
  current: () => Library;
  addFolder: (name: string, color?: string) => string;
  createNote: (o: { id?: string; folderId: string | null; title?: string; kind: NoteKind; pages?: Page[]; paper?: { style: 'blank'; color: 'white' } }) => Promise<string>;
  updateNote: (id: string, patch: { pdfText?: string }) => void;
};

export async function importZip(uri: string, zipName: string, lib: Lib, step: (m: string | null) => void) {
  if (!native?.unzip) throw new Error('Zip files can be opened in the app on the iPad.');
  const tmp = `inkpad/tmp/zip-${Date.now()}`;
  const path = decodeURIComponent(uri.replace(/^file:\/\//, ''));
  step('Opening the zip…');
  try {
    const entries = await native.unzip(path, tmp);
    const { docs, skipped } = planZip(zipName, entries);
    if (!docs.length) throw new Error(skipped.length ? `Nothing in that zip Quill can open (it has ${skipped.length} other files).` : 'That zip is empty.');
    const folders = new Map<string, string>();
    const folderFor = (name: string) => {
      const key = name.toLowerCase();
      if (folders.has(key)) return folders.get(key)!;
      const have = lib.current().folders.find((f) => f.name.toLowerCase() === key);
      const id = have ? have.id : lib.addFolder(name);
      folders.set(key, id);
      return id;
    };
    let made = 0;
    const failed: string[] = [];
    for (const d of docs) {
      step(`Adding ${made + 1} of ${docs.length}: ${d.title}`);
      const id = uid('n');
      try {
        const src = fsx.uri(`${tmp}/${d.path}`);
        if (/\.pdf$/i.test(d.path)) {
          const { pages, text } = await pdfPages(id, src);
          await lib.createNote({ id, folderId: folderFor(d.folder), kind: 'pdf', title: d.title, pages, paper: { style: 'blank', color: 'white' } });
          if (text) lib.updateNote(id, { pdfText: text });
        } else {
          const pages = await imagePages(id, [src]);
          await lib.createNote({ id, folderId: folderFor(d.folder), kind: 'image', title: d.title, pages, paper: { style: 'blank', color: 'white' } });
        }
        made++;
      } catch {
        failed.push(d.title);
        await fsx.remove(`inkpad/n/${id}`).catch(() => {});
      }
    }
    return { made, folders: folders.size, skipped, failed };
  } finally {
    step(null);
    await fsx.remove(tmp).catch(() => {});
  }
}
