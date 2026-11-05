// The real Studento's school day: Great Neck North's bells, with this student's classes. A code
// links it. It keeps itself up to date from the Studento site when there's internet (class names,
// assemblies and other special days) and carries on from what it last saw when there isn't.

type Bell = [id: string, start: string, end: string];
export type StudentoPeriod = { id: string; name: string; start: number; end: number };
type CustomDay = { date: string; label: string; periods: { period: string; label?: string; start: string; end: string }[] };
export type StudentoData = { classes: Record<string, string>; custom: CustomDay[]; override: { date: string; type: string } | null };

const SITE = 'https://studento.greatneck.workers.dev';

const NUMS = (list: [string, string][], advisory?: [string, string]): Bell[] => [
  ...(advisory ? [['advisory', advisory[0], advisory[1]] as Bell] : []),
  ...list.map(([a, b], i) => [String(i + 1), a, b] as Bell),
];

const REGULAR = NUMS([['08:00', '08:41'], ['08:44', '09:25'], ['09:28', '10:09'], ['10:12', '10:53'], ['10:56', '11:37'], ['11:40', '12:21'], ['12:24', '13:05'], ['13:08', '13:49'], ['13:52', '14:33']]);
const WEDNESDAY = NUMS([['08:36', '09:13'], ['09:16', '09:53'], ['09:56', '10:33'], ['10:36', '11:13'], ['11:16', '11:53'], ['11:56', '12:33'], ['12:36', '13:13'], ['13:16', '13:53'], ['13:56', '14:33']], ['08:00', '08:33']);
// On these two, one period is split around the assembly, so an id can appear twice.
const ASSEMBLY: Bell[] = [['1', '08:00', '08:36'], ['2', '08:39', '09:15'], ['3', '09:18', '09:57'], ['3', '10:00', '10:39'], ['4', '10:42', '11:18'], ['5', '11:21', '11:57'], ['6', '12:00', '12:36'], ['7', '12:39', '13:15'], ['8', '13:18', '13:54'], ['9', '13:57', '14:33']];
const CUSTOM: Bell[] = [['advisory', '08:00', '08:30'], ['1', '08:33', '09:05'], ['2', '09:08', '09:40'], ['3', '09:43', '10:15'], ['4', '10:18', '10:54'], ['5', '10:57', '11:33'], ['6', '11:36', '12:12'], ['7', '12:15', '12:51'], ['8', '12:54', '13:24'], ['8', '13:27', '13:57'], ['9', '14:00', '14:33']];

export const STUDENTO_START: StudentoData = {
  classes: { 1: 'Intro to business', 2: 'English', 3: 'Biology', 4: 'Gym/biology lab', 5: 'Lunch', 6: 'Health', 7: 'Hebrew', 8: 'Social studies', 9: 'Geometry', advisory: 'Advisory' },
  custom: [],
  override: null,
};

const mins = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
const pad = (n: number) => String(n).padStart(2, '0');
export const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** What's on for a day. No periods means no school. */
export function studentoDay(data: StudentoData, d: Date): { kind: string; periods: StudentoPeriod[] } {
  const named = (id: string, label?: string) => data.classes[id]?.replace(/\s+/g, ' ').trim() || label || (id === 'advisory' ? 'Advisory' : `Period ${id}`);
  const fromBells = (kind: string, bells: Bell[]) => ({
    kind,
    periods: bells.map(([id, a, b], i) => ({ id: `${id}-${i}`, name: named(id), start: mins(a), end: mins(b) })),
  });
  const key = dateKey(d);
  // A dated special day wins, then today's switch, then the weekday (same order as Studento).
  const special = data.custom.find((x) => x.date === key);
  if (special?.periods.length) {
    const periods = special.periods.map((p, i) => ({ id: `${p.period}-${i}`, name: named(p.period, p.label), start: mins(p.start), end: mins(p.end) }));
    return { kind: special.label || 'Special schedule', periods: periods.sort((a, b) => a.start - b.start) };
  }
  const day = d.getDay();
  if (day === 0 || day === 6) return { kind: 'Weekend', periods: [] };
  if (data.override?.date === key) {
    if (data.override.type === 'assembly') return fromBells('Assembly schedule', ASSEMBLY);
    if (data.override.type === 'custom') return fromBells('Special schedule', CUSTOM);
  }
  return day === 3 ? fromBells('Wednesday advisory', WEDNESDAY) : fromBells('Regular schedule', REGULAR);
}

async function get(path: string) {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), 7000);
  try {
    const r = await fetch(SITE + path, { signal: c.signal, cache: 'no-store' });
    if (!r.ok) throw new Error(String(r.status));
    return await r.json();
  } finally { clearTimeout(t); }
}

/** The latest from the Studento site, or what we had if it can't be reached. Each part stands alone. */
export async function refreshStudento(had: StudentoData, today = new Date()): Promise<StudentoData> {
  const [classes, custom, override] = await Promise.allSettled([get('/api/classes'), get('/api/custom-schedules'), get('/api/override')]);
  const next: StudentoData = { ...had };
  if (classes.status === 'fulfilled' && classes.value && typeof classes.value === 'object') next.classes = { ...had.classes, ...classes.value };
  if (custom.status === 'fulfilled' && Array.isArray(custom.value?.upcoming)) next.custom = custom.value.upcoming;
  if (override.status === 'fulfilled') next.override = override.value?.type ? { date: dateKey(today), type: override.value.type } : null;
  return next;
}
