// Small shared UI pieces: icons, buttons, sheets, prompts, toasts.
import { GlassView, isLiquidGlassAvailable } from 'expo-glass-effect';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Component, createContext, Fragment, type ErrorInfo, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewProps, type ViewStyle, type StyleProp } from 'react-native';
import Reanimated, { FadeIn, FadeInDown, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';

import { useSettings, useTheme } from '@/lib/settings';

// SF Symbols on iOS; a plain glyph in the web preview.
const FALLBACK: Record<string, string> = {
  'pencil.tip': '✎', 'highlighter': '▮', 'eraser': '⌫', 'lasso': '◌', 'textformat': 'T', 'hand.raised': '✋',
  'arrow.uturn.backward': '↶', 'arrow.uturn.forward': '↷', 'square.grid.2x2': '▦', 'list.bullet': '☰',
  'plus': '+', 'magnifyingglass': '⌕', 'star': '☆', 'star.fill': '★', 'folder': '▭', 'trash': '🗑', 'xmark': '✕',
  'square.and.arrow.up': '⇪', 'ellipsis': '⋯', 'chevron.left': '‹', 'chevron.right': '›', 'sidebar.left': '◧',
  'rectangle.split.2x1': '◫', 'photo': '▣', 'face.smiling': '☺', 'doc': '▤', 'doc.on.doc': '⎘', 'gearshape': '⚙',
  'books.vertical': '▥', 'clock': '◷', 'tray': '▱', 'arrow.up.arrow.down': '⇅', 'pencil': '✎', 'checkmark': '✓',
  'moon': '☾', 'sun.max': '☼', 'doc.badge.plus': '⊞', 'arrow.up': '↑', 'arrow.down': '↓', 'plus.square.on.square': '⧉',
  'scissors': '✂', 'doc.on.clipboard': '📋', 'square.on.square': '⧉', 'paintpalette': '◍', 'scribble': '〰',
  'hand.draw': '✍', 'pencil.and.outline': '✎', 'square.and.pencil': '✎', 'folder.badge.plus': '⊕', 'arrow.right.square': '⇥', 'play.fill': '▶', 'wand.and.rays': '✦', 'square.on.circle': '◰', 'rectangle.fill': '▬', 'photo.on.rectangle': '🖼', 'checkmark.circle.fill': '✔', 'circle': '○', 'minus': '−', 'arrow.up.left.and.arrow.down.right': '⤢', 'pause.fill': '❚❚', 'mic': '🎙', 'mic.fill': '🎙', 'eyedropper': '◍',
};

export function Icon({ name, size = 20, color }: { name: string; size?: number; color?: string }) {
  const t = useTheme();
  const c = color ?? t.text;
  if (Platform.OS === 'ios') {
    return <SymbolView name={name as SFSymbol} size={size} tintColor={c} weight="medium" resizeMode="scaleAspectFit" style={{ width: size + 2, height: size + 2 }}
      fallback={<Text style={{ fontSize: size * 0.9, color: c }}>{FALLBACK[name] ?? '•'}</Text>} />;
  }
  return <Text style={{ fontSize: size * 0.9, color: c, width: size + 4, textAlign: 'center', lineHeight: size + 4 }}>{FALLBACK[name] ?? '•'}</Text>;
}

export function IconButton({ name, onPress, active, disabled, size = 20, label, style, color, onLongPress }: {
  name: string; onPress?: () => void; active?: boolean; disabled?: boolean; size?: number; label?: string; style?: ViewStyle; color?: string; onLongPress?: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label ?? name} onPress={onPress} onLongPress={onLongPress} disabled={disabled} hitSlop={6}
      style={({ pressed }) => [{ minWidth: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, flexDirection: 'row', gap: 6,
        backgroundColor: active ? t.accent + (t.dark ? '33' : '1F') : pressed ? t.chip : 'transparent', opacity: disabled ? 0.35 : 1 }, style]}>
      <Icon name={name} size={size} color={color ?? (active ? t.accent : t.text)} />
      {label && style?.paddingHorizontal ? <Text style={{ color: active ? t.accent : t.text, fontSize: 15, fontWeight: '500' }}>{label}</Text> : null}
    </Pressable>
  );
}

