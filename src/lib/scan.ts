// Paper to iPad: scan pages with Apple's document camera, have the AI retype
// each one as clean HTML (headings, lists, tables, worksheet blanks), lay that
// out as a Letter-size PDF, and open it as a note you can write on.
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { aiOnline, askAi, imageDataUrl } from './ai';
import { fsx } from './fsx';
import { type OcrLine, readText } from './ondevice';

type NativeScan = { scanDocument(enhance: boolean): Promise<string[]>; htmlToPdf(html: string, path: string): Promise<number> };
let Native: NativeScan | null = null;
if (Platform.OS === 'ios') {
  try { Native = requireNativeModule<NativeScan>('QuillCanvas'); } catch { Native = null; }
}

export const canScan = () => !!Native;

/**
 * Scans paper pages and cleans up the pictures (white paper, crisp ink, no
 * shadows) without changing anything on them. Returns file:// uris, empty if cancelled.
 */
export async function scanEnhanced(): Promise<string[]> {
  if (!Native) throw new Error("Scanning works in the iPad app.");
  return (await Native.scanDocument(true)).map((p) => 'file://' + p);
}

const CSS = `
  body { font-family: -apple-system, 'Helvetica Neue', Helvetica, Arial, sans-serif; font-size: 12pt; line-height: 1.5; color: #15171c; }
  h1 { font-size: 21pt; line-height: 1.2; margin: 0 0 12pt; }
  h2 { font-size: 15.5pt; margin: 16pt 0 6pt; }
  h3 { font-size: 13pt; margin: 12pt 0 4pt; }
  p { margin: 0 0 8pt; }
  ul, ol { margin: 0 0 8pt; padding-left: 22pt; }
  li { margin: 0 0 5pt; }
  table { border-collapse: collapse; width: 100%; margin: 6pt 0 10pt; }
  th, td { border: 0.75pt solid #9aa0aa; padding: 4pt 7pt; text-align: left; vertical-align: top; }
  th { background: #f0f2f5; }
  .blank { display: inline-block; min-width: 130pt; border-bottom: 0.9pt solid #2b2f36; height: 1.05em; vertical-align: bottom; }
  .line { border-bottom: 0.75pt solid #aab0ba; height: 24pt; }
  .answer { color: #1d4ed8; }
  .figure { border: 0.75pt dashed #aab0ba; border-radius: 4pt; padding: 10pt; margin: 8pt 0; color: #6b7280; font-style: italic; }
  hr { border: 0; border-top: 0.75pt solid #d1d5db; margin: 12pt 0; }
  hr.page { page-break-after: always; border: 0; margin: 0; }
`;

/** Tidies the AI's HTML: no scripts/styles, "lines" placeholders become real writing lines. */
export function tidyHtml(body: string): string {
  let h = body.replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, '')
    .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*')/gi, '');
  h = h.replace(/<div class="lines"(?:\s+data-n="(\d+)")?\s*><\/div>/gi, (_, n) => '<div class="line"></div>'.repeat(Math.max(1, Math.min(20, Number(n) || 3))));
  return h;
}

export function cleanDocument(pages: string[]): string {
  const body = pages.map(tidyHtml).join('<hr class="page">');
  return `<!doctype html><html><head><meta charset="utf-8"><style>${CSS}</style></head><body>${body}</body></html>`;
}

const stripTags = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim();

/**
 * Scans paper pages and returns a clean PDF (file:// uri), a title and the text.
 * Returns null if the user cancelled the camera.
 */
