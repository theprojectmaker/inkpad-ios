// Settings: tabs down the left (General, Writing, Pencil & Touch, Paper & Pages, Sync & Backup,
// Study, Privacy, About) and that tab's rows on the right, like the iPad's own Settings app.
import Constants from 'expo-constants';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';
import { requireNativeModule } from 'expo-modules-core';
import * as Sharing from 'expo-sharing';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, useWindowDimensions, View } from 'react-native';
import Animated, { cancelAnimation, Easing, useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon, IconButton } from '@/components/ui';
import { openLink } from '@/lib/classroom';
import { NOTES_SITE } from '@/lib/drive';
import { syncNow, useCloud, type NetKind } from '@/lib/icloud';
import { useLibrary } from '@/lib/library';
import type { PageSizeId, PaperColor, PaperStyle } from '@/lib/model';
import { PAGE_SIZES } from '@/lib/model';
import { PAPERS, PAPER_STYLES } from '@/lib/paper';
import { DEFAULTS, RESET_KEEPS, useSettings, useTheme, type Settings } from '@/lib/settings';

type TabId = 'general' | 'writing' | 'pencil' | 'paper' | 'sync' | 'study' | 'privacy' | 'about';
const TABS: { id: TabId; label: string; icon: string; tint: string }[] = [
  { id: 'general', label: 'General', icon: 'gearshape', tint: '#8E8E93' },
  { id: 'writing', label: 'Writing', icon: 'pencil.tip', tint: '#FF9500' },
  { id: 'pencil', label: 'Pencil & Touch', icon: 'applepencil', tint: '#5856D6' },
  { id: 'paper', label: 'Paper & Pages', icon: 'doc.text', tint: '#34C759' },
  { id: 'sync', label: 'Sync & Backup', icon: 'icloud', tint: '#007AFF' },
  { id: 'study', label: 'Study', icon: 'book', tint: '#FF2D55' },
  { id: 'privacy', label: 'Privacy', icon: 'hand.raised', tint: '#30B0C7' },
  { id: 'about', label: 'About', icon: 'info.circle', tint: '#636366' },
];

// ---- Building blocks (module level, so switches keep their state between renders) ----

function Section({ title, footer, children }: { title?: string; footer?: string; children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {title ? <Text style={{ color: t.faint, fontSize: 12.5, fontWeight: '800', letterSpacing: 0.6, paddingHorizontal: 6 }}>{title.toUpperCase()}</Text> : null}
      <View style={{ borderRadius: 14, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, overflow: 'hidden' }}>{children}</View>
      {footer ? <Text style={{ color: t.faint, fontSize: 12.5, paddingHorizontal: 6 }}>{footer}</Text> : null}
    </View>
  );
}

function Row({ icon, label, note, right, below, onPress, last, danger }: {
  icon: string; label: string; note?: string; right?: ReactNode; below?: ReactNode; onPress?: () => void; last?: boolean; danger?: boolean;
}) {
  const t = useTheme();
  const c = danger ? t.danger : t.accent;
  return (
    <Pressable onPress={onPress} disabled={!onPress} accessibilityRole={onPress ? 'button' : undefined} accessibilityLabel={label}
      style={({ pressed }) => ({ paddingHorizontal: 14, paddingVertical: 8, minHeight: 52, justifyContent: 'center', backgroundColor: pressed ? t.chip : 'transparent', borderBottomWidth: last ? 0 : 1, borderBottomColor: t.line })}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
        <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: c + '1A', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name={icon} size={15} color={c} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: danger ? t.danger : t.text, fontSize: 16 }}>{label}</Text>
          {note ? <Text style={{ color: t.sub, fontSize: 13, marginTop: 2 }}>{note}</Text> : null}
        </View>
        {right ?? (onPress ? <Icon name="chevron.right" size={13} color={t.faint} /> : null)}
      </View>
      {below ? <View style={{ marginTop: 10, marginLeft: 42 }}>{below}</View> : null}
    </Pressable>
  );
}

