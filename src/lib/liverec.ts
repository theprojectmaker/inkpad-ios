// The recorder on the iPad: saves the sound and turns it into text as it's said. What it's doing
// lives here rather than in a screen's state, so only the parts showing it redraw four times a second.
import { requireNativeModule } from 'expo-modules-core';
import { useSyncExternalStore } from 'react';
import { Platform } from 'react-native';

export type SaidLine = { t: number; text: string };
export type LiveState = {
  elapsed: number;       // ms recorded, not counting pauses
  level: number;         // 0 to 1
  paused: boolean;
  speech: 'device' | 'online' | 'off';
  note: string;          // anything the student needs to know
  lines: SaidLine[];
  partial: string;       // words still being worked out
};

type Poll = Omit<LiveState, 'lines'> & { lines: SaidLine[]; total: number };
type NativeRec = {
  recStart(path: string): Promise<void>;
  recPoll(since: number): Poll;
  recPause(on: boolean): void;
  recStop(): Promise<{ dur: number; lines: SaidLine[] }>;
};

let Native: NativeRec | null = null;
if (Platform.OS === 'ios') {
  try { Native = requireNativeModule<NativeRec>('QuillCanvas'); } catch { Native = null; }
}

const EMPTY: LiveState = { elapsed: 0, level: 0, paused: false, speech: 'off', note: '', lines: [], partial: '' };
let state = EMPTY;
let timer: ReturnType<typeof setInterval> | null = null;
let pauses: [number, number][] = [];
let pausedAt = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function poll() {
  if (!Native) return;
  try {
    const p = Native.recPoll(state.lines.length);
    state = { elapsed: p.elapsed, level: p.level, paused: p.paused, speech: p.speech, note: p.note, partial: p.partial, lines: p.lines.length ? [...state.lines, ...p.lines] : state.lines };
    emit();
  } catch {}
}

export const liveNow = () => state;

export function useLive(): LiveState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, liveNow, liveNow);
}

export async function startLive(path: string) {
  if (!Native) throw new Error('Recording works in the iPad app.');
  state = EMPTY;
  pauses = [];
  pausedAt = 0;
  await Native.recStart(path);
  if (timer) clearInterval(timer);
  timer = setInterval(poll, 250);
}

export function pauseLive(on: boolean) {
  if (on && !pausedAt) pausedAt = Date.now();
  if (!on && pausedAt) { pauses.push([pausedAt, Date.now() - pausedAt]); pausedAt = 0; }
  Native?.recPause(on);
  poll();
}

export async function stopLive(): Promise<{ dur: number; lines: SaidLine[]; pauses: [number, number][] }> {
  if (timer) { clearInterval(timer); timer = null; }
  const out = await Native!.recStop();
  state = { ...state, level: 0, partial: '', lines: out.lines };
  emit();
  if (pausedAt) { pauses.push([pausedAt, Date.now() - pausedAt]); pausedAt = 0; }
  return { ...out, pauses };
}
