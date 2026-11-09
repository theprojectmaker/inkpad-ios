// Root: settings, library, toasts, the hidden PDF engine, and the stack.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { useEffect, useRef } from 'react';
import { AppState, Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ShareReceiver } from '@/components/share-receiver';
import { ToastProvider } from '@/components/ui';
import { checkCloud, syncNow } from '@/lib/icloud';
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

/** Keeps the notes in step with iCloud: at launch, on coming back to the app, and after changes. */
function CloudSync() {
  const lib = useLibrary();
  const { s } = useSettings();
  const on = s.icloud !== false;
  const run = useRef(() => {});
  run.current = () => { if (on && lib.ready) syncNow(lib.current, lib.adopt).catch(() => {}); };
  useEffect(() => { checkCloud().catch(() => {}); }, []);
  useEffect(() => { run.current(); }, [on, lib.ready]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => { if (st === 'active') run.current(); });
    return () => sub.remove();
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
