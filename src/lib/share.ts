// "Share to Quill": files shared from Mail, Files, Photos, Safari... arrive
// through the iOS share extension that expo-share-intent adds at build time.
// The native module only exists in a build made after it was added, so it is
// loaded defensively: in an older build, Expo Go or on web this simply reports
// "nothing shared" instead of crashing the app.
import { Platform } from 'react-native';

export type SharedFile = { path: string; mimeType: string; fileName?: string };
type ShareState = { hasShareIntent: boolean; shareIntent: { files?: SharedFile[] | null }; resetShareIntent: () => void };

let real: (() => ShareState) | null = null;
if (Platform.OS === 'ios') {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    real = (require('expo-share-intent') as { useShareIntent: () => unknown }).useShareIntent as unknown as () => ShareState;
  } catch { real = null; }
}
const none = (): ShareState => ({ hasShareIntent: false, shareIntent: {}, resetShareIntent: () => {} });

// Chosen once at load, so it is always the same hook on every render.
export const useIncomingShare: () => ShareState = real ?? none;
export const shareSupported = real !== null;
