// The library: subjects (folders) and the list of notes. The list is a small
// JSON index so the library opens instantly; each note's pages load on open.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { fsx } from './fsx';
import { emptyNote, FOLDER_COLORS, type Folder, type Library, type NoteDoc, type NoteKind, type NoteMeta, type Page, type PaperColor, type PaperStyle, uid } from './model';
import { deleteNoteFiles, duplicateDoc, LIB_PATH, loadDoc, saveDoc } from './noteio';

type Ctx = {
  lib: Library;
  ready: boolean;
  addFolder: (name: string, color?: string) => string;
  updateFolder: (id: string, patch: Partial<Folder>) => void;
  removeFolder: (id: string) => void;
  createNote: (opts: { folderId: string | null; title?: string; kind: NoteKind; paper?: { style: PaperStyle; color: PaperColor }; pages?: Page[]; id?: string }) => Promise<string>;
  updateNote: (id: string, patch: Partial<NoteMeta>) => void;
  removeNote: (id: string) => Promise<void>;
  duplicateNote: (id: string) => Promise<string | null>;
  meta: (id: string) => NoteMeta | undefined;
};

const EMPTY: Library = { v: 1, folders: [], notes: [] };
const LibCtx = createContext<Ctx | null>(null);

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [lib, setLib] = useState<Library>(EMPTY);
  const [ready, setReady] = useState(false);
  const libRef = useRef(lib);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const s = await fsx.readText(LIB_PATH);
        if (s) {
          const l = JSON.parse(s) as Library;
          if (l && Array.isArray(l.notes) && Array.isArray(l.folders)) { libRef.current = l; setLib(l); }
        } else {
          // First run: a couple of starter subjects.
          const now = Date.now();
          const l: Library = { v: 1, notes: [], folders: [
            { id: uid('f'), name: 'School', color: FOLDER_COLORS[5], created: now },
            { id: uid('f'), name: 'Personal', color: FOLDER_COLORS[3], created: now + 1 },
          ] };
          libRef.current = l; setLib(l);
          await fsx.writeText(LIB_PATH, JSON.stringify(l));
        }
      } catch {}
      setReady(true);
    })();
  }, []);

  const commit = useCallback((fn: (l: Library) => Library) => {
    const next = fn(libRef.current);
    libRef.current = next;
    setLib(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { fsx.writeText(LIB_PATH, JSON.stringify(libRef.current)).catch(() => {}); }, 250);
  }, []);

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
    const doc: NoteDoc = o.pages?.length ? { v: 1, id, paper, pages: o.pages } : emptyNote(id, paper.style, paper.color);
    await saveDoc(doc);
    const now = Date.now();
    const count = libRef.current.notes.filter((n) => n.title.startsWith('Note ')).length;
    const meta: NoteMeta = { id, title: o.title?.trim() || `Note ${count + 1}`, folderId: o.folderId, created: now, updated: now, opened: now, pages: doc.pages.length, kind: o.kind };
    commit((l) => ({ ...l, notes: [meta, ...l.notes] }));
    return id;
  }, [commit]);

  const updateNote = useCallback((id: string, patch: Partial<NoteMeta>) => {
    commit((l) => ({ ...l, notes: l.notes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }));
  }, [commit]);

  const removeNote = useCallback(async (id: string) => {
    commit((l) => ({ ...l, notes: l.notes.filter((n) => n.id !== id) }));
    await deleteNoteFiles(id);
  }, [commit]);

  const duplicateNote = useCallback(async (id: string) => {
    const doc = await loadDoc(id);
    const m = libRef.current.notes.find((n) => n.id === id);
    if (!doc || !m) return null;
    const nid = uid('n');
    await duplicateDoc(doc, nid);
    const now = Date.now();
    // The thumbnail is regenerated the next time the copy is opened.
    commit((l) => ({ ...l, notes: [{ ...m, id: nid, title: m.title + ' copy', created: now, updated: now, thumb: undefined, fav: false }, ...l.notes] }));
    return nid;
  }, [commit]);

  const meta = useCallback((id: string) => libRef.current.notes.find((n) => n.id === id), []);

  const v = useMemo(() => ({ lib, ready, addFolder, updateFolder, removeFolder, createNote, updateNote, removeNote, duplicateNote, meta }),
    [lib, ready, addFolder, updateFolder, removeFolder, createNote, updateNote, removeNote, duplicateNote, meta]);
  return <LibCtx.Provider value={v}>{children}</LibCtx.Provider>;
}

export function useLibrary() {
  const c = useContext(LibCtx);
  if (!c) throw new Error('LibraryProvider missing');
  return c;
}
