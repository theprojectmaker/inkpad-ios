// RN side of the PDF engine. <EngineHost/> is mounted once in the root layout
// (a 1x1 invisible WebView); `engine` is the promise API the app calls.
// Jobs run one at a time so memory stays flat on the iPad.
import { useEffect, useRef } from 'react';
import { Platform, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { bytesFromB64 } from './b64';
import { ENGINE_HTML } from './engine-html';
import { fsx } from './fsx';

const CHUNK_BYTES = 3 * 64 * 1024;   // raw bytes per chunk (multiple of 3 so base64 pieces join cleanly)
const STR_CHUNK = 256 * 1024;
const MAX_OPEN_DOCS = 2;

type Pending = { resolve: (d: any) => void; reject: (e: Error) => void; onProgress?: (done: number, total: number) => void };

class Engine {
  private inject: ((js: string) => void) | null = null;
  private readyWait: { p: Promise<void>; resolve: () => void; reject: (e: Error) => void; settled: boolean };
  private reqs = new Map<number, Pending>();
  private acks = new Map<string, () => void>();
  private nextId = 1;
  private chain: Promise<unknown> = Promise.resolve();
  private open = new Map<string, { path: string; pages: [number, number][]; used: number }>();
  private dead: string | null = null;

  constructor() { this.readyWait = this.makeReady(); }

  private makeReady() {
    const w = { settled: false } as { p: Promise<void>; resolve: () => void; reject: (e: Error) => void; settled: boolean };
    w.p = new Promise<void>((res, rej) => {
      w.resolve = () => { w.settled = true; res(); };
      w.reject = (e) => { w.settled = true; rej(e); };
    });
    w.p.catch(() => {});
    return w;
  }

  attach(inject: (js: string) => void) { this.inject = inject; }

  // The WebView was reloaded or crashed: everything it held is gone.
  reset(reason: string | null) {
    this.open.clear();
    for (const r of this.reqs.values()) r.reject(new Error(reason ?? 'The PDF engine restarted.'));
    this.reqs.clear();
    for (const a of this.acks.values()) a();
    this.acks.clear();
    this.dead = reason;
    if (this.readyWait.settled) this.readyWait = this.makeReady();
  }

  onMessage(raw: string) {
    let m: any;
    try { m = JSON.parse(raw); } catch { return; }
    if (m.type === 'ready') { this.dead = null; this.readyWait.resolve(); }
    else if (m.type === 'fatal') { this.dead = "The PDF tools couldn't start. Close and reopen the app."; this.readyWait.reject(new Error(this.dead)); }
    else if (m.type === 'ack') { const a = this.acks.get(m.id); if (a) { this.acks.delete(m.id); a(); } }
    else if (m.type === 'progress') this.reqs.get(m.req)?.onProgress?.(m.done, m.total);
    else if (m.type === 'res') {
      const r = this.reqs.get(m.req);
      if (!r) return;
      this.reqs.delete(m.req);
      if (m.ok) r.resolve(m.data); else r.reject(new Error(m.error || 'PDF engine error'));
    }
  }

  private async ready() {
    if (!this.inject) throw new Error('The PDF engine is not running.');
    const t = new Promise<void>((_, rej) => setTimeout(() => rej(new Error(this.dead ?? "The PDF tools didn't start in time. Try again.")), 25000));
    await Promise.race([this.readyWait.p, t]);
  }

  private run(js: string) { this.inject?.(js + ';true;'); }

  private call<T>(js: (req: number) => string, onProgress?: Pending['onProgress'], timeoutMs = 120000, reqOut?: { id: number }): Promise<T> {
    const req = this.nextId++;
    if (reqOut) reqOut.id = req;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { if (this.reqs.delete(req)) reject(new Error('The PDF engine timed out.')); }, timeoutMs);
      this.reqs.set(req, {
        resolve: (d) => { clearTimeout(timer); resolve(d); },
        reject: (e) => { clearTimeout(timer); reject(e); },
        onProgress,
      });
      this.run(js(req));
    });
  }

  private waitAck(id: string, js: string) {
    return new Promise<void>((resolve) => { this.acks.set(id, resolve); this.run(js); });
  }

  // Serialise jobs.
  private job<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.chain.then(fn, fn);
    this.chain = p.catch(() => {});
    return p;
  }

  private async sendFile(path: string): Promise<string> {
    const id = 'b' + this.nextId++;
    const size = fsx.size(path);
    if (!size) throw new Error('File is empty or missing.');
    await this.waitAck(id, `NE.blobBegin(${JSON.stringify(id)},${size})`);
    await fsx.readChunks(path, CHUNK_BYTES, (b64) => this.waitAck(id, `NE.blobChunk(${JSON.stringify(id)},"${b64}")`));
    return id;
  }

  private async sendBase64(b64: string): Promise<string> {
    const id = 'b' + this.nextId++;
    const n = Math.floor((b64.length * 3) / 4) - (b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0);
    await this.waitAck(id, `NE.blobBegin(${JSON.stringify(id)},${n})`);
    const step = (CHUNK_BYTES / 3) * 4;
    for (let i = 0; i < b64.length; i += step) await this.waitAck(id, `NE.blobChunk(${JSON.stringify(id)},"${b64.slice(i, i + step)}")`);
    return id;
  }

  private async sendString(s: string): Promise<string> {
    const id = 's' + this.nextId++;
    for (let i = 0; i < s.length; i += STR_CHUNK) await this.waitAck(id, `NE.strChunk(${JSON.stringify(id)},${JSON.stringify(s.slice(i, i + STR_CHUNK))})`);
    if (!s.length) await this.waitAck(id, `NE.strChunk(${JSON.stringify(id)},"")`);
    return id;
  }

  private async ensureOpen(key: string, path: string) {
    const have = this.open.get(key);
    if (have && have.path === path) { have.used = Date.now(); return have.pages; }
    while (this.open.size >= MAX_OPEN_DOCS) {
      let oldest: string | null = null, t = Infinity;
      for (const [k, v] of this.open) if (v.used < t) { t = v.used; oldest = k; }
      if (!oldest) break;
      this.run(`NE.close(${JSON.stringify(oldest)})`);
      this.open.delete(oldest);
    }
    const blob = await this.sendFile(path);
    const res = await this.call<{ pages: [number, number][] }>((req) => `NE.open(${req},${JSON.stringify(key)},${JSON.stringify(blob)})`);
    this.open.set(key, { path, pages: res.pages, used: Date.now() });
    return res.pages;
  }

  /** Opens a PDF (if needed) and returns each page's size in points. */
  info(key: string, path: string) {
    return this.job(async () => { await this.ready(); return this.ensureOpen(key, path); });
  }

  /** Renders one page to JPEG base64, longest side = maxPx. */
  render(key: string, path: string, index: number, maxPx: number) {
    return this.job(async () => {
      await this.ready();
      await this.ensureOpen(key, path);
      return this.call<{ b64: string; w: number; h: number }>((req) => `NE.render(${req},${JSON.stringify(key)},${index | 0},${Math.round(maxPx)},0.86)`);
    });
  }

  /** JPEG of a rectangle of a page (page points) rendered at `scale` px per point. */
  region(key: string, path: string, index: number, scale: number, r: { x: number; y: number; w: number; h: number }) {
    return this.job(async () => {
      await this.ready();
      await this.ensureOpen(key, path);
      const n = (v: number) => (Number.isFinite(v) ? Math.round(v * 100) / 100 : 0);
      return this.call<{ b64: string }>((req) => `NE.region(${req},${JSON.stringify(key)},${index | 0},${n(scale)},${n(r.x)},${n(r.y)},${n(r.w)},${n(r.h)})`);
    });
  }

  /** Plain text of the PDF (for search), at most `max` characters. */
  text(key: string, path: string, max = 12000) {
    return this.job(async () => {
      await this.ready();
      await this.ensureOpen(key, path);
      return (await this.call<{ text: string }>((req) => `NE.text(${req},${JSON.stringify(key)},${max | 0})`)).text.trim();
    });
  }

  close(key: string) {
    if (this.open.delete(key)) this.run(`NE.close(${JSON.stringify(key)})`);
  }

  /**
   * Builds a PDF. `files` maps blob names used in the spec to files (or base64)
   * that are uploaded first; the result is written to outPath in pieces.
   */
  exportPdf(spec: unknown, files: Record<string, { path?: string; b64?: string }>, outPath: string, onProgress?: (done: number, total: number) => void) {
    return this.job(async () => {
      await this.ready();
      const ids: Record<string, string> = {};
      for (const [name, src] of Object.entries(files)) {
        ids[name] = src.path ? await this.sendFile(src.path) : await this.sendBase64(src.b64 ?? '');
      }
      // Swap blob names for the uploaded ids.
      const json = JSON.stringify(spec).replace(/"@blob:([^"]+)"/g, (_, n) => JSON.stringify(ids[n] ?? n));
      const specId = await this.sendString(json);
      const ref = { id: 0 };
      const out = await this.call<{ size: number }>((req) => `NE.exportPdf(${req},${JSON.stringify(specId)})`, onProgress, 300000, ref);
      const outReq = ref.id;
      await fsx.remove(outPath);
      let at = 0;
      const n = 3 * 128 * 1024;
      try {
        while (at < out.size) {
          const part = await this.call<{ b64: string; n: number }>((req) => `NE.pull(${req},${outReq},${at},${n})`);
          if (!part.n) break;
          await fsx.writeBytes(outPath, bytesFromB64(part.b64), at > 0);
          at += part.n;
        }
      } finally { this.run(`NE.free(${outReq})`); }
      return out.size;
    });
  }
}

