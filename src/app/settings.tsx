// Settings: how Quill looks and writes, Google (Classroom + Drive), and redeem codes.
import Constants from 'expo-constants';
import { router } from 'expo-router';
import type { ReactNode } from 'react';
import { Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton } from '@/components/ui';
import { openLink } from '@/lib/classroom';
import { NOTES_SITE } from '@/lib/drive';
import { useSettings, useTheme } from '@/lib/settings';

export default function SettingsScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { s, set } = useSettings();
  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));

  const Section = ({ title, children }: { title: string; children: ReactNode }) => (
    <View style={{ gap: 6 }}>
      <Text style={{ color: t.faint, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6, paddingHorizontal: 6 }}>{title.toUpperCase()}</Text>
      <View style={{ borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>{children}</View>
    </View>
  );
  const Row = ({ icon, label, note, right, onPress, last }: { icon: string; label: string; note?: string; right?: ReactNode; onPress?: () => void; last?: boolean }) => (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, minHeight: 52, paddingVertical: 8, backgroundColor: pressed ? t.chip : 'transparent', borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line })}>
      <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: t.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={15} color={t.accent} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
        {note ? <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>{note}</Text> : null}
      </View>
      {right ?? (onPress ? <Icon name="chevron.right" size={13} color={t.faint} /> : null)}
    </Pressable>
  );
  const Choice = ({ value, options }: { value: string; options: { id: string; label: string }[] }) => (
    <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2 }}>
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => set({ theme: o.id as 'system' | 'light' | 'dark' })}
          style={{ paddingHorizontal: 12, height: 28, borderRadius: 7, justifyContent: 'center', backgroundColor: value === o.id ? t.elev : 'transparent' }}>
          <Text style={{ color: value === o.id ? t.text : t.sub, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52, gap: 4 }}>
        <IconButton name="chevron.left" label="Back to notes" onPress={back} />
        <Text style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: '800', marginLeft: 6 }}>Settings</Text>
      </View>
      <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 60, gap: 24, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
        <Section title="Tools">
          <Row icon="graduationcap" label="Classroom" note="Assignments and hand in." onPress={() => router.push('/classroom')} />
          <Row icon="function" label="Calculator" onPress={() => router.push('/calculator')} />
          <Row icon="clock" label={s.scheduleUnlocked ? 'My schedule' : 'Clock'} onPress={() => router.push('/clock')} last={!s.gamesUnlocked} />
          {s.gamesUnlocked ? <Row icon="gamecontroller" label="Games" onPress={() => router.push('/games')} last /> : null}
        </Section>

        <Section title="Look">
          <Row icon="circle.lefthalf.filled" label="Appearance" last
            right={<Choice value={s.theme === 'dark' ? 'dark' : 'light'} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />} />
        </Section>

        <Section title="Writing">
          <Row icon="hand.draw" label="Draw with finger" onPress={() => set({ fingerDraws: !s.fingerDraws })} note="Off: only Apple Pencil writes, fingers scroll and zoom."
            right={<Switch value={!!s.fingerDraws} onValueChange={(v) => set({ fingerDraws: v })} />} />
          <Row icon="triangle" label="Shape lock" onPress={() => set({ holdToShape: s.holdToShape === false })} note="Draw a line, circle, box or triangle and hold the Pencil still: it snaps clean."
            right={<Switch value={s.holdToShape !== false} onValueChange={(v) => set({ holdToShape: v })} />} />
          <Row icon="doc.badge.plus" label="Add pages automatically" onPress={() => set({ autoPage: s.autoPage === false })} note="Write on the last page and a blank one appears after it. An empty last page is left out when you share or hand in."
            right={<Switch value={s.autoPage !== false} onValueChange={(v) => set({ autoPage: v })} />} />
          <Row icon="speedometer" label="Show ink speed" onPress={() => set({ inkStats: !s.inkStats })} note="Numbers on the page showing how fast the ink is on this iPad."
            right={<Switch value={!!s.inkStats} onValueChange={(v) => set({ inkStats: v })} />} last />
        </Section>

        <Section title="Google">
          <Row icon="arrow.triangle.2.circlepath" label="Keep notes synced to Google Drive" onPress={() => set({ driveSync: !s.driveSync })} note="Saved to Drive › Quill when you leave a note."
            right={<Switch value={!!s.driveSync} onValueChange={(v) => set({ driveSync: v })} />} />
          <Row icon="globe" label="My notes online" note="quill-study.pages.dev/notes" onPress={() => openLink(NOTES_SITE)} last />
        </Section>

        <Section title="Extras">
          <Row icon="ticket" label="Redeem a code" onPress={() => router.push('/redeem')} last />
        </Section>

        <Text style={{ color: t.faint, fontSize: 13, textAlign: 'center' }}>Quill {Constants.expoConfig?.version ?? ''}</Text>
      </ScrollView>
    </View>
  );
}
