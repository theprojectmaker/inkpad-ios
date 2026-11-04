// Quill's tools for the canvas, laid out like Notability:
// ToolButtons sit in the middle of the top bar (line icons, the pen and
// highlighter show their colour underneath), and ToolStrip is a thin row under
// the bar with the current tool's options: pen style, colours and sizes.
import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import type { CanvasTool } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { ColorSheet } from '@/components/color-sheet';
import { type FavTool, type InkTool, type PenStyle, useSettings, useTheme } from '@/lib/settings';

export const TOOLS: { id: InkTool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'pencil.tip', label: 'Pen' },
  { id: 'marker', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso' },
  { id: 'text', icon: 'textformat', label: 'Text' },
  { id: 'tape', icon: 'rectangle.fill', label: 'Tape' },
  { id: 'laser', icon: 'cursorarrow.rays', label: 'Laser pointer' },
];

const PEN_STYLES: { id: PenStyle; label: string }[] = [
  { id: 'pen', label: 'Ballpoint' },
  { id: 'felt', label: 'Gel' },
  { id: 'fountain', label: 'Fountain' },
  { id: 'pencil', label: 'Pencil' },
];

export const PEN_COLORS = ['#111111', '#1E5EFF', '#E5322D', '#0AA35B', '#F28C18', '#8E44EC'];
export const HL_COLORS = ['#FFE14D', '#7CF27C', '#6FD3FF', '#FF8FD0', '#FFB45C', '#C9B6FF'];

const WIDTHS = {
  pen: [1.1, 1.6, 2.4],
  felt: [1.4, 2.2, 3.4],
  fountain: [2, 4, 7],
  pencil: [1.5, 3, 6],
  marker: [8, 15, 26],
  eraser: [8, 20, 40],
  text: [14, 18, 26],
  tape: [16, 26, 40],
} as const;

const TAPE_COLORS = ['#F7B731', '#45AAF2', '#26DE81', '#FC5C65', '#A55EEA', '#4B4B4B'];
const FONTS: { id: string; label: string }[] = [
  { id: 'system', label: 'Plain' }, { id: 'round', label: 'Round' }, { id: 'serif', label: 'Serif' }, { id: 'hand', label: 'Hand' }, { id: 'mono', label: 'Mono' },
];

/** The tool the canvas should use for the current settings. */
export function currentTool(s: { inkKind?: InkTool; penStyle?: PenStyle; inkSize?: number; textSizeIdx?: number; penColor: string; hlColor: string; eraser?: string; lassoBox?: boolean; tapeColor?: string; tapeSize?: number; textFont?: string; textBold?: boolean }): CanvasTool {
  const kind = s.inkKind ?? 'pen';
  const i = Math.max(0, Math.min(2, s.inkSize ?? 1));
  if (kind === 'pen') {
    // Ballpoint = an even, thin line: no swelling where you press hard or slow down.
    // Gel = a line that thickens with pressure.
    const st = s.penStyle ?? 'pen';
    const kind = st === 'pen' ? 'monoline' : st === 'felt' ? 'pen' : st;
    return { kind, color: s.penColor, width: WIDTHS[st][i] };
  }
  if (kind === 'marker') return { kind: 'marker', color: s.hlColor, width: WIDTHS.marker[i] };
  if (kind === 'eraser') return { kind: 'eraser', color: '#000000', width: WIDTHS.eraser[i], mode: s.eraser ?? 'partial' };
  if (kind === 'tape') return { kind: 'tape', color: s.tapeColor ?? TAPE_COLORS[0], width: WIDTHS.tape[Math.max(0, Math.min(2, s.tapeSize ?? 1))] };
  if (kind === 'laser') return { kind: 'laser', color: '#FF2A33', width: 5 };
  if (kind === 'text') return { kind: 'text', color: s.penColor, width: WIDTHS.text[Math.max(0, Math.min(2, s.textSizeIdx ?? 1))], mode: s.textFont ?? 'system', bold: !!s.textBold };
  return { kind: 'lasso', color: '#000000', width: 1, mode: s.lassoBox ? 'box' : 'free' };
}