function Choice<T extends string>({ value, options, onPick }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2 }}>
      {options.map((o) => (
        <Pressable key={o.id} onPress={() => onPick(o.id)} accessibilityRole="button" accessibilityState={{ selected: value === o.id }} accessibilityLabel={o.label}
          style={{ paddingHorizontal: 12, height: 28, borderRadius: 7, justifyContent: 'center', backgroundColor: value === o.id ? t.elev : 'transparent' }}>
          <Text style={{ color: value === o.id ? t.text : t.sub, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Chips<T extends string>({ value, options, onPick }: { value: T; options: { id: T; label: string }[]; onPick: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      {options.map((o) => {
        const on = value === o.id;
        return (
          <Pressable key={o.id} onPress={() => onPick(o.id)} accessibilityRole="button" accessibilityState={{ selected: on }} accessibilityLabel={o.label}
            style={{ paddingHorizontal: 12, height: 30, borderRadius: 15, justifyContent: 'center', backgroundColor: on ? t.accent : t.chip }}>
            <Text style={{ color: on ? t.accentText : t.text, fontSize: 13, fontWeight: '600' }}>{o.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const Toggle = ({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) => (
  <Switch accessibilityLabel={label} value={value} onValueChange={onChange} />
);

/** Two arrows that turn while iCloud is syncing. */
function SyncSpinner({ busy, color }: { busy: boolean; color: string }) {
  const r = useSharedValue(0);
  useEffect(() => {
    if (busy) { r.value = 0; r.value = withRepeat(withTiming(360, { duration: 900, easing: Easing.linear }), -1, false); }
    else { cancelAnimation(r); r.value = withTiming(0, { duration: 150 }); }
  }, [busy, r]);
  const st = useAnimatedStyle(() => ({ transform: [{ rotate: `${r.value}deg` }] }));
  return <Animated.View style={st}><Icon name="arrow.triangle.2.circlepath" size={22} color={color} /></Animated.View>;
}

const NET_NAME: Record<NetKind, string> = { wifi: 'Wi-Fi', wired: 'Wired', cellular: 'Cellular', none: 'Offline', other: '' };
const STREAM: { id: string; label: string; v: number }[] = [
  { id: 'off', label: 'Off', v: 0 }, { id: 'low', label: 'Light', v: 0.3 }, { id: 'mid', label: 'Medium', v: 0.6 }, { id: 'high', label: 'Strong', v: 0.9 },
];
const FONTS: { id: string; label: string }[] = [
  { id: 'system', label: 'System' }, { id: 'serif', label: 'Serif' }, { id: 'mono', label: 'Mono' }, { id: 'hand', label: 'Hand' }, { id: 'round', label: 'Round' },
];

// ---- The screen ----

export default function SettingsScreen() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const wide = width >= 700;
  const { s, set } = useSettings();
  const [tab, setTab] = useState<TabId>('general');
  const reduce = !!s.reduceMotion;

  // Cross-fade and a short slide towards the tab you picked (~200 ms); a plain fade with Reduce Motion.
  const p = useSharedValue(1);
  const dir = useSharedValue(1);
  const prevIdx = useRef(0);
  const pick = (id: TabId) => {
    if (id === tab) return;
    if (s.haptics !== false) Haptics.selectionAsync().catch(() => {});
    const i = TABS.findIndex((x) => x.id === id);
    dir.value = i >= prevIdx.current ? 1 : -1;
    prevIdx.current = i;
    setTab(id);
  };
  useEffect(() => {
    p.value = 0;
    p.value = withTiming(1, { duration: reduce ? 150 : 200, easing: Easing.out(Easing.cubic) });
  }, [tab, reduce, p]);
  const paneStyle = useAnimatedStyle(() => ({
    opacity: p.value,
    transform: reduce ? [] : wide ? [{ translateY: (1 - p.value) * 12 * dir.value }] : [{ translateX: (1 - p.value) * 16 * dir.value }],
  }));

  const back = () => (router.canGoBack() ? router.back() : router.replace('/'));
  const cur = TABS.find((x) => x.id === tab)!;

  const tabList = wide ? (
    <ScrollView style={{ width: 270, borderRightWidth: 1, borderRightColor: t.line, backgroundColor: t.side }} contentContainerStyle={{ padding: 12, gap: 2 }}>
      {TABS.map((x) => {
        const on = x.id === tab;
        return (
          <Pressable key={x.id} onPress={() => pick(x.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={x.label}
            style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, paddingHorizontal: 10, borderRadius: 11, backgroundColor: on ? t.accent : pressed ? t.chip : 'transparent' })}>
            <View style={{ width: 30, height: 30, borderRadius: 8, backgroundColor: on ? '#FFFFFF33' : x.tint, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name={x.icon} size={15} color="#FFFFFF" />
            </View>
            <Text style={{ color: on ? t.accentText : t.text, fontSize: 16, fontWeight: on ? '600' : '400' }}>{x.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  ) : (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }} contentContainerStyle={{ paddingHorizontal: 14, gap: 8, paddingBottom: 8 }}>
      {TABS.map((x) => {
        const on = x.id === tab;
        return (
          <Pressable key={x.id} onPress={() => pick(x.id)} accessibilityRole="tab" accessibilityState={{ selected: on }} accessibilityLabel={x.label}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 34, paddingHorizontal: 12, borderRadius: 17, backgroundColor: on ? t.accent : t.chip }}>
            <Icon name={x.icon} size={13} color={on ? t.accentText : t.sub} />
            <Text style={{ color: on ? t.accentText : t.text, fontSize: 14, fontWeight: '600' }}>{x.label}</Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, height: 52, gap: 4 }}>
        <IconButton name="chevron.left" label="Back to notes" onPress={back} />
        <Text style={{ flex: 1, color: t.text, fontSize: 22, fontWeight: '800', marginLeft: 6 }}>Settings</Text>
      </View>
      <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column', borderTopWidth: wide ? 1 : 0, borderTopColor: t.line }}>
        {tabList}
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 20, paddingBottom: 60 + ins.bottom, maxWidth: 700, width: '100%', alignSelf: 'center' }}>
          {wide ? <Text style={{ color: t.text, fontSize: 28, fontWeight: '800', marginBottom: 18, paddingHorizontal: 4 }}>{cur.label}</Text> : null}
          <Animated.View key={tab} style={[{ gap: 24 }, paneStyle]}>
            <Pane tab={tab} s={s} set={set} />
          </Animated.View>
        </ScrollView>
      </View>
    </View>
  );
}

function Pane({ tab, s, set }: { tab: TabId; s: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useTheme();
  switch (tab) {
    case 'general': return (
      <>
        <Section title="Look">
          <Row icon="circle.lefthalf.filled" label="Appearance"
            right={<Choice value={s.theme === 'dark' ? 'dark' : 'light'} onPick={(v) => set({ theme: v })} options={[{ id: 'light', label: 'Light' }, { id: 'dark', label: 'Dark' }]} />} />
          <Row icon="square.grid.2x2" label="Library view"
            right={<Choice value={s.view} onPick={(v) => set({ view: v })} options={[{ id: 'grid', label: 'Grid' }, { id: 'list', label: 'List' }]} />} />
          <Row icon="arrow.up.arrow.down" label="Sort notes by" last
            right={<Choice value={s.sort} onPick={(v) => set({ sort: v })} options={[{ id: 'updated', label: 'Edited' }, { id: 'created', label: 'Created' }, { id: 'title', label: 'Title' }]} />} />
        </Section>
        <Section title="Feel">
          <Row icon="iphone.radiowaves.left.and.right" label="Haptics" note="Little taps when you pick a tool or a shape snaps."
            onPress={() => set({ haptics: s.haptics === false })} right={<Toggle label="Haptics" value={s.haptics !== false} onChange={(v) => set({ haptics: v })} />} />
          <Row icon="figure.walk.motion" label="Reduce motion" note="Fades instead of slides." last
            onPress={() => set({ reduceMotion: !s.reduceMotion })} right={<Toggle label="Reduce motion" value={!!s.reduceMotion} onChange={(v) => set({ reduceMotion: v })} />} />
        </Section>
        <Section title="Safety">
          <Row icon="trash" label="Ask before deleting a note" last
            onPress={() => set({ confirmDelete: s.confirmDelete === false })} right={<Toggle label="Ask before deleting a note" value={s.confirmDelete !== false} onChange={(v) => set({ confirmDelete: v })} />} />
        </Section>
      </>
    );
    case 'writing': {
      const sv = s.streamline ?? 0;
      const near = STREAM.reduce((a, b) => (Math.abs(b.v - sv) < Math.abs(a.v - sv) ? b : a));
      return (
        <>
          <Section title="Handwriting">
            <Row icon="scribble" label="Scribble" note="In a text box, Pencil handwriting turns into typing."
              onPress={() => set({ scribble: s.scribble === false })} right={<Toggle label="Scribble" value={s.scribble !== false} onChange={(v) => set({ scribble: v })} />} />
            <Row icon="scribble.variable" label="Scribble out to erase" note="Scribble back and forth over writing to delete it, like crossing it out. Undo brings it back."
              onPress={() => set({ scratchOut: !s.scratchOut })} right={<Toggle label="Scribble out to erase" value={!!s.scratchOut} onChange={(v) => set({ scratchOut: v })} />} />
            <Row icon="highlighter" label="Straight highlighter" note="A nearly straight highlighter swipe comes out ruler-straight."
              onPress={() => set({ straightMarker: s.straightMarker === false })} right={<Toggle label="Straight highlighter" value={s.straightMarker !== false} onChange={(v) => set({ straightMarker: v })} />} />
            <Row icon="waveform.path" label="Pen smoothing" note="Evens out the wobble in your hand." last
              below={<Choice value={near.id} onPick={(id) => set({ streamline: STREAM.find((x) => x.id === id)!.v })} options={STREAM} />} />
          </Section>
          <Section title="Shapes">
            <Row icon="triangle" label="Hold to snap shapes" note="Draw a line, circle, box or triangle and hold the Pencil still: it snaps clean."
              onPress={() => set({ holdToShape: s.holdToShape === false })} right={<Toggle label="Hold to snap shapes" value={s.holdToShape !== false} onChange={(v) => set({ holdToShape: v })} />} />
            <Row icon="angle" label="Shape lock" note="Shape tool lines go in 15° steps, boxes come out square, ellipses round."
              onPress={() => set({ shapeLock: !s.shapeLock })} right={<Toggle label="Shape lock" value={!!s.shapeLock} onChange={(v) => set({ shapeLock: v })} />} />
            <Row icon="square.fill" label="Fill shapes" last
              onPress={() => set({ shapeFill: !s.shapeFill })} right={<Toggle label="Fill shapes" value={!!s.shapeFill} onChange={(v) => set({ shapeFill: v })} />} />
          </Section>
          <Section title="Typing">
            <Row icon="textformat" label="Text box font" last below={<Chips value={s.textFont ?? 'system'} onPick={(v) => set({ textFont: v })} options={FONTS} />} />
          </Section>
          <Section title="Diagnostics">
            <Row icon="speedometer" label="Show ink speed" note="Numbers on the page showing how fast the ink is on this iPad." last
              onPress={() => set({ inkStats: !s.inkStats })} right={<Toggle label="Show ink speed" value={!!s.inkStats} onChange={(v) => set({ inkStats: v })} />} />
          </Section>
        </>
      );
    }
    case 'pencil': return (
      <>
        <Section title="Apple Pencil and fingers">
          <Row icon="hand.draw" label="Draw with finger" note="Off: only Apple Pencil writes, fingers scroll and zoom." last
            onPress={() => set({ fingerDraws: !s.fingerDraws })} right={<Toggle label="Draw with finger" value={!!s.fingerDraws} onChange={(v) => set({ fingerDraws: v })} />} />
        </Section>
        <Section title="Tools">
          <Row icon="eraser" label="Eraser" note="What the eraser takes away."
            below={<Choice value={s.eraser ?? 'partial'} onPick={(v) => set({ eraser: v })} options={[{ id: 'partial', label: 'Partial' }, { id: 'stroke', label: 'Whole line' }, { id: 'hl', label: 'Highlighter only' }]} />} />
          <Row icon="lasso" label="Rectangle lasso" note="The lasso draws a box instead of a free loop." last
            onPress={() => set({ lassoBox: !s.lassoBox })} right={<Toggle label="Rectangle lasso" value={!!s.lassoBox} onChange={(v) => set({ lassoBox: v })} />} />
        </Section>
        <Section title="Toolbar">
          <Row icon="rectangle.topthird.inset.filled" label="Toolbar position"
            below={<Choice value={s.toolDock ?? 'top'} onPick={(v) => set({ toolDock: v })} options={[{ id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }, { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }]} />} />
          <Row icon="star" label="Favourites bar" note="The floating bar of your saved pens."
            onPress={() => set({ showFavs: s.showFavs === false })} right={<Toggle label="Favourites bar" value={s.showFavs !== false} onChange={(v) => set({ showFavs: v })} />} />
          <Row icon="arrow.counterclockwise" label="Reset toolbar" note="Every tool back on the toolbar, in the first order." last
            onPress={() => Alert.alert('Reset toolbar?', 'All tools come back in their first order.', [{ text: 'Cancel', style: 'cancel' }, { text: 'Reset', onPress: () => set({ toolOrder: undefined, toolHidden: undefined }) }])} />
        </Section>
      </>
    );
    case 'paper': {
      const dp = s.defaultPaper ?? { style: 'blank' as PaperStyle, color: 'white' as PaperColor, size: 'letter' as PageSizeId };
      const put = (patch: Partial<NonNullable<Settings['defaultPaper']>>) => set({ defaultPaper: { ...dp, ...patch } });
      return (
        <>
          <Section title="New notes" footer="New notes start on this paper. You can still change a note's paper inside it.">
            <Row icon="doc.text" label="Paper" below={<Chips value={dp.style} onPick={(v) => put({ style: v })} options={PAPER_STYLES.map((x) => ({ id: x.id, label: x.name }))} />} />
            <Row icon="paintpalette" label="Colour" below={
              <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
                {PAPERS.map((x) => {
                  const on = dp.color === x.id;
                  return (
                    <Pressable key={x.id} onPress={() => put({ color: x.id })} accessibilityRole="button" accessibilityLabel={`${x.name} paper`} accessibilityState={{ selected: on }} style={{ alignItems: 'center', gap: 4 }}>
                      <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: x.bg, borderWidth: on ? 3 : 1, borderColor: on ? t.accent : t.line }} />
                      <Text style={{ color: on ? t.accent : t.sub, fontSize: 11.5, fontWeight: '600' }}>{x.name}</Text>
                    </Pressable>
                  );
                })}
              </View>} />
            <Row icon="rectangle.portrait" label="Size" last below={<Chips value={dp.size ?? 'letter'} onPick={(v) => put({ size: v })} options={PAGE_SIZES.map((x) => ({ id: x.id, label: x.name }))} />} />
          </Section>
          <Section title="Pages">
            <Row icon="doc.badge.plus" label="Add pages automatically" note="Write on the last page and a blank one appears after it. An empty last page is left out when you share or hand in."
              onPress={() => set({ autoPage: s.autoPage === false })} right={<Toggle label="Add pages automatically" value={s.autoPage !== false} onChange={(v) => set({ autoPage: v })} />} />
            <Row icon="number" label="Page numbers" note="A small number under each page."
              onPress={() => set({ pageNumbers: !s.pageNumbers })} right={<Toggle label="Page numbers" value={!!s.pageNumbers} onChange={(v) => set({ pageNumbers: v })} />} />
            <Row icon="sun.max" label="Keep screen on" note="The iPad doesn't dim or lock while a note is open." last
              onPress={() => set({ keepAwake: !s.keepAwake })} right={<Toggle label="Keep screen on" value={!!s.keepAwake} onChange={(v) => set({ keepAwake: v })} />} />
          </Section>
        </>
      );
    }
    case 'sync': return <SyncPane s={s} set={set} />;
    case 'study': return (
      <>
        <Section title="Study tools">
          <Row icon="book" label="Study" note="Quizzes and review from your notes." onPress={() => router.push('/study')} />
          <Row icon="rectangle.on.rectangle" label="Flashcards" note="Import a deck and practise." onPress={() => router.push('/flashcards')} />
          <Row icon="books.vertical" label="Reference" onPress={() => router.push('/reference')} />
          <Row icon="function" label="Calculator" onPress={() => router.push('/calculator')} last />
        </Section>
        <Section title="School">
          <Row icon="graduationcap" label="Classroom" note="Assignments and hand in." onPress={() => router.push('/classroom')} last />
        </Section>
      </>
    );
    case 'privacy': return (
      <>
        <Section title="Your data" footer="Your notes stay on this iPad, plus iCloud and Google Drive only if you turn those on.">
          <Row icon="paintpalette" label="Clear recent colours" onPress={() => set({ recentColors: [] })} />
          <Row icon="square.and.arrow.up" label="Share zoom report" note="If zooming or scrolling goes wrong, send this right after. It holds only timings, nothing you wrote." last
            onPress={() => {
              try {
                const path = requireNativeModule<{ gestureLogPath(): string }>('QuillCanvas').gestureLogPath();
                Sharing.shareAsync('file://' + path, { mimeType: 'text/plain' }).catch(() => {});
              } catch {}
            }} />
        </Section>
        <Section title="Reset">
          <Row icon="arrow.counterclockwise" label="Reset all settings" danger last note="Your notes, pens and favourites are kept."
            onPress={() => Alert.alert('Reset all settings?', 'Every setting goes back to how it was at first. Your notes, pens and favourites stay.', [
              { text: 'Cancel', style: 'cancel' },
              { text: 'Reset', style: 'destructive', onPress: () => {
                const patch: Record<string, unknown> = {};
                for (const k of Object.keys({ ...DEFAULTS, ...s }) as (keyof Settings)[]) if (!RESET_KEEPS.includes(k)) patch[k] = DEFAULTS[k];
                set(patch as Partial<Settings>);
              } },
            ])} />
        </Section>
      </>
    );
    case 'about': return (
      <>
        <Section>
          <View style={{ alignItems: 'center', paddingVertical: 24, gap: 6 }}>
            <View style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
              <Icon name="pencil.tip" size={30} color="#FFFFFF" />
            </View>
            <Text style={{ color: t.text, fontSize: 22, fontWeight: '800', marginTop: 6 }}>Quill</Text>
            <Text style={{ color: t.sub, fontSize: 14 }}>Version {Constants.expoConfig?.version ?? '?'}</Text>
          </View>
        </Section>
        <Section>
          <Row icon="globe" label="My notes online" note="quill-study.pages.dev/notes" onPress={() => openLink(NOTES_SITE)} last />
        </Section>
      </>
    );
  }
}

function SyncPane({ s, set }: { s: Settings; set: (p: Partial<Settings>) => void }) {
  const t = useTheme();
  const cloud = useCloud();
  const lib = useLibrary();
  const [, tick] = useState(0);
  useEffect(() => { const i = setInterval(() => tick((n) => n + 1), 30_000); return () => clearInterval(i); }, []);

  const ago = (at: number) => { const m = Math.round((Date.now() - at) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`; };
  const clock = (at: number) => new Date(at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const usable = cloud.status === 'on' && s.icloud !== false;
  const title = cloud.status === 'unavailable' ? 'iCloud isn’t available'
    : cloud.status === 'signed-out' ? 'Not signed in to iCloud'
    : cloud.status === 'checking' ? 'Checking iCloud…'
    : s.icloud === false ? 'iCloud sync is off'
    : cloud.busy ? 'Syncing…'
    : cloud.net === 'none' ? 'Offline'
    : cloud.waiting && cloud.net === 'cellular' ? 'Waiting for Wi-Fi'
    : cloud.error ? 'Last sync failed'
    : cloud.at ? 'Up to date' : 'Ready to sync';
  const detail = cloud.status === 'unavailable' ? 'Not switched on in this version of Quill yet.'
    : cloud.status === 'signed-out' ? 'Sign in to iCloud and turn on iCloud Drive in the iPad’s Settings.'
    : s.icloud === false ? 'Notes stay on this iPad only.'
    : cloud.error ? `${cloud.error}${cloud.retryAt && cloud.retryAt > Date.now() ? ` · trying again ${new Date(cloud.retryAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : ''}`
    : cloud.waiting && cloud.net === 'cellular' ? 'Your notes sync as soon as you’re on Wi-Fi.'
    : 'Notes sync between your devices on their own.';
  const tone = cloud.error ? t.danger : usable ? t.accent : t.faint;
  const net = NET_NAME[cloud.net];

  return (
    <>
      <Section>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
          <View style={{ width: 46, height: 46, borderRadius: 23, backgroundColor: tone + '1A', alignItems: 'center', justifyContent: 'center' }}>
            {usable ? <SyncSpinner busy={cloud.busy} color={tone} /> : <Icon name="icloud.slash" size={22} color={tone} />}
          </View>
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
            <Text style={{ color: t.sub, fontSize: 13 }}>{detail}</Text>
            <Text style={{ color: t.faint, fontSize: 12.5 }}>
              {cloud.at ? `Last synced ${clock(cloud.at)} (${ago(cloud.at)})` : 'Not synced yet'}{net ? ` · ${net}` : ''}
            </Text>
          </View>
          <Pressable disabled={!usable || cloud.busy} accessibilityRole="button" accessibilityLabel="Sync now"
            onPress={() => { syncNow(lib.current, lib.adopt).catch(() => {}); }}
            style={({ pressed }) => ({ paddingHorizontal: 14, height: 34, borderRadius: 17, justifyContent: 'center', backgroundColor: t.accent, opacity: !usable || cloud.busy ? 0.4 : pressed ? 0.7 : 1 })}>
            <Text style={{ color: t.accentText, fontSize: 14, fontWeight: '700' }}>{cloud.busy ? 'Syncing' : 'Sync now'}</Text>
          </Pressable>
        </View>
      </Section>
      <Section title="iCloud" footer="Quill checks your connection while it's open and syncs the moment Wi-Fi comes back. Failed syncs try again after 30 seconds, 2 minutes, then every 10 minutes.">
        <Row icon="icloud" label="Sync notes with iCloud"
          right={<Switch accessibilityLabel="Sync notes with iCloud" disabled={cloud.status !== 'on'} value={cloud.status === 'on' && s.icloud !== false} onValueChange={(v) => set({ icloud: v })} />} />
        <Row icon="wifi" label="Sync only on Wi-Fi" note="Off: syncs on cellular data too." last
          onPress={() => set({ wifiOnlySync: s.wifiOnlySync === false })}
          right={<Toggle label="Sync only on Wi-Fi" value={s.wifiOnlySync !== false} onChange={(v) => set({ wifiOnlySync: v })} />} />
      </Section>
      <Section title="Google Drive">
        <Row icon="arrow.triangle.2.circlepath" label="Back up notes to Google Drive" note="Saved to Drive › Quill as a PDF when you leave a note."
          onPress={() => set({ driveSync: !s.driveSync })} right={<Toggle label="Back up notes to Google Drive" value={!!s.driveSync} onChange={(v) => set({ driveSync: v })} />} />
        <Row icon="globe" label="My notes online" note="quill-study.pages.dev/notes" onPress={() => openLink(NOTES_SITE)} last />
      </Section>
    </>
  );
}
