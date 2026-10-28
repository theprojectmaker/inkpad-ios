// Page thumbnails down the left side of the editor: tap to jump to a page,
// long-press to delete it. Pictures come from the native canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, Image, Pressable, Text, View } from 'react-native';

import type { CanvasHandle } from '@/components/quill-canvas';
import { fsx } from '@/lib/fsx';
import { renderDir } from '@/lib/noteio';
import { useTheme } from '@/lib/settings';

const THUMB_W = 116;

function Thumb({ noteId, index, aspect, ver, active, canvas, absPath, onPress, onLongPress }: {
  noteId: string; index: number; aspect: number; ver: number; active: boolean; canvas: React.RefObject<CanvasHandle | null>;
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
    <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={350} style={{ alignItems: 'center', paddingVertical: 8 }}>
      <View style={{ width: THUMB_W, height: THUMB_W * aspect, backgroundColor: '#fff', borderRadius: 4, borderWidth: active ? 2.5 : 1, borderColor: active ? t.accent : t.line, overflow: 'hidden' }}>
        {uri ? <Image source={{ uri }} style={{ width: '100%', height: '100%' }} resizeMode="cover" /> : null}
      </View>
      <Text style={{ marginTop: 5, color: active ? t.accent : t.faint, fontSize: 12, fontWeight: active ? '700' : '500' }}>{index + 1}</Text>
    </Pressable>
  );
}

export function PageSidebar({ noteId, pages, current, ver, canvas, absPath, onJump, onDelete, onAdd }: {
  noteId: string; pages: { id: string; w: number; h: number }[]; current: number; ver: number;
  canvas: React.RefObject<CanvasHandle | null>; absPath: (p: string) => string;
  onJump: (i: number) => void; onDelete: (i: number) => void; onAdd: () => void;
}) {
  const t = useTheme();
  // While you write, only the page you're on gets a new picture (not every page at
  // every pause); the rest refresh when pages are added, removed or reordered.
  const layoutVer = useMemo(() => ver, [pages.length, pages.map((p) => p.id).join()]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <View style={{ width: THUMB_W + 36, backgroundColor: t.side, borderRightWidth: 1, borderRightColor: t.line }}>
      <FlatList data={pages} keyExtractor={(p) => p.id} contentContainerStyle={{ paddingVertical: 10 }}
        renderItem={({ item, index }) => (
          <Thumb noteId={noteId} index={index} aspect={item.h / item.w} ver={index === current ? ver : layoutVer} active={index === current} canvas={canvas} absPath={absPath}
            onPress={() => onJump(index)} onLongPress={() => onDelete(index)} />
        )}
        ListFooterComponent={
          <Pressable onPress={onAdd} style={{ alignSelf: 'center', marginTop: 6, marginBottom: 20, width: THUMB_W, height: 44, borderRadius: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: t.sub, fontSize: 13, fontWeight: '600' }}>+ Page</Text>
          </Pressable>
        } />
    </View>
  );
}
