// Quill's tools for the PencilKit canvas, laid out like Notability:
// ToolButtons sit in the middle of the top bar (line icons, the pen and
// highlighter show their colour underneath), and ToolStrip is a thin row under
// the bar with the current tool's options: pen style, colours and sizes.
import { Pressable, Text, View } from 'react-native';

import type { CanvasTool } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { type InkTool, type PenStyle, useSettings, useTheme } from '@/lib/settings';

export const TOOLS: { id: InkTool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'pencil.tip', label: 'Pen' },
  { id: 'marker', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso' },
  { id: 'text', icon: 'textformat', label: 'Text' },
];

const PEN_STYLES: { id: PenStyle; label: string }[] = [
  { id: 'pen', label: 'Ballpoint' },
  { id: 'fountain', label: 'Fountain' },
  { id: 'pencil', label: 'Pencil' },
];

export const PEN_COLORS = ['#111111', '#1E5EFF', '#E5322D', '#0AA35B', '#F28C18', '#8E44EC'];
export const HL_COLORS = ['#FFE14D', '#7CF27C', '#6FD3FF', '#FF8FD0', '#FFB45C', '#C9B6FF'];

const WIDTHS = {
  pen: [1.5, 2.6, 4.5],
  fountain: [2, 4, 7],
  pencil: [1.5, 3, 6],
  marker: [8, 15, 26],
  eraser: [8, 20, 40],
  text: [14, 18, 26],
} as const;

/** The tool the canvas should use for the current settings. */
export function currentTool(s: { inkKind?: InkTool; penStyle?: PenStyle; inkSize?: number; textSizeIdx?: number; penColor: string; hlColor: string }): CanvasTool {
  const kind = s.inkKind ?? 'pen';
  const i = Math.max(0, Math.min(2, s.inkSize ?? 1));
  if (kind === 'pen') { const st = s.penStyle ?? 'pen'; return { kind: st, color: s.penColor, width: WIDTHS[st][i] }; }
  if (kind === 'marker') return { kind: 'marker', color: s.hlColor, width: WIDTHS.marker[i] };
  if (kind === 'eraser') return { kind: 'eraser', color: '#000000', width: WIDTHS.eraser[i] };
  if (kind === 'text') return { kind: 'text', color: s.penColor, width: WIDTHS.text[Math.max(0, Math.min(2, s.textSizeIdx ?? 1))] };
  return { kind: 'lasso', color: '#000000', width: 1 };
}

export function ToolButtons() {
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {TOOLS.map((x) => {
        const on = x.id === kind;
        const under = x.id === 'pen' ? s.penColor : x.id === 'marker' ? s.hlColor : null;
        return (
          <Pressable key={x.id} accessibilityLabel={x.label} onPress={() => set({ inkKind: x.id })}
            style={({ pressed }) => ({ width: 44, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.accent + (t.dark ? '33' : '18') : pressed ? t.chip : 'transparent' })}>
            <Icon name={x.icon} size={20} color={on ? t.accent : t.text} />
            {under ? <View style={{ position: 'absolute', bottom: 5, width: 16, height: 3, borderRadius: 2, backgroundColor: under }} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}

const Sep = () => {
  const t = useTheme();
  return <View style={{ width: 1, height: 20, backgroundColor: t.line, marginHorizontal: 10 }} />;
};

export function ToolStrip() {
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  const hl = kind === 'marker';
  const tool = currentTool(s);

  const colors = (hl ? HL_COLORS : PEN_COLORS).map((c) => {
    const on = c.toUpperCase() === (hl ? s.hlColor : s.penColor).toUpperCase();
    return (
      <Pressable key={c} accessibilityLabel={`Colour ${c}`} onPress={() => set(hl ? { hlColor: c } : { penColor: c })}
        style={{ width: 30, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? c : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: on ? 16 : 20, height: on ? 16 : 20, borderRadius: 10, backgroundColor: c, borderWidth: c === '#FFFFFF' ? 1 : 0, borderColor: t.line }} />
        </View>
      </Pressable>
    );
  });

  const sizeIdx = kind === 'text' ? s.textSizeIdx ?? 1 : s.inkSize ?? 1;
  const sizes = [0, 1, 2].map((i) => {
    const on = sizeIdx === i;
    let mark;
    if (kind === 'eraser') mark = <View style={{ width: [8, 14, 22][i], height: [8, 14, 22][i], borderRadius: 11, borderWidth: 1.5, borderColor: on ? t.text : t.faint }} />;
    else if (kind === 'text') mark = <Text style={{ color: on ? t.text : t.faint, fontSize: [13, 17, 22][i], fontWeight: '600' }}>Aa</Text>;
    else {
      const w = (hl ? WIDTHS.marker : WIDTHS[s.penStyle ?? 'pen'])[i];
      mark = <View style={{ width: 24, height: Math.max(1.5, Math.min(12, hl ? w * 0.45 : w * 1.1)), borderRadius: 6, backgroundColor: tool.color, opacity: on ? 1 : 0.35 }} />;
    }
    return (
      <Pressable key={i} accessibilityLabel={['Small', 'Medium', 'Large'][i]} onPress={() => set(kind === 'text' ? { textSizeIdx: i } : { inkSize: i })}
        style={{ width: 42, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.chip : 'transparent' }}>
        {mark}
      </Pressable>
    );
  });

  let body;
  if (kind === 'lasso') {
    body = <Text style={{ color: t.sub, fontSize: 13 }}>Circle ink to move, resize or delete it</Text>;
  } else {
    body = (
      <>
        {kind === 'pen' ? (
          <>
            <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2 }}>
              {PEN_STYLES.map((p) => {
                const on = (s.penStyle ?? 'pen') === p.id;
                return (
                  <Pressable key={p.id} onPress={() => set({ penStyle: p.id })}
                    style={{ paddingHorizontal: 11, height: 28, borderRadius: 7, justifyContent: 'center', backgroundColor: on ? t.elev : 'transparent' }}>
                    <Text style={{ color: on ? t.text : t.sub, fontSize: 13, fontWeight: on ? '700' : '500' }}>{p.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Sep />
          </>
        ) : null}
        {kind !== 'eraser' ? <>{colors}<Sep /></> : null}
        {sizes}
        {kind === 'text' ? <><Sep /><Text style={{ color: t.sub, fontSize: 13 }}>Tap the page to type · drag text to move it</Text></> : null}
      </>
    );
  }

  return (
    <View style={{ height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.bar }}>
      {body}
    </View>
  );
}
