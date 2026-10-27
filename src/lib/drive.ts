// Saving notes to Google Drive: a "Quill" folder with one folder per subject.
// Each note is one PDF that gets replaced when you save again, so the copy in
// Drive (and on quill-study.pages.dev/notes) stays up to date. Quill can only
// see the files it made (drive.file), nothing else in your Drive.
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { connect, connectedEmail, token } from './classroom';
import { fsx } from './fsx';

const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDERS = 'inkpad/drive-folders.json';
export const NOTES_SITE = 'https://quill-study.pages.dev/notes';
const FOLDER = 'application/vnd.google-apps.folder';

let folders: Record<string, string> | null = null;

async function req(url: string, init: RequestInit = {}): Promise<any> {
  const r = await fetch(url, { ...init, headers: { authorization: `Bearer ${await token()}`, ...(init.body ? { 'content-type': 'application/json' } : {}), ...(init.headers ?? {}) } });
  if (r.status === 401 || r.status === 403) {
    const t = await r.text();
    throw Object.assign(new Error(/insufficient|scope/i.test(t) || r.status === 401 ? 'Quill needs permission to save to your Drive.' : "Google Drive didn't allow that."), { relogin: /insufficient|scope/i.test(t) || r.status === 401, status: r.status });
  }
  if (r.status === 404) throw Object.assign(new Error('Not found'), { status: 404 });
  if (!r.ok) throw new Error(`Google Drive didn't answer (${r.status}).`);
  return r.status === 204 ? null : r.json();
}

/** The id of a folder Quill made (made now if missing), cached on the iPad. */
async function folder(name: string, parent: string): Promise<string> {
  if (!folders) { try { folders = JSON.parse((await fsx.readText(FOLDERS)) || '{}'); } catch { folders = {}; } }
  const key = `${parent}/${name}`;
  const known = folders![key];
  if (known) {
    try { const f = await req(`${API}/files/${known}?fields=id,trashed`); if (!f.trashed) return known; } catch (e: any) { if (e?.status !== 404) throw e; }
  }
  const q = `name='${name.replace(/'/g, "\\'")}' and mimeType='${FOLDER}' and '${parent}' in parents and trashed=false`;
  const found = await req(`${API}/files?q=${encodeURIComponent(q)}&fields=files(id)&pageSize=1`);
  const id = found.files?.[0]?.id ?? (await req(`${API}/files?fields=id`, { method: 'POST', body: JSON.stringify({ name, mimeType: FOLDER, parents: [parent] }) })).id;
  folders![key] = id;
  fsx.writeText(FOLDERS, JSON.stringify(folders)).catch(() => {});
  return id;
}

/** Makes sure you're signed in to Google (opens Google's sign-in once if not). */
export async function ensureGoogle() {
  if (!(await connectedEmail())) await connect();
}

/**
 * Saves a note's PDF into Drive › Quill › <subject>. Pass the id from last time
 * to replace that copy. Resolves with the Drive file id.
 */
export async function saveToDrive(pdfPath: string, title: string, subject: string, existing?: string): Promise<string> {
  if (Platform.OS === 'web') throw new Error('Saving to Drive works on the iPad.');
  const run = async () => {
    const name = `${title}.pdf`;
    let id = existing;
    if (id) {
      try { await req(`${API}/files/${id}?fields=id`, { method: 'PATCH', body: JSON.stringify({ name, appProperties: { quill: '1', subject } }) }); }
      catch (e: any) { if (e?.status === 404) id = undefined; else throw e; }
    }
    if (!id) {
      const root = await folder('Quill', 'root');
      const dir = subject === 'Notes' ? root : await folder(subject, root);
      id = (await req(`${API}/files?fields=id`, { method: 'POST', body: JSON.stringify({ name, mimeType: 'application/pdf', parents: [dir], appProperties: { quill: '1', subject } }) })).id as string;
    }
    const res = await new File(fsx.uri(pdfPath)).upload(`${UPLOAD}/files/${id}?uploadType=media`, {
      httpMethod: 'PATCH', headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/pdf' },
    });
    if (res.status >= 300) throw new Error(`Google Drive didn't take the file (${res.status}).`);
    return id;
  };
  try { return await run(); }
  catch (e: any) {
    if (!e?.relogin) throw e;
    await connect();          // asks Google for the new permission, then tries once more
    return run();
  }
}
