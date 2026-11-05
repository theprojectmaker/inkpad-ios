// The working-out behind studying: no imports, so all of it can be tested on its own.

export type Card = { q: string; a: string; box: number; due: number; star?: boolean; missed?: number };
export type StudyDay = { minutes?: number; cards?: number };

const DAY = 86400000;
/** Days until a card comes back, by how well it's known. */
export const GAPS = [0, 1, 3, 7, 14, 30];

/** Each line is one card: a tab, " - ", ":" or "," splits the front from the back. */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const m = l.split(/\t| - | – | — /);
    const [q, ...rest] = m.length > 1 ? m : l.includes(':') ? l.split(':') : l.split(',');
    const a = rest.join(' ').trim();
    if (q?.trim() && a) out.push({ q: q.trim(), a, box: 0, due: 0 });
  }
  return out;
}

export const cardsToText = (cards: Pick<Card, 'q' | 'a'>[]) => cards.map((c) => `${c.q}\t${c.a}`).join('\n');

/** After answering: known cards wait longer each time, missed ones come back in a minute. */
export function answered(c: Card, knew: boolean, now: number): Card {
  const box = knew ? Math.min(GAPS.length - 1, c.box + 1) : 0;
  return { ...c, box, due: knew ? now + GAPS[box] * DAY : now + 60000, missed: knew ? c.missed : (c.missed ?? 0) + 1 };
}

export const isDue = (c: Card, now: number) => c.due <= now;
/** How much of a set is properly learned: a card counts once it's reached a week's gap. */
export const mastered = (cards: Card[]) => (cards.length ? cards.filter((c) => c.box >= 3).length / cards.length : 0);
/** The ones that keep getting missed, worst first. */
export const hardest = (cards: Card[], n = 10) => cards.filter((c) => (c.missed ?? 0) > 0).sort((a, b) => (b.missed ?? 0) - (a.missed ?? 0)).slice(0, n);

export function shuffled<T>(list: T[], random = Math.random): T[] {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const plainWords = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').replace(/^(a|an|the) /, '').trim();

function editDistance(a: string, b: string) {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** A typed answer: small typos are fine, a different word isn't. */
export function closeEnough(typed: string, answer: string) {
  const x = plainWords(typed), y = plainWords(answer);
  if (!x) return false;
  if (x === y) return true;
  return editDistance(x, y) <= Math.floor(y.length * 0.2);
}

/** Pairs for the match game: terms and answers, each column in its own random order. */
export function matchRound(cards: Pick<Card, 'q' | 'a'>[], size = 6, random = Math.random) {
  const pick = shuffled(cards, random).slice(0, size);
  const tiles = pick.flatMap((c, pair) => [{ id: `q${pair}`, pair, text: c.q }, { id: `a${pair}`, pair, text: c.a }]);
  return shuffled(tiles, random);
}

export const dayKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const did = (x?: StudyDay) => !!x && ((x.minutes ?? 0) > 0 || (x.cards ?? 0) > 0);

/** Days in a row with some studying. Today not done yet doesn't break it. */
export function streak(days: Record<string, StudyDay>, today: Date) {
  const d = new Date(today);
  if (!did(days[dayKey(d)])) d.setDate(d.getDate() - 1);
  let n = 0;
  while (did(days[dayKey(d)])) { n++; d.setDate(d.getDate() - 1); }
  return n;
}

/** The last 7 days, oldest first. */
export function lastWeek(days: Record<string, StudyDay>, today: Date) {
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(today);
    d.setDate(d.getDate() - (6 - i));
    const x = days[dayKey(d)];
    return { label: d.toLocaleDateString([], { weekday: 'narrow' }), minutes: x?.minutes ?? 0, cards: x?.cards ?? 0 };
  });
}

/** Whole days from today until a date ("2026-11-20"). Negative once it's gone. */
export function daysUntil(date: string, today: Date) {
  const [y, m, d] = date.split('-').map(Number);
  return Math.round((new Date(y, m - 1, d).getTime() - new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) / DAY);
}

/** A typed date: "11/20", "11/20/26", "2026-11-20", "Nov 20". The next such date if no year is given. Null if it can't be read. */
export function readDate(text: string, today: Date): string | null {
  const s = text.trim().toLowerCase();
  let y: number | null = null, m = 0, d = 0;
  let r = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (r) { y = +r[1]; m = +r[2]; d = +r[3]; } else if ((r = /^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/.exec(s))) {
    m = +r[1]; d = +r[2];
    if (r[3]) y = r[3].length === 2 ? 2000 + +r[3] : +r[3];
  } else if ((r = /^([a-z]{3})[a-z]*\.? (\d{1,2})$/.exec(s))) {
    m = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ').indexOf(r[1]) + 1;
    d = +r[2];
  } else return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  if (y == null) {
    y = today.getFullYear();
    if (new Date(y, m - 1, d).getTime() < new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) y++;
  }
  const check = new Date(y, m - 1, d);
  if (check.getMonth() !== m - 1) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export const CONVERT: Record<string, Record<string, number>> = {
  Length: { mm: 0.001, cm: 0.01, m: 1, km: 1000, in: 0.0254, ft: 0.3048, yd: 0.9144, mi: 1609.344 },
  Mass: { mg: 1e-6, g: 0.001, kg: 1, oz: 0.0283495, lb: 0.453592, ton: 907.185 },
  Volume: { mL: 0.001, L: 1, tsp: 0.00492892, tbsp: 0.0147868, cup: 0.236588, pt: 0.473176, qt: 0.946353, gal: 3.78541 },
  Time: { s: 1, min: 60, h: 3600, day: 86400, week: 604800 },
  Temperature: { '°C': 1, '°F': 1, K: 1 },
};

export function convert(kind: string, value: number, from: string, to: string) {
  if (kind === 'Temperature') {
    const c = from === '°C' ? value : from === '°F' ? ((value - 32) * 5) / 9 : value - 273.15;
    return to === '°C' ? c : to === '°F' ? (c * 9) / 5 + 32 : c + 273.15;
  }
  return (value * CONVERT[kind][from]) / CONVERT[kind][to];
}