export function Button({ title, onPress, kind = 'plain', disabled, icon }: { title: string; onPress: () => void; kind?: 'primary' | 'plain' | 'danger'; disabled?: boolean; icon?: string }) {
  const t = useTheme();
  const bg = kind === 'primary' ? t.accent : kind === 'danger' ? t.danger : t.chip;
  const fg = kind === 'plain' ? t.text : '#fff';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={title} onPress={onPress} disabled={disabled} style={({ pressed }) => ({ backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.85 : 1, transform: [{ scale: pressed ? 0.97 : 1 }], paddingHorizontal: 18, height: 46, borderRadius: 14, borderCurve: 'continuous', alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 })}>
      {icon ? <Icon name={icon} size={17} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

/** A centred card on a dimmed backdrop. */
/** Gives under the finger and comes back gently. */
export function PressScale({ onPress, onLongPress, label, style, children, delayLongPress }: {
  onPress?: () => void; onLongPress?: () => void; label?: string; style?: StyleProp<ViewStyle>; children: ReactNode; delayLongPress?: number;
}) {
  const k = useSharedValue(1);
  const look = useAnimatedStyle(() => ({ transform: [{ scale: k.value }] }));
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} onLongPress={onLongPress} delayLongPress={delayLongPress}
      onPressIn={() => { k.value = withTiming(0.975, { duration: 90 }); }} onPressOut={() => { k.value = withTiming(1, { duration: 180 }); }}>
      <Reanimated.View style={[style, look]}>{children}</Reanimated.View>
    </Pressable>
  );
}

export function Sheet({ visible, onClose, children, width = 420, title, topRight }: { visible: boolean; onClose: () => void; children: ReactNode; width?: number; title?: string; topRight?: boolean }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable accessibilityLabel="Close" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.36)' }]} onPress={onClose} />
        <View style={topRight ? { flex: 1, alignItems: 'flex-end', justifyContent: 'flex-start', paddingTop: 70, paddingRight: 12 } : { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }} pointerEvents="box-none">
          <Reanimated.View entering={topRight ? FadeIn.duration(130) : FadeInDown.duration(240)} style={{ width: '100%', maxWidth: width, maxHeight: '90%', backgroundColor: t.elev, borderRadius: 26, borderCurve: 'continuous', padding: 20, shadowColor: '#000', shadowOpacity: 0.24, shadowRadius: 32, shadowOffset: { width: 0, height: 14 } }}>
            {title ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <Text numberOfLines={2} style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', letterSpacing: -0.3 }}>{title}</Text>
                <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} hitSlop={10} style={({ pressed }) => ({ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip, opacity: pressed ? 0.6 : 1 })}>
                  <Icon name="xmark" size={12} color={t.sub} />
                </Pressable>
              </View>
            ) : null}
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          </Reanimated.View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type MenuItem = { label: string; icon?: string; onPress: () => void; danger?: boolean; checked?: boolean; sub?: string; group?: number };

