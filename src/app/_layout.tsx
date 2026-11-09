// Root: settings, library, toasts, the hidden PDF engine, and the stack.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ShareReceiver } from '@/components/share-receiver';
import { ToastProvider } from '@/components/ui';
import { checkCloud, getCloud, networkKind, setSyncHints, syncNow, type NetKind } from '@/lib/icloud';
import { LibraryProvider, useLibrary } from '@/lib/library';
import { EngineHost } from '@/lib/pdf-engine';
import { SettingsProvider, useSettings, useTheme } from '@/lib/settings';

function Shell() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <ToastProvider>
        <ShareReceiver />
        <CloudSync />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'fade', gestureEnabled: false }} />
      </ToastProvider>
      <EngineHost />
    </View>
  );
}

// If any screen throws while rendering, show the error (and a retry) instead of closing the app.
export function ErrorBoundary({ error, retry }: { error: Error; retry: () => Promise<void> }) {
  return (
    <View style={{ flex: 1, padding: 32, paddingTop: 80, backgroundColor: '#FFF' }}>
      <Text style={{ fontSize: 22, fontWeight: '700', color: '#111' }}>Quill hit an error</Text>
      <Text selectable style={{ marginTop: 14, fontSize: 14, color: '#333', fontFamily: 'Menlo' }}>{`${error?.name ?? 'Error'}: ${error?.message ?? String(error)}\n\n${String(error?.stack ?? '').split('\n').slice(0, 10).join('\n')}`}</Text>
      <Pressable onPress={() => { retry(); }} style={{ marginTop: 24, alignSelf: 'flex-start', backgroundColor: '#2563EB', paddingHorizontal: 18, paddingVertical: 12, borderRadius: 10 }}>
        <Text style={{ color: '#FFF', fontWeight: '600', fontSize: 16 }}>Try again</Text>
      </Pressable>
    </View>
  );
}

const RETRY = [30_000, 120_000, 600_000];   // after a failed sync: 30 s, 2 min, then every 10 min
const NET_POLL = 15_000;

/**
 * Keeps the notes in step with iCloud: at launch, on coming back to the app, after changes, and the
 * moment Wi-Fi (or a cable) comes back. With "Sync only on Wi-Fi" on, it holds off on cellular.
 */
function CloudSync() {
  const lib = useLibrary();
  const { s } = useSettings();
  const on = s.icloud !== false;
  const wifiOnly = s.wifiOnlySync !== false;
  const net = useRef<NetKind>('other');
  const fails = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const run = useRef(() => {});
  run.current = () => {
    if (!on || !lib.ready) return;
    const k = net.current;
    if (k === 'none' || (wifiOnly && k === 'cellular')) { setSyncHints({ waiting: true }); return; }
    setSyncHints({ waiting: false });
    if (retry.current) { clearTimeout(retry.current); retry.current = null; }
    syncNow(lib.current, lib.adopt).catch(() => {}).then(() => {
      const st = getCloud();
      if (st.status !== 'on') return;
      if (!st.error) { fails.current = 0; setSyncHints({ retryAt: 0 }); return; }
      // Failed: try again later, waiting longer each time.
      const wait = RETRY[Math.min(fails.current, RETRY.length - 1)];
      fails.current += 1;
      setSyncHints({ retryAt: Date.now() + wait });
      if (retry.current) clearTimeout(retry.current);
      retry.current = setTimeout(() => { retry.current = null; run.current(); }, wait);
    });
  };
  useEffect(() => () => { if (retry.current) clearTimeout(retry.current); }, []);
  useEffect(() => { checkCloud().catch(() => {}); }, []);
  useEffect(() => { networkKind().then((k) => { net.current = k; run.current(); }).catch(() => run.current()); }, [on, lib.ready, wifiOnly]);
  // Watch the connection while the app is open; Wi-Fi or a cable coming back syncs straight away.
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;
    const poll = () => {
      networkKind().then((k) => {
        const was = net.current;
        net.current = k;
        const good = (x: NetKind) => x === 'wifi' || x === 'wired';
        if (good(k) && !good(was)) { fails.current = 0; run.current(); }
      }).catch(() => {});
    };
    const start = () => { if (!timer) timer = setInterval(poll, NET_POLL); };
    const stop = () => { if (timer) { clearInterval(timer); timer = null; } };
    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') { start(); networkKind().then((k) => { net.current = k; run.current(); }).catch(() => run.current()); }
      else stop();
    });
    return () => { stop(); sub.remove(); };
  }, []);
  // A few seconds after the library changes (a note left, renamed, moved or deleted).
  useEffect(() => {
    if (!on || !lib.ready) return;
    const t = setTimeout(() => run.current(), 4000);
    return () => clearTimeout(t);
  }, [lib.lib, on, lib.ready]);
  return null;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <SettingsProvider>
        <LibraryProvider>
          <Shell />
        </LibraryProvider>
      </SettingsProvider>
    </SafeAreaProvider>
  );
}
