// Full colour palette (hues × shades + greys); picked colours are remembered in the toolbar.
import { Pressable, View } from 'react-native';

import { useSettings, useTheme } from '@/lib/settings';
import { Sheet } from './ui';

function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => { const k = (n + h / 30) % 12; return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, '0'); };
  return `#${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

const HUES = [0, 20, 38, 52, 90, 140, 170, 195, 215, 245, 275, 310];
const SHADES: [number, number][] = [[0.85, 0.82], [0.8, 0.66], [0.78, 0.52], [0.75, 0.4], [0.7, 0.28]];
const ROWS = SHADES.map(([s, l]) => HUES.map((h) => hsl(h, s, l)));
const GREYS = ['#FFFFFF', '#E6E6E6', '#C4C4C4', '#9A9A9A', '#6E6E6E', '#4A4A4A', '#2E2E2E', '#111111', '#7B5B3A', '#C2A27A', '#3D5A80', '#2A9D8F'];

export function ColorSheet({ visible, onClose, target }: { visible: boolean; onClose: () => void; target: 'pen' | 'hl' }) {
  const t = useTheme();
  const { s, set } = useSettings();
  const cur = target === 'hl' ? s.hlColor : s.penColor;
  const pick = (c: string) => {
    const recent = [c, ...s.recentColors.filter((x) => x !== c)].slice(0, 6);
    set(target === 'hl' ? { hlColor: c, recentColors: recent } : { penColor: c, recentColors: recent });
    onClose();
  };
  return (
    <Sheet visible={visible} onClose={onClose} title={target === 'hl' ? 'Highlighter colour' : 'Ink colour'} width={470}>
      {[...ROWS, GREYS].map((row, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 4, marginBottom: 4 }}>
          {row.map((c) => (
            <Pressable key={c} onPress={() => pick(c)} accessibilityLabel={`Colour ${c}`}
              style={{ flex: 1, aspectRatio: 1, borderRadius: 7, backgroundColor: c, borderWidth: c === cur ? 3 : c === '#FFFFFF' ? 1 : 0, borderColor: c === cur ? t.accent : t.line }} />
          ))}
        </View>
      ))}
    </Sheet>
  );
}
