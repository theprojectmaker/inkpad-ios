// iCloud sync: every note goes up to iCloud after it changes, and notes changed on another iPad
// (or after reinstalling) come down. Runs at launch, on coming back to the app, and a few seconds
// after the library changes. The newest change to each note wins.
import { requireNativeModule } from 'expo-modules-core';
import { useSyncExternalStore } from 'react';

import { fsx } from './fsx';
import { mergeLibraries, notesToMove } from './icloud-merge';
import type { Library } from './model';

type Native = {
  icloudStatus(): Promise<string>;
  icloudPushDir(rel: string, cloudRel: string): Promise<number>;
  icloudPullDir(cloudRel: string, rel: string): Promise<number>;
  icloudReadText(cloudRel: string): Promise<string | null>;
  icloudWriteText(cloudRel: string, text: string): Promise<boolean>;
  icloudRemove(cloudRel: string): Promise<void>;
};
let native: Native | null = null;
try { native = requireNativeModule<Native>('QuillCanvas'); } catch { native = null; }

export type CloudStatus = 'on' | 'signed-out' | 'unavailable' | 'checking';
type State = { status: CloudStatus; busy: boolean; at: number; error?: string; moved?: number };
let state: State = { status: 'checking', busy: false, at: 0 };
const listeners = new Set<() => void>();
const set = (s: Partial<State>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
export const useCloud = () => useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => state, () => state);

export async function checkCloud(): Promise<CloudStatus> {
  let s: CloudStatus = 'unavailable';
  try { if (native?.icloudStatus) s = (await native.icloudStatus()) as CloudStatus; } catch {}
  set({ status: s });
  return s;
}

let openNote: string | null = null;
/** The note on screen is never replaced underneath you; it's brought down after you leave it. */
export const setOpenNote = (id: string | null) => { openNote = id; };

let running: Promise<void> | null = null;

/**
 * Puts this iPad's library and iCloud's together. `current` is read at the end too, so nothing done
 * meanwhile is lost; `adopt` replaces the library without marking anything as changed.
 */
export function syncNow(current: () => Library, adopt: (l: Library) => void): Promise<void> {
  if (running) return running;
  running = (async () => {
    if ((await checkCloud()) !== 'on' || !native) return;
    set({ busy: true, error: undefined });
    try {
      let theirs: Library | null = null;
      const text = await native.icloudReadText('library.json');
      if (text) { try { theirs = JSON.parse(text) as Library; } catch { theirs = null; } }
      const mine = current();
      const merged = mergeLibraries(mine, theirs);
      const { up, down } = notesToMove(mine.notes, theirs?.notes ?? [], merged.notes);
      let moved = 0;
      // Files first, then the list: another iPad never sees a note before its pages.
      for (const id of up) { const n = await native.icloudPushDir(`inkpad/n/${id}`, `n/${id}`); if (n > 0) moved += n; }
      const brought: string[] = [];
      for (const id of down) {
        if (id === openNote) continue;
        const n = await native.icloudPullDir(`n/${id}`, `inkpad/n/${id}`);
        // Only counts once its pages are really here.
        if (n >= 0 && fsx.exists(`inkpad/n/${id}/note.json`)) { brought.push(id); moved += n; }
      }
      // iCloud keeps the newest of everything. This iPad lists a note only once its pages are here:
      // one that couldn't come down yet (or is open) keeps this iPad's details until next time.
      const now = current();
      const best = mergeLibraries(now, merged);
      const failed = new Set(down.filter((id) => !brought.includes(id)));
      const mineNow = new Map(now.notes.map((n) => [n.id, n] as const));
      const result: Library = { ...best, notes: best.notes.flatMap((n) => (!failed.has(n.id) ? [n] : mineNow.has(n.id) ? [mineNow.get(n.id)!] : [])) };
      if (JSON.stringify(result) !== JSON.stringify(now)) adopt(result);
      const out = JSON.stringify(best);
      if (out !== text) await native.icloudWriteText('library.json', out);
      // Deleted notes leave iCloud too.
      for (const id of Object.keys(result.gone ?? {})) if (theirs?.notes.some((n) => n.id === id)) await native.icloudRemove(`n/${id}`);
      set({ at: Date.now(), moved });
    } catch (e) {
      set({ error: String((e as Error)?.message ?? e) });
    } finally {
      set({ busy: false });
    }
  })().finally(() => { running = null; });
  return running;
}