export const engine = new Engine();

export function EngineHost() {
  const ref = useRef<WebView>(null);
  const frame = useRef<any>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') {
      engine.attach((js) => ref.current?.injectJavaScript(js));
      return;
    }
    // Web preview: same page in a hidden same-origin iframe.
    const doc = (globalThis as any).document;
    const ifr = doc.createElement('iframe');
    ifr.style.cssText = 'position:absolute;width:1px;height:1px;opacity:0;pointer-events:none;border:0;left:-10px;top:-10px';
    ifr.srcdoc = ENGINE_HTML;
    doc.body.appendChild(ifr);
    frame.current = ifr;
    const onMsg = (e: MessageEvent) => { if (e.data && e.data.__inkpad) engine.onMessage(e.data.s); };
    (globalThis as any).addEventListener('message', onMsg);
    engine.attach((js) => { try { ifr.contentWindow.eval(js); } catch (err) { console.warn('engine eval', err); } });
    return () => { (globalThis as any).removeEventListener('message', onMsg); ifr.remove(); };
  }, []);

  if (Platform.OS === 'web') return null;
  return (
    <View style={{ position: 'absolute', width: 1, height: 1, opacity: 0, left: -10, top: -10 }} pointerEvents="none">
      <WebView
        ref={ref}
        source={{ html: ENGINE_HTML, baseUrl: 'https://inkpad.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        onMessage={(e: WebViewMessageEvent) => engine.onMessage(e.nativeEvent.data)}
        onLoadStart={() => engine.reset(null)}
        onContentProcessDidTerminate={() => { engine.reset('The PDF was too heavy and the reader restarted.'); ref.current?.reload(); }}
      />
    </View>
  );
}
