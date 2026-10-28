// Quill's AI (study tools + scan to clean copy) via the quill-study backend
// (tests/quill-study, a Cloudflare Pages function that holds the model keys).
import * as ImageManipulator from 'expo-image-manipulator';

import { askLocal, pageText } from './ondevice';

const ENDPOINT = 'https://quill-study.pages.dev/api/ai';
// Keeps random traffic off the endpoint. It is not in the (public) code: builds get it
// from the QUILL_APP_TOKEN GitHub secret, the web preview from .env.local.
export const APP_TOKEN = process.env.EXPO_PUBLIC_QUILL_TOKEN ?? '';

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

// ---------- online or offline ----------

let reach: { ok: boolean; at: number } | null = null;
/** Can we reach Quill's AI right now? (asked at most every 20 s, 3 s to answer) */
export async function aiOnline(): Promise<boolean> {
  if (reach && Date.now() - reach.at < 20_000) return reach.ok;
  let ok = false;
  try {
    const c = new AbortController();
    const tm = setTimeout(() => c.abort(), 3000);
    const r = await fetch('https://quill-study.pages.dev/api/google/refresh', { signal: c.signal, cache: 'no-store' });
    clearTimeout(tm);
    ok = r.status < 500;
  } catch { ok = false; }
  reach = { ok, at: Date.now() };
  return ok;
}

const OFFLINE_RULES = 'You are a friendly study coach. The text below was read from a student\'s notes (it may have small reading mistakes; work around them). Base everything on the notes. Write for a high-school student in short, clear sentences. Write math with plain symbols (×, ÷, ², √, π), never LaTeX.';
const OFFLINE: Record<Exclude<AiTask, 'clean'>, string> = {
  summary: 'Write a study summary in Markdown: a "# " title, "## Key ideas" with 4-8 bullets, "## Important terms" with **term** — meaning, and "## Remember" with 2-3 short lines.',
  explain: 'Find the 2-4 hardest ideas and explain each simply in Markdown: "## <idea>", 3-5 sentences, and one example.',
  flashcards: 'Make 8-12 flashcards. Reply with JSON only: {"title": "<topic>", "cards": [{"q": "<question or term>", "a": "<short answer>"}]}',
  quiz: 'Write a 6-question multiple-choice quiz, 4 choices each. Reply with JSON only: {"title": "<topic>", "questions": [{"q": "<question>", "choices": ["A","B","C","D"], "answer": <0-3>, "why": "<one sentence>"}]}',
  ask: 'Answer the student\'s question about the notes. Be direct and short (under 150 words).',
};

const jsonIn = (s: string) => { const a = s.indexOf('{'), b = s.lastIndexOf('}'); if (a < 0 || b <= a) return null; try { return JSON.parse(s.slice(a, b + 1)); } catch { return null; } };

/**
 * The study AI. `pages` are pictures of the pages (file:// uris). With internet it
 * uses Quill's AI (it reads the pictures); with none, the iPad reads the writing
 * itself and Apple's on-device model answers.
 */
export async function askStudy(task: Exclude<AiTask, 'clean'>, pages: string[], extra: { question?: string; history?: { role: 'user' | 'assistant'; text: string }[] } = {}): Promise<{ text?: string; data?: any; offline?: boolean }> {
  if (await aiOnline()) {
    try { return await askAi(task, await Promise.all(pages.map((u) => imageDataUrl(u, 1600))), extra); }
    catch (e) { if (!/No internet|took too long|didn't answer \(5/i.test(String((e as Error)?.message))) throw e; reach = { ok: false, at: Date.now() }; }
  }
  const texts = await Promise.all(pages.map((u) => pageText(u).catch(() => '')));
  const notes = texts.map((t, i) => (pages.length > 1 ? `--- Page ${i + 1} ---\n` : '') + t).join('\n\n').trim();
  if (!notes) throw new Error("Couldn't find any writing to read on this page.");
  const chat = (extra.history ?? []).slice(-6).map((m) => `${m.role === 'user' ? 'Student' : 'You'}: ${m.text}`).join('\n');
  const prompt = `NOTES:\n${notes}\n\n${chat ? chat + '\n' : ''}${extra.question ? `Student: ${extra.question}\n` : ''}`;
  const out = await askLocal(`${OFFLINE_RULES}\n\n${OFFLINE[task]}`, prompt);
  if (task === 'flashcards' || task === 'quiz') {
    const data = jsonIn(out);
    if (!data) throw new Error("The offline AI's answer came out garbled. Try again.");
    return { data, offline: true };
  }
  return { text: out, offline: true };
}
