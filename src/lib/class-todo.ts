// Spots what a teacher said to do, in what was said in class, so it can go on the homework list.
// Rules only, so it works offline. It only suggests: nothing is added until it's tapped.

export type HeardTodo = { text: string; due?: string };

const pad = (n: number) => String(n).padStart(2, '0');
const key = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const MONTHS = 'jan feb mar apr may jun jul aug sep oct nov dec'.split(' ');

/** Words that mean "you have to do this", whatever else is in the sentence. */
const ALWAYS = /\b(homework|assignment|turn (it |this |that )?in|hand (it |this |that )?in|for tomorrow|due (on |by |next |this |tomorrow|monday|tuesday|wednesday|thursday|friday|\d))/i;
/** Words that only count with a day attached: "a test" alone may just be a word in the lesson. */
const WITH_DAY = /\b(test|quiz|exam|essay|project|worksheet|lab report|study for|read (pages?|chapters?)|finish (the|your|chapter|page))\b/i;

/** The day a sentence names, if it names one. */
export function dayIn(text: string, today: Date): string | undefined {
  const s = text.toLowerCase();
  const at = (add: number) => {
    const d = new Date(today.getFullYear(), today.getMonth(), today.getDate() + add);
    return key(d);
  };
  if (/\btomorrow\b/.test(s)) return at(1);
  if (/\btoday\b|\btonight\b/.test(s)) return at(0);
  const named = /\b(next )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(s);
  if (named) {
    let add = (DAYS.indexOf(named[2]) - today.getDay() + 7) % 7;
    if (add === 0) add = 7;              // said on a Friday, "Friday" means next Friday
    if (named[1] && DAYS.indexOf(named[2]) > today.getDay()) add += 7;   // "next Friday" said on a Thursday skips this Friday
    return at(add);
  }
  if (/\bnext week\b/.test(s)) return at(7);
  const inDays = /\bin (two|three|four|five|\d) days\b/.exec(s);
  if (inDays) return at(({ two: 2, three: 3, four: 4, five: 5 } as Record<string, number>)[inDays[1]] ?? +inDays[1]);
  const month = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2})\b/.exec(s);
  const slash = /\b(\d{1,2})\/(\d{1,2})\b/.exec(s);
  let m = -1, d = 0;
  if (month) { m = MONTHS.indexOf(month[1]); d = +month[2]; } else if (slash) { m = +slash[1] - 1; d = +slash[2]; }
  if (m >= 0 && m < 12 && d >= 1 && d <= 31) {
    let y = today.getFullYear();
    if (new Date(y, m, d).getTime() < new Date(y, today.getMonth(), today.getDate()).getTime()) y++;
    const date = new Date(y, m, d);
    if (date.getMonth() === m) return key(date);
  }
  return undefined;
}

/** What was said to do, newest last, without repeats. */
export function heardTodos(lines: string[], today: Date): HeardTodo[] {
  const out: HeardTodo[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    for (const raw of line.split(/(?<=[.!?])\s+/)) {
      const text = raw.trim().replace(/[.!?]+$/, '');
      if (text.length < 8 || text.length > 160 || text.endsWith('?') || /\?\s*$/.test(raw)) continue;
      const due = dayIn(text, today);
      if (!ALWAYS.test(text) && !(WITH_DAY.test(text) && due)) continue;
      const same = text.toLowerCase().replace(/[^a-z0-9 ]/g, '');
      if (seen.has(same)) continue;
      seen.add(same);
      out.push({ text: text[0].toUpperCase() + text.slice(1), due });
    }
  }
  return out.slice(-6);
}
