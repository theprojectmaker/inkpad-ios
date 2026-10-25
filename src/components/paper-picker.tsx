// Paper style + colour chooser, with live mini previews.
import { Canvas, Group, Picture } from '@shopify/react-native-skia';
import { Pressable, Text, View } from 'react-native';

import { LETTER, type PaperColor, type PaperStyle, paperPage } from '@/lib/model';
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

export function PaperPicker({ style, color, onChange }: { style: PaperStyle; color: PaperColor; onChange: (s: PaperStyle, c: PaperColor) => void }) {
  const t = useTheme();
  return (
    <View style={{ gap: 14 }}>
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
