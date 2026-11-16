// On Home: a way into today's note, and the notes whose review has come round.
import { router } from 'expo-router';
import { Pressable, Text, View } from 'react-native';

import { dueNotes, streakOf } from '@/lib/extras';
import { useLibrary } from '@/lib/library';
import { useSettings, useTheme } from '@/lib/settings';
import { Icon } from './ui';

export function HomeStrip({ onToday }: { onToday: () => void }) {
  const t = useTheme();
  const lib = useLibrary();
  const { s } = useSettings();
  const due = dueNotes(lib.lib.notes).slice(0, 6);
  const streak = streakOf(s.days);
  const old = lib.lib.notes.filter((n) => !n.trashed);
  const surprise = () => { const n = old[Math.floor(Math.random() * old.length)]; if (n) router.push(`/note/${n.id}`); };
  const chip = (key: string, icon: string, text: string, go: () => void, tint?: string) => (
    <Pressable key={key} accessibilityLabel={text} onPress={go}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 13, borderRadius: 17, backgroundColor: tint ? tint + '1A' : t.card, borderWidth: 1, borderColor: tint ? tint + '55' : t.line, opacity: pressed ? 0.6 : 1 })}>
      <Icon name={icon} size={14} color={tint ?? t.sub} />
      <Text numberOfLines={1} style={{ color: t.text, fontSize: 13, fontWeight: '500', maxWidth: 220 }}>{text}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
      {chip('today', 'calendar', "Today's note", onToday, t.accent)}
      {streak >= 2 ? chip('streak', 'flame.fill', `${streak}-day streak`, () => {}, '#F76B15') : null}
      {old.length >= 4 ? chip('surprise', 'shuffle', 'Open a random note', surprise) : null}
      {due.map((n) => chip(n.id, 'bell.fill', `Review: ${n.title}`, () => router.push(`/note/${n.id}`), '#E8590C'))}
    </View>
  );
}
