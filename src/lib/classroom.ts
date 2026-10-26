// Google Classroom, read-only: your classes and your own assignments, nothing
// else. Sign-in goes through the quill-study backend (it holds the Google
// client secret); the refresh token stays in the iPad's keychain.
import * as SecureStore from 'expo-secure-store';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { APP_TOKEN } from './ai';
import { fsx } from './fsx';

const BACKEND = 'https://quill-study.pages.dev';
const RETURN = 'inkpad://classroom';
const API = 'https://classroom.googleapis.com/v1';
const CACHE = 'inkpad/classroom.json';

export type Status = 'todo' | 'missing' | 'done';
export type Assignment = {
  id: string; courseId: string; course: string; title: string; description?: string;
  due?: number; points?: number; link: string; status: Status; grade?: number; type: string;
};
export type ClassroomData = { email: string; fetched: number; courses: { id: string; name: string; section?: string }[]; items: Assignment[] };

let access: { at: string; exp: number } | null = null;

const kv = {
  get: async (k: string) => (Platform.OS === 'web' ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k)),
  set: async (k: string, v: string) => (Platform.OS === 'web' ? globalThis.localStorage?.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async (k: string) => (Platform.OS === 'web' ? globalThis.localStorage?.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

export async function isConfigured(): Promise<boolean> {
  try { const r = await fetch(`${BACKEND}/api/google/refresh`); return !!(await r.json()).configured; } catch { return false; }
}

export const connectedEmail = () => kv.get('gc.email');

/** Opens Google's sign-in in a secure sheet; resolves with the account email. */
export async function connect(): Promise<string> {
  const r = await WebBrowser.openAuthSessionAsync(`${BACKEND}/auth/google/start`, RETURN);
  if (r.type !== 'success' || !r.url) throw new Error('cancelled');
  const q = new URL(r.url.replace(/^inkpad:\/\//, 'https://x/')).searchParams;
  if (q.get('error')) throw new Error(q.get('error')!);
  const at = q.get('at'), rt = q.get('rt'), exp = Number(q.get('exp')) || Date.now() + 3000_000;
  if (!at) throw new Error("Google didn't finish signing in. Try again.");
  access = { at, exp };
  if (rt) await kv.set('gc.rt', rt);
  const email = q.get('email') || 'Google account';
  await kv.set('gc.email', email);
  return email;
}

export async function disconnect() {
  const rt = await kv.get('gc.rt');
  access = null;
  await kv.del('gc.rt');
  await kv.del('gc.email');
  await fsx.remove(CACHE);
  if (rt) fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(rt)}`, { method: 'POST' }).catch(() => {});
}

async function token(): Promise<string> {
  if (access && access.exp - Date.now() > 60_000) return access.at;
  const rt = await kv.get('gc.rt');
  if (!rt) throw Object.assign(new Error('Connect your Google account.'), { relogin: true });
  const r = await fetch(`${BACKEND}/api/google/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-quill-app': APP_TOKEN }, body: JSON.stringify({ rt }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.at) throw Object.assign(new Error(d.error || 'Google did not answer.'), { relogin: !!d.relogin });
  access = { at: d.at, exp: d.exp };
  return d.at;
}

async function get(path: string): Promise<any> {
  const r = await fetch(API + path, { headers: { authorization: `Bearer ${await token()}` } });
  if (r.status === 401) { access = null; throw Object.assign(new Error('Your Google sign-in expired. Connect again.'), { relogin: true }); }
  if (r.status === 403) {
    const d = await r.json().catch(() => ({}));
    throw new Error(/admin|domain|disabled/i.test(JSON.stringify(d)) ? "Your school's Google admin doesn't allow apps to read Classroom." : 'Google said Quill is not allowed to read Classroom.');
  }
  if (!r.ok) throw new Error(`Classroom didn't answer (${r.status}).`);
  return r.json();
}

const dueOf = (w: any): number | undefined => {
  if (!w.dueDate) return undefined;
  const { year, month, day } = w.dueDate;
  const h = w.dueTime?.hours ?? 23, m = w.dueTime?.minutes ?? 59;
  return Date.UTC(year, month - 1, day, h, m);
};

/** Every active class and its assignments with your status (to do / missing / done). */
export async function fetchAssignments(): Promise<ClassroomData> {
  const email = (await kv.get('gc.email')) || '';
  const cr = await get('/courses?studentId=me&courseStates=ACTIVE&pageSize=50');
  const courses = (cr.courses ?? []).map((c: any) => ({ id: c.id, name: c.name, section: c.section }));
  const items: Assignment[] = [];
  await Promise.all(courses.map(async (c: { id: string; name: string }) => {
    try {
      const [cw, subs] = await Promise.all([
        get(`/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&orderBy=updateTime%20desc&pageSize=60`),
        get(`/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=200`),
      ]);
      const byWork = new Map<string, any>((subs.studentSubmissions ?? []).map((s: any) => [s.courseWorkId, s]));
      for (const w of cw.courseWork ?? []) {
        const s = byWork.get(w.id);
        const due = dueOf(w);
        const done = s && (s.state === 'TURNED_IN' || s.state === 'RETURNED');
        const status: Status = done ? 'done' : (s?.late || (due != null && due < Date.now())) ? 'missing' : 'todo';
        items.push({
          id: w.id, courseId: c.id, course: c.name, title: w.title || 'Untitled', description: w.description,
          due, points: w.maxPoints, link: s?.alternateLink || w.alternateLink, status, grade: s?.assignedGrade, type: w.workType || 'ASSIGNMENT',
        });
      }
    } catch (e) { if ((e as any)?.relogin) throw e; }
  }));
  const data: ClassroomData = { email, fetched: Date.now(), courses, items };
  fsx.writeText(CACHE, JSON.stringify(data)).catch(() => {});
  return data;
}

export async function cached(): Promise<ClassroomData | null> {
  try { const s = await fsx.readText(CACHE); return s ? JSON.parse(s) : null; } catch { return null; }
}

/** Works with any account (even when a school blocks outside apps): Classroom's
 * own website, straight to your assignments list, signed in the normal way. */
export const openWebsite = (which: Status = 'todo') => WebBrowser.openBrowserAsync(
  `https://classroom.google.com/a/${which === 'done' ? 'turned-in' : which === 'missing' ? 'missing' : 'not-turned-in'}/all`,
  { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, dismissButtonStyle: 'done' },
);

/** Opens the assignment in Google's own page (in-app Safari sheet) to read or turn it in. */
export const openAssignment = (a: Assignment) => WebBrowser.openBrowserAsync(a.link, { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET });
