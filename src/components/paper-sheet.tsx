// The Templates page: page size and orientation, the everyday papers as big previews,
// more templates, and paper colour. Apply uses it.
import { Canvas, Group, Picture } from '@shopify/react-native-skia';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui';
import { type PageSizeId, type PaperColor, type PaperStyle, paperPage } from '@/lib/model';
import { PAPERS } from '@/lib/paper';
import { useSettings } from '@/lib/settings';
import { paperPicture } from '@/lib/skia-render';

const BLUE = '#3F6AF2';
const BASIC: [PaperStyle, string][] = [['blank', 'Blank'], ['lined', 'Lined'], ['grid', 'Grid'], ['dotted', 'Dotted']];
const MORE: [PaperStyle, string][] = [['narrow', 'Narrow lined'], ['cornell', 'Cornell notes'], ['todo', 'Checklist'], ['music', 'Music'], ['iso', 'Isometric']];
const SIZES: [PageSizeId, string][] = [['letter', 'Letter'], ['a4', 'A4'], ['tall', 'Tall']];

function Preview({ style, color, w, landscape }: { style: PaperStyle; color: PaperColor; w: number; landscape: boolean }) {
  const page = paperPage(style, color, landscape ? { w: 792, h: 612 } : { w: 612, h: 792 });
  const k = w / page.w;
  return (
    <Canvas style={{ width: w, height: page.h * k }} pointerEvents="none">
      <Group transform={[{ scale: k }]}><Picture picture={paperPicture(page)} /></Group>
    </Canvas>
  );
}

