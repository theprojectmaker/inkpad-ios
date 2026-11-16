// Small helpers for the newer note tools: review reminders, the daily note and tags.
import type { NoteMeta } from './model';

const DAY = 86400000;

/** Days between reviews. Opening a note that's due counts as reviewing it. */
export const REVIEW_DAYS = [1, 3, 7, 14, 30];

export type Review = NonNullable<NoteMeta['review']>;

export const startReview = (now = Date.now()): Review => ({ step: 0, next: now + REVIEW_DAYS[0] * DAY });

/** The review after one is done: further out each time, and none after the last. `days` is the wait, or null when finished. */
export function advanceReview(r: Review, now = Date.now()): { review: Review | undefined; days: number | null } {
  const step = r.step + 1;
  if (step >= REVIEW_DAYS.length) return { review: undefined, days: null };
  return { review: { step, next: now + REVIEW_DAYS[step] * DAY }, days: REVIEW_DAYS[step] };
}

/** Notes whose review time has come, the longest-waiting first. */
export const dueNotes = (notes: NoteMeta[], now = Date.now()) =>
  notes.filter((n) => !n.trashed && n.review && n.review.next <= now).sort((a, b) => a.review!.next - b.review!.next);

/** The daily note's title: the same all day, different tomorrow. */
export const dailyTitle = (d = new Date()) =>
  `Daily ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}`;

/** "bio, #exam week" becomes ['bio', 'exam', 'week']: lowercase, no # signs, no repeats, at most eight. */
export function parseTags(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/[\s,;]+/)) {
    const t = raw.replace(/^#+/, '').toLowerCase().slice(0, 24);
    if (t && !out.includes(t)) out.push(t);
  }
  return out.slice(0, 8);
}

export const tagLine = (tags?: string[]) => (tags?.length ? tags.map((t) => `#${t}`).join(' ') : '');

/** Days in a row with a note opened, counting back from today (or yesterday, so it doesn't vanish before you start). */
export function streakOf(days: string[] | undefined): number {
  const set = new Set(days ?? []);
  const d = new Date();
  if (!set.has(d.toISOString().slice(0, 10))) d.setDate(d.getDate() - 1);
  let n = 0;
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/** Every tag in use, the most used first. */
export function tagCounts(notes: NoteMeta[]): { tag: string; count: number }[] {
  const m = new Map<string, number>();
  for (const n of notes) if (!n.trashed) for (const t of n.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
  return [...m].map(([tag, count]) => ({ tag, count })).sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}
