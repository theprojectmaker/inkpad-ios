// Quill's AI (study tools + scan to clean copy) via the quill-study backend
// (tests/quill-study, a Cloudflare Pages function that holds the model keys).
import * as ImageManipulator from 'expo-image-manipulator';

const ENDPOINT = 'https://quill-study.pages.dev/api/ai';
// Not a secret: just keeps random traffic off the endpoint.
export const APP_TOKEN = 'Nn6LJ_rM5O9z7VHjSwDdSIQv';

export type AiTask = 'summary' | 'flashcards' | 'quiz' | 'explain' | 'ask' | 'clean';
export type Flashcard = { q: string; a: string };
export type QuizQ = { q: string; choices: string[]; answer: number; why?: string };

/** A local image (file:// uri) as a JPEG data URL, no wider/taller than maxSide. */
export async function imageDataUrl(uri: string, maxSide = 1600): Promise<string> {
  const probe = await ImageManipulator.manipulateAsync(uri, [], {});
  const big = Math.max(probe.width, probe.height);
  const resize = big > maxSide ? [{ resize: probe.width >= probe.height ? { width: maxSide } : { height: maxSide } }] : [];
  const r = await ImageManipulator.manipulateAsync(uri, resize, { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG, base64: true });
  if (!r.base64) throw new Error("Couldn't read that page.");
  return 'data:image/jpeg;base64,' + r.base64;
}

export async function askAi(task: AiTask, images: string[], extra: { question?: string; history?: { role: 'user' | 'assistant'; text: string }[] } = {}): Promise<{ text?: string; data?: any }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 120000);
  try {
    const r = await fetch(ENDPOINT, {
      method: 'POST', signal: ctrl.signal,
      headers: { 'content-type': 'application/json', 'x-quill-app': APP_TOKEN },
      body: JSON.stringify({ task, images, ...extra }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok || !d.ok) throw new Error(d.error || `The AI didn't answer (${r.status}).`);
    return { text: d.text, data: d.data };
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw new Error('The AI took too long. Try again.');
    if (/Network request failed|Failed to fetch/i.test(String((e as Error)?.message))) throw new Error('No internet connection.');
    throw e;
  } finally { clearTimeout(timer); }
}
