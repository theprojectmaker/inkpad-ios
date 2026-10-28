// Google Classroom: your classes, your assignments and the teacher's worksheets
// (read-only). Sign-in goes through the quill-study backend (it holds the Google
// client secret); the refresh token stays in the iPad's keychain.
// Google lets no outside app press "Turn in", so handing in = the note as a PDF
// through the share sheet (Classroom app) - see handIn().
import * as SecureStore from 'expo-secure-store';
import * as Sharing from 'expo-sharing';
import * as WebBrowser from 'expo-web-browser';
import { Platform } from 'react-native';

import { APP_TOKEN } from './ai';
import { fsx } from './fsx';
import type { Homework } from './model';

const BACKEND = 'https://quill-study.pages.dev';
const RETURN = 'inkpad://classroom';
const API = 'https://classroom.googleapis.com/v1';
const DRIVE = 'https://www.googleapis.com/drive/v3';
const CACHE = 'inkpad/classroom.json';

export type Status = 'todo' | 'missing' | 'done';
export type Material = { kind: 'drive' | 'link' | 'video' | 'form'; title: string; url: string; fileId?: string; thumb?: string };
export type Assignment = {
  id: string; courseId: string; course: string; title: string; description?: string;
  due?: number; points?: number; link: string; status: Status; grade?: number; type: string;
  materials?: Material[];
  topicId?: string; posted?: number;
  state?: string;          // Google's submission state (NEW, CREATED, TURNED_IN, RETURNED, RECLAIMED_BY_STUDENT)
  yours?: Material[];      // files already attached to your work
};
export type Topic = { id: string; name: string };
/** A teacher's post on the class Stream. */
export type Post = { id: string; text: string; posted: number; materials: Material[]; link: string };
/** Classwork that isn't an assignment (a handout, notes, slides). */
export type ClassMaterial = { id: string; courseId: string; title: string; description?: string; topicId?: string; posted: number; materials: Material[]; link: string };
export type CourseDetail = { topics: Topic[]; posts: Post[]; materials: ClassMaterial[] };
export type Course = { id: string; name: string; section?: string; room?: string; link?: string };
export type ClassroomData = { email: string; fetched: number; courses: Course[]; items: Assignment[] };

export const keyOf = (a: { courseId: string; id: string }) => `${a.courseId}:${a.id}`;
export const homeworkOf = (a: Assignment): Homework => ({ key: keyOf(a), courseId: a.courseId, id: a.id, course: a.course, title: a.title, link: a.link, due: a.due });

let access: { at: string; exp: number } | null = null;

const kv = {
  get: async (k: string) => (Platform.OS === 'web' ? globalThis.localStorage?.getItem(k) ?? null : SecureStore.getItemAsync(k)),
  set: async (k: string, v: string) => (Platform.OS === 'web' ? globalThis.localStorage?.setItem(k, v) : SecureStore.setItemAsync(k, v)),
  del: async (k: string) => (Platform.OS === 'web' ? globalThis.localStorage?.removeItem(k) : SecureStore.deleteItemAsync(k)),
};

