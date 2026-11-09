// Putting two copies of the library together (this iPad's and the one in iCloud). Every note and
// folder carries `ts`, the last time anything about it changed; the newer one wins. Deleting
// something leaves its id in `gone` with the time, so it isn't brought back by an older copy.
// No React Native imports, so it can be tested with plain Node.

type Item = { id: string; ts?: number };
type Lib<N extends Item, F extends Item> = { notes: N[]; folders: F[]; gone?: Record<string, number> };

function mergeList<T extends Item>(mine: T[], theirs: T[], gone: Record<string, number>): T[] {
  const byId = new Map<string, T>();
  for (const x of theirs) byId.set(x.id, x);
  const out: T[] = [];
  const seen = new Set<string>();
  const pick = (a: T | undefined, b: T | undefined) => (!a ? b : !b ? a : (b.ts ?? 0) > (a.ts ?? 0) ? b : a);
  for (const m of mine) {
    const w = pick(m, byId.get(m.id))!;
    seen.add(m.id);
    if ((gone[m.id] ?? 0) > (w.ts ?? 0)) continue;
    out.push(w);
  }
  for (const t of theirs) {
    if (seen.has(t.id)) continue;
    if ((gone[t.id] ?? 0) > (t.ts ?? 0)) continue;
    out.push(t);
  }
  return out;
}

export function mergeLibraries<N extends Item, F extends Item, L extends Lib<N, F>>(mine: L, theirs: Lib<N, F> | null): L {
  if (!theirs) return mine;
  const gone: Record<string, number> = { ...(theirs.gone ?? {}) };
  for (const [k, v] of Object.entries(mine.gone ?? {})) gone[k] = Math.max(gone[k] ?? 0, v);
  // Forget deletions after 90 days.
  const old = Date.now() - 90 * 86400000;
  for (const k of Object.keys(gone)) if (gone[k] < old) delete gone[k];
  return { ...mine, gone, notes: mergeList(mine.notes, theirs.notes, gone), folders: mergeList(mine.folders, theirs.folders, gone) };
}

type Dated = { id: string; updated?: number; created?: number };
const when = (n: Dated | undefined) => (n ? n.updated ?? n.created ?? 0 : -1);

/** What has to move: notes whose writing is newer here (up) or newer in iCloud (down). */
export function notesToMove(mine: Dated[], theirs: Dated[], merged: Dated[]) {
  const a = new Map(mine.map((n) => [n.id, n]));
  const b = new Map(theirs.map((n) => [n.id, n]));
  const up: string[] = [], down: string[] = [];
  for (const n of merged) {
    const here = a.get(n.id), there = b.get(n.id);
    if (here && when(here) > when(there)) up.push(n.id);
    else if (there && when(there) > when(here)) down.push(n.id);
  }
  return { up, down };
}
