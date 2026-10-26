// Paper to iPad: scan pages with Apple's document camera, have the AI retype
// each one as clean HTML (headings, lists, tables, worksheet blanks), lay that
// out as a Letter-size PDF, and open it as a note you can write on.
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

import { askAi, imageDataUrl } from './ai';
import { fsx } from './fsx';

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
  return (await Native.scanDocument(true)).map((p) => "file://" + p);
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
  for (let i = 0; i < paths.length; i++) {
    onStep(paths.length > 1 ? `Making a clean copy… page ${i + 1} of ${paths.length}` : 'Making a clean copy…');
    const img = await imageDataUrl('file://' + paths[i], 1800);
    const r = await askAi('clean', [img]);
    if (!r.text?.trim()) throw new Error(`The AI couldn't read page ${i + 1}. Try scanning it again with more light.`);
    bodies.push(r.text);
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
