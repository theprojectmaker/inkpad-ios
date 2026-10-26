// The real Desmos calculators (graphing, scientific, geometry) inside Quill.
// A web view that only ever shows desmos.com; anything else is blocked.
import { createElement, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Icon, IconButton } from '@/components/ui';
import { useTheme } from '@/lib/settings';

const MODES = [
  { id: 'calculator', label: 'Graphing' },
  { id: 'scientific', label: 'Scientific' },
  { id: 'fourfunction', label: 'Basic' },
  { id: 'geometry', label: 'Geometry' },
] as const;
type Mode = (typeof MODES)[number]['id'];

const allowed = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === 'desmos.com' || h.endsWith('.desmos.com') || url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:');
  } catch { return false; }
};

export function Desmos({ onClose, onBack, compact }: { onClose?: () => void; onBack?: () => void; compact?: boolean }) {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('calculator');
  const [loading, setLoading] = useState(true);
  const url = `https://www.desmos.com/${mode}`;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
        {onBack ? <IconButton name="chevron.left" label="Back to notes" onPress={onBack} /> : null}
        <Icon name="function" size={18} color={t.accent} />
        {!compact ? <Text style={{ color: t.text, fontSize: 17, fontWeight: '800', marginRight: 4 }}>Calculator</Text> : null}
        <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2, flexShrink: 1 }}>
          {MODES.map((m) => (
            <Pressable key={m.id} onPress={() => { setMode(m.id); setLoading(true); }}
              style={{ paddingHorizontal: compact ? 8 : 12, height: 28, borderRadius: 7, justifyContent: 'center', backgroundColor: mode === m.id ? t.elev : 'transparent' }}>
              <Text style={{ color: mode === m.id ? t.text : t.sub, fontSize: 12.5, fontWeight: '600' }}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        <View style={{ flex: 1 }} />
        {onClose ? (
          <Pressable onPress={onClose} accessibilityLabel="Close calculator" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Icon name="xmark" size={13} color={t.sub} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {Platform.OS === 'web'
          ? createElement('iframe', { src: url, style: { border: 0, width: '100%', height: '100%' }, title: 'Desmos' })
          : (
            <WebView
              key={mode}
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: '#fff' }}
              onLoadEnd={() => setLoading(false)}
              onShouldStartLoadWithRequest={(r) => allowed(r.url)}
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures={false}
              keyboardDisplayRequiresUserAction={false}
              hideKeyboardAccessoryView
              sharedCookiesEnabled
            />
          )}
        {loading && Platform.OS !== 'web' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
