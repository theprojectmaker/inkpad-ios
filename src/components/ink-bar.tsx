// Quill's own tools for the PencilKit canvas (instead of Apple's palette).
// PenTray: little drawn pens standing in the top bar, each tipped with its
// colour; the picked one sits up. OptionsPill: floats under the bar with the
// colours and three sizes (shown as real strokes) for the current tool.
import { Pressable, View } from 'react-native';

import type { CanvasTool } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { type InkTool, useSettings, useTheme } from '@/lib/settings';

export const TOOLS: { id: InkTool; label: string }[] = [
  { id: 'pen', label: 'Pen' },
  { id: 'fountain', label: 'Fountain pen' },
  { id: 'pencil', label: 'Pencil' },
  { id: 'marker', label: 'Highlighter' },
  { id: 'eraser', label: 'Eraser' },
  { id: 'lasso', label: 'Lasso' },
];

export const PEN_COLORS = ['#111111', '#1E5EFF', '#E5322D', '#0AA35B', '#F28C18', '#8E44EC'];
export const HL_COLORS = ['#FFE14D', '#7CF27C', '#6FD3FF', '#FF8FD0', '#FFB45C', '#C9B6FF'];

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

// ---------- pen drawings ----------

const tri = (w: number, h: number, color: string) => (
  <View style={{ width: 0, height: 0, borderLeftWidth: w / 2, borderRightWidth: w / 2, borderBottomWidth: h, borderLeftColor: 'transparent', borderRightColor: 'transparent', borderBottomColor: color }} />
);

function PenArt({ kind, color, dark }: { kind: InkTool; color: string; dark: boolean }) {
  const body = dark ? '#3A3D45' : '#FFFFFF';
  const edge = dark ? '#4A4E57' : '#D5D8DE';
  const B = (h: number, c = body, w = 16) => <View style={{ width: w, height: h, backgroundColor: c, borderLeftWidth: 1, borderRightWidth: 1, borderColor: edge }} />;
  switch (kind) {
    case 'pen':
      return (
        <View style={{ alignItems: 'center' }}>
          {tri(4, 5, color)}
          {tri(16, 13, dark ? '#8B8F98' : '#C9CDD4')}
          <View style={{ width: 16, height: 5, backgroundColor: color }} />
          {B(40)}
        </View>
      );
    case 'fountain':
      return (
        <View style={{ alignItems: 'center' }}>
          <View style={{ alignItems: 'center' }}>
            {tri(14, 16, '#D4AF4F')}
            <View style={{ position: 'absolute', top: 5, width: 1, height: 11, backgroundColor: '#8A6A1E' }} />
          </View>
          <View style={{ width: 16, height: 4, backgroundColor: '#B8902F' }} />
          {B(42, color)}
        </View>
      );
    case 'pencil':
      return (
        <View style={{ alignItems: 'center' }}>
          {tri(5, 5, color)}
          {tri(16, 12, '#EBCB94')}
          {B(42, color)}
        </View>
      );
    case 'marker':
      return (
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 12, height: 8, backgroundColor: color, borderTopLeftRadius: 2, borderTopRightRadius: 6, transform: [{ skewX: '-12deg' }] }} />
          <View style={{ width: 18, height: 8, backgroundColor: dark ? '#6C707A' : '#B9BDC5' }} />
          <View style={{ width: 20, height: 9, backgroundColor: color }} />
          {B(38, body, 20)}
        </View>
      );
    case 'eraser':
      return (
        <View style={{ alignItems: 'center' }}>
          <View style={{ width: 20, height: 18, backgroundColor: '#F4A7B4', borderTopLeftRadius: 5, borderTopRightRadius: 5 }} />
          <View style={{ width: 20, height: 6, backgroundColor: dark ? '#8B8F98' : '#C9CDD4' }} />
          {B(36, body, 20)}
        </View>
      );
    default:
      return null;
  }
}

/** The tools as pens standing in the bar. Tapping the current one shows/hides its options. */
export function PenTray({ onToggleOptions }: { onToggleOptions: () => void }) {
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 52, overflow: 'hidden', gap: 2 }}>
      {TOOLS.map((x) => {
        const on = x.id === kind;
        const color = x.id === 'marker' ? s.hlColor : s.penColor;
        return (
          <Pressable key={x.id} accessibilityLabel={x.label} onPress={() => (on ? onToggleOptions() : set({ inkKind: x.id }))}
            style={{ width: 44, height: 52, alignItems: 'center', justifyContent: x.id === 'lasso' ? 'center' : 'flex-start' }}>
            {x.id === 'lasso' ? (
              <View style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.accent + '22' : 'transparent' }}>
                <Icon name="lasso" size={21} color={on ? t.accent : t.sub} />
              </View>
            ) : (
              <View style={{ marginTop: on ? 4 : 16 }}>
                <PenArt kind={x.id} color={color} dark={t.dark} />
              </View>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Colours and sizes for the current tool, floating under the bar. */
export function OptionsPill() {
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  if (kind === 'lasso') return null;
  const hl = kind === 'marker';
  const colors = hl ? HL_COLORS : PEN_COLORS;
  const color = hl ? s.hlColor : s.penColor;
  const size = s.inkSize ?? 1;
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', height: 46, paddingHorizontal: 10, borderRadius: 23, backgroundColor: t.elev,
      shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, borderWidth: t.dark ? 1 : 0, borderColor: t.line }}>
      {kind !== 'eraser' ? colors.map((c) => {
        const on = c.toUpperCase() === color.toUpperCase();
        return (
          <Pressable key={c} accessibilityLabel={`Colour ${c}`} onPress={() => set(hl ? { hlColor: c } : { penColor: c })}
            style={{ width: 34, height: 40, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: 26, height: 26, borderRadius: 13, borderWidth: 2, borderColor: on ? c : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
              <View style={{ width: on ? 18 : 22, height: on ? 18 : 22, borderRadius: 11, backgroundColor: c }} />
            </View>
          </Pressable>
        );
      }) : null}
      {kind !== 'eraser' ? <View style={{ width: 1, height: 24, backgroundColor: t.line, marginHorizontal: 8 }} /> : null}
      {[0, 1, 2].map((i) => {
        const on = size === i;
        const w = WIDTHS[kind][i];
        return (
          <Pressable key={i} accessibilityLabel={['Thin', 'Medium', 'Thick'][i]} onPress={() => set({ inkSize: i })}
            style={{ width: 46, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.chip : 'transparent' }}>
            {kind === 'eraser'
              ? <View style={{ width: [8, 14, 22][i], height: [8, 14, 22][i], borderRadius: 11, borderWidth: 1.5, borderColor: on ? t.text : t.faint }} />
              : <View style={{ width: 26, height: Math.max(1.5, Math.min(14, hl ? w * 0.5 : w * 1.2)), borderRadius: 7, backgroundColor: hl ? color : on ? color : t.faint, opacity: hl && !on ? 0.5 : 1 }} />}
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small round toggle used in the top bar (ruler, finger drawing). */
export function BarToggle({ icon, label, on, onPress }: { icon: string; label: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityLabel={label} onPress={onPress}
      style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.accent + '22' : 'transparent' }}>
      <Icon name={icon} size={19} color={on ? t.accent : t.sub} />
    </Pressable>
  );
}
