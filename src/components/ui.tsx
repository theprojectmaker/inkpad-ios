// Small shared UI pieces: icons, buttons, sheets, prompts, toasts.
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { Component, createContext, Fragment, type ErrorInfo, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, Animated, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, type ViewStyle } from 'react-native';

import { useTheme } from '@/lib/settings';

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
      style={({ pressed }) => [{ minWidth: 38, height: 38, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, flexDirection: 'row', gap: 6,
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
    <Pressable onPress={onPress} disabled={disabled} style={({ pressed }) => ({ backgroundColor: bg, opacity: disabled ? 0.4 : pressed ? 0.8 : 1, paddingHorizontal: 16, height: 42, borderRadius: 11, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 8 })}>
      {icon ? <Icon name={icon} size={17} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '600' }}>{title}</Text>
    </Pressable>
  );
}

/** A centred card on a dimmed backdrop. */
export function Sheet({ visible, onClose, children, width = 420, title }: { visible: boolean; onClose: () => void; children: ReactNode; width?: number; title?: string }) {
  const t = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.32)' }]} onPress={onClose} />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 16 }} pointerEvents="box-none">
          <View style={{ width: '100%', maxWidth: width, maxHeight: '90%', backgroundColor: t.elev, borderRadius: 18, padding: 18, shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }}>
            {title ? <Text style={{ color: t.text, fontSize: 19, fontWeight: '700', marginBottom: 12 }}>{title}</Text> : null}
            <ScrollView bounces={false} keyboardShouldPersistTaps="handled">{children}</ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

export type MenuItem = { label: string; icon?: string; onPress: () => void; danger?: boolean; checked?: boolean };

export function MenuSheet({ visible, onClose, title, items }: { visible: boolean; onClose: () => void; title?: string; items: MenuItem[] }) {
  const t = useTheme();
  return (
    <Sheet visible={visible} onClose={onClose} title={title} width={360}>
      {items.map((it, i) => (
        <Pressable key={i} onPress={() => { onClose(); setTimeout(it.onPress, 60); }}
          style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? t.chip : 'transparent' })}>
          {it.icon ? <Icon name={it.icon} size={19} color={it.danger ? t.danger : t.text} /> : null}
          <Text style={{ flex: 1, color: it.danger ? t.danger : t.text, fontSize: 16 }}>{it.label}</Text>
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
        style={{ color: t.text, fontSize: 17, borderWidth: 1, borderColor: t.line, borderRadius: 11, paddingHorizontal: 12, height: 46, backgroundColor: t.card }} />
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
    timer.current = setTimeout(() => Animated.timing(op, { toValue: 0, duration: 220, useNativeDriver: Platform.OS !== 'web' }).start(() => setMsg(null)), 2600);
  }, [op]);
  const busy = useCallback((m: string | null) => setBusy(m), []);
  return (
    <ToastCtx.Provider value={{ toast, busy }}>
      {children}
      {msg ? (
        <Animated.View pointerEvents="none" style={{ position: 'absolute', bottom: 40, alignSelf: 'center', opacity: op, backgroundColor: t.dark ? '#F1F2F4' : '#1C1D21', paddingHorizontal: 18, paddingVertical: 11, borderRadius: 22, maxWidth: 520 }}>
          <Text style={{ color: t.dark ? '#111' : '#fff', fontSize: 15, fontWeight: '500', textAlign: 'center' }}>{msg}</Text>
        </Animated.View>
      ) : null}
      {busyMsg ? (
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)', alignItems: 'center', justifyContent: 'center' }]}>
          <View style={{ backgroundColor: t.elev, borderRadius: 16, paddingHorizontal: 26, paddingVertical: 20, alignItems: 'center', gap: 12, minWidth: 200 }}>
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
