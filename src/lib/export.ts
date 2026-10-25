// Export a note as a flattened, annotated PDF. Original PDF pages are copied
// as-is (text stays selectable) and the ink is drawn on top as vector paths.
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';

import { fsx } from './fsx';
import type { NoteDoc } from './model';
import { notePath } from './noteio';
import { paperOf, paperSvg } from './paper';
import { engine } from './pdf-engine';
import { strokeSvg } from './ink';
import { HL_ALPHA, renderTextPng } from './skia-render';

export async function exportNotePdf(doc: NoteDoc, title: string, onProgress?: (done: number, total: number) => void): Promise<string> {
  const files: Record<string, { path?: string; b64?: string }> = {};
  const blob = (name: string, src: { path?: string; b64?: string }) => { files[name] = src; return `@blob:${name}`; };
  const pages = doc.pages.map((p) => {
    let bg: any;
    let rules: { d: string; color: string }[] = [];
    if (p.bg.kind === 'pdf') bg = { kind: 'pdf', blob: blob(p.bg.file, { path: notePath(doc.id, p.bg.file) }), index: p.bg.index };
    else if (p.bg.kind === 'image') bg = { kind: 'image', blob: blob(p.bg.file, { path: notePath(doc.id, p.bg.file) }), fill: '#ffffff' };
    else { bg = { kind: 'paper', fill: paperOf(p.bg.color).bg }; rules = paperSvg(p.bg.style, p.bg.color, p.w, p.h); }
    const dark = p.bg.kind === 'paper' && p.bg.color === 'dark';
    const items: any[] = [];
    for (const s of p.strokes) if (s.kind === 'hl') { const d = strokeSvg(s); if (d) items.push({ t: 'path', d, color: s.color, opacity: HL_ALPHA, multiply: !dark }); }
    for (const im of p.images) items.push({ t: 'img', blob: blob(im.file, { path: notePath(doc.id, im.file) }), x: im.x, y: im.y, w: im.w, h: im.h });
    for (const s of p.strokes) if (s.kind === 'pen') { const d = strokeSvg(s); if (d) items.push({ t: 'path', d, color: s.color }); }
    for (const t of p.texts) {
      const r = renderTextPng(t);
      if (r) items.push({ t: 'img', blob: blob('t_' + t.id, { b64: r.b64 }), x: r.box.x, y: r.box.y, w: r.box.w, h: r.box.h });
    }
    return { w: p.w, h: p.h, bg, rules, items };
  });
  const safe = (title || 'Note').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 80) || 'Note';
  const out = `inkpad/out/${safe}.pdf`;
  await engine.exportPdf({ title: safe, pages }, files, out, onProgress);
  return out;
}

export async function shareImage(path: string) {
  if (Platform.OS === 'web') {
    const a = (globalThis as any).document.createElement('a');
    a.href = fsx.uri(path); a.download = path.split('/').pop() || 'page.jpg'; a.click();
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(fsx.uri(path), { mimeType: 'image/jpeg', UTI: 'public.jpeg' });
}

export async function sharePdf(path: string, title: string) {
  if (Platform.OS === 'web') {
    const a = (globalThis as any).document.createElement('a');
    a.href = fsx.uri(path);
    a.download = path.split('/').pop() || 'note.pdf';
    a.click();
    return;
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(fsx.uri(path), { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: title });
}
