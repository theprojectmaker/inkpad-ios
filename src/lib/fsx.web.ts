// Browser stand-in for fsx.ts, only for testing in the web preview. Text files
// live in localStorage; binary files are kept in memory as data URLs for the session.
import { b64FromBytes } from './b64';

const PREFIX = 'inkpad-fs:';
const bin = new Map<string, { mime: string; b64: string }>();

const mimeOf = (path: string) =>
  path.endsWith('.pdf') ? 'application/pdf' : path.endsWith('.png') ? 'image/png' : 'image/jpeg';

export const fsx = {
  async readText(path: string): Promise<string | null> {
    try { return localStorage.getItem(PREFIX + path); } catch { return null; }
  },
  async writeText(path: string, text: string) {
    try { localStorage.setItem(PREFIX + path, text); } catch {}
  },
  async writeBase64(path: string, b64: string, append = false) {
    const prev = append ? bin.get(path)?.b64 ?? '' : '';
    // Appending base64 is only valid on 3-byte boundaries; chunk writers keep to that.
    bin.set(path, { mime: mimeOf(path), b64: prev + b64 });
  },
  async writeBytes(path: string, bytes: Uint8Array, append = false) {
    await fsx.writeBase64(path, b64FromBytes(bytes), append);
  },
  exists(path: string) {
    if (bin.has(path)) return true;
    try { return localStorage.getItem(PREFIX + path) != null; } catch { return false; }
  },
  size(path: string) {
    const b = bin.get(path);
    return b ? Math.floor(b.b64.length * 3 / 4) : 0;
  },
  async remove(path: string) {
    for (const k of [...bin.keys()]) if (k === path || k.startsWith(path + '/')) bin.delete(k);
    try {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const k = localStorage.key(i);
        if (k && (k === PREFIX + path || k.startsWith(PREFIX + path + '/'))) localStorage.removeItem(k);
      }
    } catch {}
  },
  async removeOthers(dir: string, keep: (name: string) => boolean) {
    for (const k of [...bin.keys()]) {
      if (!k.startsWith(dir + '/')) continue;
      const name = k.slice(dir.length + 1);
      if (!name.includes('/') && !keep(name)) bin.delete(k);
    }
  },
  async copyIn(srcUri: string, path: string) {
    const res = await fetch(srcUri);
    const buf = new Uint8Array(await res.arrayBuffer());
    bin.set(path, { mime: mimeOf(path), b64: b64FromBytes(buf) });
  },
  async copy(from: string, to: string) {
    const b = bin.get(from);
    if (b) bin.set(to, { ...b });
  },
  uri(path: string) {
    const b = bin.get(path);
    return b ? `data:${b.mime};base64,${b.b64}` : '';
  },
  async readChunks(path: string, chunkBytes: number, onChunk: (b64: string, done: number, total: number) => Promise<void> | void) {
    const b = bin.get(path);
    if (!b) return 0;
    const step = Math.floor(chunkBytes / 3) * 4;
    const total = Math.floor(b.b64.length * 3 / 4);
    for (let i = 0; i < b.b64.length; i += step) {
      const part = b.b64.slice(i, i + step);
      await onChunk(part, Math.min(total, Math.floor((i + part.length) * 3 / 4)), total);
    }
    return total;
  },
};

export type Fsx = typeof fsx;
