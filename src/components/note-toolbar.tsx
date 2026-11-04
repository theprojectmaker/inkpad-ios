// The floating toolbar, laid out like the recordings of Notability the user sent:
// a white pill at the top of the page. Top row: the tools, on two swipeable sets.
// Bottom row: the picked tool's colours, three sizes and its line style. Every tool
// remembers its own colours and sizes.
import { Canvas, Path, Skia, DashPathEffect } from '@shopify/react-native-skia';
import { useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';

import type { CanvasTool } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { type InkTool, type PenLine, type Settings, type ToolKit, useSettings } from '@/lib/settings';

export const KITS: Record<string, ToolKit> = {
  pen: { colors: ['#000000', '#0A66F0', '#E01E26', '#FFFFFF', '#F28C0F'], color: 0, sizes: [2, 3, 5], size: 1, line: 'even' },
  pencil: { colors: ['#4A5456', '#8A8A8A', '#000000'], color: 0, sizes: [2, 4, 7], size: 1, line: 'even' },
  marker: { colors: ['#FFFF00', '#F000C8', '#A8FF1E'], color: 0, sizes: [4, 6, 9], size: 1, line: 'even' },
  eraser: { colors: [], color: 0, sizes: [2, 5, 9], size: 1, line: 'even' },
  text: { colors: ['#000000', '#0A66F0', '#E01E26', '#F28C0F'], color: 0, sizes: [14, 18, 26], size: 1, line: 'even' },
  calligraphy: { colors: ['#000000', '#0A66F0', '#E01E26', '#FFFFFF', '#F28C0F', '#12006C'], color: 0, sizes: [3, 5, 8], size: 1, line: 'even' },
  tape: { colors: ['#DFF0FC', '#F0AEAE', '#9AD3C8', '#F9CC98', '#D9D2E8'], color: 0, sizes: [3, 5, 8], size: 1, line: 'even' },
  laser: { colors: ['#E00014', '#0A33E0', '#18D018', '#F2E600'], color: 0, sizes: [3], size: 0, line: 'even' },
};

export const kitOf = (s: Pick<Settings, 'tk'>, id: string): ToolKit => ({ ...(KITS[id] ?? KITS.pen), ...(s.tk?.[id] ?? {}) });

/** The width a 1-12 size means for a tool, in page points. */
export function widthOf(id: string, n: number): number {
  switch (id) {
    case 'marker': return 5 + n * 2.2;
    case 'pencil': return 0.8 * Math.pow(n, 1.2);
    case 'eraser': return 6 + n * 3;
    case 'tape': return 12 + n * 3;
    case 'calligraphy': return 1.2 * n;
    default: return 0.5 * Math.pow(n, 1.25);
  }
}

/** What the canvas should use for the current settings. */
export function currentTool(s: Settings): CanvasTool {
  const id = s.inkKind ?? 'pen';
  const k = kitOf(s, id);
  const color = k.colors[k.color] ?? k.colors[0] ?? '#000000';
  const n = k.sizes[k.size] ?? k.sizes[0];
  const broken = k.line === 'dash' || k.line === 'dot' ? k.line : '';
  switch (id) {
    case 'pen': return { kind: k.line === 'pressure' ? 'pen' : 'monoline', color, width: widthOf('pen', n), mode: broken };
    case 'pencil': return { kind: 'pencil', color, width: widthOf('pencil', n), mode: broken };
    case 'marker': return { kind: 'marker', color, width: widthOf('marker', n), mode: broken };
    case 'calligraphy': return { kind: 'fountain', color, width: widthOf('calligraphy', n), mode: broken, angle: s.nibAngle ?? 40, stabilize: !!s.nibSteady };
    case 'eraser': return { kind: 'eraser', color: '#000000', width: widthOf('eraser', n), mode: s.eraser ?? 'partial' };
    case 'tape': return { kind: 'tape', color, width: widthOf('tape', n) };
    case 'laser': return { kind: 'laser', color, width: 5 };
    case 'text': return { kind: 'text', color, width: n, mode: s.textFont ?? 'system', bold: !!s.textBold, italic: !!s.textItalic, underline: !!s.textUnderline };
    case 'hand': return { kind: 'hand', color: '#000000', width: 1 };
    case 'comment': return { kind: 'comment', color: '#000000', width: 1 };
    default: return { kind: 'lasso', color: '#000000', width: 1, mode: s.lassoBox ? 'box' : 'free' };
  }
}

const INK = '#3B4252';
const BLUE = '#3F6AF2';

const PALETTES = [
  ['#FFFF00', '#F28C0F', '#E01E26', '#F000C8', '#A8FF1E', '#5CC840', '#9000B8', '#541E88', '#0A7A38', '#0A66F0', '#1A3EA8', '#12006C', '#FFFFFF', '#8C8C8C', '#000000', '#845A30'],
  ['#FFF7A8', '#FFD6A5', '#FFADAD', '#FFC6FF', '#CAFFBF', '#9BF6FF', '#A0C4FF', '#BDB2FF', '#D8F3DC', '#BDE0FE', '#E2C2FF', '#F1C0E8', '#F5F5F5', '#D6D6D6', '#B8B8B8', '#E6CCB2'],
  ['#C9A400', '#B85C00', '#9D0208', '#A0007A', '#5C9400', '#2D6A2F', '#5A189A', '#3C096C', '#004B23', '#023E8A', '#03045E', '#0A1128', '#6C757D', '#495057', '#212529', '#582F0E'],
  ['#FFFFFF', '#E9ECEF', '#CED4DA', '#ADB5BD', '#868E96', '#6C757D', '#495057', '#343A40', '#212529', '#000000', '#2A9D8F', '#E76F51', '#F4A261', '#E9C46A', '#264653', '#457B9D'],
];

const TOOLS_A: { id: InkTool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'pencil.tip', label: 'Pen' },
  { id: 'pencil', icon: 'pencil', label: 'Pencil' },
  { id: 'marker', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'text', icon: 'textformat', label: 'Text' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso' },
];
const TOOLS_B: { id: InkTool; icon: string; label: string }[] = [
  { id: 'hand', icon: 'hand.point.up.left', label: 'Navigate' },
  { id: 'laser', icon: 'cursorarrow.rays', label: 'Laser pointer' },
  { id: 'calligraphy', icon: 'paintbrush.pointed', label: 'Calligraphy' },
  { id: 'tape', icon: 'rectangle.fill', label: 'Tape' },
  { id: 'comment', icon: 'bubble.left', label: 'Comment' },
];

const WAVE = 'M3 14C8 4 14 4 20 11S32 19 37 7';

/** A little picture of a line style. */
function LineGlyph({ line, color = INK, width = 40 }: { line: PenLine; color?: string; width?: number }) {
  const path = Skia.Path.MakeFromSVGString(WAVE);
  if (!path) return null;
  return (
    <Canvas style={{ width, height: 20 }} pointerEvents="none">
      <Path path={path} style="stroke" strokeCap="round" strokeWidth={line === 'pressure' ? 2.8 : line === 'even' ? 2 : 2} color={color}>
        {line === 'dash' ? <DashPathEffect intervals={[5, 4]} /> : line === 'dot' ? <DashPathEffect intervals={[0.1, 4.4]} /> : null}
      </Path>
    </Canvas>
  );
}

/** Thick-growing segmented slider, 1 to 12, with the number on its thumb. */
export function ThicknessSlider({ value, onChange, onDone, max = 12 }: { value: number; onChange: (n: number) => void; onDone?: (n: number) => void; max?: number }) {
  const w = useRef(1);
  const last = useRef(value);
  const at = (e: GestureResponderEvent) => {
    const n = Math.max(1, Math.min(max, Math.round((e.nativeEvent.locationX / w.current) * (max - 1)) + 1));
    last.current = n;
    onChange(n);
  };
  const f = (value - 1) / (max - 1);
  return (
    <View accessibilityLabel="Thickness" onLayout={(e) => { w.current = Math.max(1, e.nativeEvent.layout.width); }}
      style={{ height: 40, justifyContent: 'center' }}
      onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true} onResponderGrant={at} onResponderMove={at} onResponderRelease={() => onDone?.(last.current)}>
      <View pointerEvents="none" style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
        {Array.from({ length: max }, (_, i) => (
          <View key={i} style={{ flex: 1, height: 3 + (i / (max - 1)) * 8, borderRadius: 2, backgroundColor: i / (max - 1) <= f ? BLUE : '#C4CBDA' }} />
        ))}
      </View>
      <View pointerEvents="none" style={{ position: 'absolute', left: `${f * 100}%`, marginLeft: -15, width: 30, height: 30, borderRadius: 15, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center',
        shadowColor: '#000', shadowOpacity: 0.22, shadowRadius: 5, shadowOffset: { width: 0, height: 2 } }}>
        <Text style={{ color: '#5A6478', fontSize: 12, fontWeight: '700' }}>{value}</Text>
      </View>
    </View>
  );
}

