// The Study hub: a calm summary of today, then a few big tiles. Each tile opens one focused view
// (flashcards, quizzes, the focus timer, tests and homework, notes tools, progress) that slides in
// with a way back. Everything here works offline.
import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FocusTimer, timer, useTimer } from '@/components/learn/focus-timer';
import { FromNotes } from '@/components/learn/from-notes';
import { Progress, WeekChart } from '@/components/learn/progress';
import { QuickReview, type ReviewPick } from '@/components/learn/quick-review';
import { deckQuestions, Quiz, type Question } from '@/components/learn/quiz';
import { Box, Empty, Enter, GREEN, mmss, OfflineNote, ORANGE, PINK, plural, PURPLE, RowButton, SubHeader, TEAL, Tile } from '@/components/learn/shared';
import { TestsHomework } from '@/components/learn/tests-homework';
import { Icon, IconButton, useToast } from '@/components/ui';
import { useTheme } from '@/lib/settings';
import { dayKey, daysUntil, hardest, isDue, mastered, shuffled, streak } from '@/lib/study-logic';
import { type Deck, updateStudy, useStudy } from '@/lib/study-store';

type View_ = 'cards' | 'quiz' | 'timer' | 'tests' | 'notes' | 'progress';
type Session =
  | { kind: 'review'; title: string; picks: ReviewPick[]; empty: string }
  | { kind: 'quiz'; title: string; deckId: string; questions: Question[] };

const TITLES: Record<View_, string> = { cards: 'Flashcards', quiz: 'Quiz me', timer: 'Focus timer', tests: 'Tests & homework', notes: 'From my notes', progress: 'Progress' };

/** Missing a quiz question counts as a miss on that card, so it shows up in "hardest cards". */
function markMissed(deckId: string, q: string) {
  updateStudy((d) => ({ ...d, decks: d.decks.map((k) => (k.id !== deckId ? k : { ...k, cards: k.cards.map((c) => (c.q === q ? { ...c, missed: (c.missed ?? 0) + 1 } : c)) })) }));
}

