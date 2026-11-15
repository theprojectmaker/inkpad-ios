// The drawing board's gallery: every drawing, newest first.
import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, useToast } from '@/components/ui';
import { CANVAS_SIZES, deleteBoard, duplicateBoard, type DrawMeta, frameJpeg, listBoards, newBoard, renameBoard, saveBoard, thumbPath } from '@/lib/draw-model';
import { fsx } from '@/lib/fsx';
import { useTheme } from '@/lib/settings';

export default function DrawGallery() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { toast } = useToast();
  const [list, setList] = useState<DrawMeta[]>([]);
  const [sizes, setSizes] = useState(false);
  const [target, setTarget] = useState<DrawMeta | null>(null);
  const [sheet, setSheet] = useState<null | 'menu' | 'rename' | 'delete'>(null);
  const [stamp, setStamp] = useState(0);

  const refresh = useCallback(() => { listBoards().then((l) => { setList(l); setStamp(Date.now()); }).catch(() => {}); }, []);
  useFocusEffect(refresh);

  const make = async (w: number, h: number) => {
    try {
      const b = newBoard(`Drawing ${list.length + 1}`, w, h);
      await saveBoard(b, frameJpeg(b, 0, 360));
      router.push(`/draw/${b.id}` as never);
    } catch (e) { toast("Couldn't make the drawing: " + String((e as Error)?.message ?? e)); }
  };

  const pad = 24, gap = 18;
  const cols = Math.max(2, Math.floor((width - pad * 2 + gap) / (200 + gap)));
  const cardW = (width - pad * 2 - (cols - 1) * gap) / cols;

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, gap: 8 }}>
        <IconButton name="chevron.left" label="Back to notes" onPress={() => router.back()} />
        <Text style={{ flex: 1, color: t.text, fontSize: 28, fontWeight: '800', letterSpacing: -0.5 }}>Drawing Board</Text>
        <Pressable accessibilityLabel="New drawing" onPress={() => setSizes(true)} style={({ pressed }) => ({ height: 40, paddingHorizontal: 16, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.accent, opacity: pressed ? 0.8 : 1 })}>
          <Icon name="plus" size={15} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>New</Text>
        </Pressable>
      </View>
      {list.length ? (
        <ScrollView contentContainerStyle={{ padding: pad, flexDirection: 'row', flexWrap: 'wrap', gap }}>
          {list.map((m) => (
            <Pressable key={m.id} accessibilityLabel={m.name} onPress={() => router.push(`/draw/${m.id}` as never)} onLongPress={() => { setTarget(m); setSheet('menu'); }} delayLongPress={350}
              style={({ pressed }) => ({ width: cardW, opacity: pressed ? 0.85 : 1 })}>
              <View style={{ width: cardW, height: cardW * 0.75, borderRadius: 14, overflow: 'hidden', backgroundColor: '#fff', borderWidth: 1, borderColor: t.line }}>
                {fsx.exists(thumbPath(m.id)) ? <Image source={{ uri: `${fsx.uri(thumbPath(m.id))}?v=${stamp}` }} style={{ width: '100%', height: '100%' }} resizeMode="contain" /> : null}
              </View>
              <Text numberOfLines={1} style={{ color: t.text, fontSize: 15, fontWeight: '600', marginTop: 8 }}>{m.name}</Text>
              <Text style={{ color: t.sub, fontSize: 13 }}>{m.frames > 1 ? `${m.frames} frames` : 'Drawing'}</Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 40 }}>
          <Icon name="paintbrush.pointed" size={44} color={t.faint} />
          <Text style={{ color: t.text, fontSize: 20, fontWeight: '700' }}>A place to draw and animate</Text>
          <Text style={{ color: t.sub, fontSize: 16, textAlign: 'center', maxWidth: 420 }}>Layers, brushes, symmetry, frames for animation, and ink you can push around after it's drawn.</Text>
          <Pressable accessibilityLabel="Make the first drawing" onPress={() => setSizes(true)} style={{ height: 46, paddingHorizontal: 24, borderRadius: 23, justifyContent: 'center', backgroundColor: t.accent, marginTop: 6 }}>
            <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>New drawing</Text>
          </Pressable>
        </View>
      )}
      <MenuSheet visible={sizes} onClose={() => setSizes(false)} title="Canvas" items={CANVAS_SIZES.map((s) => ({ label: s.label, sub: `${s.w} × ${s.h}`, icon: 'rectangle', onPress: () => make(s.w, s.h) }))} />
      <MenuSheet visible={sheet === 'menu'} onClose={() => setSheet(null)} title={target?.name} items={target ? [
        { label: 'Rename', icon: 'pencil', onPress: () => setSheet('rename') },
        { label: 'Duplicate', icon: 'doc.on.doc', onPress: async () => { await duplicateBoard(target.id); refresh(); } },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => setSheet('delete') },
      ] : []} />
      <PromptSheet visible={sheet === 'rename'} title="Rename drawing" initial={target?.name ?? ''} onCancel={() => setSheet(null)}
        onSubmit={async (v) => { setSheet(null); if (target && v.trim()) { await renameBoard(target.id, v.trim()); refresh(); } }} />
      <ConfirmSheet visible={sheet === 'delete'} title="Delete this drawing?" message="This can't be undone." onCancel={() => setSheet(null)}
        onConfirm={async () => { setSheet(null); if (target) { await deleteBoard(target.id); refresh(); } }} />
    </View>
  );
}