export function MenuSheet({ visible, onClose, title, items, topRight }: { visible: boolean; onClose: () => void; title?: string; items: MenuItem[]; topRight?: boolean }) {
  const t = useTheme();
  // One tap per opening, and the action waits until the sheet has gone, so a
  // picker or another sheet it opens isn't dropped by iOS mid-dismiss.
  const fired = useRef(false);
  useEffect(() => { if (visible) fired.current = false; }, [visible]);
  return (
    <Sheet visible={visible} onClose={onClose} title={title} width={topRight ? 320 : 360} topRight={topRight}>
      {topRight && items.some((x) => x.group != null) ? [...new Set(items.map((x) => x.group ?? 0))].map((g) => (
        <View key={g} style={{ borderRadius: 12, backgroundColor: t.dark ? t.chip : '#ECEDF1', marginBottom: 12, overflow: 'hidden' }}>
          {items.filter((x) => (x.group ?? 0) === g).map((it, i) => (
            <Pressable key={i} accessibilityRole="button" accessibilityLabel={it.label} onPress={() => { if (fired.current) return; fired.current = true; onClose(); setTimeout(it.onPress, Platform.OS === 'ios' ? 380 : 60); }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingVertical: 8, paddingHorizontal: 14, borderTopWidth: i ? StyleSheet.hairlineWidth : 0, borderTopColor: t.line, opacity: pressed ? 0.6 : 1 })}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: it.danger ? t.danger : t.text, fontSize: 16 }}>{it.label}</Text>
                {it.sub ? <Text style={{ color: t.faint, fontSize: 12.5, marginTop: 1 }}>{it.sub}</Text> : null}
              </View>
              {it.checked ? <Icon name="checkmark" size={15} color={t.accent} /> : it.icon ? <Icon name={it.icon} size={18} color={t.sub} /> : null}
            </Pressable>
          ))}
        </View>
      )) : items.map((it, i) => (
        <Pressable key={i} accessibilityRole="button" accessibilityLabel={it.label} testID={`menu-${it.label}`} onPress={() => { if (fired.current) return; fired.current = true; onClose(); setTimeout(it.onPress, Platform.OS === 'ios' ? 380 : 60); }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 13, minHeight: 48, paddingVertical: 8, paddingHorizontal: 10, borderRadius: 12, borderCurve: 'continuous', backgroundColor: pressed ? t.chip : 'transparent',
            // A hairline where one group of items ends and the next begins.
            marginTop: i && it.group !== items[i - 1].group ? 9 : 0, borderTopWidth: 0 })}>
          {it.icon ? <Icon name={it.icon} size={19} color={it.danger ? t.danger : it.checked ? t.accent : t.text} /> : null}
          <View style={{ flex: 1 }}>
            <Text style={{ color: it.danger ? t.danger : t.text, fontSize: 16 }}>{it.label}</Text>
            {it.sub ? <Text numberOfLines={2} style={{ color: t.faint, fontSize: 12.5, marginTop: 1 }}>{it.sub}</Text> : null}
          </View>
          {it.checked ? <Icon name="checkmark" size={16} color={t.accent} /> : null}
        </Pressable>
      ))}
    </Sheet>
  );
}

export function PromptSheet({ visible, title, initial = '', placeholder, confirm = 'Save', onCancel, onSubmit }: {
  visible: boolean; title: string; initial?: string; placeholder?: string; confirm?: string; onCancel: () => void; onSubmit: (v: string) => void;
}) {
  const t = useTheme();
  const [v, setV] = useState(initial);
  useEffect(() => { if (visible) setV(initial); }, [visible, initial]);
  return (
    <Sheet visible={visible} onClose={onCancel} title={title} width={400}>
      <TextInput value={v} onChangeText={setV} placeholder={placeholder} placeholderTextColor={t.faint} autoFocus selectTextOnFocus
        onSubmitEditing={() => onSubmit(v)} returnKeyType="done"
        style={{ color: t.text, fontSize: 17, borderRadius: 13, borderCurve: 'continuous', paddingHorizontal: 14, height: 48, backgroundColor: t.chip }} />
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 16 }}>
        <Button title="Cancel" onPress={onCancel} />
        <Button title={confirm} kind="primary" onPress={() => onSubmit(v)} />
      </View>
    </Sheet>
  );
}

export function ConfirmSheet({ visible, title, message, confirm = 'Delete', onCancel, onConfirm }: { visible: boolean; title: string; message?: string; confirm?: string; onCancel: () => void; onConfirm: () => void }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onCancel} title={title} width={380}>
      {message ? <Text style={{ color: t.sub, fontSize: 15, lineHeight: 21 }}>{message}</Text> : null}
      <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 18 }}>
        <Button title="Cancel" onPress={onCancel} />
        <Button title={confirm} kind="danger" onPress={onConfirm} />
      </View>
    </Sheet>
  );
}

// ---------- toast + busy overlay ----------

