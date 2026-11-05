// Record to Notes: while the teacher talks, this reads what's on the student's page and what was
// said, keeps a running set of notes and says where the class is up to. It uses the best helper it
// can reach: Quill's AI online, Apple's model on the iPad offline, otherwise the plain rules
// in livenotes-basic, which need nothing at all.
import { useCallback, useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';

import type { CanvasHandle } from '@/components/quill-canvas';

import { aiOnline, askAi, imageDataUrl } from './ai';
import { fsx } from './fsx';
import { basicNotes, matchPage, parseReply, wordsOf } from './livenotes-basic';
import { liveNow } from './liverec';
import type { LiveNote } from './model';
import { inTime, notePath } from './noteio';
import { askLocal, localAIStatus, pageText } from './ondevice';

export type NotesSource = 'online' | 'device' | 'basic';

const FIRST_AFTER = 15_000, EVERY = 30_000, MIN_WORDS = 20;

const RULES = `You help a student during a class. You get what the teacher just said (a speech transcript, so it can have mistakes) and what's on the student's page.
Reply in exactly this format:
NOW: one short sentence on what the teacher is on and, if it's on the page, which part and what to do there.
NOTES:
- a short note in the student's own study style
- another short note
Keep only what was really said or shown: facts, definitions, steps, examples, homework and test dates. Never make anything up. If there's nothing new worth keeping, write NOTES: none`;

const LISTENING = 'Listening. Notes appear when the teacher says something worth keeping.';

const SUMMARY = `Turn these class notes into clean study notes. Use short plain lines, with these headings where they apply: Main ideas, Key terms, Steps, Homework. Keep only what's in the notes. No introduction.`;

export const allSaid = () => {
  const s = liveNow();
  return [...s.lines.map((l) => l.text), s.partial].filter(Boolean).join(' ');
};

async function ask(instructions: string, prompt: string, image?: string): Promise<{ text: string; source: NotesSource } | null> {
  if (await aiOnline()) {
    try {
      const images = image ? [await inTime(imageDataUrl(image, 1200), 8000, 'picture')] : [];
      const r = await inTime(askAi('ask', images, { question: `${instructions}\n\n${prompt}` }), 25_000, 'online');
      if (r.text) return { text: r.text, source: 'online' };
    } catch {}
  }
  if (localAIStatus() === 'ready') {
    try { return { text: await inTime(askLocal(instructions, prompt), 30_000, 'device'), source: 'device' }; } catch {}
  }
  return null;
}

/** Clean notes from the running ones, for the page in the note. */
export async function summarize(notes: LiveNote[]): Promise<string> {
  const plain = notes.map((n) => `- ${n.text}`).join('\n');
  if (!notes.length) return '';
  const r = await ask(SUMMARY, plain);
  return r?.text.replace(/\*\*/g, '').replace(/^#+\s*/gm, '').trim() || plain;
}

export type LiveNotes = {
  now: string;
  notes: LiveNote[];
  source: NotesSource | null;
  busy: boolean;
  /** One last round on anything not looked at yet; returns all the notes. */
  finish(): Promise<LiveNote[]>;
  reset(): void;
};

export function useLiveNotes(on: boolean, noteId: string, canvas: RefObject<CanvasHandle | null>, page: () => number, absPath: (p: string) => string): LiveNotes {
  const [now, setNow] = useState('');
  const [notes, setNotes] = useState<LiveNote[]>([]);
  const [source, setSource] = useState<NotesSource | null>(null);
  const [busy, setBusy] = useState(false);
  const notesRef = useRef(notes); notesRef.current = notes;
  const doneChars = useRef(0);
  const lastRun = useRef(0);
  const running = useRef<Promise<void> | null>(null);

  const round = useCallback(async () => {
    const full = allSaid();
    const said = full.slice(doneChars.current).trim();
    if (!said) return;
    doneChars.current = full.length;
    lastRun.current = Date.now();
    setBusy(true);
    const at = Math.max(0, (liveNow().elapsed - 15_000) / 1000);
    try {
      // What's on the page right now. The reading happens on the iPad, so it works offline.
      const shot = notePath(noteId, 'live_page.jpg');
      let image: string | undefined;
      let screen = '';
      try {
        if (await inTime(Promise.resolve(canvas.current?.pageShot(page(), absPath(shot), 900)), 5000, 'page')) {
          image = fsx.uri(shot);
          screen = await inTime(pageText(image), 10_000, 'reading').catch(() => '');
        }
      } catch {}
      const known = notesRef.current.map((n) => n.text);
      const prompt = `ALREADY IN THE NOTES:\n${known.slice(-12).join('\n') || '(nothing yet)'}\n\nON THE STUDENT'S PAGE:\n${screen.slice(0, 2500) || '(no writing yet)'}\n\nTHE TEACHER JUST SAID:\n${said.slice(-3500)}`;
      const r = await ask(RULES, prompt, image);
      let fresh: string[];
      if (r) {
        const p = parseReply(r.text);
        fresh = p.notes;
        if (p.now) setNow(p.now);
        setSource(r.source);
      } else {
        fresh = basicNotes(said, screen, known);
        const line = matchPage(said, screen);
        setNow(line ? `Sounds like this part of your page: “${line}”` : LISTENING);
        setSource('basic');
      }
      if (fresh.length) {
        setNotes((list) => {
          const have = new Set(list.map((n) => n.text.toLowerCase()));
          return [...list, ...fresh.filter((t) => !have.has(t.toLowerCase())).map((text) => ({ t: at, text }))];
        });
      }
    } finally { setBusy(false); }
  }, [noteId, canvas, page, absPath]);

  useEffect(() => {
    if (!on) return;
    lastRun.current = Date.now() - (EVERY - FIRST_AFTER);
    const t = setInterval(() => {
      if (running.current || liveNow().paused || Date.now() - lastRun.current < EVERY) return;
      if (wordsOf(allSaid().slice(doneChars.current)).length < MIN_WORDS) return;
      running.current = round().catch(() => {}).finally(() => { running.current = null; });
    }, 3000);
    return () => clearInterval(t);
  }, [on, round]);

  const finish = useCallback(async () => {
    // Stopping never hangs: the recording is already safe, and these only add to the notes.
    if (running.current) await inTime(running.current, 45_000, 'waiting').catch(() => {});
    await inTime(round(), 60_000, 'last').catch(() => {});
    // setNotes has run by now, but the ref only catches up on the next draw.
    await new Promise((ok) => setTimeout(ok, 50));
    return notesRef.current;
  }, [round]);

  const reset = useCallback(() => {
    setNow(''); setNotes([]); setSource(null);
    doneChars.current = 0;
  }, []);

  return { now, notes, source, busy, finish, reset };
}
