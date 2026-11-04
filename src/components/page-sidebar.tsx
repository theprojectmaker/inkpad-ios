// Page thumbnails down the left side of the editor: tap to jump to a page,
// press and hold for what you can do with it. Pictures come from the native canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';

import type { CanvasHandle } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { fsx } from '@/lib/fsx';
import { renderDir } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';

const THUMB_W = 116;

function Thumb({ noteId, index, aspect, ver, active, marked, canvas, absPath, onPress, onLongPress }: {
  noteId: string; index: number; aspect: number; ver: number; active: boolean; marked: boolean; canvas: React.RefObject<CanvasHandle | null>;
  absPath: (p: string) => string; onPress: () => void; onLongPress: () => void;
}) {
  const t = useTheme();
  const [uri, setUri] = useState('');
  const prev = useRef('');
  useEffect(() => {
    let live = true;
    const path = `${renderDir(noteId)}/pg${index}_${ver}.jpg`;
    const timer = setTimeout(async () => {
      try {
        const ok = await canvas.current?.pageThumb(index, absPath(path), THUMB_W * 1.5);
        if (!live || !ok) return;
        if (prev.current && prev.current !== path) fsx.remove(prev.current);
        prev.current = path;
        setUri(fsx.uri(path));
      } catch {}
    }, active ? 500 : 60 + index * 40);
    return () => { live = false; clearTimeout(timer); };
  }, [noteId, index, ver, canvas, absPath]);

  return (
    <Pressable accessibilityLabel={`Page ${index + 1}`} onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={{ alignItems: 'center', paddingVertical: 8 }}>
      <View style={{ width: THUMB_W, height: THUMB_W * aspect, backgroundColor: '#fff', borderRadius: 4, borderWidth: active ? 2.5 : 1, borderColor: active ? t.accent : t.line, overflow: 'hidden' }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
        {marked ? <View style={{ position: 'absolute', top: 0, right: 6 }}><Icon name="bookmark.fill" size={16} color="#E5322D" /></View> : null}
      </View>
      <Text style={{ marginTop: 5, color: active ? t.accent : t.faint, fontSize: 12, fontWeight: active ? '700' : '500' }}>{index + 1}</Text>
    </Pressable>
  );
}

export function PageSidebar({ noteId, pages, current, ver, canvas, absPath, onJump, onMenu, onAdd }: {
  noteId: string; pages: { id: string; w: number; h: number; mark?: 1 }[]; current: number; ver: number;
  canvas: React.RefObject<CanvasHandle | null>; absPath: (p: string) => string;
  onJump: (i: number) => void; onMenu: (i: number) => void; onAdd: () => void;
}) {
  const t = useTheme();
  const [onlyMarked, setOnlyMarked] = useState(false);
  const anyMarked = pages.some((p) => p.mark);
  const shown = pages.map((p, index) => ({ p, index })).filter((x) => !onlyMarked || x.p.mark);
  // While you write, only the page you're on gets a new picture (not every page at
  // every pause); the rest refresh when pages are added, removed or reordered.
  const layoutVer = useMemo(() => ver, [pages.length, pages.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ width: THUMB_W + 36, backgroundColor: t.side, borderRightWidth: 1, borderRightColor: t.line }}>
      {anyMarked ? (
        <Pressable accessibilityLabel="Bookmarked pages only" onPress={() => setOnlyMarked((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, height: 34, margin: 8, marginBottom: 0, borderRadius: 9, backgroundColor: onlyMarked ? t.accent : t.chip }}>
          <Icon name="bookmark.fill" size={12} color={onlyMarked ? '#fff' : t.sub} />
          <Text style={{ color: onlyMarked ? '#fff' : t.sub, fontSize: 12.5, fontWeight: '600' }}>Bookmarks</Text>
        </Pressable>
      ) : null}
      <FlatList data={shown} keyExtractor={(x) => x.p.id} contentContainerStyle={{ paddingVertical: 10 }}
        renderItem={({ item: { p: item, index } }) => (
          <Thumb noteId={noteId} index={index} aspect={item.h / item.w} ver={index === current ? ver : layoutVer} active={index === current} marked={!!item.mark} canvas={canvas} absPath={absPath}
            onPress={() => onJump(index)} onLongPress={() => onMenu(index)} />
        )}
        ListFooterComponent={
          <Pressable onPress={onAdd} style={{ alignSelf: 'center', marginTop: 6, marginBottom: 20, width: THUMB_W, height: 44, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.sub, fontSize: 13, fontWeight: '600' }}>+ Page</Text>
          </Pressable>
        } />
    </View>
  );
}
