// The focus timer, Pomodoro style: focus, a short break, and a longer break every fourth round.
// It keeps running while you look at other parts of the hub, and works from the time it should
// end, so it stays right if the iPad locks or the app is left.
import { useSyncExternalStore } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/lib/settings';
import { logStudy } from '@/lib/study-store';

import { Bar, Box, Enter, GREEN, mmss, plural } from './shared';

type Phase = 'idle' | 'focus' | 'break';
type TimerState = { phase: Phase; minutes: number; endsAt: number; startedAt: number; total: number; left: number; rounds: number };

let st: TimerState = { phase: 'idle', minutes: 25, endsAt: 0, startedAt: 0, total: 0, left: 0, rounds: 0 };
const ls = new Set<() => void>();
let notify: (m: string) => void = () => {};
let iv: ReturnType<typeof setInterval> | null = null;
let logged = false;

const set = (p: Partial<TimerState>) => { st = { ...st, ...p }; ls.forEach((l) => l()); };
const log = (ms: number) => { const m = Math.round(ms / 60000); if (m > 0 && !logged) { logged = true; logStudy({ minutes: m }); } };
const stopTicking = () => { if (iv) clearInterval(iv); iv = null; };

function tick() {
  if (st.phase === 'idle') { stopTicking(); return; }
  const s = Math.ceil((st.endsAt - Date.now()) / 1000);
  if (s > 0) { if (s !== st.left) set({ left: s }); return; }
  if (st.phase === 'focus') {
    log(st.endsAt - st.startedAt);
    const rounds = st.rounds + 1;
    const long = rounds % 4 === 0;
    const mins = long ? 15 : 5;
    notify(long ? 'Four rounds done. Take a 15 minute break.' : 'Nice focus. Take a 5 minute break.');
    set({ phase: 'break', rounds, endsAt: Date.now() + mins * 60000, total: mins * 60, left: mins * 60 });
  } else {
    notify('Break over. Ready for another round?');
    set({ phase: 'idle', left: 0 });
    stopTicking();
  }
}

const startTicking = () => { stopTicking(); iv = setInterval(tick, 1000); };

export const timer = {
  setNotify(fn: (m: string) => void) { notify = fn; },
  setMinutes(m: number) { set({ minutes: m }); },
  start() {
    logged = false;
    const now = Date.now();
    set({ phase: 'focus', startedAt: now, endsAt: now + st.minutes * 60000, total: st.minutes * 60, left: st.minutes * 60 });
    startTicking();
  },
  stop() { if (st.phase === 'focus') log(Date.now() - st.startedAt); set({ phase: 'idle', left: 0 }); stopTicking(); },
  skipBreak() { set({ phase: 'idle', left: 0 }); stopTicking(); },
  resetRounds() { set({ rounds: 0 }); },
};

export function useTimer(): TimerState {
  return useSyncExternalStore((l) => { ls.add(l); return () => { ls.delete(l); }; }, () => st, () => st);
}

export function FocusTimer({ minutesToday }: { minutesToday: number }) {
  const t = useTheme();
  const s = useTimer();
  const color = s.phase === 'break' ? GREEN : t.accent;
  const done = s.total ? 1 - s.left / s.total : 0;

  return (
    <View style={{ gap: 14 }}>
      <Box>
        {s.phase === 'idle' ? (
          <Enter dy={8} style={{ gap: 16 }}>
            <Text style={{ color: t.sub, fontSize: 15 }}>Pick a length, then put everything else away.</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[15, 25, 45, 60].map((m) => (
                <Pressable key={m} accessibilityLabel={`${m} minutes`} onPress={() => timer.setMinutes(m)}
                  style={{ flex: 1, height: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: s.minutes === m ? `${t.accent}1F` : t.chip }}>
                  <Text style={{ color: s.minutes === m ? t.accent : t.text, fontSize: 16, fontWeight: '600' }}>{m} min</Text>
                </Pressable>
              ))}
            </View>
            <Pressable accessibilityLabel="Start focus" onPress={timer.start} style={({ pressed }) => ({ height: 52, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>Start {s.minutes} minutes</Text>
            </Pressable>
          </Enter>
        ) : (
          <Enter dy={8} style={{ alignItems: 'center', gap: 14, paddingVertical: 8 }}>
            <Text style={{ color, fontSize: 15, fontWeight: '700', letterSpacing: 0.4 }}>{s.phase === 'focus' ? `FOCUS, ROUND ${s.rounds + 1}` : 'BREAK'}</Text>
            <Text style={{ color: t.text, fontSize: 72, fontWeight: '700', fontVariant: ['tabular-nums'], letterSpacing: -1 }}>{mmss(s.left)}</Text>
            <View style={{ alignSelf: 'stretch' }}><Bar value={done} color={color} height={6} /></View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable accessibilityLabel={s.phase === 'focus' ? 'End timer' : 'Skip break'} onPress={s.phase === 'focus' ? timer.stop : timer.skipBreak}
                style={{ height: 44, paddingHorizontal: 22, borderRadius: 12, justifyContent: 'center', backgroundColor: t.chip }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{s.phase === 'focus' ? 'End' : 'Skip break'}</Text>
              </Pressable>
            </View>
          </Enter>
        )}
      </Box>
      <Box>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          {[0, 1, 2, 3].map((i) => (
            <View key={i} style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: i < s.rounds % 4 || (s.rounds > 0 && s.rounds % 4 === 0 && s.phase === 'break') ? t.accent : t.chip }} />
          ))}
          <Text style={{ flex: 1, color: t.sub, fontSize: 14 }}>{plural(s.rounds, 'round')} so far. A long break comes after every fourth.</Text>
          {s.rounds ? <Pressable accessibilityLabel="Reset rounds" onPress={timer.resetRounds} hitSlop={8}><Text style={{ color: t.accent, fontSize: 14, fontWeight: '600' }}>Reset</Text></Pressable> : null}
        </View>
        <Text style={{ color: t.sub, fontSize: 14 }}>{plural(minutesToday, 'minute')} studied today.</Text>
      </Box>
    </View>
  );
}
