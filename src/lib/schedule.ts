// The optional class schedule for the Studento-style clock: the same periods
// every school day (Mon-Fri). Saved as one small JSON file; nothing leaves the iPad.
import { useCallback, useEffect, useState } from 'react';

import { fsx } from './fsx';

export type Period = { id: string; name: string; start: number; end: number }; // minutes after midnight
export type Schedule = { periods: Period[]; theme: number };

const PATH = 'inkpad/schedule.json';
const EMPTY: Schedule = { periods: [], theme: 0 };

/** "8:05" -> 485. School times: 1-6 o'clock means afternoon. Returns null if it isn't a time. */
export function parseTime(s: string): number | null {
  const m = s.trim().toLowerCase().match(/^(\d{1,2})(?::?(\d{2}))?\s*(am|pm|a|p)?$/);
  if (!m) return null;
  let h = Number(m[1]); const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) return null;
  const ap = m[3]?.[0];
  if (ap === 'p' && h < 12) h += 12;
  else if (ap === 'a' && h === 12) h = 0;
  else if (!ap && h >= 1 && h <= 6) h += 12;
  return h * 60 + min;
}

export const fmtTime = (mins: number) => {
  const h = Math.floor(mins / 60) % 24, m = mins % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
};

export type Now =
  | { kind: 'class'; period: Period; left: number; total: number; next?: Period }   // left/total in seconds
  | { kind: 'passing'; next: Period; left: number }
  | { kind: 'free' };

/** Where the day is right now: in a class, between classes, or no school. */
export function whereNow(s: Schedule, d: Date): Now {
  const day = d.getDay();
  if (day === 0 || day === 6 || !s.periods.length) return { kind: 'free' };
  const sec = d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  const list = [...s.periods].sort((a, b) => a.start - b.start);
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    if (sec >= p.start * 60 && sec < p.end * 60) return { kind: 'class', period: p, left: p.end * 60 - sec, total: (p.end - p.start) * 60, next: list[i + 1] };
    if (sec < p.start * 60) return i === 0 && p.start * 60 - sec > 3600 ? { kind: 'free' } : { kind: 'passing', next: p, left: p.start * 60 - sec };
  }
  return { kind: 'free' };
}

export function useSchedule() {
  const [s, setS] = useState<Schedule>(EMPTY);
  useEffect(() => { fsx.readText(PATH).then((t) => { if (t) try { setS({ ...EMPTY, ...JSON.parse(t) }); } catch {} }); }, []);
  const save = useCallback((next: Schedule) => { setS(next); fsx.writeText(PATH, JSON.stringify(next)).catch(() => {}); }, []);
  return { s, save };
}
