// Root: settings, library, toasts, the hidden PDF engine, and the stack.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { ShareReceiver } from '@/components/share-receiver';
import { ToastProvider } from '@/components/ui';
import { LibraryProvider } from '@/lib/library';
import { EngineHost } from '@/lib/pdf-engine';
import { SettingsProvider, useTheme } from '@/lib/settings';

function Shell() {
  const t = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      <StatusBar style={t.dark ? 'light' : 'dark'} />
      <ToastProvider>
        <ShareReceiver />
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