type Toaster = { toast: (msg: string) => void; busy: (msg: string | null) => void };
const ToastCtx = createContext<Toaster>({ toast: () => {}, busy: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const t = useTheme();
  const [msg, setMsg] = useState<string | null>(null);
  const [busyMsg, setBusy] = useState<string | null>(null);
  const op = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toast = useCallback((m: string) => {
    setMsg(m);
    Animated.timing(op, { toValue: 1, duration: 160, useNativeDriver: Platform.OS !== 'web' }).start();
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(({ finished }) => { if (finished) setMsg(null); }), 2600);
  }, [op]);
  const busy = useCallback((m: string | null) => setBusy(m), []);
  return (
    <ToastCtx.Provider value={{ toast, busy }}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 44, alignSelf: 'center', opacity: op, transform: [{ translateY: op.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }], backgroundColor: t.dark ? '#F1F2F4' : 'rgba(28,29,33,0.94)', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 24, maxWidth: 520, shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 16, shadowOffset: { width: 0, height: 6 } }}>
          <Text style={{ color: t.dark ? '#111' : '#fff', fontSize: 15, fontWeight: '500', textAlign: 'center' }}>{msg}</Text>
        </Animated.View>
      ) : null}
      {busyMsg ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ backgroundColor: t.elev, borderRadius: 22, borderCurve: 'continuous', paddingHorizontal: 28, paddingVertical: 22, alignItems: 'center', gap: 12, minWidth: 200, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }}>
            <ActivityIndicator color={t.accent} />
            <Text style={{ color: t.text, fontSize: 15 }}>{busyMsg}</Text>
          </View>
        </View>
      ) : null}
    </ToastCtx.Provider>
  );
}

// ---------- settings rows ----------

export function SectionTitle({ title }: { title: string }) {
  const t = useTheme();
  return <Text style={{ color: t.faint, fontSize: 12, fontWeight: '700', letterSpacing: 0.7, marginTop: 14, marginBottom: 6 }}>{title.toUpperCase()}</Text>;
}

export function ToggleRow({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={() => onChange(!value)} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: 12 }}>
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16 }}>{label}</Text>
        {hint ? <Text style={{ color: t.faint, fontSize: 13, marginTop: 2 }}>{hint}</Text> : null}
      </View>
      <View style={{ width: 46, height: 28, borderRadius: 14, padding: 2, backgroundColor: value ? '#34C759' : t.chip, alignItems: value ? 'flex-end' : 'flex-start' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 } }} />
      </View>
    </Pressable>
  );
}

export function ChoiceRow<T extends string | number>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, gap: 12 }}>
      <Text style={{ flex: 1, color: t.text, fontSize: 16 }}>{label}</Text>
      <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 10, padding: 2 }}>
        {options.map(([k, l]) => (
          <Pressable key={String(k)} onPress={() => onChange(k)} style={{ paddingHorizontal: 10, height: 30, borderRadius: 8, justifyContent: 'center', backgroundColor: value === k ? t.card : 'transparent' }}>
            <Text style={{ color: value === k ? t.text : t.sub, fontSize: 13, fontWeight: '600' }}>{l}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export function ActionRow({ label, icon, onPress, danger }: { label: string; icon?: string; onPress: () => void; danger?: boolean }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 11, paddingHorizontal: 4, borderRadius: 10, backgroundColor: pressed ? t.chip : 'transparent' })}>
      {icon ? <Icon name={icon} size={19} color={danger ? t.danger : t.sub} /> : null}
      <Text style={{ flex: 1, color: danger ? t.danger : t.text, fontSize: 16 }}>{label}</Text>
    </Pressable>
  );
}

// ---------- crash guard ----------


/**
 * Catches errors in one part of the screen (a note, the page list, the audio
 * bar...) and shows a small "Try again" card there, so one bug never takes
 * down the whole app.
 */
export class Guard extends Component<{ children: ReactNode; label?: string }, { error: Error | null; n: number }> {
  state = { error: null as Error | null, n: 0 };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) { if (__DEV__) console.warn('Guard caught', error, info?.componentStack); }
  render() {
    if (!this.state.error) return <Fragment key={this.state.n}>{this.props.children}</Fragment>;
    return <GuardCard label={this.props.label} error={this.state.error} retry={() => this.setState((s) => ({ error: null, n: s.n + 1 }))} />;
  }
}

function GuardCard({ label, error, retry }: { label?: string; error: Error; retry: () => void }) {
  const t = useTheme();
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, backgroundColor: t.desk }}>
      <View style={{ maxWidth: 420, backgroundColor: t.card, borderRadius: 16, padding: 20, gap: 10, borderWidth: 1, borderColor: t.line }}>
        <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{label ? `${label} hit a problem` : 'Something went wrong'}</Text>
        <Text style={{ color: t.sub, fontSize: 14 }}>Your notes are saved. Tap Try again to reload this part.</Text>
        <Text selectable numberOfLines={4} style={{ color: t.faint, fontSize: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : undefined }}>{String(error?.message ?? error)}</Text>
        <View style={{ flexDirection: 'row' }}><Button title="Try again" kind="primary" onPress={retry} /></View>
      </View>
    </View>
  );
}

