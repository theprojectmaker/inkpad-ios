// The Study hub: what's due, how the week is going, a focus timer, tests and homework.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton, Sheet, useToast } from '@/components/ui';
import { uid } from '@/lib/model';
import { useSchedule, whereNow } from '@/lib/schedule';
import { useSettings, useTheme } from '@/lib/settings';
import { studentoDay } from '@/lib/studento';
import { dayKey, daysUntil, isDue, lastWeek, readDate, streak } from '@/lib/study-logic';
import { logStudy, updateStudy, useStudy } from '@/lib/study-store';

const BLUE = '#3F6AF2';
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

function Panel({ title, children, right }: { title: string; children: React.ReactNode; right?: React.ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ padding: 16, borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 24 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
        {right}
      </View>
      {children}
    </View>
  );
}

/** Works from the time it should end, so it stays right if the iPad locks or the app is left. */
function FocusTimer() {
  const t = useTheme();
  const { toast } = useToast();
  const [minutes, setMinutes] = useState(25);
  const [phase, setPhase] = useState<'idle' | 'focus' | 'break'>('idle');
  const [endsAt, setEndsAt] = useState(0);
  const [startedAt, setStartedAt] = useState(0);
  const [left, setLeft] = useState(0);
  const logged = useRef(false);
  const log = (ms: number) => { const m = Math.round(ms / 60000); if (m > 0 && !logged.current) { logged.current = true; logStudy({ minutes: m }); } };

  useEffect(() => {
    if (phase === 'idle') return;
    const tick = () => {
      const s = Math.ceil((endsAt - Date.now()) / 1000);
      if (s > 0) { setLeft(s); return; }
      if (phase === 'focus') {
        log(endsAt - startedAt);
        toast('Nice focus. Take a 5 minute break.');
        setPhase('break');
        setEndsAt(Date.now() + 5 * 60000);
      } else { toast('Break over.'); setPhase('idle'); }
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, endsAt]);

  const start = () => { logged.current = false; setStartedAt(Date.now()); setEndsAt(Date.now() + minutes * 60000); setPhase('focus'); };
  const stop = () => { if (phase === 'focus') log(Date.now() - startedAt); setPhase('idle'); };

  return (
    <Panel title="Focus timer">
      {phase === 'idle' ? (
        <>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {[15, 25, 45].map((m) => (
              <Pressable key={m} accessibilityLabel={`${m} minutes`} onPress={() => setMinutes(m)} style={{ flex: 1, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: minutes === m ? `${BLUE}1F` : t.chip }}>
                <Text style={{ color: minutes === m ? BLUE : t.text, fontSize: 15, fontWeight: '600' }}>{m} min</Text>
              </Pressable>
            ))}
          </View>
          <Pressable accessibilityLabel="Start focus" onPress={start} style={{ height: 42, borderRadius: 10, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Start</Text>
          </Pressable>
        </>
      ) : (
        <View style={{ alignItems: 'center', gap: 8 }}>
          <Text style={{ color: t.sub, fontSize: 14 }}>{phase === 'focus' ? 'Focusing' : 'Break'}</Text>
          <Text style={{ color: t.text, fontSize: 44, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{mmss(left)}</Text>
          <Pressable accessibilityLabel="End timer" onPress={stop} style={{ height: 38, paddingHorizontal: 18, borderRadius: 10, justifyContent: 'center', backgroundColor: t.chip }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>End</Text>
          </Pressable>
        </View>
      )}
    </Panel>
  );
}

export default function StudyHub() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { toast } = useToast();
  const { s: prefs } = useSettings();
  const study = useStudy();
  const { s: sched } = useSchedule();
  const [now, setNow] = useState(() => new Date());
  const [testOpen, setTestOpen] = useState(false);
  const [hwOpen, setHwOpen] = useState(false);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);

  const due = study.decks.reduce((n, d) => n + d.cards.filter((c) => isDue(c, now.getTime())).length, 0);
  const today = study.days[dayKey(now)] ?? {};
  const week = lastWeek(study.days, now);
  const most = Math.max(1, ...week.map((d) => d.minutes + d.cards));
  const run = streak(study.days, now);

  const day = prefs.scheduleUnlocked && sched.studento ? studentoDay(sched.studento, now) : null;
  const w = day ? whereNow({ periods: day.periods, theme: 0 }, now) : null;
  const classes = day ? [...new Set(day.periods.map((p) => p.name))].filter((n) => n !== 'Lunch' && n !== 'Advisory') : [];

  const field = { height: 44, borderRadius: 10, backgroundColor: t.chip, paddingHorizontal: 12, color: t.text, fontSize: 16 } as const;
  const save = (kind: 'test' | 'hw') => {
    const parsed = date.trim() ? readDate(date, now) : null;
    if (date.trim() && !parsed) { toast('Write the date like 11/20.'); return; }
    if (!name.trim() || (kind === 'test' && !parsed)) return;
    if (kind === 'test') updateStudy((d) => ({ ...d, tests: [...d.tests, { id: uid('t'), name: name.trim(), date: parsed! }].sort((a, b) => a.date.localeCompare(b.date)) }));
    else updateStudy((d) => ({ ...d, homework: [{ id: uid('h'), text: name.trim(), due: parsed ?? undefined }, ...d.homework] }));
    setName(''); setDate(''); setTestOpen(false); setHwOpen(false);
  };
  const add = (label: string, onPress: () => void) => (
    <Pressable accessibilityLabel={label} onPress={onPress} hitSlop={8}><Text style={{ color: BLUE, fontSize: 15, fontWeight: '600' }}>Add</Text></Pressable>
  );

  const stat = (value: string | number, label: string) => (
    <View style={{ flex: 1, alignItems: 'center', paddingVertical: 8 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: t.sub, fontSize: 13 }}>{label}</Text>
    </View>
  );

  const open = study.homework.filter((h) => !h.done);
  const finished = study.homework.filter((h) => h.done).slice(0, 5);
  const avg = study.quizzes.length ? Math.round((study.quizzes.reduce((n, q) => n + q.score / Math.max(1, q.total), 0) / study.quizzes.length) * 100) : null;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <IconButton name="arrow.left" label="Back to notes" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', marginLeft: 6 }}>Study</Text>
        <IconButton name="books.vertical" label="Reference" onPress={() => router.push('/reference')} />
      </View>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, maxWidth: 760, width: '100%', alignSelf: 'center', paddingBottom: 60 }}>
        {w && w.kind !== 'free' ? (
          <Pressable accessibilityLabel="My schedule" onPress={() => router.push('/clock')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 14, borderRadius: 14, backgroundColor: `${BLUE}14` }}>
            <Icon name="clock" size={18} color={BLUE} />
            <Text style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '500' }}>
              {w.kind === 'class' ? `${w.period.name}, ${Math.ceil(w.left / 60)} min left${w.next ? `. Next: ${w.next.name}` : ''}` : `${w.next.name} starts in ${Math.ceil(w.left / 60)} min`}
            </Text>
          </Pressable>
        ) : null}

        <Panel title="Today">
          <View style={{ flexDirection: 'row' }}>
            {stat(run, run === 1 ? 'day streak' : 'days streak')}
            {stat(`${today.cards ?? 0}/${study.goalCards}`, 'cards')}
            {stat(`${today.minutes ?? 0}/${study.goalMinutes}`, 'minutes')}
          </View>
          <Pressable accessibilityLabel="Study flashcards" onPress={() => router.push('/flashcards')} style={{ height: 42, borderRadius: 10, backgroundColor: due ? BLUE : t.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: due ? '#fff' : t.text, fontSize: 15, fontWeight: '600' }}>{due ? `Review ${due} due card${due === 1 ? '' : 's'}` : 'Flashcards'}</Text>
          </Pressable>
        </Panel>

        <Panel title="This week">
          <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 90, gap: 8 }}>
            {week.map((d, i) => (
              <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 4 }}>
                <View style={{ width: '70%', height: Math.max(3, ((d.minutes + d.cards) / most) * 66), borderRadius: 4, backgroundColor: i === 6 ? BLUE : `${BLUE}55` }} />
                <Text style={{ color: t.sub, fontSize: 12 }}>{d.label}</Text>
              </View>
            ))}
          </View>
          {avg != null ? <Text style={{ color: t.sub, fontSize: 13 }}>Quiz average: {avg}% over {study.quizzes.length} quiz{study.quizzes.length === 1 ? '' : 'zes'}. Latest: {study.quizzes[0].score}/{study.quizzes[0].total} on {study.quizzes[0].title}</Text> : null}
        </Panel>

        <FocusTimer />

        <Panel title="Tests" right={add('Add a test', () => { setName(''); setDate(''); setTestOpen(true); })}>
          {study.tests.length ? study.tests.filter((x) => daysUntil(x.date, now) >= 0).map((x) => {
            const n = daysUntil(x.date, now);
            return (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={{ width: 86, color: n <= 2 ? t.danger : BLUE, fontSize: 14, fontWeight: '700' }}>{n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${n} days`}</Text>
                <Text style={{ flex: 1, color: t.text, fontSize: 15 }}>{x.name}</Text>
                <IconButton name="xmark" label={`Remove ${x.name}`} onPress={() => updateStudy((d) => ({ ...d, tests: d.tests.filter((k) => k.id !== x.id) }))} />
              </View>
            );
          }) : <Text style={{ color: t.sub, fontSize: 14 }}>Add a test to count down to it.</Text>}
        </Panel>

        <Panel title="Homework" right={add('Add homework', () => { setName(''); setDate(''); setHwOpen(true); })}>
          {open.length ? open.map((h) => {
            const n = h.due ? daysUntil(h.due, now) : null;
            return (
              <Pressable key={h.id} accessibilityLabel={`Done: ${h.text}`} onPress={() => updateStudy((d) => ({ ...d, homework: d.homework.map((k) => (k.id === h.id ? { ...k, done: true } : k)) }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 32 }}>
                <Icon name="circle" size={19} color={t.faint} />
                <Text style={{ flex: 1, color: t.text, fontSize: 15 }}>{h.text}</Text>
                {n != null ? <Text style={{ color: n < 0 ? t.danger : n <= 1 ? '#D97706' : t.sub, fontSize: 13 }}>{n < 0 ? 'Late' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${n} days`}</Text> : null}
              </Pressable>
            );
          }) : <Text style={{ color: t.sub, fontSize: 14 }}>Nothing to do. Nice.</Text>}
          {finished.map((h) => (
            <Pressable key={h.id} accessibilityLabel={`Not done: ${h.text}`} onPress={() => updateStudy((d) => ({ ...d, homework: d.homework.map((k) => (k.id === h.id ? { ...k, done: false } : k)) }))} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 28, opacity: 0.55 }}>
              <Icon name="checkmark.circle.fill" size={19} color="#30A46C" />
              <Text style={{ flex: 1, color: t.text, fontSize: 15, textDecorationLine: 'line-through' }}>{h.text}</Text>
            </Pressable>
          ))}
        </Panel>
      </ScrollView>

      <Sheet visible={testOpen || hwOpen} onClose={() => { setTestOpen(false); setHwOpen(false); }} title={testOpen ? 'Add a test' : 'Add homework'} width={420}>
        <View style={{ gap: 10 }}>
          <TextInput accessibilityLabel={testOpen ? 'Test name' : 'Homework'} value={name} onChangeText={setName} autoFocus placeholder={testOpen ? 'Biology chapter 4' : 'Geometry page 42, 1 to 10'} placeholderTextColor={t.faint} style={field} />
          {classes.length ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 6 }}>
              {classes.map((c) => (
                <Pressable key={c} accessibilityLabel={c} onPress={() => setName((v) => (v.startsWith(`${c}: `) ? v : `${c}: ${v}`))} style={{ height: 30, paddingHorizontal: 11, borderRadius: 15, justifyContent: 'center', backgroundColor: t.chip }}>
                  <Text style={{ color: t.text, fontSize: 13 }}>{c}</Text>
                </Pressable>
              ))}
            </ScrollView>
          ) : null}
          <TextInput accessibilityLabel="Date" value={date} onChangeText={setDate} placeholder={testOpen ? 'Date, like 11/20' : 'Due date, like 11/20 (optional)'} placeholderTextColor={t.faint} keyboardType="numbers-and-punctuation" style={field} />
          <Pressable accessibilityLabel="Save" onPress={() => save(testOpen ? 'test' : 'hw')} style={{ height: 42, borderRadius: 10, backgroundColor: BLUE, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '600' }}>Save</Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}
