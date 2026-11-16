// Whatever is inside shows on the iPad but is left out of screen sharing, AirPlay mirroring, screen
// recordings and screenshots (see modules/quill-canvas/ios/QuillShield.swift). Quill wraps its
// toolbars in one, so someone watching a shared screen sees only the page.
// In a build without the native part, or on the web, it is an ordinary view.
import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType, ReactNode } from 'react';
import { Platform, View, type ViewProps } from 'react-native';

let Native: ComponentType<ViewProps & { shielded?: boolean }> | null = null;
if (Platform.OS === 'ios') {
  try { if (requireOptionalNativeModule('QuillShield')) Native = requireNativeViewManager('QuillShield'); } catch { Native = null; }
}

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const;

/** Covers its parent and passes touches through wherever nothing inside is in the way. */
export function Shield({ on = true, children }: { on?: boolean; children: ReactNode }) {
  if (!Native) return <View pointerEvents="box-none" style={FILL}>{children}</View>;
  return <Native shielded={on} pointerEvents="box-none" style={FILL}>{children}</Native>;
}

export const shieldSupported = () => !!Native;
