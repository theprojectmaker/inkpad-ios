// The Note Switcher: the notes that are open, with a picture of each.
import { Image, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';

import { fsx } from '@/lib/fsx';
import { useLibrary } from '@/lib/library';
import { notePath } from '@/lib/noteio';
import { closeOtherTabs, closeTab, useTabs } from '@/lib/tabs';
import { useTheme } from '@/lib/settings';
import { Icon, IconButton } from './ui';

export function NoteTabs({ current, onPick, onClose }: { current: string; onPick: (id: string) => void; onClose: () => void }) {
  const t = useTheme();
  const lib = useLibrary();
  const tabs = useTabs();
  return (
    <Modal visible transparent animationType="none" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close open notes" style={StyleSheet.absoluteFill} onPress={onClose} />
      <Reanimated.View entering={FadeIn.duration(110)} style={{ position: 'absolute', top: 58, left: 12, width: 320, padding: 8, borderRadius: 16, backgroundColor: t.elev, shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}>
        <Text style={{ color: t.text, fontSize: 15, fontWeight: '600', padding: 8 }}>Open notes</Text>
        {tabs.map((id) => {
          const n = lib.meta(id);
          if (!n) return null;
          const on = id === current;
          return (
            <Reanimated.View key={id} style={{ flexDirection: 'row', alignItems: 'center', borderRadius: 10, backgroundColor: on ? t.chip : 'transparent' }}>
              <Pressable accessibilityLabel={`Open ${n.title}`} onPress={() => { if (on) onClose(); else onPick(id); }} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8 }}>
                <View style={{ width: 30, height: 38, borderRadius: 4, overflow: 'hidden', backgroundColor: '#fff', borderWidth: StyleSheet.hairlineWidth, borderColor: t.line, alignItems: 'center', justifyContent: 'center' }}>
                  {n.thumb ? <Image source={{ uri: fsx.uri(notePath(n.id, n.thumb)) }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : <Icon name="doc" size={14} color={t.faint} />}
                </View>
                <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 15, fontWeight: on ? '600' : '400' }}>{n.title}</Text>
              </Pressable>
              {on ? null : <IconButton name="xmark" label={`Close ${n.title}`} onPress={() => closeTab(id)} />}
            </Reanimated.View>
          );
        })}
        {tabs.length > 1 ? (
          <Pressable accessibilityLabel="Close other notes" onPress={() => { closeOtherTabs(current); onClose(); }} style={{ padding: 10 }}>
            <Text style={{ color: '#3F6AF2', fontSize: 14 }}>Close the others</Text>
          </Pressable>
        ) : null}
      </Reanimated.View>
    </Modal>
  );
}
