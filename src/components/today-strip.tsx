// A quiet line on Home: what's due. Only what applies shows.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Reanimated, { FadeIn, FadeOut, LinearTransition, useReducedMotion } from 'react-native-reanimated';

import { useTheme } from '@/lib/settings';
import { daysUntil, isDue } from '@/lib/study-logic';
import { useStudy } from '@/lib/study-store';
import { Icon } from './ui';

const when = (days: number) => (days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`);

export function TodayStrip() {
  const t = useTheme();
  const study = useStudy();
  const still = useReducedMotion();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(i);
  }, []);

  const items: { key: string; icon: string; text: string; go: string }[] = [];

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
        <Reanimated.View key={x.key} entering={still ? undefined : FadeIn.duration(200)} exiting={still ? undefined : FadeOut.duration(160)} layout={still ? undefined : LinearTransition.duration(200)}>
          <Pressable accessibilityLabel={x.text} onPress={() => router.push(x.go as never)}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, opacity: pressed ? 0.6 : 1 })}>
            <Icon name={x.icon} size={14} color={t.sub} />
            <Text numberOfLines={1} style={{ color: t.text, fontSize: 13, fontWeight: '500', maxWidth: 240 }}>{x.text}</Text>
          </Pressable>
        </Reanimated.View>
      ))}
    </View>
  );
}
