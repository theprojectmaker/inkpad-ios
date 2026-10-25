// Paper style + colour chooser, with live mini previews.
import { Canvas, Group, Picture } from '@shopify/react-native-skia';
import { Pressable, Text, View } from 'react-native';

import { LETTER, PAGE_SIZES, type PageSizeId, type PaperColor, type PaperStyle, paperPage } from '@/lib/model';
import { PAPER_STYLES, PAPERS } from '@/lib/paper';
import { useTheme } from '@/lib/settings';
import { paperPicture } from '@/lib/skia-render';

const PW = 64;

function Mini({ style, color }: { style: PaperStyle; color: PaperColor }) {
  const page = paperPage(style, color);
  const k = PW / LETTER.w;
  return (
    <Canvas style={{ width: PW, height: LETTER.h * k }} pointerEvents="none">
      <Group transform={[{ scale: k }]}><Picture picture={paperPicture(page)} /></Group>
    </Canvas>
  );
}

export function PaperPicker({ style, color, onChange, size, onSize }: {
  style: PaperStyle; color: PaperColor; onChange: (s: PaperStyle, c: PaperColor) => void;
  size?: PageSizeId; onSize?: (s: PageSizeId) => void;
}) {
  const t = useTheme();
  return (
    <View style={{ gap: 14 }}>
      {onSize ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {PAGE_SIZES.map((p) => {
            const on = (size ?? 'letter') === p.id;
            return (
              <Pressable key={p.id} onPress={() => onSize(p.id)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 36, paddingHorizontal: 12, borderRadius: 18, backgroundColor: on ? t.accent : t.chip }}>
                <View style={{ width: (p.w / p.h) * 16, height: 16, borderRadius: 2, borderWidth: 1.5, borderColor: on ? '#fff' : t.sub }} />
                <Text style={{ color: on ? '#fff' : t.text, fontSize: 14, fontWeight: '600' }}>{p.name}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {PAPER_STYLES.map((p) => (
          <Pressable key={p.id} onPress={() => onChange(p.id, color)} style={{ alignItems: 'center', gap: 5 }}>
            <View style={{ borderWidth: 2, borderColor: p.id === style ? t.accent : t.line, borderRadius: 6, padding: 2 }}>
              <Mini style={p.id} color={color} />
            </View>
            <Text style={{ color: p.id === style ? t.accent : t.sub, fontSize: 12, fontWeight: '600' }}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
        {PAPERS.map((p) => (
          <Pressable key={p.id} onPress={() => onChange(style, p.id)} accessibilityLabel={p.name} style={{ alignItems: 'center', gap: 4 }}>
            <View style={{ width: 34, height: 34, borderRadius: 17, backgroundColor: p.bg, borderWidth: p.id === color ? 3 : 1, borderColor: p.id === color ? t.accent : t.line }} />
            <Text style={{ color: t.sub, fontSize: 11 }}>{p.name}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
