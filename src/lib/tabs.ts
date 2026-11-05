// The notes open at the moment, so you can hop between them.
import { useSyncExternalStore } from 'react';

let ids: string[] = [];
const listeners = new Set<() => void>();
const set = (next: string[]) => { ids = next; listeners.forEach((l) => l()); };

export const openTab = (id: string) => { if (!ids.includes(id)) set([...ids, id].slice(-8)); };
export const closeTab = (id: string) => set(ids.filter((x) => x !== id));
export const closeOtherTabs = (id: string) => set(ids.filter((x) => x === id));

export function useTabs(): string[] {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => ids, () => ids);
}