export async function scanToCleanCopy(onStep: (msg: string) => void): Promise<{ pdfUri: string; title: string; text: string } | null> {
  if (!Native) throw new Error('Scanning works in the iPad app.');
  const paths = await Native.scanDocument(false);
  if (!paths.length) return null;
  const bodies: string[] = [];
  // With internet the AI retypes each page; with none (or if it fails) the iPad reads
  // the page itself and Quill lays it out, so this always works.
  let online = await aiOnline();
  for (let i = 0; i < paths.length; i++) {
    const of = paths.length > 1 ? ` page ${i + 1} of ${paths.length}` : '';
    if (online) {
      onStep(`Making a clean copy…${of}`);
      try {
        const r = await askAi('clean', [await imageDataUrl('file://' + paths[i], 1800)]);
        if (r.text?.trim()) { bodies.push(r.text); continue; }
      } catch { online = false; }
    }
    onStep(`Reading the page on this iPad…${of}`);
    const lines = await readText('file://' + paths[i]);
    if (!lines.length && paths.length === 1) throw new Error("Couldn't find any writing. Try scanning again with more light.");
    bodies.push(ocrToHtml(lines, i === 0));
  }
  onStep('Laying out the pages…');
  const html = cleanDocument(bodies);
  const out = `inkpad/out/clean_${Date.now().toString(36)}.pdf`;
  const abs = decodeURIComponent(fsx.uri(out).replace(/^file:\/\//, ''));
  await Native.htmlToPdf(html, abs);
  const h1 = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(bodies[0]);
  const title = (h1 ? stripTags(h1[1]) : '').slice(0, 80) || 'Scanned notes';
  return { pdfUri: fsx.uri(out), title, text: stripTags(bodies.join(' ')).slice(0, 4000) };
}

// ---------- the offline converter ----------

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * A typed page from the lines the iPad read off a scan (no internet): rows are
 * rebuilt from where the lines sit, bigger lines become headings, bullets and
 * numbered questions keep their marks, ____ becomes a writing blank, and a gap
 * under a question becomes writing lines.
 */
export function ocrToHtml(lines: OcrLine[], first: boolean): string {
  if (!lines.length) return '<p class="figure">(No writing found on this page.)</p>';
  // Lines on the same row (a question and its points, table cells) join left to right.
  const rows: { text: string; x: number; y: number; h: number }[] = [];
  for (const l of [...lines].sort((a, b) => a.y - b.y || a.x - b.x)) {
    const r = rows.find((q) => Math.abs(q.y - l.y) < Math.min(q.h, l.h) * 0.5);
    if (r) {
      const parts = [{ x: r.x, t: r.text }, { x: l.x, t: l.text }].sort((a, b) => a.x - b.x);
      r.text = parts.map((p) => p.t).join('    ');
      r.x = Math.min(r.x, l.x); r.h = Math.max(r.h, l.h);
    } else rows.push({ text: l.text.trim(), x: l.x, y: l.y, h: l.h });
  }
  rows.sort((a, b) => a.y - b.y);
  const hs = rows.map((r) => r.h).sort((a, b) => a - b);
  const H = hs[Math.floor(hs.length / 2)] || 0.02;
  const left = Math.min(...rows.map((r) => r.x));
  const out: string[] = [];
  let list: 'ul' | null = null;
  let para: string[] = [];
  const flush = () => { if (para.length) { out.push(`<p>${para.join(' ')}</p>`); para = []; } };
  const close = () => { if (list) { out.push('</ul>'); list = null; } };
  const blanks = (s: string) => esc(s).replace(/_{3,}/g, '<span class="blank"></span>');
  let headed = !first;
  rows.forEach((r, i) => {
    const prev = rows[i - 1], next = rows[i + 1];
    const gapBefore = prev ? r.y - (prev.y + prev.h) : 0;
    const gapAfter = next ? next.y - (r.y + r.h) : 0;
    const text = r.text.replace(/\s+/g, ' ').trim();
    if (!text) return;
    const big = r.h > H * 1.35 && text.length < 70;
    const bullet = /^[•·▪●○◦\-–*]\s+/.exec(text);
    const numbered = /^(\(?\d{1,2}[.)]|\(?[a-hA-H][.)]|Q\d+[.:)]?)\s+/.exec(text);
    const indent = r.x - left > 0.035 ? ' style="margin-left:18pt"' : '';
    if (gapBefore > H * 0.9) flush();
    if (big || (!headed && i === 0 && text.length < 60 && !numbered)) {
      flush(); close();
      out.push(!headed ? `<h1>${esc(text)}</h1>` : `<h2>${esc(text)}</h2>`);
      headed = true;
      return;
    }
    if (bullet) {
      flush();
      if (!list) { out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${blanks(text.slice(bullet[0].length))}</li>`);
      return;
    }
    close();
    if (numbered) {
      flush();
      out.push(`<p${indent}><b>${esc(numbered[1])}</b> ${blanks(text.slice(numbered[0].length))}</p>`);
      // Room to answer: a big gap under a question turns into writing lines.
      if (gapAfter > H * 2.2) out.push('<div class="line"></div>'.repeat(Math.min(8, Math.max(1, Math.round(gapAfter / (H * 1.8))))));
      return;
    }
    if (indent && !para.length) { out.push(`<p${indent}>${blanks(text)}</p>`); return; }
    para.push(blanks(text));
  });
  flush(); close();
  return out.join('\n');
}