/** The paged swatches. */
export function ColorGrid({ current, onPick }: { current?: string; onPick: (c: string) => void }) {
  const [page, setPage] = useState(0);
  const W = 8 * 34 + 7 * 6;
  return (
    <View>
      <ScrollView horizontal pagingEnabled showsHorizontalScrollIndicator={false} style={{ width: W }}
        onMomentumScrollEnd={(e) => setPage(Math.round(e.nativeEvent.contentOffset.x / W))}>
        {PALETTES.map((p, i) => (
          <View key={i} style={{ width: W, flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {p.map((c) => (
              <Pressable key={c} accessibilityLabel={`Colour ${c}`} onPress={() => onPick(c)} style={{ width: 34, height: 34, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 26, height: 26, borderRadius: 13, backgroundColor: c, borderWidth: c === '#FFFFFF' || c === '#F5F5F5' ? 1 : 0, borderColor: '#B8BFCC', alignItems: 'center', justifyContent: 'center' }}>
                  {current?.toUpperCase() === c ? <Icon name="checkmark" size={12} color={c === '#FFFFFF' || c === '#FFFF00' ? '#000' : '#fff'} /> : null}
                </View>
              </Pressable>
            ))}
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 7, marginTop: 10 }}>
        {PALETTES.map((_, i) => <View key={i} style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: i === page ? '#222' : '#BBB' }} />)}
      </View>
    </View>
  );
}

const Card = ({ children, width, top = 96, align }: { children: React.ReactNode; width?: number; top?: number; align?: number }) => (
  <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center' }]}>
    <View style={{ position: 'absolute', top, left: align, width, padding: 16, borderRadius: 18, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}>
      {children}
    </View>
  </View>
);

const LINES: PenLine[] = ['even', 'pressure', 'dash', 'dot'];

export function NoteToolbar({ recording, hasAudio, ruler, onInsert, onAudio, onRuler, onSettings, onPaste, onTape }: {
  recording: boolean; hasAudio: boolean; ruler: boolean; onInsert: () => void; onAudio: () => void; onRuler: () => void; onSettings: () => void;
  onPaste: () => void; onTape: (what: 'show' | 'hide' | 'clear') => void;
}) {
  const { s, set } = useSettings();
  const { width: screen } = useWindowDimensions();
  const [set2, setSet2] = useState(false);
  const [pop, setPop] = useState<null | 'colors' | 'addColor' | 'size' | 'line' | 'nib'>(null);
  const kind = (s.inkKind ?? 'pen') as string;
  const k = kitOf(s, kind);
  const color = k.colors[k.color] ?? '#000000';
  const patch = (p: Partial<ToolKit>) => set({ tk: { ...(s.tk ?? {}), [kind]: { ...k, ...p } } });
  const pick = (id: InkTool) => {
    setPop(null);
    if (id !== kind) set({ inkKind: id, lastTool: kind as InkTool });
  };

  const toolBtn = (x: { id: InkTool; icon: string; label: string }) => {
    const on = x.id === kind;
    const tk = kitOf(s, x.id);
    const tint = on && tk.colors.length ? tk.colors[tk.color] : null;
    const shown = tint && tint.toUpperCase() !== '#FFFFFF' ? tint : on ? BLUE : INK;
    return (
      <Pressable key={x.id} accessibilityLabel={x.label} onPress={() => pick(x.id)} style={{ width: 42, height: 46, alignItems: 'center', justifyContent: 'center' }}>
        {x.id === 'text'
          ? <Text style={{ fontSize: 24, fontWeight: '800', fontStyle: 'italic', color: shown, letterSpacing: -1 }}>Tt</Text>
          : <Icon name={x.icon} size={24} color={shown} />}
        {on ? <View style={{ position: 'absolute', bottom: 3, width: 24, height: 3, borderRadius: 2, backgroundColor: shown }} /> : null}
      </Pressable>
    );
  };
  const plain = (icon: string, label: string, onPress: () => void, tint?: string, active?: boolean) => (
    <Pressable key={label} accessibilityLabel={label} onPress={() => { setPop(null); onPress(); }} style={{ width: 42, height: 46, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name={icon} size={24} color={tint ?? (active ? BLUE : INK)} />
    </Pressable>
  );
  const Div = () => <View style={{ width: 1, height: 24, backgroundColor: '#D5D9E2', marginHorizontal: 4 }} />;
  const Bar = () => <View style={{ width: 1, alignSelf: 'stretch', backgroundColor: '#E2E5EC', marginHorizontal: 8 }} />;

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} style={{ height: 32, paddingHorizontal: 16, borderRadius: 16, justifyContent: 'center', backgroundColor: on ? '#E9EEFD' : '#ECEDF1', borderWidth: on ? 1.2 : 0, borderColor: BLUE }}>
      <Text style={{ color: INK, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );

  const dots = (
    <>
      {k.colors.map((c, i) => {
        const on = i === k.color;
        const white = c.toUpperCase() === '#FFFFFF';
        return (
          <Pressable key={i + c} accessibilityLabel={`Colour ${c}`} onPress={() => { if (on) setPop(pop === 'colors' ? null : 'colors'); else { patch({ color: i }); setPop(null); } }}
            style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: on ? 30 : 26, height: on ? 30 : 26, borderRadius: 15, backgroundColor: c, borderWidth: white || on ? 1.5 : 0, borderColor: on ? BLUE : '#B8BFCC', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="pencil" size={13} color={white || c.toUpperCase() === '#FFFF00' ? '#333' : '#fff'} /> : null}
            </View>
          </Pressable>
        );
      })}
      <Pressable accessibilityLabel="More colours" onPress={() => setPop(pop === 'addColor' ? null : 'addColor')} style={{ width: 34, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: '#ECEDF1', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={12} color={INK} /></View>
      </Pressable>
    </>
  );
  const sizes = k.sizes.map((n, i) => {
    const on = i === k.size;
    const d = [9, 14, 20][i] ?? 14;
    return (
      <Pressable key={i} accessibilityLabel={['Small', 'Medium', 'Large'][i]} onPress={() => { if (on) setPop(pop === 'size' ? null : 'size'); else { patch({ size: i }); setPop(null); } }} style={{ width: 38, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: on ? '#fff' : '#ECEDF1', borderWidth: on ? 1.5 : 0, borderColor: BLUE, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: INK }} />
        </View>
      </Pressable>
    );
  });
  const lineChip = (
    <Pressable accessibilityLabel="Line style" onPress={() => setPop(pop === 'line' ? null : 'line')} style={{ height: 38, paddingHorizontal: 6, justifyContent: 'center' }}>
      <LineGlyph line={k.line} />
    </Pressable>
  );

  let row2;
  if (kind === 'lasso') {
    row2 = <View style={{ flexDirection: 'row', gap: 12, justifyContent: 'center', flex: 1 }}>{chip('Freeform', !s.lassoBox, () => set({ lassoBox: false }))}{chip('Boxed', !!s.lassoBox, () => set({ lassoBox: true }))}{chip('Paste', false, onPaste)}</View>;
  } else if (kind === 'eraser') {
    row2 = <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'center' }}>{sizes}<Bar />{chip('Whole', s.eraser === 'stroke', () => set({ eraser: 'stroke' }))}<View style={{ width: 8 }} />{chip('Partial', s.eraser !== 'stroke', () => set({ eraser: 'partial' }))}</View>;
  } else if (kind === 'hand') {
    row2 = <Text style={{ flex: 1, textAlign: 'center', color: '#6B7385', fontSize: 14 }}>The Pencil scrolls the page. Pick a pen to write again.</Text>;
  } else if (kind === 'comment') {
    row2 = <Text style={{ flex: 1, textAlign: 'center', color: '#6B7385', fontSize: 14 }}>Tap the page to leave a comment. Tap a pin to read or change it.</Text>;
  } else if (kind === 'laser') {
    row2 = <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{dots}</View>;
  } else if (kind === 'tape') {
    row2 = <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1 }}>{dots}<Bar />{sizes}<Bar />{chip('Reveal all', false, () => onTape('show'))}<View style={{ width: 6 }} />{chip('Hide all', false, () => onTape('hide'))}</View>;
  } else if (kind === 'text') {
    const fonts: [string, string][] = [['system', 'Helvetica'], ['serif', 'Georgia'], ['round', 'Rounded'], ['hand', 'Noteworthy'], ['mono', 'Menlo']];
    const fi = Math.max(0, fonts.findIndex((f) => f[0] === (s.textFont ?? 'system')));
    const n = k.sizes[k.size];
    row2 = (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        {chip(fonts[fi][1], false, () => set({ textFont: fonts[(fi + 1) % fonts.length][0] }))}
        <Bar />
        <Pressable accessibilityLabel="Smaller text" onPress={() => { const v = k.sizes.slice(); v[k.size] = Math.max(8, n - 1); patch({ sizes: v }); }} style={{ padding: 6 }}><Icon name="minus.circle" size={20} color={INK} /></Pressable>
        <Text style={{ width: 28, textAlign: 'center', color: INK, fontSize: 15 }}>{n}</Text>
        <Pressable accessibilityLabel="Bigger text" onPress={() => { const v = k.sizes.slice(); v[k.size] = Math.min(96, n + 1); patch({ sizes: v }); }} style={{ padding: 6 }}><Icon name="plus.circle" size={20} color={INK} /></Pressable>
        <Bar />
        {dots}
        <Bar />
        <Pressable accessibilityLabel="Bold" onPress={() => set({ textBold: !s.textBold })} style={{ width: 30, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: s.textBold ? '#E9EEFD' : 'transparent' }}>
          <Text style={{ fontSize: 18, fontWeight: '800', color: s.textBold ? BLUE : INK }}>B</Text>
        </Pressable>
        <Pressable accessibilityLabel="Italic" onPress={() => set({ textItalic: !s.textItalic })} style={{ width: 30, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: s.textItalic ? '#E9EEFD' : 'transparent' }}>
          <Text style={{ fontSize: 18, fontStyle: 'italic', color: s.textItalic ? BLUE : INK }}>I</Text>
        </Pressable>
        <Pressable accessibilityLabel="Underline" onPress={() => set({ textUnderline: !s.textUnderline })} style={{ width: 30, height: 34, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: s.textUnderline ? '#E9EEFD' : 'transparent' }}>
          <Text style={{ fontSize: 18, textDecorationLine: 'underline', color: s.textUnderline ? BLUE : INK }}>U</Text>
        </Pressable>
      </View>
    );
  } else {
    row2 = (
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        {kind === 'calligraphy' ? <><Pressable accessibilityLabel="Nib settings" onPress={() => setPop(pop === 'nib' ? null : 'nib')} style={{ height: 38, paddingHorizontal: 6, justifyContent: 'center' }}><LineGlyph line="pressure" /></Pressable><Bar /></> : null}
        {dots}
        <Bar />
        {sizes}
        {kind !== 'calligraphy' ? <><Bar />{lineChip}</> : null}
      </View>
    );
  }

  const pillW = Math.min(screen - 110, 620);
  return (
    <>
      {pop ? <Modal visible transparent animationType="none" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setPop(null)}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={() => setPop(null)} />
        {pop === 'colors' || pop === 'addColor' ? (
          <Card>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#15171C', marginBottom: 12 }}>Colors</Text>
            <ColorGrid current={color} onPick={(c) => {
              if (pop === 'addColor') { const list = k.colors.includes(c) ? k.colors : [...k.colors, c].slice(-8); patch({ colors: list, color: list.indexOf(c) }); } else { const list = k.colors.slice(); list[k.color] = c; patch({ colors: list }); }
              setPop(null);
            }} />
          </Card>
        ) : pop === 'size' ? (
          <Card width={Math.min(screen - 40, 400)}>
            <ThicknessSlider value={k.sizes[k.size]} onChange={(n) => { const v = k.sizes.slice(); v[k.size] = n; patch({ sizes: v }); }} />
          </Card>
        ) : pop === 'line' ? (
          <Card width={120}>
            <View style={{ gap: 8, alignItems: 'center' }}>
              {LINES.map((l) => (
                <Pressable key={l} accessibilityLabel={`Line ${l}`} onPress={() => { patch({ line: l }); setPop(null); }}
                  style={{ width: 88, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: k.line === l ? '#E9EEFD' : '#ECEDF1', borderWidth: k.line === l ? 1.2 : 0, borderColor: BLUE }}>
                  <LineGlyph line={l} />
                </Pressable>
              ))}
            </View>
          </Card>
        ) : (
          <Card width={Math.min(screen - 40, 360)}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#15171C' }}>Angle  <Text style={{ fontWeight: '400', color: '#5A6478' }}>{s.nibAngle ?? 40}°</Text></Text>
            <ThicknessSlider value={Math.round((s.nibAngle ?? 40) / 5) + 1} max={19} onChange={(n) => set({ nibAngle: (n - 1) * 5 })} />
            <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: '#15171C' }}>Stabilization</Text>
              <Switch accessibilityLabel="Stabilization" value={!!s.nibSteady} onValueChange={(v) => set({ nibSteady: v })} />
            </View>
          </Card>
        )}
      </Modal> : null}
      <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: 'center' }]}>
        <View style={{ position: 'absolute', top: 12, width: pillW, borderRadius: 20, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 4 } }}>
          <View style={{ height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}>
            {!set2 ? (
              <>
                {TOOLS_A.map(toolBtn)}
                {plain('plus.circle', 'Insert', onInsert)}
                {plain(hasAudio && !recording ? 'play.circle' : recording ? 'waveform' : 'mic', 'Audio', onAudio, recording ? '#E5322D' : undefined)}
                <Div />
                {toolBtn(TOOLS_B[0])}
                {plain('chevron.right', 'More tools', () => setSet2(true))}
              </>
            ) : (
              <>
                {TOOLS_B.map(toolBtn)}
                {plain('ruler', 'Measure', onRuler, ruler ? '#F28C0F' : undefined, ruler)}
                {plain(hasAudio && !recording ? 'play.circle' : recording ? 'waveform' : 'mic', 'Audio', onAudio, recording ? '#E5322D' : undefined)}
                {plain('gearshape', 'Toolbox settings', onSettings)}
                {plain('chevron.left', 'Back to the main tools', () => setSet2(false))}
              </>
            )}
          </View>
          <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: '#D5D9E2' }} />
          <View style={{ height: 46, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}>{row2}</View>
        </View>
      </View>
    </>
  );
}

