// Quill's own tool bar for the PencilKit canvas (instead of Apple's palette):
// one slim row of tools, then colours and three sizes for the current tool.
import { Pressable, View } from 'react-native';

import type { CanvasTool } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { type InkTool, useSettings, useTheme } from '@/lib/settings';

const TOOLS: { id: InkTool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'pencil.tip', label: 'Pen' },
  { id: 'fountain', icon: 'signature', label: 'Fountain pen' },
  { id: 'pencil', icon: 'pencil', label: 'Pencil' },
  { id: 'marker', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso' },
];

export const PEN_COLORS = ['#111111', '#1E5EFF', '#E5322D', '#0AA35B', '#8E44EC'];
export const HL_COLORS = ['#FFE14D', '#7CF27C', '#6FD3FF', '#FF8FD0', '#FFB45C'];

const WIDTHS: Record<InkTool, [number, number, number]> = {
  pen: [1.5, 2.6, 4.5],
  fountain: [2, 4, 7],
  pencil: [1.5, 3, 6],
  marker: [8, 15, 26],
  eraser: [8, 20, 40],
  lasso: [1, 1, 1],
};

/** The tool the canvas should use for the current settings. */
export function currentTool(kind: InkTool, size: number, penColor: string, hlColor: string): CanvasTool {
  const w = WIDTHS[kind][Math.max(0, Math.min(2, size))];
  return { kind, color: kind === 'marker' ? hlColor : penColor, width: w };
}

export function InkBar({ ruler, onRuler }: { ruler: boolean; onRuler: () => void }) {
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  const hl = kind === 'marker';
  const colors = hl ? HL_COLORS : PEN_COLORS;
  const color = hl ? s.hlColor : s.penColor;
  const showColors = kind !== 'eraser' && kind !== 'lasso';
  const showSizes = kind !== 'lasso';
  const sep = <View style={{ width: 1, height: 22, backgroundColor: t.line, marginHorizontal: 8 }} />;

  return (
    <View style={{ alignItems: 'center', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.bar }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', height: 44, paddingHorizontal: 8, borderRadius: 22, backgroundColor: t.chip }}>
        {TOOLS.map((x) => {
          const on = x.id === kind;
          return (
            <Pressable key={x.id} accessibilityLabel={x.label} onPress={() => set({ inkKind: x.id })}
              style={{ width: 40, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.elev : 'transparent' }}>
              <Icon name={x.icon} size={19} color={on ? t.accent : t.sub} />
            </Pressable>
          );
        })}
        <Pressable accessibilityLabel={ruler ? 'Hide ruler' : 'Show ruler'} onPress={onRuler}
          style={{ width: 40, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: ruler ? t.elev : 'transparent' }}>
          <Icon name="ruler" size={19} color={ruler ? t.accent : t.sub} />
        </Pressable>
        {showColors ? sep : null}
        {showColors ? colors.map((c) => {
          const on = c.toUpperCase() === color.toUpperCase();
          return (
            <Pressable key={c} accessibilityLabel={`Colour ${c}`} onPress={() => set(hl ? { hlColor: c } : { penColor: c })}
              style={{ width: 32, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: on ? 24 : 20, height: on ? 24 : 20, borderRadius: 12, backgroundColor: c, borderWidth: on ? 3 : 0, borderColor: t.elev, shadowColor: '#000', shadowOpacity: on ? 0.25 : 0, shadowRadius: 2 }} />
            </Pressable>
          );
        }) : null}
        {showSizes ? sep : null}
        {showSizes ? [0, 1, 2].map((i) => {
          const on = (s.inkSize ?? 1) === i;
          const d = [6, 10, 15][i];
          return (
            <Pressable key={i} accessibilityLabel={['Thin', 'Medium', 'Thick'][i]} onPress={() => set({ inkSize: i })}
              style={{ width: 34, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.elev : 'transparent' }}>
              <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: on ? t.text : t.faint }} />
            </Pressable>
          );
        }) : null}
        {sep}
        <Pressable accessibilityLabel={s.fingerDraws ? 'Fingers draw (tap to scroll with fingers)' : 'Fingers scroll (tap to draw with fingers)'} onPress={() => set({ fingerDraws: !s.fingerDraws })}
          style={{ width: 40, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: s.fingerDraws ? t.elev : 'transparent' }}>
          <Icon name="hand.draw" size={19} color={s.fingerDraws ? t.accent : t.sub} />
        </Pressable>
      </View>
    </View>
  );
}
