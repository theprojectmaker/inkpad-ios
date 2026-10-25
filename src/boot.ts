// iOS entry. A JavaScript error during startup normally closes a release
// build instantly with no explanation. This handler catches fatal errors
// first, keeps the app alive and shows what went wrong, so a crash can be
// reported instead of guessed at. It is installed before anything else loads.
import { Alert } from 'react-native';

type Handler = (error: unknown, isFatal?: boolean) => void;
const EU = (globalThis as any).ErrorUtils as { getGlobalHandler?: () => Handler; setGlobalHandler?: (h: Handler) => void } | undefined;
const fallback = EU?.getGlobalHandler?.();
let shown = false;

EU?.setGlobalHandler?.((error, isFatal) => {
  const e = error as { name?: string; message?: string; stack?: string };
  const text = `${e?.name ?? 'Error'}: ${e?.message ?? String(error)}\n\n${(e?.stack ?? '').split('\n').slice(0, 8).join('\n')}`;
  (globalThis as any).__inkpadLastError = text;
  if (!isFatal) { fallback?.(error, isFatal); return; }
  if (shown) return;
  shown = true;
  try { Alert.alert('Quill hit an error', text.slice(0, 1500), [{ text: 'OK', onPress: () => { shown = false; } }]); }
  catch { fallback?.(error, isFatal); }
});

require('expo-router/entry');
