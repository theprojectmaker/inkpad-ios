// The calculator: the real Desmos (graphing + scientific) when there's internet,
// and Quill's own offline graphing calculator when there isn't (it switches by
// itself). The Desmos view only ever shows desmos.com; anything else is blocked.
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, Text, View } from 'react-native';
import { WebView } from 'react-native-webview';

import { Icon, IconButton } from '@/components/ui';
import { GRAPHER_HTML } from '@/lib/grapher-html';
import { useTheme } from '@/lib/settings';

// Just the two a student needs: graphing and a regular calculator.
const MODES = [
  { id: 'calculator', label: 'Graph' },
  { id: 'scientific', label: 'Calculator' },
] as const;
type Mode = (typeof MODES)[number]['id'];

const allowed = (url: string) => {
  try {
    const h = new URL(url).hostname;
    return h === 'desmos.com' || h.endsWith('.desmos.com') || url.startsWith('about:') || url.startsWith('blob:') || url.startsWith('data:');
  } catch { return false; }
};

/** Can we reach Desmos right now? (a quick check, 4 seconds at most) */
async function online(): Promise<boolean> {
  try {
    const c = new AbortController();
    const t = setTimeout(() => c.abort(), 4000);
    const r = await fetch('https://www.desmos.com/robots.txt', { method: 'HEAD', signal: c.signal, cache: 'no-store' });
    clearTimeout(t);
    return r.ok || r.status < 500;
  } catch { return false; }
}

export function Desmos({ onClose, onBack, compact }: { onClose?: () => void; onBack?: () => void; compact?: boolean }) {
  const t = useTheme();
  const [mode, setMode] = useState<Mode>('calculator');
  const [loading, setLoading] = useState(true);
  const [offline, setOffline] = useState<boolean | null>(Platform.OS === 'web' ? false : null);
  const local = useRef<WebView>(null);
  const url = `https://www.desmos.com/${mode}`;

  const [checking, setChecking] = useState(false);
  const check = useCallback(() => { setChecking(true); online().then((ok) => { setOffline(!ok); setChecking(false); }); }, []);
  useEffect(() => { if (Platform.OS !== 'web') { setOffline(null); check(); } }, [check]);
  // The offline calculator switches between graph and keypad itself.
  useEffect(() => { if (offline) local.current?.injectJavaScript(`window.setMode&&setMode(${JSON.stringify(mode === 'scientific' ? 'calc' : 'graph')});true;`); }, [mode, offline]);

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: t.line }}>
        {onBack ? <IconButton name="chevron.left" label="Back to notes" onPress={onBack} /> : null}
        <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2, flexShrink: 1 }}>
          {MODES.map((m) => (
            <Pressable key={m.id} onPress={() => { if (m.id === mode) return; setMode(m.id); if (!offline) setLoading(true); }}
              style={{ paddingHorizontal: compact ? 14 : 20, height: 30, borderRadius: 7, justifyContent: 'center', backgroundColor: mode === m.id ? t.elev : 'transparent' }}>
              <Text style={{ color: mode === m.id ? t.text : t.sub, fontSize: 14, fontWeight: '700' }}>{m.label}</Text>
            </Pressable>
          ))}
        </View>
        {offline ? (
          <Pressable onPress={check} accessibilityLabel="Try Desmos again" style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: 30, paddingHorizontal: 10, borderRadius: 15, backgroundColor: t.chip }}>
            <Icon name="wifi.slash" size={12} color={t.sub} />
            <Text style={{ color: t.sub, fontSize: 12.5, fontWeight: '700' }}>{checking ? 'Checking…' : compact ? 'Offline' : 'Offline · tap to retry Desmos'}</Text>
          </Pressable>
        ) : null}
        <View style={{ flex: 1 }} />
        {onClose ? (
          <Pressable onPress={onClose} accessibilityLabel="Close calculator" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
            <Icon name="xmark" size={13} color={t.sub} />
          </Pressable>
        ) : null}
      </View>
      <View style={{ flex: 1 }}>
        {Platform.OS === 'web'
          ? createElement('iframe', offline ? { srcDoc: GRAPHER_HTML, style: { border: 0, width: '100%', height: '100%' }, title: 'Calculator' } : { src: url, style: { border: 0, width: '100%', height: '100%' }, title: 'Desmos' })
          : offline === null ? null
          : offline ? (
            <WebView ref={local} source={{ html: GRAPHER_HTML }} originWhitelist={['about:*']} style={{ flex: 1, backgroundColor: '#fff' }}
              onLoadEnd={() => { if (mode === 'scientific') local.current?.injectJavaScript("setMode('calc');true;"); }}
              keyboardDisplayRequiresUserAction={false} hideKeyboardAccessoryView scrollEnabled={false} />
          ) : (
            <WebView
              key={mode}
              source={{ uri: url }}
              style={{ flex: 1, backgroundColor: '#fff' }}
              onLoadEnd={() => setLoading(false)}
              onError={() => setOffline(true)}
              onShouldStartLoadWithRequest={(r) => allowed(r.url)}
              setSupportMultipleWindows={false}
              allowsBackForwardNavigationGestures={false}
              keyboardDisplayRequiresUserAction={false}
              hideKeyboardAccessoryView
              sharedCookiesEnabled
            />
          )}
        {(offline === null || (loading && !offline)) && Platform.OS !== 'web' ? (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
            <ActivityIndicator color={t.accent} />
          </View>
        ) : null}
      </View>
    </View>
  );
}