export default function StudyHub() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { toast } = useToast();
  const study = useStudy();
  const tm = useTimer();
  const scroll = useRef<ScrollView>(null);
  const [now, setNow] = useState(() => new Date());
  const [view, setView] = useState<View_ | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [nav, setNav] = useState(0);
  useEffect(() => { const id = setInterval(() => setNow(new Date()), 30000); return () => clearInterval(id); }, []);
  useEffect(() => { timer.setNotify(toast); }, [toast]);

  const go = (v: View_ | null, s: Session | null = null) => {
    setView(v);
    setSession(s);
    setNav((n) => n + 1);
    scroll.current?.scrollTo({ y: 0, animated: false });
  };
  const back = () => (session ? go(view) : go(null));
  const forward = !!(view || session);

  // ---- what the hub knows ----
  const all = study.decks.flatMap((d) => d.cards.map((card) => ({ deckId: d.id, deck: d.title, card })));
  const dueList = all.filter((x) => isDue(x.card, now.getTime()));
  const due = dueList.length;
  const hard = hardest(all.map((x) => x.card), 15).map((c) => all.find((x) => x.card === c)!).filter(Boolean);
  const today = study.days[dayKey(now)] ?? {};
  const run = streak(study.days, now);
  const upcoming = study.tests.map((x) => ({ ...x, n: daysUntil(x.date, now) })).filter((x) => x.n >= 0).sort((a, b) => a.n - b.n);
  const openHw = study.homework.filter((h) => !h.done);
  const quizzable = study.decks.filter((d) => deckQuestions(d.cards, 1).length);

  const startDue = () => go('cards', { kind: 'review', title: 'Due cards', picks: shuffled(dueList).slice(0, 20), empty: 'Nothing is due. Cards come back here when it\'s time to see them again.' });
  const startHard = () => go('cards', { kind: 'review', title: 'Hardest cards', picks: hard, empty: 'No hard cards yet. Cards you miss in a review or quiz show up here.' });
  const startQuiz = (d: Deck) => {
    const questions = deckQuestions(d.cards, 10);
    if (!questions.length) { toast('This set needs at least 3 different answers for a quiz.'); return; }
    go('quiz', { kind: 'quiz', title: d.title, deckId: d.id, questions });
  };

  // ---- the hub ----
  const stat = (value: string | number, label: string, color: string, sub?: string) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'], letterSpacing: -0.5 }}>{value}</Text>
      <Text style={{ color: t.text, fontSize: 14, fontWeight: '600' }}>{label}</Text>
      {sub ? <Text style={{ color: t.sub, fontSize: 13 }}>{sub}</Text> : null}
    </View>
  );

  const nextTest = upcoming[0];
  const hub = (
    <View style={{ gap: 18 }}>
      <Enter dy={10}>
        <Box style={{ padding: 22, gap: 18 }}>
          <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</Text>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            {stat(due, due === 1 ? 'card due' : 'cards due', due ? t.accent : t.text, `${today.cards ?? 0} of ${study.goalCards} done today`)}
            {stat(run, run === 1 ? 'day streak' : 'days streak', run ? ORANGE : t.text, run ? 'Keep it going' : 'Study today to start one')}
            {stat(today.minutes ?? 0, 'minutes today', (today.minutes ?? 0) >= study.goalMinutes ? GREEN : t.text, `Goal ${study.goalMinutes}`)}
          </View>
          {due ? (
            <Pressable accessibilityLabel={`Review ${due} due cards`} onPress={startDue} style={({ pressed }) => ({ height: 50, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Review {plural(due, 'due card')}</Text>
            </Pressable>
          ) : null}
          {nextTest || openHw.length ? (
            <Pressable accessibilityLabel="Tests and homework" onPress={() => go('tests')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <Icon name="calendar" size={15} color={t.sub} />
              <Text style={{ flex: 1, color: t.sub, fontSize: 14 }}>
                {[nextTest ? `${nextTest.name} ${nextTest.n === 0 ? 'is today' : nextTest.n === 1 ? 'is tomorrow' : `in ${nextTest.n} days`}` : '', openHw.length ? `${plural(openHw.length, 'homework item')} to do` : ''].filter(Boolean).join(' · ')}
              </Text>
              <Icon name="chevron.right" size={13} color={t.faint} />
            </Pressable>
          ) : null}
        </Box>
      </Enter>

      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
        {([
          { v: 'cards', icon: 'rectangle.on.rectangle', color: t.accent, sub: due ? `${plural(due, 'card')} due now` : study.decks.length ? `${plural(study.decks.length, 'set')}, all caught up` : 'Make your first set', badge: due ? String(due) : undefined },
          { v: 'quiz', icon: 'checklist', color: PURPLE, sub: quizzable.length ? 'Multiple choice from your sets' : 'From your sets or typed notes' },
          { v: 'timer', icon: 'timer', color: TEAL, sub: tm.phase === 'idle' ? `${tm.minutes} minute focus rounds` : `${tm.phase === 'focus' ? 'Focusing' : 'On a break'}, ${mmss(tm.left)} left`, badge: tm.phase === 'idle' ? undefined : mmss(tm.left) },
          { v: 'tests', icon: 'calendar', color: ORANGE, sub: nextTest ? `Next: ${nextTest.name}, ${nextTest.n === 0 ? 'today' : `${nextTest.n}d`}` : openHw.length ? `${plural(openHw.length, 'thing')} to do` : 'Count down to tests', badge: nextTest && nextTest.n <= 7 ? (nextTest.n === 0 ? 'Today' : `${nextTest.n}d`) : undefined },
          { v: 'notes', icon: 'doc.text', color: PINK, sub: 'Typed notes into cards, a quiz or a summary' },
          { v: 'progress', icon: 'chart.bar', color: GREEN, sub: `${(today.minutes ?? 0) + (today.cards ?? 0) ? 'Today counts. ' : ''}Goals, week and scores` },
        ] as const).map((x, i) => (
          <Enter key={x.v} dy={14} delay={40 + i * 30} style={{ flexBasis: '46%', flexGrow: 1 }}>
            <Tile icon={x.icon} color={x.color} title={TITLES[x.v]} sub={x.sub} badge={'badge' in x ? x.badge : undefined} onPress={() => go(x.v)} />
          </Enter>
        ))}
      </View>

      <Enter dy={14} delay={240}>
        <RowButton icon="books.vertical" color={t.sub} title="Reference" sub="Formulas, symbols, the periodic table and unit conversion" onPress={() => router.push('/reference')} />
      </Enter>

      <Enter dy={14} delay={270}>
        <Box title="This week" right={<Pressable accessibilityLabel="See progress" onPress={() => go('progress')} hitSlop={8}><Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>More</Text></Pressable>}>
          <WeekChart study={study} now={now} height={96} />
        </Box>
      </Enter>
    </View>
  );

  // ---- the focused views ----
  const cardsView = (
    <View style={{ gap: 12 }}>
      <RowButton icon="arrow.triangle.2.circlepath" color={t.accent} title="Review due cards" sub={due ? `${plural(due, 'card')} from all your sets` : 'Nothing due right now'} onPress={startDue} />
      <RowButton icon="flame" color={ORANGE} title="Review hardest cards" sub={hard.length ? `The ${plural(hard.length, 'card')} you miss most` : 'Cards you miss will gather here'} onPress={startHard} />
      <RowButton icon="checklist" color={PURPLE} title="Quiz from a set" sub="Multiple choice made from a set's own answers" onPress={() => go('quiz')} />
      <RowButton icon="square.grid.2x2" color={TEAL} title="All flashcard tools" sub="Make, import and edit sets; type the answer, match game, starred" onPress={() => router.push('/flashcards')} />
      {study.decks.length ? (
        <Box title="Your sets" style={{ marginTop: 6 }}>
          {study.decks.map((d) => {
            const n = d.cards.filter((c) => isDue(c, now.getTime())).length;
            return (
              <Pressable key={d.id} accessibilityLabel={`Open ${d.title}`} onPress={() => router.push('/flashcards')} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 36 }}>
                <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 16 }}>{d.title}</Text>
                <Text style={{ color: n ? t.accent : t.sub, fontSize: 14, fontWeight: n ? '700' : '400' }}>{n ? `${n} due` : `${Math.round(mastered(d.cards) * 100)}% learned`}</Text>
              </Pressable>
            );
          })}
        </Box>
      ) : null}
    </View>
  );

  const quizView = (
    <View style={{ gap: 12 }}>
      {quizzable.length ? quizzable.map((d) => (
        <RowButton key={d.id} icon="checklist" color={PURPLE} title={d.title} sub={`${Math.min(10, d.cards.length)} questions`} onPress={() => startQuiz(d)} />
      )) : (
        <Box><Empty text="Make a flashcard set with at least 3 cards and it can quiz you here. Or make a quiz from typed notes." /></Box>
      )}
      <RowButton icon="doc.text" color={PINK} title="Quiz from typed notes" sub="Paste notes and get a quiz, offline" onPress={() => go('notes')} />
      <OfflineNote text="Quizzes are made on this iPad, so they work with no internet." />
    </View>
  );

  let body: React.ReactNode = hub;
  let title = '';
  if (session?.kind === 'review') { title = session.title; body = <QuickReview picks={session.picks} empty={session.empty} onDone={() => go('cards')} />; }
  else if (session?.kind === 'quiz') { title = session.title; const s = session; body = <Quiz title={s.title} questions={s.questions} onDone={() => go('quiz')} onAnswer={(i, right) => { if (!right) markMissed(s.deckId, s.questions[i].q); }} />; }
  else if (view) {
    title = TITLES[view];
    body = view === 'cards' ? cardsView
      : view === 'quiz' ? quizView
      : view === 'timer' ? <FocusTimer minutesToday={today.minutes ?? 0} />
      : view === 'tests' ? <TestsHomework study={study} now={now} />
      : view === 'notes' ? <FromNotes />
      : <Progress study={study} now={now} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <IconButton name="arrow.left" label="Back to notes" onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} />
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', marginLeft: 6 }}>{forward ? '' : 'Study'}</Text>
      </View>
      <ScrollView ref={scroll} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 4, maxWidth: 760, width: '100%', alignSelf: 'center', paddingBottom: 80 }}>
        <Enter key={nav} dx={forward ? 28 : -28} style={{ gap: 16 }}>
          {forward ? <SubHeader title={title} onBack={back} /> : null}
          {body}
        </Enter>
      </ScrollView>
    </View>
  );
}
