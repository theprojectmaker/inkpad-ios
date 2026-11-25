// Over-the-air updates. Expo only looks for one when the app starts cold, and an iPad app can stay
// open in the background for days — so Quill also looks whenever it comes back to the front, and
// Settings › About has a button. A fetched update is used the next time the app starts (or at once,
// from the button).
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

export type UpdateInfo = { version: string; build: string; update: string; when: string };

export function updateInfo(): UpdateInfo {
  const build = String((Constants as unknown as { platform?: { ios?: { buildNumber?: string } } }).platform?.ios?.buildNumber ?? '?');
  let update = 'Built in', when = '';
  try {
    if (!Updates.isEmbeddedLaunch && Updates.updateId) update = Updates.updateId.slice(0, 8);
    if (Updates.createdAt) when = Updates.createdAt.toLocaleDateString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {}
  return { version: Constants.expoConfig?.version ?? '?', build, update, when };
}

let busy = false;
let last = 0;

/** Looks for an update and downloads it. 'ready' means one is waiting to be used. */
export async function fetchUpdate(force = false): Promise<'ready' | 'none' | 'off' | 'failed'> {
  if (__DEV__ || !Updates.isEnabled) return 'off';
  if (busy) return 'none';
  if (!force && Date.now() - last < 10 * 60_000) return 'none';   // at most every ten minutes on its own
  busy = true;
  last = Date.now();
  try {
    const c = await Updates.checkForUpdateAsync();
    if (!c.isAvailable) return 'none';
    const f = await Updates.fetchUpdateAsync();
    return f.isNew ? 'ready' : 'none';
  } catch { return 'failed'; }
  finally { busy = false; }
}

export const applyUpdate = () => Updates.reloadAsync().catch(() => {});
