// Small building blocks for the Study hub: calm cards, big tiles, a back header and gentle motion.
import { type ReactNode, useEffect } from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import Reanimated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withDelay, withTiming } from 'react-native-reanimated';

import { Icon, PressScale } from '@/components/ui';
import { useTheme } from '@/lib/settings';

export const GREEN = '#30A46C';
export const ORANGE = '#D97706';
export const PURPLE = '#8E5CF7';
export const TEAL = '#0FA5A5';
export const PINK = '#E5487D';
export const ease = Easing.out(Easing.cubic);
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.max(0, s) % 60).padStart(2, '0')}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Fades and slides in once, about 220 ms. `dx`/`dy` is where it starts from. */
export function Enter({ dx = 0, dy = 0, delay = 0, children, style }: { dx?: number; dy?: number; delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const reduced = useReducedMotion();
  const p = useSharedValue(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) return;
    p.value = withDelay(delay, withTiming(1, { duration: 220, easing: ease }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const look = useAnimatedStyle(() => ({ opacity: p.value, transform: [{ translateX: (1 - p.value) * dx }, { translateY: (1 - p.value) * dy }] }));
  return <Reanimated.View style={[style, look]}>{children}</Reanimated.View>;
}

/** A filled bar that grows to its value. */
export function Bar({ value, color, height = 8 }: { value: number; color: string; height?: number }) {
  const t = useTheme();
  const w = useSharedValue(0);
  useEffect(() => { w.value = withTiming(Math.max(0, Math.min(1, value)), { duration: 420, easing: ease }); }, [value, w]);
  const look = useAnimatedStyle(() => ({ width: `${w.value * 100}%` }));
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: t.chip, overflow: 'hidden' }}>
      <Reanimated.View style={[{ height, borderRadius: height / 2, backgroundColor: color }, look]} />
    </View>
  );
}

export function Box({ children, style, title, right }: { children: ReactNode; style?: StyleProp<ViewStyle>; title?: string; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={[{ padding: 20, borderRadius: 18, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, gap: 12 }, style]}>
      {title ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: 24 }}>
          <Text style={{ flex: 1, color: t.text, fontSize: 17, fontWeight: '700' }}>{title}</Text>
          {right}
        </View>
      ) : null}
      {children}
    </View>
  );
}

/** A large hub tile: tinted icon, a name and one line about it. */
export function Tile({ icon, color, title, sub, onPress, badge }: { icon: string; color: string; title: string; sub: string; onPress: () => void; badge?: string }) {
  const t = useTheme();
  return (
    <PressScale label={title} onPress={onPress} style={{ minHeight: 140, padding: 18, borderRadius: 20, backgroundColor: t.card, borderWidth: 1, borderColor: t.line, justifyContent: 'space-between', gap: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
        <View style={{ width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}1F` }}>
          <Icon name={icon} size={22} color={color} />
        </View>
        <View style={{ flex: 1 }} />
        {badge ? (
          <View style={{ paddingHorizontal: 9, height: 24, borderRadius: 12, justifyContent: 'center', backgroundColor: color }}>
            <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>{badge}</Text>
          </View>
        ) : null}
      </View>
      <View style={{ gap: 3 }}>
        <Text style={{ color: t.text, fontSize: 18, fontWeight: '700' }}>{title}</Text>
        <Text numberOfLines={2} style={{ color: t.sub, fontSize: 14, lineHeight: 19 }}>{sub}</Text>
      </View>
    </PressScale>
  );
}

/** The top of a sub-view: a back control and a big title. */
export function SubHeader({ title, onBack, right }: { title: string; onBack: () => void; right?: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6, marginBottom: 4 }}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back to Study" onPress={onBack} hitSlop={10} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 2, opacity: pressed ? 0.5 : 1, paddingVertical: 4 })}>
        <Icon name="chevron.left" size={18} color={t.accent} />
        <Text style={{ color: t.accent, fontSize: 16, fontWeight: '500' }}>Study</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Text style={{ flex: 1, color: t.text, fontSize: 30, fontWeight: '800', letterSpacing: -0.4 }}>{title}</Text>
        {right}
      </View>
    </View>
  );
}

/** A wide row button used inside sub-views. */
export function RowButton({ icon, color, title, sub, onPress, disabled }: { icon: string; color: string; title: string; sub?: string; onPress: () => void; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} disabled={disabled} onPress={onPress}
      style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 14, borderRadius: 14, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line, opacity: disabled ? 0.45 : 1 })}>
      <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: `${color}1F` }}>
        <Icon name={icon} size={19} color={color} />
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{title}</Text>
        {sub ? <Text style={{ color: t.sub, fontSize: 13.5 }}>{sub}</Text> : null}
      </View>
      <Icon name="chevron.right" size={15} color={t.faint} />
    </Pressable>
  );
}

/** A quiet line saying something was made on the iPad with no internet. */
export function OfflineNote({ text = 'Made offline on this iPad from your own words.' }: { text?: string }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name="wifi.slash" size={13} color={t.faint} />
      <Text style={{ color: t.faint, fontSize: 12.5 }}>{text}</Text>
    </View>
  );
}

export function Empty({ text }: { text: string }) {
  const t = useTheme();
  return <Text style={{ color: t.sub, fontSize: 15, lineHeight: 21 }}>{text}</Text>;
}
