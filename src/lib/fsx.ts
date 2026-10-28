// Tiny file layer over expo-file-system (SDK 57 File/Directory API). Paths
// are relative to the app's document folder, e.g. "notes/n123/note.json".
// fsx.web.ts has the same surface for the browser preview.
import { Directory, File, Paths } from 'expo-file-system';

import { b64FromBytes } from './b64';

const root = () => Paths.document;
const file = (path: string) => new File(root(), path);

function ensureParent(path: string) {
  const i = path.lastIndexOf('/');
  if (i <= 0) return;
  const d = new Directory(root(), path.slice(0, i));
  if (!d.exists) d.create({ intermediates: true, idempotent: true });
}

export const fsx = {
  async readText(path: string): Promise<string | null> {
    // A write interrupted by a crash leaves the new text in .tmp (or the old in .bak).
    for (const p of [path, path + '.tmp', path + '.bak']) {
      const f = file(p);
      if (f.exists) { try { return await f.text(); } catch {} }
    }
    return null;
  },
  async writeText(path: string, text: string) {
    ensureParent(path);
    // Write to a temp file and swap it in, so a crash mid-write never leaves half a note.
    // The old file is kept as .bak until the new one is in place.
    const tmp = file(path + '.tmp');
    if (tmp.exists) tmp.delete();
    tmp.write(text);
    const f = file(path), bak = file(path + '.bak');
    if (bak.exists) bak.delete();
    if (f.exists) f.move(bak);
    tmp.move(file(path));
    if (bak.exists) bak.delete();
  },
  async writeBase64(path: string, b64: string, append = false) {
    ensureParent(path);
    file(path).write(b64, { encoding: 'base64', append });
  },
  async writeBytes(path: string, bytes: Uint8Array, append = false) {
    ensureParent(path);
    file(path).write(bytes, { append });
  },
  /** Names of the files and folders inside a folder. */
  list(dir: string): string[] {
    const d = new Directory(root(), dir);
    if (!d.exists) return [];
    return d.list().map((it) => it.uri.replace(/\/$/, '').split('/').pop() ?? '').filter(Boolean);
  },
  exists(path: string) {
    return file(path).exists || new Directory(root(), path).exists;
  },
  size(path: string): number {
    const f = file(path);
    return f.exists ? f.size ?? 0 : 0;
  },
  async remove(path: string) {
    try { const f = file(path); if (f.exists) { f.delete(); return; } } catch {}
    try { const d = new Directory(root(), path); if (d.exists) d.delete(); } catch {}
  },
  async removeOthers(dir: string, keep: (name: string) => boolean) {
    const d = new Directory(root(), dir);
    if (!d.exists) return;
    for (const it of d.list()) {
      const name = it.uri.replace(/\/$/, '').split('/').pop() ?? '';
      if (!keep(name)) { try { it.delete(); } catch {} }
    }
  },
  // Copies a picked/shared file (any uri) into the app folder.
  async copyIn(srcUri: string, path: string) {
    ensureParent(path);
    const dst = file(path);
    if (dst.exists) dst.delete();
    new File(srcUri).copySync(dst);
  },
  async copy(from: string, to: string) {
    ensureParent(to);
    const dst = file(to);
    if (dst.exists) dst.delete();
    file(from).copySync(dst);
  },
  uri(path: string) {
    return file(path).uri;
  },
  // Reads a file as base64 pieces, never holding the whole file as one string.
  async readChunks(path: string, chunkBytes: number, onChunk: (b64: string, done: number, total: number) => Promise<void> | void) {
    const f = file(path);
    const h = f.open();
    try {
      const total = h.size ?? f.size ?? 0;
      let done = 0;
      while (done < total) {
        const bytes = h.readBytes(Math.min(chunkBytes, total - done));
        if (!bytes.length) break;
        done += bytes.length;
        await onChunk(b64FromBytes(bytes), done, total);
      }
      return total;
    } finally { h.close(); }
  },
};

export type Fsx = typeof fsx;