/** The tools. Like Notability: tap a tool to pick it, tap it again for its options. */
export function ToolButtons({ onOptions }: { onOptions?: () => void } = {}) {
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      {TOOLS.map((x) => {
        const on = x.id === kind;
        const under = x.id === 'pen' ? s.penColor : x.id === 'marker' ? s.hlColor : x.id === 'tape' ? s.tapeColor : null;
        return (
          <Pressable key={x.id} accessibilityLabel={x.label} onPress={() => { if (on) onOptions?.(); else set({ inkKind: x.id, lastTool: kind }); }}
            style={({ pressed }) => ({ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.accent + (t.dark ? '33' : '18') : pressed ? t.chip : 'transparent' })}>
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

/** The picked tool's options: pen style, colours, sizes. Shown as a card under the tools. */
export function ToolStrip({ floating, onPaste, onTape }: { floating?: boolean; onPaste?: () => void; onTape?: (what: 'show' | 'hide' | 'clear') => void } = {}) {
  const [picker, setPicker] = useState(false);
  const t = useTheme();
  const { s, set } = useSettings();
  const kind = s.inkKind ?? 'pen';
  const hl = kind === 'marker';
  const tool = currentTool(s);

  const tape = kind === 'tape';
  const nowColor = tape ? s.tapeColor : hl ? s.hlColor : s.penColor;
  const base = tape ? TAPE_COLORS : hl ? HL_COLORS : PEN_COLORS;
  // A colour picked from the full palette stays in the row.
  const extra = !tape && !base.includes(nowColor.toUpperCase()) ? [nowColor] : [];
  const colors = [...base, ...extra].map((c) => {
    const on = c.toUpperCase() === nowColor.toUpperCase();
    return (
      <Pressable key={c} accessibilityLabel={`Colour ${c}`} onPress={() => set(tape ? { tapeColor: c } : hl ? { hlColor: c } : { penColor: c })}
        style={{ width: 30, height: 36, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: on ? c : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: on ? 16 : 20, height: on ? 16 : 20, borderRadius: 10, backgroundColor: c, borderWidth: c === '#FFFFFF' ? 1 : 0, borderColor: t.line }} />
        </View>
      </Pressable>
    );
  });

  const sizeIdx = kind === 'text' ? s.textSizeIdx ?? 1 : tape ? s.tapeSize ?? 1 : s.inkSize ?? 1;
  const sizes = [0, 1, 2].map((i) => {
    const on = sizeIdx === i;
    let mark;
    if (kind === 'eraser') mark = <View style={{ width: [8, 14, 22][i], height: [8, 14, 22][i], borderRadius: 11, borderWidth: 1.5, borderColor: on ? t.text : t.faint }} />;
    else if (kind === 'text') mark = <Text style={{ color: on ? t.text : t.faint, fontSize: [13, 17, 22][i], fontWeight: '600' }}>Aa</Text>;
    else {
      const w = (tape ? WIDTHS.tape : hl ? WIDTHS.marker : WIDTHS[s.penStyle ?? 'pen'])[i];
      mark = <View style={{ width: 24, height: Math.max(1.5, Math.min(12, tape || hl ? w * 0.45 : w * 1.1)), borderRadius: 6, backgroundColor: tool.color, opacity: on ? 1 : 0.35 }} />;
    }
    return (
      <Pressable key={i} accessibilityLabel={['Small', 'Medium', 'Large'][i]} onPress={() => set(kind === 'text' ? { textSizeIdx: i } : tape ? { tapeSize: i } : { inkSize: i })}
        style={{ width: 42, height: 30, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.chip : 'transparent' }}>
        {mark}
      </Pressable>
    );
  });

  let body;
  const seg = <T extends string>(options: [T, string][], value: T, pick: (v: T) => void) => (
    <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2 }}>
      {options.map(([id, label]) => (
        <Pressable key={id} accessibilityLabel={label} onPress={() => pick(id)}
          style={{ paddingHorizontal: 11, height: 28, borderRadius: 7, justifyContent: 'center', backgroundColor: value === id ? t.elev : 'transparent' }}>
          <Text style={{ color: value === id ? t.text : t.sub, fontSize: 13, fontWeight: value === id ? '700' : '500' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
  const pill = (label: string, onPress?: () => void) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} style={{ height: 30, paddingHorizontal: 12, marginLeft: 6, borderRadius: 15, justifyContent: 'center', backgroundColor: t.chip }}>
      <Text style={{ color: t.text, fontSize: 13, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
  const more = (
    <Pressable accessibilityLabel="More colours" onPress={() => setPicker(true)} style={{ width: 30, height: 36, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="plus.circle" size={21} color={t.sub} />
    </Pressable>
  );
  const isFav = (s.favs ?? []).some((f) => f.kind === kind && f.color === nowColor && f.size === (s.inkSize ?? 1) && (hl || f.style === (s.penStyle ?? 'pen')));
  const saveFav = () => {
    const f: FavTool = { kind: hl ? 'marker' : 'pen', style: s.penStyle ?? 'pen', color: nowColor, size: s.inkSize ?? 1 };
    if (!isFav) set({ favs: [...(s.favs ?? []), f].slice(-8), showFavs: true });
  };
  if (kind === 'laser') {
    body = <Text style={{ color: t.sub, fontSize: 13 }}>Point at things with the Pencil; the trail fades on its own</Text>;
  } else if (kind === 'lasso') {
    body = (
      <>
        {seg<'free' | 'box'>([['free', 'Freehand'], ['box', 'Box']], s.lassoBox ? 'box' : 'free', (v) => set({ lassoBox: v === 'box' }))}
        <Sep />
        <Text style={{ color: t.sub, fontSize: 13 }}>Circle ink, or tap a photo or text</Text>
        {pill('Paste', onPaste)}
      </>
    );
  } else if (tape) {
    body = (
      <>
        {colors}<Sep />{sizes}<Sep />
        {pill('Hide all', () => onTape?.('hide'))}
        {pill('Reveal all', () => onTape?.('show'))}
        {pill('Remove all', () => onTape?.('clear'))}
      </>
    );
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
        {kind === 'eraser' ? <>{seg<'partial' | 'stroke' | 'hl'>([['partial', 'Partial'], ['stroke', 'Whole line'], ['hl', 'Highlighter only']], (s.eraser as 'partial') ?? 'partial', (v) => set({ eraser: v }))}<Sep /></> : null}
        {kind !== 'eraser' ? <>{colors}{more}<Sep /></> : null}
        {kind === 'text' ? <>{seg(FONTS.map((f) => [f.id, f.label] as [string, string]), s.textFont ?? 'system', (v) => set({ textFont: v }))}{pill(s.textBold ? 'Bold ✓' : 'Bold', () => set({ textBold: !s.textBold }))}<Sep /></> : null}
        {sizes}
        {kind === 'pen' || hl ? pill(isFav ? 'Saved ★' : 'Save pen ☆', saveFav) : null}
        {kind === 'text' ? <></> : null}
      </>
    );
  }

  return (
    <>
    <ColorSheet visible={picker} onClose={() => setPicker(false)} target={hl ? 'hl' : 'pen'} />
    {floating ? (
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', rowGap: 8, maxWidth: 860, paddingHorizontal: 16, paddingVertical: 10,
        borderRadius: 18, backgroundColor: t.elev, borderWidth: t.dark ? 1 : 0, borderColor: t.line,
        shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}>
        {body}
      </View>
    ) : (
    // Scrolls sideways when it doesn't fit (Split View, smaller iPads) instead of cutting off.
    <ScrollView horizontal showsHorizontalScrollIndicator={false} bounces={false}
      style={{ height: 44, flexGrow: 0, borderBottomWidth: 1, borderBottomColor: t.line, backgroundColor: t.bar }}
      contentContainerStyle={{ flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 }}>
      {body}
    </ScrollView>
    )}
    </>
  );
}

/** The pens you saved, floating at the side of the page. Tap to write with one; press and hold to remove it. */
export function FavBar() {
  const t = useTheme();
  const { s, set } = useSettings();
  const favs = s.favs ?? [];
  if (s.showFavs === false || !favs.length) return null;
  const kind = s.inkKind ?? 'pen';
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 8, top: 0, bottom: 0, justifyContent: 'center' }}>
      <View style={{ paddingVertical: 6, paddingHorizontal: 4, gap: 4, borderRadius: 20, backgroundColor: t.elev + 'F2', borderWidth: t.dark ? 1 : 0, borderColor: t.line,
        shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 10, shadowOffset: { width: 0, height: 3 } }}>
        {favs.map((f, i) => {
          const on = f.kind === kind && f.color === (f.kind === 'marker' ? s.hlColor : s.penColor) && f.size === (s.inkSize ?? 1) && (f.kind === 'marker' || f.style === (s.penStyle ?? 'pen'));
          return (
            <Pressable key={i} accessibilityLabel={`Saved pen ${i + 1}`} delayLongPress={450}
              onPress={() => set(f.kind === 'marker' ? { inkKind: 'marker', hlColor: f.color, inkSize: f.size, lastTool: kind } : { inkKind: 'pen', penColor: f.color, penStyle: f.style, inkSize: f.size, lastTool: kind })}
              onLongPress={() => set({ favs: favs.filter((_, k) => k !== i) })}
              style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.accent + '26' : 'transparent' }}>
              {f.kind === 'marker'
                ? <View style={{ width: 18, height: 10, borderRadius: 2, backgroundColor: f.color }} />
                : <View style={{ width: 8 + f.size * 4, height: 8 + f.size * 4, borderRadius: 10, backgroundColor: f.color }} />}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}