/** A floating surface: clear Liquid Glass where the iPad has it (iPadOS 26), a see-through white card where it doesn't. */
const HAS_GLASS = (() => { try { return Platform.OS === 'ios' && isLiquidGlassAvailable(); } catch { return false; } })();
function GlassBody({ radius, style, children, ...rest }: ViewProps & { radius: number }) {
  const { s } = useSettings();
  return (
    HAS_GLASS && !s.solidBars ? (
      // The buttons sit inside the glass, so it lights up and flexes under a touch like the system's bars.
      <GlassView {...rest} glassEffectStyle="clear" isInteractive style={[{ borderRadius: radius, borderCurve: 'continuous' }, style]}>{children}</GlassView>
    ) : (
    <View {...rest} style={[{ borderRadius: radius, borderCurve: 'continuous' }, { backgroundColor: s.solidBars ? '#FFFFFF' : 'rgba(255,255,255,0.72)', borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(60,60,67,0.18)', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 3 } }, style]}>
      {children}
    </View>
    )
  );
}

/** Where the surface sits (these go on the part that moves); everything else styles the glass itself. */
const PLACE_KEYS = ['position', 'top', 'left', 'right', 'bottom', 'alignSelf', 'zIndex', 'maxWidth', 'margin', 'marginTop', 'marginBottom', 'marginLeft', 'marginRight', 'marginHorizontal', 'marginVertical'];

/**
 * `stretchy`: pulling on the surface stretches it toward the finger, like pulling on something soft, and it springs
 * back when let go. 'vertical' only answers pulls up and down, for bars whose contents scroll sideways.
 */
export function Glass({ radius = 22, style, children, stretchy, ...rest }: ViewProps & { radius?: number; stretchy?: boolean | 'vertical' }) {
  const px = useSharedValue(0), py = useSharedValue(0);
  const mode = useRef(stretchy);
  mode.current = stretchy;
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => !!mode.current && Math.hypot(g.dx, g.dy) > 12 && (mode.current !== 'vertical' || Math.abs(g.dy) > Math.abs(g.dx) * 1.5),
    onPanResponderMove: (_, g) => { px.value = mode.current === 'vertical' ? 0 : g.dx; py.value = g.dy; },
    onPanResponderRelease: () => { px.value = withSpring(0, { damping: 9, stiffness: 190, mass: 0.6 }); py.value = withSpring(0, { damping: 9, stiffness: 190, mass: 0.6 }); },
    onPanResponderTerminate: () => { px.value = withSpring(0, { damping: 9, stiffness: 190, mass: 0.6 }); py.value = withSpring(0, { damping: 9, stiffness: 190, mass: 0.6 }); },
  })).current;
  const pull = useAnimatedStyle(() => {
    // The further it's pulled the less it gives, up to about 44 points.
    const ax = Math.abs(px.value), ay = Math.abs(py.value);
    const x = (px.value < 0 ? -1 : 1) * 44 * (1 - 1 / (ax / 90 + 1));
    const y = (py.value < 0 ? -1 : 1) * 44 * (1 - 1 / (ay / 90 + 1));
    return { transform: [{ translateX: x * 0.5 }, { translateY: y * 0.5 }, { scaleX: 1 + Math.abs(x) / 150 - Math.abs(y) / 520 }, { scaleY: 1 + Math.abs(y) / 150 - Math.abs(x) / 520 }] };
  });
  if (!stretchy) return <GlassBody radius={radius} style={style} {...rest}>{children}</GlassBody>;
  const flat = (StyleSheet.flatten(style) ?? {}) as Record<string, unknown>;
  const outer: Record<string, unknown> = {}, inner: Record<string, unknown> = {};
  for (const k of Object.keys(flat)) (PLACE_KEYS.includes(k) ? outer : inner)[k] = flat[k];
  return (
    <Reanimated.View {...pan.panHandlers} style={[outer as ViewStyle, pull]}>
      <GlassBody radius={radius} style={inner as ViewStyle} {...rest}>{children}</GlassBody>
    </Reanimated.View>
  );
}
