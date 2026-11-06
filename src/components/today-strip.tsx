// A quiet line on Home: the class happening now, and what's due. Only what applies shows.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useSchedule, whereNow } from '@/lib/schedule';
import { useSettings, useTheme } from '@/lib/settings';
import { studentoDay } from '@/lib/studento';
import { daysUntil, isDue } from '@/lib/study-logic';
import { useStudy } from '@/lib/study-store';
import { Icon } from './ui';

const clock = (min: number) => {
  const h = Math.floor(min / 60), m = min % 60;
  return `${h % 12 || 12}:${String(m).padStart(2, '0')}`;
};
const when = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

export function TodayStrip() {
  const t = useTheme();
  const { s } = useSettings();
  const { s: sched } = useSchedule();
  const study = useStudy();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(i);
  }, []);

  const items: { key: string; icon: string; text: string; go: string }[] = [];

  if (s.scheduleUnlocked && sched.studento) {
    const w = whereNow({ periods: studentoDay(sched.studento, now).periods, theme: 0 }, now);
    if (w.kind === 'class') items.push({ key: 'class', icon: 'clock', text: `${w.period.name}, ${Math.max(1, Math.ceil(w.left / 60))} min left`, go: '/clock' });
    else if (w.kind === 'passing') items.push({ key: 'class', icon: 'clock', text: `${w.next.name} at ${clock(w.next.start)}`, go: '/clock' });
  }

  const due = study.decks.reduce((n, d) => n + d.cards.filter((c) => isDue(c, now.getTime())).length, 0);
  if (due) items.push({ key: 'cards', icon: 'rectangle.on.rectangle', text: `${due} ${due === 1 ? 'card' : 'cards'} to review`, go: '/flashcards' });

  const open = study.homework.filter((h) => !h.done);
  const soon = open.filter((h) => h.due && daysUntil(h.due, now) <= 1);
  if (soon.length) items.push({ key: 'hw', icon: 'checkmark.circle', text: `${soon.length} homework due soon`, go: '/study' });
  else if (open.length) items.push({ key: 'hw', icon: 'checkmark.circle', text: `${open.length} homework open`, go: '/study' });

  const test = study.tests
    .map((x) => ({ name: x.name, days: daysUntil(x.date, now) }))
    .filter((x) => x.days >= 0 && x.days <= 14)
    .sort((a, b) => a.days - b.days)[0];
  if (test) items.push({ key: 'test', icon: 'calendar', text: `${test.name} ${when(test.days)}`, go: '/study' });

  if (!items.length) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 8, marginTop: 16 }}>
      {items.map((x) => (
        <Pressable key={x.key} accessibilityLabel={x.text} onPress={() => router.push(x.go as never)}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, opacity: pressed ? 0.6 : 1 })}>
          <Icon name={x.icon} size={14} color={t.sub} />
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 13, fontWeight: '500', maxWidth: 240 }}>{x.text}</Text>
        </Pressable>
      ))}
    </View>
  );
}
