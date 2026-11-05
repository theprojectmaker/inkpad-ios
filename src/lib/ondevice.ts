// What Quill can do on the iPad with no internet: read printed and handwritten
// text (Apple's Vision), clean up page pictures, and Apple's on-device model
// (iPadOS 26 with Apple Intelligence) for the study tools.
import { requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';

export type OcrLine = { text: string; x: number; y: number; w: number; h: number; conf: number };   // 0...1, top-left origin
export type LocalAIStatus = 'ready' | 'off' | 'downloading' | 'unsupported';

type NativeOnDevice = {
  readText(path: string): Promise<{ lines: OcrLine[]; width: number; height: number }>;
  pickColor(start: string): Promise<string>;
  copyText(text: string): Promise<void>;
  pdfInfo(path: string, maxText: number): Promise<{ pages: [number, number][]; text: string }>;
  pdfCover(path: string, dst: string, width: number): Promise<boolean>;
  enhanceImage(src: string, dst: string, mode: string): Promise<boolean>;
  localAIStatus(): LocalAIStatus;
  localAI(instructions: string, prompt: string): Promise<string>;
};
let Native: NativeOnDevice | null = null;
if (Platform.OS === 'ios') {
  try { Native = requireNativeModule<NativeOnDevice>('QuillCanvas'); } catch { Native = null; }
}

const plain = (uri: string) => decodeURIComponent(uri.replace(/^file:\/\//, ''));

/** Every line of writing in a picture (file:// uri or path), top to bottom. */
export async function readText(uri: string): Promise<OcrLine[]> {
  if (!Native?.readText) throw new Error('Reading pages works in the iPad app.');
  const r = await Native.readText(plain(uri));
  return [...r.lines].sort((a, b) => a.y - b.y || a.x - b.x);
}

/** A PDF's page sizes and some text, read directly from the file. null where that can't be done (the browser preview). */
export async function pdfInfo(uri: string, maxText = 12000) {
  if (!Native?.pdfInfo) return null;
  return Native.pdfInfo(plain(uri), maxText);
}

/** The first page of a PDF as a small picture. False where that can't be done. */
export async function pdfCover(uri: string, dstUri: string, width: number): Promise<boolean> {
  return (await Native?.pdfCover?.(plain(uri), plain(dstUri), width)) ?? false;
}

/** Apple's colour picker. Empty if closed without picking. */
export async function pickColor(start: string): Promise<string> {
  return (await Native?.pickColor?.(start)) ?? '';
}

export const copyText = (text: string) => Native?.copyText?.(text);

/** The text of a page picture as plain lines (for the offline AI). */
export async function pageText(uri: string): Promise<string> {
  return (await readText(uri)).map((l) => l.text).join('\n');
}

/**
 * A page picture fixed up to look like a clean file (on the iPad, offline): enlarged if
 * small, even white paper, no shadows, dark sharp writing. "color" keeps colours,
 * "document" is crisp black and white. Written to `dst` (file:// uri or path).
 */
export async function enhanceImage(src: string, dst: string, mode: 'color' | 'document' = 'color'): Promise<void> {
  if (!Native?.enhanceImage) throw new Error('This works in the iPad app.');
  if (!(await Native.enhanceImage(plain(src), plain(dst), mode))) throw new Error("Couldn't improve that page.");
}

export function localAIStatus(): LocalAIStatus {
  try { return Native?.localAIStatus?.() ?? 'unsupported'; } catch { return 'unsupported'; }
}

/** Why the offline AI can't help right now, in plain words (or null if it can). */
export function localAIProblem(): string | null {
  switch (localAIStatus()) {
    case 'ready': return null;
    case 'off': return 'No internet. To use the AI offline, turn on Apple Intelligence in Settings.';
    case 'downloading': return "No internet, and the iPad's offline AI is still downloading. Try again soon.";
    default: return "No internet, and this iPad can't run the AI offline. Connect to Wi-Fi and try again.";
  }
}

/** One answer from Apple's on-device model. Keeps the text short enough for it. */
export async function askLocal(instructions: string, prompt: string): Promise<string> {
  const p = localAIProblem();
  if (p) throw new Error(p);
  const out = await Native!.localAI(instructions, prompt.length > 9000 ? prompt.slice(0, 9000) + '\n…' : prompt);
  return out.trim();
}
