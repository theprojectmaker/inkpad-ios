// Page sidebar: thumbnails of every page; tap to jump, long-press for page actions.
import { Canvas, Group, Image as SkImageNode, Picture } from '@shopify/react-native-skia';
import { memo, useEffect, useReducer, useRef, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';

import type { NoteDoc, Page } from '@/lib/model';
import { useTheme } from '@/lib/settings';
import { inkPicture, paperPicture, thumbBg, thumbImages } from '@/lib/skia-render';
import { MenuSheet } from './ui';
import type { NoteViewHandle } from './note-view';

const W = 112;

const Thumb = memo(function Thumb({ noteId, page }: { noteId: string; page: Page }) {
  const [, force] = useReducer((n: number) => n + 1, 0);
  useEffect(() => thumbImages.subscribe(force), []);
  const k = W / page.w;
  const h = Math.min(page.h * k, W * 2.2);
  const bg = thumbBg(noteId, page);
  return (
    <Canvas style={{ width: W, height: h }} pointerEvents="none">
      <Group transform={[{ scale: k }]}>
        <Picture picture={paperPicture(page)} />
        {bg ? <SkImageNode image={bg} x={0} y={0} width={page.w} height={page.h} fit="fill" /> : null}
        <Picture picture={inkPicture(noteId, page, null, 0)} />
      </Group>
    </Canvas>
  );
});

export function PagePanel({ doc, current, api }: { doc: NoteDoc; current: number; api: React.RefObject<NoteViewHandle | null> }) {
  const t = useTheme();
  const [menu, setMenu] = useState<number | null>(null);
  const list = useRef<FlatList<Page>>(null);

  useEffect(() => {
    if (current >= 0 && current < doc.pages.length) {
      try { list.current?.scrollToIndex({ index: current, viewPosition: 0.4, animated: true }); } catch {}
    }
  }, [current, doc.pages.length]);

  return (
    <View style={{ width: W + 32, backgroundColor: t.side, borderRightWidth: 1, borderRightColor: t.line }}>
      <FlatList
        ref={list}
        data={doc.pages}
        keyExtractor={(p) => p.id}
        windowSize={5}
        initialNumToRender={6}
        maxToRenderPerBatch={4}
        removeClippedSubviews
        onScrollToIndexFailed={() => {}}
        contentContainerStyle={{ paddingVertical: 12, alignItems: 'center', gap: 14 }}
        renderItem={({ item, index }) => (
          <Pressable onPress={() => api.current?.gotoPage(index)} onLongPress={() => setMenu(index)} delayLongPress={350} style={{ alignItems: 'center' }}>
            <View style={{ borderWidth: 2, borderColor: index === current ? t.accent : 'transparent', borderRadius: 6, padding: 2 }}>
              <Thumb noteId={doc.id} page={item} />
            </View>
            <Text style={{ color: index === current ? t.accent : t.sub, fontSize: 12, marginTop: 4, fontWeight: '600' }}>{index + 1}</Text>
          </Pressable>
        )}
        ListFooterComponent={
          <Pressable onPress={() => api.current?.addPage(doc.pages.length - 1)} style={({ pressed }) => ({ width: W, height: 54, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.faint, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.6 : 1, marginTop: 4 })}>
            <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>+ Page</Text>
          </Pressable>
        }
      />
      <MenuSheet visible={menu != null} onClose={() => setMenu(null)} title={menu != null ? `Page ${menu + 1}` : ''} items={menu == null ? [] : [
        { label: 'Insert blank page after', icon: 'doc.badge.plus', onPress: () => api.current?.addPage(menu) },
        { label: 'Duplicate page', icon: 'plus.square.on.square', onPress: () => api.current?.duplicatePage(menu) },
        { label: 'Move up', icon: 'arrow.up', onPress: () => api.current?.movePage(menu, -1) },
        { label: 'Move down', icon: 'arrow.down', onPress: () => api.current?.movePage(menu, 1) },
        { label: 'Delete page', icon: 'trash', danger: true, onPress: () => api.current?.deletePage(menu) },
      ]} />
    </View>
  );
}
