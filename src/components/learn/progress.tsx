// How it's going: daily goals (which can be changed), the last 7 days, quiz scores and how well
// each set is learned.
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';
import Reanimated, { useAnimatedStyle, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Icon } from '@/components/ui';
import { useTheme } from '@/lib/settings';
import { dayKey, lastWeek, mastered, streak, type StudyDay } from '@/lib/study-logic';
import { type StudyData, updateStudy } from '@/lib/study-store';

import { Bar, Box, ease, Empty, GREEN, plural } from './shared';

/** The longest run of days in a row with some studying, ever. */
export function bestStreak(days: Record<string, StudyDay>) {
  const keys = Object.keys(days).filter((k) => (days[k].minutes ?? 0) > 0 || (days[k].cards ?? 0) > 0).sort();
  let best = 0, run = 0, prev: Date | null = null;
  for (const k of keys) {
    const [y, m, d] = k.split('-').map(Number);
    const cur = new Date(y, m - 1, d);
    run = prev && Math.round((cur.getTime() - prev.getTime()) / 86400000) === 1 ? run + 1 : 1;
    best = Math.max(best, run);
    prev = cur;
  }
  return best;
}

function Column({ value, most, label, today, delay }: { value: number; most: number; label: string; today: boolean; delay: number }) {
  const t = useTheme();
  const h = useSharedValue(0);
  useEffect(() => { h.value = withDelay(delay, withTiming(Math.max(4, (value / most) * 110), { duration: 420, easing: ease })); }, [value, most, delay, h]);
  const look = useAnimatedStyle(() => ({ height: h.value }));
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%', gap: 6 }}>
      <Text style={{ color: t.faint, fontSize: 11, fontVariant: ['tabular-nums'] }}>{value || ''}</Text>
      <Reanimated.View style={[{ width: '62%', borderRadius: 6, backgroundColor: today ? t.accent : `${t.accent}55` }, look]} />
      <Text style={{ color: today ? t.text : t.sub, fontSize: 12, fontWeight: today ? '700' : '400' }}>{label}</Text>
    </View>
  );
}

/** The 7-day chart on its own, so the hub can show it small. */
export function WeekChart({ study, now, height = 150 }: { study: StudyData; now: Date; height?: number }) {
  const week = lastWeek(study.days, now);
  const most = Math.max(1, ...week.map((d) => d.minutes + d.cards));
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height, gap: 6 }}>
      {week.map((d, i) => <Column key={i} value={d.minutes + d.cards} most={most} label={d.label} today={i === 6} delay={i * 35} />)}
    </View>
  );
}

function Goal({ label, value, goal, color, step, onChange }: { label: string; value: number; goal: number; color: string; step: number; onChange: (n: number) => void }) {
  const t = useTheme();
  const btn = (icon: string, d: number, a11y: string) => (
    <Pressable accessibilityLabel={a11y} hitSlop={6} onPress={() => onChange(Math.max(step, goal + d))} style={({ pressed }) => ({ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? t.line : t.chip })}>
      <Icon name={icon} size={14} color={t.text} />
    </Pressable>
  );
  return (
    <View style={{ gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: t.sub, fontSize: 15, fontVariant: ['tabular-nums'] }}>{value} of {goal}</Text>
        {btn('minus', -step, `Lower ${label.toLowerCase()} goal`)}
        {btn('plus', step, `Raise ${label.toLowerCase()} goal`)}
      </View>
      <Bar value={value / Math.max(1, goal)} color={value >= goal ? GREEN : color} />
    </View>
  );
}

export function Progress({ study, now }: { study: StudyData; now: Date }) {
  const t = useTheme();
  const today = study.days[dayKey(now)] ?? {};
  const week = lastWeek(study.days, now);
  const weekMin = week.reduce((n, d) => n + d.minutes, 0), weekCards = week.reduce((n, d) => n + d.cards, 0);
  const run = streak(study.days, now), best = Math.max(run, bestStreak(study.days));
  const avg = study.quizzes.length ? Math.round((study.quizzes.reduce((n, q) => n + q.score / Math.max(1, q.total), 0) / study.quizzes.length) * 100) : null;

  const stat = (v: string | number, l: string) => (
    <View style={{ flex: 1, gap: 2 }}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{v}</Text>
      <Text style={{ color: t.sub, fontSize: 13 }}>{l}</Text>
    </View>
  );

  return (
    <View style={{ gap: 16 }}>
      <Box title="Today's goals">
        <Goal label="Cards" value={today.cards ?? 0} goal={study.goalCards} color={t.accent} step={5} onChange={(n) => updateStudy((d) => ({ ...d, goalCards: n }))} />
        <Goal label="Minutes" value={today.minutes ?? 0} goal={study.goalMinutes} color={t.accent} step={5} onChange={(n) => updateStudy((d) => ({ ...d, goalMinutes: n }))} />
      </Box>

      <Box title="Last 7 days">
        <WeekChart study={study} now={now} />
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 4 }}>
          {stat(weekMin, 'minutes')}
          {stat(weekCards, 'cards')}
          {stat(run, 'day streak')}
          {stat(best, 'best streak')}
        </View>
      </Box>

      <Box title="Quizzes" right={avg != null ? <Text style={{ color: t.sub, fontSize: 15 }}>Average {avg}%</Text> : undefined}>
        {study.quizzes.length ? study.quizzes.slice(0, 6).map((q, i) => (
          <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15 }}>{q.title}</Text>
            <Text style={{ color: q.score / Math.max(1, q.total) >= 0.7 ? GREEN : t.sub, fontSize: 15, fontWeight: '600', fontVariant: ['tabular-nums'] }}>{q.score}/{q.total}</Text>
          </View>
        )) : <Empty text="Quiz scores show up here after your first quiz." />}
      </Box>

      <Box title="Sets">
        {study.decks.length ? study.decks.map((d) => {
          const m = mastered(d.cards);
          return (
            <View key={d.id} style={{ gap: 6 }}>
              <View style={{ flexDirection: 'row' }}>
                <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: '600' }}>{d.title}</Text>
                <Text style={{ color: t.sub, fontSize: 14 }}>{Math.round(m * 100)}% learned · {plural(d.cards.length, 'card')}</Text>
              </View>
              <Bar value={m} color={m >= 0.8 ? GREEN : t.accent} height={6} />
            </View>
          );
        }) : <Empty text="No flashcard sets yet." />}
      </Box>
    </View>
  );
}
