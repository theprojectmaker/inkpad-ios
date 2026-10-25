// The page that runs inside the hidden WebView (or an iframe on web).
// pdf.js renders PDF pages to JPEG on demand; pdf-lib writes the exported PDF.
// Data only ever crosses the bridge in chunks: files come in as base64
// pieces (one in flight at a time) and the exported PDF is pulled back out
// piece by piece, so neither side ever holds one giant string.
const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174';
const PDFLIB = 'https://cdnjs.cloudflare.com/ajax/libs/pdf-lib/1.17.1/pdf-lib.min.js';

export const ENGINE_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<script src="${PDFJS}/pdf.min.js"></script><script src="${PDFLIB}"></script></head><body><script>
(function(){
const post = (m) => {
  const s = JSON.stringify(m);
  if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(s);
  else parent.postMessage({ __inkpad: 1, s: s }, '*');
};
const fail = (req, e) => post({ type: 'res', req: req, ok: false, error: String((e && e.message) || e) });
if (!window.pdfjsLib || !window.PDFLib) { post({ type: 'fatal', error: 'offline' }); return; }
pdfjsLib.GlobalWorkerOptions.workerSrc = '${PDFJS}/pdf.worker.min.js';
const blobs = {}, strs = {}, docs = {}, outs = {};
const NE = window.NE = {};
NE.blobBegin = (id, n) => { blobs[id] = { buf: new Uint8Array(n), at: 0 }; post({ type: 'ack', id: id }); };
NE.blobChunk = (id, b64) => {
  const b = blobs[id]; let bin;
  try { bin = atob(b64); } catch (e) { post({ type: 'ack', id: id, error: 'bad chunk' }); return; }
  for (let i = 0; i < bin.length; i++) b.buf[b.at + i] = bin.charCodeAt(i);
  b.at += bin.length; post({ type: 'ack', id: id });
};
NE.drop = (id) => { delete blobs[id]; delete strs[id]; };
NE.strChunk = (id, s) => { strs[id] = (strs[id] || '') + s; post({ type: 'ack', id: id }); };

NE.open = async (req, docId, blobId) => {
  try {
    if (docs[docId]) { try { docs[docId].destroy(); } catch (e) {} }
    const data = blobs[blobId].buf; delete blobs[blobId];
    const doc = await pdfjsLib.getDocument({ data: data, isEvalSupported: false }).promise;
    docs[docId] = doc;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const pg = await doc.getPage(i);
      const v = pg.getViewport({ scale: 1 });
      pages.push([Math.round(v.width * 100) / 100, Math.round(v.height * 100) / 100]);
      pg.cleanup();
    }
    post({ type: 'res', req: req, ok: true, data: { pages: pages } });
  } catch (e) {
    const pw = e && e.name === 'PasswordException';
    fail(req, pw ? 'This PDF is password-protected. Remove the password and try again.' : "That PDF couldn't be opened. It may be damaged.");
  }
};
NE.text = async (req, docId, max) => {
  try {
    const doc = docs[docId]; if (!doc) throw new Error('not open');
    let s = '';
    for (let i = 1; i <= doc.numPages && s.length < max; i++) {
      const pg = await doc.getPage(i);
      const tc = await pg.getTextContent();
      s += tc.items.map((it) => (it.str || '') + (it.hasEOL ? ' ' : '')).join(' ').replace(/\\s+/g, ' ') + ' ';
      pg.cleanup();
    }
    post({ type: 'res', req: req, ok: true, data: { text: s.slice(0, max) } });
  } catch (e) { fail(req, e); }
};
NE.close = (docId) => { const d = docs[docId]; if (d) { try { d.destroy(); } catch (e) {} delete docs[docId]; } };
NE.render = async (req, docId, index, maxPx, q) => {
  try {
    const doc = docs[docId]; if (!doc) throw new Error('not open');
    const page = await doc.getPage(index + 1);
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.max(0.1, Math.min(4, maxPx / Math.max(v1.width, v1.height)));
    const vp = page.getViewport({ scale: scale });
    const cv = document.createElement('canvas');
    cv.width = Math.max(1, Math.round(vp.width)); cv.height = Math.max(1, Math.round(vp.height));
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    const url = cv.toDataURL('image/jpeg', q || 0.85);
    const w = cv.width, h = cv.height;
    cv.width = 0; cv.height = 0; page.cleanup();
    post({ type: 'res', req: req, ok: true, data: { b64: url.slice(url.indexOf(',') + 1), w: w, h: h } });
  } catch (e) { fail(req, e); }
};

const hex = (c) => {
  const m = /^#?([0-9a-f]{6})/i.exec(c || '') || [0, '111111'];
  const n = parseInt(m[1], 16);
  return PDFLib.rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
};
const isPng = (b) => b[0] === 0x89 && b[1] === 0x50;

NE.exportPdf = async (req, specId) => {
  try {
    const spec = JSON.parse(strs[specId]); delete strs[specId];
    const L = PDFLib;
    const out = await L.PDFDocument.create();
    out.setTitle(spec.title || 'Note'); out.setCreator('Inkpad'); out.setProducer('Inkpad');
    const srcs = {}, imgs = {};
    const embed = async (id) => {
      if (imgs[id]) return imgs[id];
      const b = blobs[id] && blobs[id].buf; if (!b) return null;
      imgs[id] = isPng(b) ? await out.embedPng(b) : await out.embedJpg(b);
      return imgs[id];
    };
    for (let k = 0; k < spec.pages.length; k++) {
      const pg = spec.pages[k];
      let page, R = 0, cx = 0, cy = 0, W = pg.w, H = pg.h;
      if (pg.bg.kind === 'pdf') {
        if (!srcs[pg.bg.blob]) srcs[pg.bg.blob] = await L.PDFDocument.load(blobs[pg.bg.blob].buf, { ignoreEncryption: true });
        const cp = (await out.copyPages(srcs[pg.bg.blob], [pg.bg.index]))[0];
        page = out.addPage(cp);
        R = ((page.getRotation().angle % 360) + 360) % 360;
        const cb = page.getCropBox(); cx = cb.x; cy = cb.y; W = cb.width; H = cb.height;
      } else {
        page = out.addPage([pg.w, pg.h]);
        page.drawRectangle({ x: 0, y: 0, width: pg.w, height: pg.h, color: hex(pg.bg.fill || '#ffffff') });
        if (pg.bg.kind === 'image') { const im = await embed(pg.bg.blob); if (im) page.drawImage(im, { x: 0, y: 0, width: pg.w, height: pg.h }); }
      }
      // Our page space is the page as displayed (top-left origin); map it to PDF user space.
      const map = (u, v) => R === 90 ? [cx + v, cy + u] : R === 180 ? [cx + W - u, cy + v] : R === 270 ? [cx + W - v, cy + H - u] : [cx + u, cy + H - v];
      const o = map(0, 0); const rot = L.degrees(R);
      // Ink is stroked with round caps and joins, exactly like on screen.
      page.pushOperators(L.setLineJoin(L.LineJoinStyle.Round));
      for (const r of pg.rules || []) page.drawSvgPath(r.d, { x: o[0], y: o[1], rotate: rot, color: hex(r.color), borderWidth: 0 });
      for (const it of pg.items) {
        if (it.t === 'path') {
          const opt = { x: o[0], y: o[1], rotate: rot, color: hex(it.color), borderWidth: 0, opacity: it.opacity == null ? 1 : it.opacity };
          if (it.multiply) opt.blendMode = L.BlendMode.Multiply;
          page.drawSvgPath(it.d, opt);
        } else if (it.t === 'line') {
          const opt = { x: o[0], y: o[1], rotate: rot, borderColor: hex(it.color), borderWidth: it.w, borderLineCap: L.LineCapStyle.Round, borderOpacity: it.opacity == null ? 1 : it.opacity };
          if (it.multiply) opt.blendMode = L.BlendMode.Multiply;
          page.drawSvgPath(it.d, opt);
        } else if (it.t === 'img') {
          const im = await embed(it.blob); if (!im) continue;
          const a = map(it.x, it.y + it.h);
          page.drawImage(im, { x: a[0], y: a[1], width: it.w, height: it.h, rotate: rot });
        }
      }
      post({ type: 'progress', req: req, done: k + 1, total: spec.pages.length });
    }
    const bytes = await out.save({ useObjectStreams: true });
    for (const id in blobs) delete blobs[id];
    outs[req] = bytes;
    post({ type: 'res', req: req, ok: true, data: { size: bytes.length } });
  } catch (e) { fail(req, e); }
};
NE.pull = (req, outId, at, n) => {
  const b = outs[outId]; if (!b) { fail(req, 'gone'); return; }
  const part = b.subarray(at, Math.min(b.length, at + n));
  let s = ''; for (let i = 0; i < part.length; i += 8192) s += String.fromCharCode.apply(null, part.subarray(i, i + 8192));
  post({ type: 'res', req: req, ok: true, data: { b64: btoa(s), n: part.length } });
};
NE.free = (req) => { delete outs[req]; };
post({ type: 'ready' });
})();
</script></body></html>`;