export function PaperSheet({ visible, confirm = 'Apply', style, color, size, withSize, onClose, onDone }: {
  visible: boolean; title?: string; confirm?: string; style?: PaperStyle; color?: PaperColor; size?: PageSizeId; withSize?: boolean;
  onClose: () => void; onDone: (style: PaperStyle, color: PaperColor, size?: PageSizeId) => void;
}) {
  const ins = useSafeAreaInsets();
  const { s, set } = useSettings();
  const [st, setSt] = useState<PaperStyle>(style ?? 'blank');
  const [co, setCo] = useState<PaperColor>(color ?? 'white');
  const [sz, setSz] = useState<PageSizeId>(size ?? 'letter');
  const [menu, setMenu] = useState(false);
  const [tab, setTab] = useState<'all' | 'mine'>('all');
  useEffect(() => {
    if (!visible) return;
    setSt(style ?? 'blank');
    setCo(color ?? 'white');
    setSz(size ?? 'letter');
    setTab('all');
  }, [visible, style, color, size]);
  const landscape = sz === 'landscape';
  const mine = s.myTemplates ?? [];
  const isMine = mine.includes(st);
  const tile = ([id, name]: [PaperStyle, string], w: number) => {
    const on = id === st;
    return (
      <Pressable key={id} accessibilityLabel={name} onPress={() => setSt(id)} style={{ width: w }}>
        <View style={{ borderWidth: on ? 4 : 1, borderColor: on ? BLUE : '#C9CFDB', backgroundColor: '#fff', overflow: 'hidden' }}>
          <Preview style={id} color={co} w={w - (on ? 8 : 2)} landscape={landscape} />
          {on ? <View style={{ position: 'absolute', top: 8, left: 8, height: 22, paddingHorizontal: 9, borderRadius: 11, justifyContent: 'center', backgroundColor: '#7A7F8A' }}><Text style={{ color: '#fff', fontSize: 11, fontWeight: '800' }}>CURRENT</Text></View> : null}
          {on ? (
            <Pressable accessibilityLabel={isMine ? 'Remove from My Templates' : 'Add to My Templates'} onPress={() => set({ myTemplates: isMine ? mine.filter((x) => x !== id) : [...mine, id] })} hitSlop={8} style={{ position: 'absolute', top: 8, right: 8 }}>
              <Icon name={isMine ? 'star.fill' : 'star'} size={20} color={BLUE} />
            </Pressable>
          ) : null}
        </View>
        <Text style={{ marginTop: 8, color: '#15171C', fontSize: 15 }}>{name}</Text>
      </Pressable>
    );
  };
  const all = [...BASIC, ...MORE];
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#fff', paddingTop: ins.top }}>
        <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: '#E5E7EC' }}>
          <Pressable accessibilityLabel="Close templates" onPress={onClose} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EC' }}><Icon name="xmark" size={16} color="#15171C" /></Pressable>
          <Text style={{ fontSize: 21, fontWeight: '700', color: '#15171C' }}>Templates</Text>
          <Pressable accessibilityLabel={confirm} onPress={() => onDone(st, co, sz)} style={{ height: 44, paddingHorizontal: 20, borderRadius: 22, justifyContent: 'center', backgroundColor: BLUE }}><Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{confirm}</Text></Pressable>
        </View>
        {tab === 'mine' ? (
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 110 }}>
            <Text style={{ fontSize: 19, fontWeight: '700', color: '#15171C', marginBottom: 16 }}>My Templates</Text>
            {mine.length ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>{all.filter((p) => mine.includes(p[0])).map((p) => tile(p, 170))}</View>
              : <Text style={{ color: '#6B7385', fontSize: 16 }}>Tap the star on a template to keep it here.</Text>}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 110 }}>
            {withSize ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, zIndex: 5 }}>
                <Text style={{ fontSize: 18, fontWeight: '700', color: '#15171C' }}>Size:</Text>
                <View>
                  <Pressable accessibilityLabel="Page size" onPress={() => setMenu((v) => !v)} style={{ width: 220, height: 42, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, borderRadius: 10, borderWidth: 1, borderColor: '#C9CFDB' }}>
                    <Text style={{ fontSize: 17, fontWeight: '600', color: '#15171C' }}>{SIZES.find((x) => x[0] === sz)?.[1] ?? 'Letter'}</Text>
                    <Icon name="chevron.down" size={13} color="#6B7385" />
                  </Pressable>
                  {menu ? (
                    <View style={{ position: 'absolute', top: 46, left: 0, width: 220, borderRadius: 10, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, zIndex: 6 }}>
                      {SIZES.map(([id, n]) => <Pressable key={id} accessibilityLabel={n} onPress={() => { setSz(id); setMenu(false); }} style={{ padding: 12 }}><Text style={{ fontSize: 16, color: '#15171C' }}>{n}</Text></Pressable>)}
                    </View>
                  ) : null}
                </View>
                <View style={{ flex: 1 }} />
                <View style={{ flexDirection: 'row', backgroundColor: '#ECEDF1', borderRadius: 10, padding: 2 }}>
                  {[false, true].map((l) => (
                    <Pressable key={String(l)} accessibilityLabel={l ? 'Landscape' : 'Portrait'} onPress={() => setSz(l ? 'landscape' : 'letter')} style={{ width: 42, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: landscape === l ? '#fff' : 'transparent' }}>
                      <View style={{ width: l ? 18 : 13, height: l ? 13 : 18, borderWidth: 1.5, borderColor: landscape === l ? BLUE : '#7A8294', borderRadius: 2 }} />
                    </Pressable>
                  ))}
                </View>
              </View>
            ) : null}
            <Text style={{ fontSize: 19, fontWeight: '700', color: '#15171C', marginTop: 26, marginBottom: 16 }}>Basic Templates</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>{BASIC.map((p) => tile(p, 170))}</View>
            <Text style={{ fontSize: 19, fontWeight: '700', color: '#15171C', marginTop: 30, marginBottom: 16 }}>More Templates</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 24 }}>{MORE.map((p) => tile(p, 170))}</View>
            <Text style={{ fontSize: 19, fontWeight: '700', color: '#15171C', marginTop: 30, marginBottom: 14 }}>Paper colour</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
              {PAPERS.map((p) => (
                <Pressable key={p.id} accessibilityLabel={p.name} onPress={() => setCo(p.id)} style={{ alignItems: 'center', gap: 5 }}>
                  <View style={{ width: 40, height: 40, borderRadius: 20, backgroundColor: p.bg, borderWidth: p.id === co ? 3 : 1, borderColor: p.id === co ? BLUE : '#C9CFDB' }} />
                  <Text style={{ color: '#6B7385', fontSize: 12 }}>{p.name}</Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
        )}
        <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 28, alignItems: 'center' }}>
          <View style={{ flexDirection: 'row', padding: 4, borderRadius: 26, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 3 } }}>
            {([['all', 'Templates', 'doc.plaintext'], ['mine', 'My Templates', 'heart']] as const).map(([id, n, icon]) => (
              <Pressable key={id} accessibilityLabel={n} onPress={() => setTab(id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 42, paddingHorizontal: 14, borderRadius: 21, backgroundColor: tab === id ? '#ECEDF1' : 'transparent' }}>
                <Icon name={icon} size={18} color={tab === id ? BLUE : '#3B4252'} />
                <Text style={{ color: tab === id ? BLUE : '#3B4252', fontSize: 15, fontWeight: '600' }}>{n}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      </View>
    </Modal>
  );
}
