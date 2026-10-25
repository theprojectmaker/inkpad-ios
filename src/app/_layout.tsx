// Root: settings, library, toasts, the hidden PDF engine, and the stack.
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

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
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg }, animation: 'fade', gestureEnabled: false }} />
      </ToastProvider>
      <EngineHost />
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