/** Is Classroom switched on? null = can't tell right now (offline): don't treat that as "no". */
export async function isConfigured(): Promise<boolean | null> {
  try {
    const c = new AbortController();
    const tm = setTimeout(() => c.abort(), 6000);
    const r = await fetch(`${BACKEND}/api/google/refresh`, { signal: c.signal });
    clearTimeout(tm);
    return !!(await r.json()).configured;
  } catch { return null; }
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

let refreshing: Promise<string> | null = null;
/** A fresh Google access token (signs in again only when Google says so). Callers share one refresh. */
export async function token(): Promise<string> {
  if (access && access.exp - Date.now() > 60_000) return access.at;
  if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
  return refreshing;
}
async function refresh(): Promise<string> {
  const rt = await kv.get('gc.rt');
  if (!rt) throw Object.assign(new Error('Connect your Google account.'), { relogin: true });
  const r = await fetch(`${BACKEND}/api/google/refresh`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-quill-app': APP_TOKEN }, body: JSON.stringify({ rt }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.at) throw Object.assign(new Error(d.error || 'Google did not answer.'), { relogin: !!d.relogin });
  access = { at: d.at, exp: d.exp };
  return d.at;
}

async function call(url: string, retried = false): Promise<Response> {
  const r = await fetch(url, { headers: { authorization: `Bearer ${await token()}` } });
  if (r.status === 401) {
    access = null;
    if (!retried) return call(url, true);       // the access token ran out: get a new one and try once more
    throw Object.assign(new Error('Your Google sign-in expired. Connect again.'), { relogin: true });
  }
  if (r.status === 403) {
    const d = await r.json().catch(() => ({}));
    const s = JSON.stringify(d);
    if (/insufficient|scope/i.test(s)) throw Object.assign(new Error('Quill needs one more permission. Connect again.'), { relogin: true });
    throw Object.assign(new Error(/admin|domain|disabled/i.test(s) ? "Your school's Google admin hasn't allowed Quill yet." : "Google said Quill can't open that."), { status: 403 });
  }
  if (!r.ok) throw Object.assign(new Error(`Google didn't answer (${r.status}).`), { status: r.status });
  return r;
}
const get = async (path: string): Promise<any> => (await call(API + path)).json();

/** Every page of a list (Classroom sends 50-200 at a time). */
async function getAll(path: string, key: string, max = 8): Promise<any[]> {
  const out: any[] = [];
  let tok = '';
  for (let i = 0; i < max; i++) {
    const d = await get(path + (tok ? `&pageToken=${encodeURIComponent(tok)}` : ''));
    out.push(...(d[key] ?? []));
    tok = d.nextPageToken;
    if (!tok) break;
  }
  return out;
}

/** Only "not allowed / not there" means empty; offline or a Google hiccup must not wipe saved data. */
const skippable = (e: any) => e?.status === 403 || e?.status === 404;

const dueOf = (w: any): number | undefined => {
  if (!w.dueDate) return undefined;
  const { year, month, day } = w.dueDate;
  // Google leaves out zero fields: {} is midnight UTC; no dueTime at all means the end of the day.
  const h = w.dueTime ? w.dueTime.hours ?? 0 : 23, m = w.dueTime ? w.dueTime.minutes ?? 0 : 59;
  return Date.UTC(year, month - 1, day, h, m);
};

const materialsOf = (list: any[] | undefined): Material[] => (list ?? []).map((m: any): Material | null => {
  if (m.driveFile?.driveFile) { const f = m.driveFile.driveFile; return { kind: 'drive', title: f.title || 'File', url: f.alternateLink, fileId: f.id, thumb: f.thumbnailUrl }; }
  if (m.link) return { kind: 'link', title: m.link.title || m.link.url, url: m.link.url, thumb: m.link.thumbnailUrl };
  if (m.youtubeVideo) return { kind: 'video', title: m.youtubeVideo.title || 'Video', url: m.youtubeVideo.alternateLink, thumb: m.youtubeVideo.thumbnailUrl };
  if (m.form) return { kind: 'form', title: m.form.title || 'Google Form', url: m.form.formUrl };
  return null;
}).filter(Boolean) as Material[];

/** Every active class and its assignments with your status (to do / missing / done). */
export async function fetchAssignments(): Promise<ClassroomData> {
  const email = (await kv.get('gc.email')) || '';
  const cr = { courses: await getAll('/courses?studentId=me&courseStates=ACTIVE&pageSize=50', 'courses', 4) };
  const courses: Course[] = (cr.courses ?? []).map((c: any) => ({ id: c.id, name: c.name, section: c.section, room: c.room, link: c.alternateLink }));
  const items: Assignment[] = [];
  await Promise.all(courses.map(async (c) => {
    try {
      const [cwList, subList] = await Promise.all([
        getAll(`/courses/${c.id}/courseWork?courseWorkStates=PUBLISHED&orderBy=updateTime%20desc&pageSize=100`, 'courseWork'),
        getAll(`/courses/${c.id}/courseWork/-/studentSubmissions?userId=me&pageSize=200`, 'studentSubmissions'),
      ]);
      const cw = { courseWork: cwList }, subs = { studentSubmissions: subList };
      const byWork = new Map<string, any>((subs.studentSubmissions ?? []).map((s: any) => [s.courseWorkId, s]));
      for (const w of cw.courseWork ?? []) {
        const s = byWork.get(w.id);
        const due = dueOf(w);
        const done = s && (s.state === 'TURNED_IN' || s.state === 'RETURNED');
        const status: Status = done ? 'done' : (s?.late || (due != null && due < Date.now())) ? 'missing' : 'todo';
        items.push({
          id: w.id, courseId: c.id, course: c.name, title: w.title || 'Untitled', description: w.description,
          due, points: w.maxPoints, link: s?.alternateLink || w.alternateLink, status, grade: s?.assignedGrade, type: w.workType || 'ASSIGNMENT',
          materials: materialsOf(w.materials), topicId: w.topicId, posted: Date.parse(w.creationTime) || undefined,
          state: s?.state, yours: materialsOf(s?.assignmentSubmission?.attachments),
        });
      }
    } catch (e) { if ((e as any)?.relogin || !skippable(e)) throw e; }
  }));
  const data: ClassroomData = { email, fetched: Date.now(), courses, items };
  fsx.writeText(CACHE, JSON.stringify(data)).catch(() => {});
  return data;
}

/** A class's Stream, topics and class materials (fetched when you open the class). */
export async function fetchCourse(courseId: string): Promise<CourseDetail> {
  const safe = async (path: string, key: string, max: number) => { try { return await getAll(path, key, max); } catch (e) { if (skippable(e)) return []; throw e; } };
  const [topics, posts, mats] = await Promise.all([
    safe(`/courses/${courseId}/topics?pageSize=50`, 'topic', 4),
    safe(`/courses/${courseId}/announcements?announcementStates=PUBLISHED&orderBy=updateTime%20desc&pageSize=30`, 'announcements', 1),
    safe(`/courses/${courseId}/courseWorkMaterials?courseWorkMaterialStates=PUBLISHED&pageSize=60`, 'courseWorkMaterial', 4),
  ]);
  const d: CourseDetail = {
    topics: topics.map((x: any) => ({ id: x.topicId, name: x.name })),
    posts: posts.map((x: any) => ({ id: x.id, text: x.text || '', posted: Date.parse(x.creationTime) || 0, materials: materialsOf(x.materials), link: x.alternateLink })),
    materials: mats.map((x: any) => ({ id: x.id, courseId, title: x.title || 'Material', description: x.description, topicId: x.topicId, posted: Date.parse(x.creationTime) || 0, materials: materialsOf(x.materials), link: x.alternateLink })),
  };
  fsx.writeText(`inkpad/classroom-${courseId}.json`, JSON.stringify(d)).catch(() => {});
  return d;
}

export async function cachedCourse(courseId: string): Promise<CourseDetail | null> {
  try { const s = await fsx.readText(`inkpad/classroom-${courseId}.json`); return s ? JSON.parse(s) : null; } catch { return null; }
}

const thumbs = new Map<string, { link: string; at: number }>();
/** A preview picture of a Drive file (Google makes it; it needs the sign-in to load). Never caches a failure. */
export async function driveThumb(fileId: string): Promise<{ uri: string; headers: Record<string, string> } | null> {
  try {
    let t = thumbs.get(fileId);
    if (!t || Date.now() - t.at > 45 * 60_000) {      // Google's picture links only last a while
      const m = await (await call(`${DRIVE}/files/${fileId}?fields=thumbnailLink&supportsAllDrives=true`)).json();
      if (!m.thumbnailLink) return null;
      t = { link: String(m.thumbnailLink).replace(/=s\d+$/, '=s640'), at: Date.now() };
      thumbs.set(fileId, t);
    }
    return { uri: t.link, headers: { authorization: `Bearer ${await token()}` } };
  } catch { return null; }
}

export async function cached(): Promise<ClassroomData | null> {
  try { const s = await fsx.readText(CACHE); return s ? JSON.parse(s) : null; } catch { return null; }
}

/**
 * Downloads a Drive worksheet into the app: Google Docs/Slides/Sheets come out
 * as PDFs, PDFs and photos as they are. Resolves with a file:// uri and its kind.
 */
export async function downloadMaterial(m: Material): Promise<{ uri: string; kind: 'pdf' | 'image'; title: string }> {
  if (!m.fileId) throw new Error('This one is a link. Tap it to open it.');
  const meta = await (await call(`${DRIVE}/files/${m.fileId}?fields=mimeType,name&supportsAllDrives=true`)).json();
  const mime: string = meta.mimeType || '';
  let url: string, kind: 'pdf' | 'image', ext: string;
  if (mime.startsWith('application/vnd.google-apps.')) {
    if (/folder|form|site|map|shortcut/.test(mime)) throw new Error("This can't open as pages. Tap it to view it.");
    url = `${DRIVE}/files/${m.fileId}/export?mimeType=application/pdf`; kind = 'pdf'; ext = 'pdf';
  } else if (mime === 'application/pdf') {
    url = `${DRIVE}/files/${m.fileId}?alt=media&supportsAllDrives=true`; kind = 'pdf'; ext = 'pdf';
  } else if (mime.startsWith('image/')) {
    url = `${DRIVE}/files/${m.fileId}?alt=media&supportsAllDrives=true`; kind = 'image'; ext = mime.split('/')[1].replace('jpeg', 'jpg');
  } else throw new Error("Quill can open PDFs, Google Docs and photos. Tap it to view this one.");
  const bytes = new Uint8Array(await (await call(url)).arrayBuffer());
  const path = `inkpad/tmp/cls_${m.fileId}.${ext}`;
  await fsx.writeBytes(path, bytes);
  return { uri: fsx.uri(path), kind, title: (meta.name || m.title).replace(/\.[a-z0-9]{2,4}$/i, '') };
}

/**
 * Hands work in: the note's PDF goes to the iOS share sheet, where "Classroom"
 * attaches it to the assignment (Google only lets its own app press Turn in).
 */
export async function handIn(pdfPath: string, title: string) {
  if (Platform.OS === 'web') throw new Error('Hand in works on the iPad.');
  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this device.');
  await Sharing.shareAsync(fsx.uri(pdfPath), { mimeType: 'application/pdf', UTI: 'com.adobe.pdf', dialogTitle: `Hand in: ${title}` });
}

const sheet = { presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET, dismissButtonStyle: 'done' as const };

/** Works with any account (even when a school blocks outside apps): Classroom's
 * own website, straight to your assignments list, signed in the normal way. */
export const openWebsite = (which: Status = 'todo') => WebBrowser.openBrowserAsync(
  `https://classroom.google.com/a/${which === 'done' ? 'turned-in' : which === 'missing' ? 'missing' : 'not-turned-in'}/all`, sheet);

/** Opens a page in Google's own site (in-app Safari sheet): an assignment, a material, a class. */
export const openLink = (url: string) => WebBrowser.openBrowserAsync(url, sheet);
export const openAssignment = (a: { link: string }) => openLink(a.link);

export const dueLabel = (due?: number) => {
  if (due == null) return 'No due date';
  const d = new Date(due), now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diff = Math.round((day(d) - day(now)) / 86400000);
  const time = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  if (diff === 0) return `Due today, ${time}`;
  if (diff === 1) return `Due tomorrow, ${time}`;
  if (diff === -1) return 'Was due yesterday';
  if (diff > 1 && diff < 7) return `Due ${d.toLocaleDateString([], { weekday: 'long' })}, ${time}`;
  return `${diff < 0 ? 'Was due' : 'Due'} ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
};

// Class banner colours, like Classroom's (all dark enough for white text).
const CLASS_COLORS = ['#1967D2', '#137333', '#E37400', '#A142F4', '#D93025', '#129EAF', '#B80672', '#4285F4', '#0B8043'];
export const courseColor = (id: string) => CLASS_COLORS[Math.abs([...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)) % CLASS_COLORS.length];