/** The lasso's Style popover: thickness, line style and colour, applied to what's selected. */
export function StylePopover({ color, width, onChange, onClose }: { color: string; width: number; onChange: (p: { color?: string; width?: number; line?: PenLine }) => void; onClose: () => void }) {
  const toN = (w: number) => Math.max(1, Math.min(12, Math.round(Math.pow(w / 0.5, 1 / 1.25))));
  const [n, setN] = useState(toN(width));
  const [cur, setCur] = useState(color);
  const [line, setLine] = useState<PenLine>('even');
  return (
    <Modal visible transparent animationType="none" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close style" style={StyleSheet.absoluteFill} onPress={onClose} />
      <Card top={150}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#15171C' }}>Stroke</Text>
        <ThicknessSlider value={n} onChange={setN} onDone={(v) => onChange({ width: widthOf('pen', v) })} />
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'space-between', marginVertical: 8 }}>
          {LINES.map((l) => (
            <Pressable key={l} accessibilityLabel={`Line ${l}`} onPress={() => { setLine(l); onChange({ line: l }); }} style={{ width: 70, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: line === l ? '#E9EEFD' : '#ECEDF1', borderWidth: line === l ? 1.2 : 0, borderColor: BLUE }}>
              <LineGlyph line={l} />
            </Pressable>
          ))}
        </View>
        <Text style={{ fontSize: 17, fontWeight: '700', color: '#15171C', marginVertical: 10 }}>Colors</Text>
        <ColorGrid current={cur} onPick={(c) => { setCur(c); onChange({ color: c }); }} />
      </Card>
    </Modal>
  );
}
