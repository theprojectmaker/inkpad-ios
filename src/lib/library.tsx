// The library: subjects (folders) and the list of notes. The list is a small
// JSON index so the library opens instantly; each note's pages load on open.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { fsx } from './fsx';
import { emptyNote, FOLDER_COLORS, type Folder, type Library, type NoteDoc, type NoteKind, type NoteMeta, type Page, type PageSizeId, type PaperColor, type PaperStyle, uid } from './model';
import { deleteNoteFiles, duplicateDoc, LIB_PATH, loadDoc, saveDoc } from './noteio';

type Ctx = {
  lib: Library;
  ready: boolean;
  addFolder: (name: string, color?: string) => string;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  removeFolder: (id: string) => void;
  createNote: (opts: { folderId: string | null; title?: string; kind: NoteKind; paper?: { style: PaperStyle; color: PaperColor; size?: PageSizeId }; pages?: Page[]; id?: string }) => Promise<string>;
  updateNote: (id: string, patch: Partial<NoteMeta>) => void;
  removeNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<string | null>;
  meta: (id: string) => NoteMeta | undefined;
  /** Writes the library index now (instead of a moment later). */
  flush: () => Promise<void>;
};

const EMPTY: Library = { v: 1, folders: [], notes: [] };
const LibCtx = createContext<Ctx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<Library>(EMPTY);
  const [ready, setReady] = useState(false);
  const libRef = useRef(lib);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loaded = useRef(false);
  const early = useRef<((l: Library) => Library)[]>([]);   // changes made before the library finished loading

  useEffect(() => {
    (async () => {
      let l: Library | null = null;
      try {
        const s = await fsx.readText(LIB_PATH);
        if (s) {
          const p = JSON.parse(s) as Library;
          if (p && Array.isArray(p.notes) && Array.isArray(p.folders)) l = p;
        }
      } catch {}
      // No readable index: rebuild it from the notes on disk rather than starting empty
      // (a fresh install has none, and gets a couple of starter subjects).
      if (!l) l = await rebuild();
      for (const fn of early.current) l = fn(l);
      early.current = [];
      loaded.current = true;
      libRef.current = l; setLib(l);
      await fsx.writeText(LIB_PATH, JSON.stringify(l)).catch(() => {});
      setReady(true);
    })();
  }, []);

  const write = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (!loaded.current) return;
    await fsx.writeText(LIB_PATH, JSON.stringify(libRef.current)).catch(() => {});
  }, []);

  // Never lose the last change: save at once when the app goes to the background.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st !== 'active' && timer.current) write(); });
    return () => sub.remove();
  }, [write]);

  const commit = useCallback((fn: (l: Library) => Library) => {
    if (!loaded.current) early.current.push(fn);
    const next = fn(libRef.current);
    libRef.current = next;
    setLib(next);
    if (!loaded.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(write, 250);
  }, [write]);

  const addFolder = useCallback((name: string, color?: string) => {
    const id = uid('f');
    commit((l) => ({ ...l, folders: [...l.folders, { id, name: name.trim() || 'Untitled', color: color ?? FOLDER_COLORS[l.folders.length % FOLDER_COLORS.length], created: Date.now() }] }));
    return id;
  }, [commit]);

  const updateFolder = useCallback((id: string, patch: Partial<Folder>) => {
    commit((l) => ({ ...l, folders: l.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }));
  }, [commit]);

  const removeFolder = useCallback((id: string) => {
    // Notes in it are kept and become Unfiled.
    commit((l) => ({ ...l, folders: l.folders.filter((f) => f.id !== id), notes: l.notes.map((n) => (n.folderId === id ? { ...n, folderId: null } : n)) }));
  }, [commit]);

  const createNote: Ctx['createNote'] = useCallback(async (o) => {
    const id = o.id ?? uid('n');
    const paper = o.paper ?? { style: 'lined', color: 'white' };
    const doc: NoteDoc = o.pages?.length ? { v: 1, id, paper, pages: o.pages } : emptyNote(id, paper.style, paper.color, paper.size);
    await saveDoc(doc);
    const now = Date.now();
    const count = libRef.current.notes.filter((n) => n.title.startsWith('Note ')).length;
    const meta: NoteMeta = { id, title: o.title?.trim() || `Note ${count + 1}`, folderId: o.folderId, created: now, updated: now, opened: now, pages: doc.pages.length, kind: o.kind };
    commit((l) => ({ ...l, notes: [meta, ...l.notes] }));
    await write();
    return id;
  }, [commit]);

  const updateNote = useCallback((id: string, patch: Partial<NoteMeta>) => {
    commit((l) => ({ ...l, notes: l.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  }, [commit]);

  const removeNote = useCallback(async (id: string) => {
    commit((l) => ({ ...l, notes: l.notes.filter((n) => n.id !== id) }));
    await write();
    await deleteNoteFiles(id);
  }, [commit]);

  const duplicateNote = useCallback(async (id: string) => {
    const doc = await loadDoc(id);
    const m = libRef.current.notes.find((n) => n.id === id);
    if (!doc || !m) return null;
    const nid = uid('n');
    try { await duplicateDoc(doc, nid); }
    catch (e) { await deleteNoteFiles(nid); throw e; }
    const now = Date.now();
    // The thumbnail is regenerated the next time the copy is opened.
    commit((l) => ({ ...l, notes: [{ ...m, id: nid, title: m.title + ' copy', created: now, updated: now, thumb: undefined, fav: false }, ...l.notes] }));
    return nid;
  }, [commit]);

  const meta = useCallback((id: string) => libRef.current.notes.find((n) => n.id === id), []);

  const v = useMemo(() => ({ lib, ready, addFolder, updateFolder, removeFolder, createNote, updateNote, removeNote, duplicateNote, meta, flush: write }),
    [lib, ready, addFolder, updateFolder, removeFolder, createNote, updateNote, removeNote, duplicateNote, meta, write]);
  return <LibCtx.Provider value={v}>{children}</LibCtx.Provider>;
}

/** The index from the notes on disk (used if library.json is ever unreadable). */
async function rebuild(): Promise<Library> {
  const ids = fsx.list('inkpad/n');
  const now = Date.now();
  if (!ids.length) {
    return { v: 1, notes: [], folders: [
      { id: uid('f'), name: 'School', color: FOLDER_COLORS[5], created: now },
      { id: uid('f'), name: 'Personal', color: FOLDER_COLORS[3], created: now + 1 },
    ] };
  }
  const notes: NoteMeta[] = [];
  for (const id of ids) {
    const doc = await loadDoc(id).catch(() => null);
    if (!doc) continue;
    const kind: NoteKind = doc.pages.some((p) => p.bg.kind === 'pdf') ? 'pdf' : doc.pages.some((p) => p.bg.kind === 'image') ? 'image' : 'paper';
    notes.push({ id, title: 'Recovered note', folderId: null, created: now, updated: now, pages: doc.pages.length, kind });
  }
  return { v: 1, folders: [], notes };
}

export function useLibrary() {
  const c = useContext(LibCtx);
  if (!c) throw new Error('LibraryProvider missing');
  return c;
}
