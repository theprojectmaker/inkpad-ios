// The floating toolbar, laid out like the recordings of Notability the user sent:
// a white pill at the top of the page. Top row: the tools, on two swipeable sets.
// Bottom row: the picked tool's colours, three sizes and its line style. Every tool
// remembers its own colours and sizes.
import { Canvas, Path, Skia, DashPathEffect } from '@shopify/react-native-skia';
import { useEffect, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, ScrollView, StyleSheet, Switch, Text, useWindowDimensions, View, type GestureResponderEvent } from 'react-native';
import Reanimated, { FadeIn, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import type { CanvasTool } from '@/components/quill-canvas';
import { ToolIcon } from '@/components/tool-icons';
import { Icon, useToast } from '@/components/ui';
import { pickColor } from '@/lib/ondevice';
import { type InkTool, type PenLine, type Settings, type ToolKit, useSettings } from '@/lib/settings';

export const KITS: Record<string, ToolKit> = {
  pen: { colors: ['#000000', '#0A66F0', '#E01E26', '#FFFFFF', '#F28C0F'], color: 0, sizes: [2, 3, 5], size: 1, line: 'even' },
  pencil: { colors: ['#4A5456', '#8A8A8A', '#000000'], color: 0, sizes: [2, 4, 7], size: 1, line: 'even' },
  marker: { colors: ['#FFFF00', '#F000C8', '#A8FF1E'], color: 0, sizes: [4, 6, 9], size: 1, line: 'even' },
  eraser: { colors: [], color: 0, sizes: [2, 5, 9], size: 1, line: 'even' },
  text: { colors: ['#000000', '#0A66F0', '#E01E26', '#F28C0F'], color: 0, sizes: [14, 18, 26], size: 1, line: 'even' },
  calligraphy: { colors: ['#000000', '#0A66F0', '#E01E26', '#FFFFFF', '#F28C0F', '#12006C'], color: 0, sizes: [3, 5, 8], size: 1, line: 'even' },
  compass: { colors: ['#000000', '#0A66F0', '#E01E26'], color: 0, sizes: [2, 3, 5], size: 1, line: 'even' },
  shape: { colors: ['#000000', '#0A66F0', '#E01E26', '#30A46C'], color: 0, sizes: [2, 3, 5], size: 1, line: 'even' },
  brush: { colors: ['#000000', '#0A66F0', '#E01E26', '#F28C0F', '#30A46C'], color: 0, sizes: [3, 6, 10], size: 1, line: 'even' },
  tape: { colors: ['#DFF0FC', '#F0AEAE', '#9AD3C8', '#F9CC98', '#D9D2E8'], color: 0, sizes: [3, 5, 8], size: 1, line: 'even' },
  laser: { colors: ['#E00014', '#0A33E0', '#18D018', '#F2E600'], color: 0, sizes: [3], size: 0, line: 'even' },
};

export const kitOf = (s: Pick<Settings, 'tk'>, id: string): ToolKit => ({ ...(KITS[id] ?? KITS.pen), ...(s.tk?.[id] ?? {}) });

const SHAPES = [
  { id: 'line', icon: 'line', label: 'Line' },
  { id: 'arrow', icon: 'arrow', label: 'Arrow' },
  { id: 'double', icon: 'dbl', label: 'Double arrow' },
  { id: 'rect', icon: 'rect', label: 'Rectangle' },
  { id: 'ellipse', icon: 'ellipse', label: 'Circle' },
  { id: 'triangle', icon: 'triangle', label: 'Triangle' },
  { id: 'diamond', icon: 'diamond', label: 'Diamond' },
  { id: 'star', icon: 'star', label: 'Star' },
  { id: 'check', icon: 'check2', label: 'Check mark' },
  { id: 'cross', icon: 'cross2', label: 'Cross' },
  { id: 'axes', icon: 'axes', label: 'Graph axes' },
] as const;

/** The width a 1-12 size means for a tool, in page points. */
export function widthOf(id: string, n: number): number {
  switch (id) {
    case 'marker': return 5 + n * 2.2;
    case 'pencil': return 0.8 * Math.pow(n, 1.2);
    case 'eraser': return 6 + n * 3;
    case 'tape': return 12 + n * 3;
    case 'brush': return 0.9 * n;
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
    case 'pen': return { kind: k.line === 'pressure' ? 'pen' : 'monoline', color, width: widthOf('pen', n), mode: broken, streamline: s.streamline };
    case 'pencil': return { kind: 'pencil', color, width: widthOf('pencil', n), mode: broken, streamline: s.streamline };
    case 'marker': return { kind: 'marker', color, width: widthOf('marker', n), mode: broken, streamline: s.streamline };
    case 'brush': return { kind: s.brushType ?? 'brushpen', color, width: widthOf('brush', n), streamline: s.streamline };
    case 'shape': return { kind: 'shape', color, width: widthOf('pen', n), mode: [s.shapeType ?? 'line', s.shapeLock ? 'lock' : '', s.shapeFill ? 'fill' : ''].filter(Boolean).join(',') };
    case 'calligraphy': return { kind: 'fountain', color, width: widthOf('calligraphy', n), mode: broken, angle: s.nibAngle ?? 40, stabilize: !!s.nibSteady };
    case 'eraser': return { kind: 'eraser', color: '#000000', width: widthOf('eraser', n), mode: s.eraser ?? 'partial' };
    case 'tape': return { kind: 'tape', color, width: widthOf('tape', n) };
    case 'compass': return { kind: 'compass', color, width: widthOf('pen', n) };
    case 'laser': return { kind: 'laser', color, width: 5 };
    case 'text': return { kind: 'text', color, width: n, mode: s.textFont ?? 'system', bold: !!s.textBold, italic: !!s.textItalic, underline: !!s.textUnderline };
    case 'hand': return { kind: 'hand', color: '#000000', width: 1 };
    case 'comment': return { kind: 'comment', color: '#000000', width: 1 };
    case 'measure': return { kind: 'measure', color: '#000000', width: 1, mode: s.measureMode ?? 'ruler' };
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
  { id: 'pen', icon: 'pen', label: 'Pen' },
  { id: 'pencil', icon: 'pencil', label: 'Pencil' },
  { id: 'marker', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'text', icon: 'textformat', label: 'Text' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso' },
];
const TOOLS_B: { id: InkTool; icon: string; label: string }[] = [
  { id: 'hand', icon: 'hand', label: 'Navigate' },
  { id: 'laser', icon: 'laser', label: 'Laser pointer' },
  { id: 'calligraphy', icon: 'calligraphy', label: 'Calligraphy' },
  { id: 'tape', icon: 'tape', label: 'Tape' },
  { id: 'comment', icon: 'comment', label: 'Comment' },
  { id: 'measure', icon: 'measure', label: 'Measure' },
  { id: 'compass', icon: 'compass', label: 'Compass' },
  { id: 'shape', icon: 'shape', label: 'Shapes' },
  { id: 'brush', icon: 'brush', label: 'Brushes' },
];

const ALL_TOOLS: { id: string; icon: string; label: string }[] = [
  ...TOOLS_A,
  { id: 'media', icon: 'media', label: 'Media' },
  { id: 'record', icon: 'mic', label: 'Record' },
  TOOLS_B[0],
  { id: 'zoom', icon: 'zoom', label: 'Zoom' },
  ...TOOLS_B.slice(1),
];
const fullOrder = (saved?: string[]) => {
  const ids = ALL_TOOLS.map((t) => t.id);
  return [...(saved ?? []).filter((x) => ids.includes(x)), ...ids.filter((x) => !(saved ?? []).includes(x))];
};

const BRUSHES = [
  { id: 'brushpen', label: 'Brush pen', note: 'Soft tip, thin to thick with pressure' },
  { id: 'feltTip', label: 'Felt tip', note: 'Solid, even and bold' },
  { id: 'chisel', label: 'Chisel', note: 'Slanted nib for lettering' },
  { id: 'crayon', label: 'Crayon', note: 'Waxy and textured' },
  { id: 'watercolor', label: 'Watercolor', note: 'See-through, builds up where it overlaps' },
  { id: 'spray', label: 'Spray', note: 'A scatter of fine specks' },
] as const;

const TOOLBOX_ROW = 50;

/** The grip on a Toolbox row. */
function DragGrip({ label, onDrag, onDrop }: { label: string; onDrag: (dy: number) => void; onDrop: (dy: number) => void }) {
  const on = useRef({ onDrag, onDrop });
  on.current = { onDrag, onDrop };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => on.current.onDrag(0),
    onPanResponderMove: (_, g) => on.current.onDrag(g.dy),
    onPanResponderRelease: (_, g) => on.current.onDrop(g.dy),
    onPanResponderTerminate: () => on.current.onDrop(0),
  })).current;
  return (
    <View {...pan.panHandlers} accessibilityLabel={label} style={{ width: 44, height: TOOLBOX_ROW, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="line.3.horizontal" size={17} color="#9AA2B2" />
    </View>
  );
}

/** Toolbox: drag to reorder, or hide tools. */
function Toolbox({ visible, onClose, onSettings }: { visible: boolean; onClose: () => void; onSettings: () => void }) {
  const { s, set } = useSettings();
  const order = fullOrder(s.toolOrder);
  const hidden = s.toolHidden ?? [];
  const [drag, setDrag] = useState<{ from: number; dy: number } | null>(null);
  const clampTo = (from: number, dy: number) => Math.max(0, Math.min(order.length - 1, from + Math.round(dy / TOOLBOX_ROW)));
  const drop = (from: number, dy: number) => {
    setDrag(null);
    const to = clampTo(from, dy);
    if (to === from) return;
    const n = order.slice();
    const [id] = n.splice(from, 1);
    n.splice(to, 0, id);
    set({ toolOrder: n });
  };
  const shift = (i: number) => {
    if (!drag) return 0;
    if (i === drag.from) return drag.dy;
    const to = clampTo(drag.from, drag.dy);
    if (drag.from < i && i <= to) return -TOOLBOX_ROW;
    if (to <= i && i < drag.from) return TOOLBOX_ROW;
    return 0;
  };
  return (
    <Modal visible={visible} transparent animationType="fade" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close toolbox" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(0,0,0,0.25)' }]} onPress={onClose} />
      <View pointerEvents="box-none" style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 20 }}>
        <View style={{ width: '100%', maxWidth: 560, maxHeight: '85%', borderRadius: 22, backgroundColor: '#fff', overflow: 'hidden' }}>
          <View style={{ height: 60, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14 }}>
            <Pressable accessibilityLabel="Cancel toolbox" onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#E5E7EC' }}><Icon name="xmark" size={14} color="#15171C" /></Pressable>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#15171C' }}>Toolbox</Text>
            <Pressable accessibilityLabel="Done with toolbox" onPress={onClose} style={{ width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: BLUE }}><Icon name="checkmark" size={15} color="#fff" /></Pressable>
          </View>
          <Text style={{ color: '#6B7385', fontSize: 14, paddingHorizontal: 18, paddingBottom: 10 }}>Drag to reorder, or hide the Toolbox tools. You can also hold a tool in the bar to hide it.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 18, paddingBottom: 12 }}>
            <Text style={{ flex: 1, color: '#15171C', fontSize: 15 }}>Toolbar position</Text>
            {(['top', 'bottom', 'left', 'right'] as const).map((d) => (
              <Pressable key={d} accessibilityLabel={`Toolbar on the ${d}`} onPress={() => set({ toolDock: d })} style={{ height: 30, paddingHorizontal: 10, borderRadius: 8, justifyContent: 'center', backgroundColor: (s.toolDock ?? 'top') === d ? '#E9EEFD' : '#ECEDF1' }}>
                <Text style={{ color: (s.toolDock ?? 'top') === d ? BLUE : '#15171C', fontSize: 13, fontWeight: '500' }}>{d[0].toUpperCase() + d.slice(1)}</Text>
              </Pressable>
            ))}
          </View>
          <ScrollView scrollEnabled={!drag}>
            {order.map((id, i) => {
              const x = ALL_TOOLS.find((t) => t.id === id)!;
              const off = hidden.includes(id);
              return (
                <View key={id} style={{ flexDirection: 'row', alignItems: 'center', height: TOOLBOX_ROW, paddingLeft: 14, gap: 12, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#E5E7EC', backgroundColor: '#fff', zIndex: drag?.from === i ? 2 : 0, transform: [{ translateY: shift(i) }], shadowColor: '#000', shadowOpacity: drag?.from === i ? 0.14 : 0, shadowRadius: 8, shadowOffset: { width: 0, height: 2 } }}>
                  <Pressable accessibilityLabel={(off ? 'Show ' : 'Hide ') + x.label} onPress={() => set({ toolHidden: off ? hidden.filter((h) => h !== id) : [...hidden, id] })} hitSlop={8}>
                    <Icon name={off ? 'eye.slash' : 'eye'} size={20} color="#9AA2B2" />
                  </Pressable>
                  {id === 'text' ? <Text style={{ width: 26, textAlign: 'center', fontSize: 19, fontWeight: '800', fontStyle: 'italic', color: INK }}>Tt</Text> : <ToolIcon name={x.icon} size={22} color={off ? '#B8BFCC' : INK} />}
                  <Text style={{ flex: 1, fontSize: 16, color: off ? '#9AA2B2' : '#15171C' }}>{x.label}</Text>
                  <DragGrip label={'Reorder ' + x.label} onDrag={(dy) => setDrag({ from: i, dy })} onDrop={(dy) => drop(i, dy)} />
                </View>
              );
            })}
            <Pressable accessibilityLabel="App settings" onPress={() => { onClose(); onSettings(); }} style={{ padding: 16 }}><Text style={{ color: BLUE, fontSize: 16 }}>App settings</Text></Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

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

/** The mark under the picked tool fades in. */
function ToolMark({ on, color, children }: { on: boolean; color: string; children: React.ReactNode }) {
  const k = useSharedValue(on ? 1 : 0);
  useEffect(() => { k.value = withTiming(on ? 1 : 0, { duration: 110 }); }, [on, k]);
  const mark = useAnimatedStyle(() => ({ opacity: k.value }));
  return (
    <>
      {children}
      <Reanimated.View style={[{ position: 'absolute', bottom: 2, width: 18, height: 2, borderRadius: 1, backgroundColor: color }, mark]} />
    </>
  );
}

/** Which edge the toolbar is on, so popovers open beside it. */
let cardPlace: 'top' | 'bottom' | 'left' | 'right' = 'top';

const Card = ({ children, width, top = 110, align }: { children: React.ReactNode; width?: number; top?: number; align?: number }) => (
  <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: cardPlace === 'left' ? 'flex-start' : cardPlace === 'right' ? 'flex-end' : 'center', paddingHorizontal: cardPlace === 'left' || cardPlace === 'right' ? 150 : 0 }]}>
    <Reanimated.View entering={FadeIn.duration(110)} style={{ position: 'absolute', ...(cardPlace === 'bottom' ? { bottom: 130 } : { top: cardPlace === 'top' ? top : 64 }), ...(cardPlace === 'left' ? { left: 150 } : cardPlace === 'right' ? { right: 150 } : { left: align }), width, padding: 16, borderRadius: 18, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 6 } }}>
      {children}
    </Reanimated.View>
  </View>
);

const LINES: PenLine[] = ['even', 'pressure', 'dash', 'dot'];

export function NoteToolbar({ recording, hasAudio, ruler, zoom, onInsert, onAudio, onRuler, onZoom, onCalibrate, onSettings, onPaste, onTape, onCompass, raised }: {
  recording: boolean; hasAudio: boolean; ruler: boolean; zoom: boolean; onInsert: () => void; onAudio: () => void; onRuler: (on: boolean) => void; onZoom: () => void; onCalibrate: () => void; onSettings: () => void;
  onPaste: () => void; onTape: (what: 'show' | 'hide' | 'clear') => void; onCompass: (what: 'circle' | 'reset') => void; raised?: boolean;
}) {
  const { s, set } = useSettings();
  const { width: screen, height: screenH } = useWindowDimensions();
  const { toast } = useToast();
  const dock = s.toolDock ?? 'top';
  const upright = dock === 'left' || dock === 'right';
  cardPlace = dock;
  const [set2, setSet2] = useState(false);
  const [pop, setPop] = useState<null | 'colors' | 'addColor' | 'size' | 'line' | 'nib' | 'brush'>(null);
  const [toolbox, setToolbox] = useState(false);
  const kind = (s.inkKind ?? 'pen') as string;
  const k = kitOf(s, kind);
  const color = k.colors[k.color] ?? '#000000';
  const patch = (p: Partial<ToolKit>) => set({ tk: { ...(s.tk ?? {}), [kind]: { ...k, ...p } } });
  const usePicked = (c: string, adding: boolean) => {
    if (adding) { const list = k.colors.includes(c) ? k.colors : [...k.colors, c].slice(-8); patch({ colors: list, color: list.indexOf(c) }); } else { const list = k.colors.slice(); list[k.color] = c; patch({ colors: list }); }
  };
  const hide = (id: string, label: string) => {
    set({ toolHidden: [...(s.toolHidden ?? []), id] });
    toast(`${label} hidden. Bring it back from the gear in the Toolbox.`);
  };
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
      <Pressable key={x.id} accessibilityLabel={x.label} onPress={() => pick(x.id)} onLongPress={() => hide(x.id, x.label)} delayLongPress={500} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}>
        <ToolMark on={on} color={shown}>
          {x.id === 'text'
            ? <Text style={{ fontSize: 18, fontWeight: '500', color: shown, letterSpacing: -0.5 }}>Tt</Text>
            : <ToolIcon name={x.icon} size={21} color={shown} />}
        </ToolMark>
      </Pressable>
    );
  };
  const plain = (icon: string, label: string, onPress: () => void, tint?: string, active?: boolean, hideId?: string) => (
    <Pressable key={label} accessibilityLabel={label} onPress={() => { setPop(null); onPress(); }} onLongPress={hideId ? () => hide(hideId, label) : undefined} delayLongPress={500} style={{ width: 40, height: 44, alignItems: 'center', justifyContent: 'center' }}>
      <ToolIcon name={icon} size={icon === 'next' || icon === 'prev' ? 15 : 21} color={tint ?? (active ? BLUE : INK)} />
    </Pressable>
  );
  const Div = () => <View style={upright ? { height: 1, width: 20, backgroundColor: '#D5D9E2', marginVertical: 4 } : { width: 1, height: 22, backgroundColor: '#E2E5EC', marginHorizontal: 6 }} />;
  const Bar = () => <View style={upright ? { height: 1, alignSelf: 'stretch', backgroundColor: '#E2E5EC', marginVertical: 6 } : { width: 1, height: 22, backgroundColor: '#E2E5EC', marginHorizontal: 10 }} />;
  const R2 = { flexDirection: upright ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', flex: upright ? undefined : 1 } as const;

  const chip = (label: string, on: boolean, onPress: () => void) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} style={{ height: 30, paddingHorizontal: 14, borderRadius: 15, justifyContent: 'center', backgroundColor: on ? '#E9EEFD' : '#ECEDF1', borderWidth: on ? 1.2 : 0, borderColor: BLUE }}>
      <Text style={{ color: INK, fontSize: 13 }}>{label}</Text>
    </Pressable>
  );

  const dots = (
    <>
      {k.colors.map((c, i) => {
        const on = i === k.color;
        const white = c.toUpperCase() === '#FFFFFF';
        return (
          <Pressable key={i + c} accessibilityLabel={`Colour ${c}`} onPress={() => { if (on) setPop(pop === 'colors' ? null : 'colors'); else { patch({ color: i }); setPop(null); } }}
            style={{ width: 34, height: 38, alignItems: 'center', justifyContent: 'center' }}>
            <View style={{ width: on ? 26 : 22, height: on ? 26 : 22, borderRadius: 13, backgroundColor: c, borderWidth: white || on ? 1.5 : 0, borderColor: on ? BLUE : '#B8BFCC', alignItems: 'center', justifyContent: 'center' }}>
              {on ? <Icon name="pencil" size={11} color={white || c.toUpperCase() === '#FFFF00' ? '#333' : '#fff'} /> : null}
            </View>
          </Pressable>
        );
      })}
      <Pressable accessibilityLabel="More colours" onPress={() => setPop(pop === 'addColor' ? null : 'addColor')} style={{ width: 32, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 22, height: 22, borderRadius: 10, backgroundColor: '#ECEDF1', alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={10} color={INK} /></View>
      </Pressable>
    </>
  );
  const sizes = k.sizes.map((n, i) => {
    const on = i === k.size;
    const d = [6, 10, 15][i] ?? 10;
    return (
      <Pressable key={i} accessibilityLabel={['Small', 'Medium', 'Large'][i]} onPress={() => { if (on) setPop(pop === 'size' ? null : 'size'); else { patch({ size: i }); setPop(null); } }} style={{ width: 34, height: 38, alignItems: 'center', justifyContent: 'center' }}>
        <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: on ? '#fff' : '#ECEDF1', borderWidth: on ? 1.5 : 0, borderColor: BLUE, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: INK }} />
        </View>
      </Pressable>
    );
  });
  const lineChip = (
    <Pressable accessibilityLabel="Line style" onPress={() => setPop(pop === 'line' ? null : 'line')} style={{ height: 34, paddingHorizontal: 4, justifyContent: 'center' }}>
      <LineGlyph line={k.line} width={32} />
    </Pressable>
  );

  let row2;
  if (kind === 'measure') {
    const m = s.measureMode ?? 'ruler';
    row2 = (
      <View style={{ ...R2, gap: upright ? 6 : 10 }}>
        {chip('Ruler', m === 'ruler', () => { set({ measureMode: 'ruler' }); onRuler(true); })}
        {chip('Calculate length', m === 'length', () => { set({ measureMode: 'length' }); onCalibrate(); })}
        {chip('Calculate area', m === 'area', () => { set({ measureMode: 'area' }); onCalibrate(); })}
        {chip('Angle', m === 'angle', () => { set({ measureMode: 'angle' }); onRuler(false); })}
        <Bar />
        <Pressable accessibilityLabel={ruler ? 'Hide ruler' : 'Show ruler'} onPress={() => onRuler(!ruler)} style={{ padding: 4 }}><Icon name={ruler ? 'eye.slash' : 'eye'} size={21} color={INK} /></Pressable>
      </View>
    );
  } else if (kind === 'lasso') {
    row2 = <View style={{ ...R2, gap: upright ? 6 : 12 }}>{chip('Freeform', !s.lassoBox, () => set({ lassoBox: false }))}{chip('Boxed', !!s.lassoBox, () => set({ lassoBox: true }))}{chip('Paste', false, onPaste)}</View>;
  } else if (kind === 'eraser') {
    row2 = <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, justifyContent: 'center' }}>{sizes}<Bar />{chip('Whole', s.eraser === 'stroke', () => set({ eraser: 'stroke' }))}<View style={{ width: 8 }} />{chip('Partial', s.eraser !== 'stroke', () => set({ eraser: 'partial' }))}</View>;
  } else if (kind === 'hand') {
    row2 = <Text style={{ flex: 1, textAlign: 'center', color: '#6B7385', fontSize: 13 }}>The Pencil scrolls the page. Pick a pen to write again.</Text>;
  } else if (kind === 'comment') {
    row2 = <Text style={{ flex: 1, textAlign: 'center', color: '#6B7385', fontSize: 13 }}>Tap the page to leave a comment. Tap a pin to read or change it.</Text>;
  } else if (kind === 'laser') {
    row2 = <View style={R2}>{dots}</View>;
  } else if (kind === 'brush') {
    row2 = <View style={R2}>{dots}<Bar />{sizes}<Bar />{chip(BRUSHES.find((b) => b.id === (s.brushType ?? 'brushpen'))?.label ?? 'Brush', false, () => setPop(pop === 'brush' ? null : 'brush'))}</View>;
  } else if (kind === 'shape') {
    const cur = s.shapeType ?? 'line';
    const shapeBtn = (icon: string, label: string, on: boolean, press: () => void) => (
      <Pressable key={label} accessibilityLabel={label} onPress={press} style={{ width: 34, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? '#E9EEFD' : 'transparent' }}>
        <ToolIcon name={icon} size={19} color={on ? BLUE : INK} />
      </Pressable>
    );
    row2 = (
      <View style={R2}>
        {dots}<Bar />
        {SHAPES.map((x) => shapeBtn(x.icon, x.label, cur === x.id, () => set({ shapeType: x.id })))}
        <Bar />
        {shapeBtn('lock', 'Lock angles and sides', !!s.shapeLock, () => set({ shapeLock: !s.shapeLock }))}
        {shapeBtn('fill', 'Fill shapes', !!s.shapeFill, () => set({ shapeFill: !s.shapeFill }))}
      </View>
    );
  } else if (kind === 'compass') {
    row2 = <View style={R2}>{dots}<Bar />{sizes}<Bar />{chip('Full circle', false, () => onCompass('circle'))}<View style={{ width: 6 }} />{chip('New point', false, () => onCompass('reset'))}</View>;
  } else if (kind === 'tape') {
    row2 = <View style={R2}>{dots}<Bar />{sizes}<Bar />{chip('Reveal all', false, () => onTape('show'))}<View style={{ width: 6 }} />{chip('Hide all', false, () => onTape('hide'))}</View>;
  } else if (kind === 'text') {
    const fonts: [string, string][] = [['system', 'Helvetica'], ['serif', 'Georgia'], ['round', 'Rounded'], ['hand', 'Noteworthy'], ['mono', 'Menlo']];
    const fi = Math.max(0, fonts.findIndex((f) => f[0] === (s.textFont ?? 'system')));
    const n = k.sizes[k.size];
    row2 = (
      <View style={R2}>
        {chip(fonts[fi][1], false, () => set({ textFont: fonts[(fi + 1) % fonts.length][0] }))}
        <Bar />
        <Pressable accessibilityLabel="Smaller text" onPress={() => { const v = k.sizes.slice(); v[k.size] = Math.max(8, n - 1); patch({ sizes: v }); }} style={{ padding: 4 }}><Icon name="minus.circle" size={17} color={INK} /></Pressable>
        <Text style={{ width: 24, textAlign: 'center', color: INK, fontSize: 13 }}>{n}</Text>
        <Pressable accessibilityLabel="Bigger text" onPress={() => { const v = k.sizes.slice(); v[k.size] = Math.min(96, n + 1); patch({ sizes: v }); }} style={{ padding: 4 }}><Icon name="plus.circle" size={17} color={INK} /></Pressable>
        <Bar />
        {dots}
        <Bar />
        <Pressable accessibilityLabel="Bold" onPress={() => set({ textBold: !s.textBold })} style={{ width: 25, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: s.textBold ? '#E9EEFD' : 'transparent' }}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: s.textBold ? BLUE : INK }}>B</Text>
        </Pressable>
        <Pressable accessibilityLabel="Italic" onPress={() => set({ textItalic: !s.textItalic })} style={{ width: 25, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: s.textItalic ? '#E9EEFD' : 'transparent' }}>
          <Text style={{ fontSize: 15, fontStyle: 'italic', color: s.textItalic ? BLUE : INK }}>I</Text>
        </Pressable>
        <Pressable accessibilityLabel="Underline" onPress={() => set({ textUnderline: !s.textUnderline })} style={{ width: 25, height: 28, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: s.textUnderline ? '#E9EEFD' : 'transparent' }}>
          <Text style={{ fontSize: 15, textDecorationLine: 'underline', color: s.textUnderline ? BLUE : INK }}>U</Text>
        </Pressable>
      </View>
    );
  } else {
    row2 = (
      <View style={R2}>
        {kind === 'calligraphy' ? <><Pressable accessibilityLabel="Nib settings" onPress={() => setPop(pop === 'nib' ? null : 'nib')} style={{ height: 38, paddingHorizontal: 6, justifyContent: 'center' }}><LineGlyph line="pressure" /></Pressable><Bar /></> : null}
        {dots}
        <Bar />
        {sizes}
        {kind !== 'calligraphy' ? <><Bar />{lineChip}</> : null}
      </View>
    );
  }

  const order = fullOrder(s.toolOrder);
  const hidden = s.toolHidden ?? [];
  const shown = order.filter((id) => !hidden.includes(id));
  // Room for a whole row of tools on either page, plus the options row below it.
  const mostTools = Math.max(Math.min(shown.length, 8) + (shown.length > 8 ? 2 : 1), Math.max(0, shown.length - 8) + 2);
  const pillW = Math.min(screen - 24, Math.max(470, mostTools * 40 + 44));
  // On a narrow screen it can't share a line with the buttons on each side, so it sits below them.
  const below = dock === 'top' && pillW + 2 * 240 > screen;
  const render = (id: string) => {
    if (id === 'media') return plain('media', 'Insert', onInsert, undefined, false, 'media');
    if (id === 'record') return plain(hasAudio && !recording ? 'play' : recording ? 'waveform' : 'mic', 'Audio', onAudio, recording ? '#E5322D' : undefined, false, 'record');
    if (id === 'zoom') return plain('zoom', 'Zoom', onZoom, undefined, zoom, 'zoom');
    const x = ALL_TOOLS.find((t) => t.id === id);
    return x ? toolBtn(x as { id: InkTool; icon: string; label: string }) : null;
  };
  const first = shown.slice(0, 8);
  const second = shown.slice(8);
  return (
    <>
      <Toolbox visible={toolbox} onClose={() => setToolbox(false)} onSettings={onSettings} />
      {pop ? <Modal visible transparent animationType="none" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={() => setPop(null)}>
        <Pressable accessibilityLabel="Close" style={StyleSheet.absoluteFill} onPress={() => setPop(null)} />
        {pop === 'colors' || pop === 'addColor' ? (
          <Card>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <Text style={{ fontSize: 17, fontWeight: '700', color: '#15171C' }}>Colors</Text>
              <Pressable accessibilityLabel="Colour wheel" onPress={() => {
                const adding = pop === 'addColor';
                setPop(null);
                setTimeout(async () => { const c = await pickColor(color); if (c) usePicked(c, adding); }, 300);
              }} hitSlop={8}><Icon name="paintpalette.fill" size={24} color={BLUE} /></Pressable>
            </View>
            <ColorGrid current={color} onPick={(c) => { usePicked(c, pop === 'addColor'); setPop(null); }} />
          </Card>
        ) : pop === 'size' ? (
          <Card width={Math.min(screen - 40, 400)}>
            <ThicknessSlider value={k.sizes[k.size]} onChange={(n) => { const v = k.sizes.slice(); v[k.size] = n; patch({ sizes: v }); }} />
          </Card>
        ) : pop === 'brush' ? (
          <Card width={Math.min(screen - 40, 300)}>
            <View style={{ gap: 6 }}>
              {BRUSHES.map((b) => (
                <Pressable key={b.id} accessibilityLabel={b.label} onPress={() => { set({ brushType: b.id }); setPop(null); }} style={{ height: 44, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', backgroundColor: (s.brushType ?? 'brushpen') === b.id ? '#E9EEFD' : '#F2F3F6' }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#15171C' }}>{b.label}</Text>
                  <Text style={{ fontSize: 12, color: '#5A6478' }}>{b.note}</Text>
                </Pressable>
              ))}
              <Text style={{ fontSize: 15, fontWeight: '700', color: '#15171C', marginTop: 8 }}>Streamline</Text>
              <ThicknessSlider value={Math.round((s.streamline ?? 0) * 10) + 1} max={11} onChange={(v) => set({ streamline: (v - 1) / 10 })} />
            </View>
          </Card>
        ) : pop === 'line' ? (
          <Card width={Math.min(screen - 40, 300)}>
            <Text style={{ fontSize: 15, fontWeight: '700', color: '#15171C', marginBottom: 2 }}>Streamline</Text>
            <Text style={{ fontSize: 12, color: '#5A6478', marginBottom: 2 }}>Higher smooths out a shaky hand.</Text>
            <ThicknessSlider value={Math.round((s.streamline ?? 0) * 10) + 1} max={11} onChange={(v) => set({ streamline: (v - 1) / 10 })} />
            <View style={{ gap: 8, alignItems: 'center', marginTop: 8 }}>
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
      <DockedPill dock={dock} below={below} raised={raised} width={pillW} maxHeight={screenH - 150} onDock={(d) => set({ toolDock: d })}
        tools={!set2 ? (
          <Reanimated.View key="first" entering={FadeIn.duration(120)} style={{ flexDirection: upright ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: upright ? 0 : 6 }}>
            {first.map(render)}
            {second.length ? <Div /> : null}
            {second[0] ? render(second[0]) : null}
            {plain('next', 'More tools', () => setSet2(true))}
          </Reanimated.View>
        ) : (
          <Reanimated.View key="second" entering={FadeIn.duration(120)} style={{ flexDirection: upright ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: upright ? 0 : 6 }}>
            {second.map(render)}
            {plain('settings', 'Toolbox settings', () => { setPop(null); setToolbox(true); })}
            {plain('prev', 'Back to the main tools', () => setSet2(false))}
          </Reanimated.View>
        )}
        options={<Reanimated.View key={kind} entering={FadeIn.duration(100)} style={upright ? { paddingVertical: 4, paddingHorizontal: 4, alignItems: 'center' } : { height: 42, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>{row2}</Reanimated.View>} />
    </>
  );
}

/** The toolbar on its edge of the screen. Drag the grip to move it to another edge. */
function DockedPill({ dock, below, raised, width, maxHeight, onDock, tools, options }: {
  dock: 'top' | 'bottom' | 'left' | 'right'; below?: boolean; raised?: boolean; width: number; maxHeight: number; onDock: (d: 'top' | 'bottom' | 'left' | 'right') => void; tools: React.ReactNode; options: React.ReactNode;
}) {
  const upright = dock === 'left' || dock === 'right';
  const size = useWindowDimensions();
  const x = useSharedValue(0), y = useSharedValue(0);
  const moved = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }] }));
  const on = useRef({ onDock, size });
  on.current = { onDock, size };
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderMove: (_, g) => { x.value = g.dx; y.value = g.dy; },
    onPanResponderRelease: (_, g) => {
      x.value = 0;
      y.value = 0;
      const { width: w, height: h } = on.current.size;
      if (Math.hypot(g.dx, g.dy) < 12) return;
      // Whichever edge it's let go nearest.
      const edges = [['left', g.moveX], ['right', w - g.moveX], ['top', g.moveY], ['bottom', h - g.moveY]] as const;
      on.current.onDock([...edges].sort((a, b) => a[1] - b[1])[0][0]);
    },
    onPanResponderTerminate: () => { x.value = 0; y.value = 0; },
  })).current;
  const grip = (
    <View {...pan.panHandlers} accessibilityLabel="Move the toolbar" style={upright ? { height: 18, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' } : { position: 'absolute', left: 0, top: 0, bottom: 0, width: 16, zIndex: 2, alignItems: 'center', justifyContent: 'center' }}>
      {upright ? <View style={{ width: 22, height: 3, borderRadius: 2, backgroundColor: '#E2E5EC' }} /> : null}
    </View>
  );
  const place = dock === 'top' ? { top: below ? 58 : 10, width } : dock === 'bottom' ? { bottom: raised ? 78 : 14, width } : dock === 'left' ? { left: 10, top: 58, maxHeight } : { right: 10, top: 58, maxHeight };
  const hair = upright ? { width: StyleSheet.hairlineWidth, alignSelf: 'stretch' as const, backgroundColor: '#E2E5EC' } : { height: StyleSheet.hairlineWidth, marginHorizontal: 14, backgroundColor: '#E2E5EC' };
  return (
    <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { alignItems: upright ? undefined : 'center' }]}>
      <Reanimated.View style={[{ position: 'absolute', borderRadius: 14, backgroundColor: '#fff', shadowColor: '#000', shadowOpacity: 0.08, shadowRadius: 12, shadowOffset: { width: 0, height: 2 } }, place, moved]}>
        {grip}
        {upright ? (
          <View style={{ flexDirection: dock === 'left' ? 'row' : 'row-reverse', maxHeight: maxHeight - 18 }}>
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: 46, flexGrow: 0 }}>{tools}</ScrollView>
            <View style={hair} />
            <ScrollView showsVerticalScrollIndicator={false} style={{ width: 112, flexGrow: 0 }}>{options}</ScrollView>
          </View>
        ) : (
          <>
            <View style={{ height: 46, overflow: 'hidden', justifyContent: 'center' }}>{tools}</View>
            <View style={hair} />
            {options}
          </>
        )}
      </Reanimated.View>
    </View>
  );
}

/** The lasso's Style popover: thickness, line style and colour, applied to what's selected. */
export function StylePopover({ color, width, onChange, onFill, onClose }: { color: string; width: number; onChange: (p: { color?: string; width?: number; line?: PenLine }) => void; onFill: (color: string) => void; onClose: () => void }) {
  const [tab, setTab] = useState<'stroke' | 'fill'>('stroke');
  const toN = (w: number) => Math.max(1, Math.min(12, Math.round(Math.pow(w / 0.5, 1 / 1.25))));
  const [n, setN] = useState(toN(width));
  const [cur, setCur] = useState(color);
  const [line, setLine] = useState<PenLine>('even');
  return (
    <Modal visible transparent animationType="none" supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']} onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close style" style={StyleSheet.absoluteFill} onPress={onClose} />
      <Card top={150}>
        <View style={{ flexDirection: 'row', backgroundColor: '#ECEDF1', borderRadius: 9, padding: 2, marginBottom: 12 }}>
          {(['stroke', 'fill'] as const).map((x) => (
            <Pressable key={x} accessibilityLabel={x === 'stroke' ? 'Stroke' : 'Fill'} onPress={() => setTab(x)} style={{ flex: 1, height: 30, borderRadius: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: tab === x ? '#fff' : 'transparent' }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#15171C' }}>{x === 'stroke' ? 'Stroke' : 'Fill'}</Text>
            </Pressable>
          ))}
        </View>
        {tab === 'fill' ? (
          <>
            <Text style={{ fontSize: 13, color: '#5A6478', marginBottom: 10 }}>Fills in shapes you've closed, like a circle or a box.</Text>
            <Pressable accessibilityLabel="No fill" onPress={() => onFill('')} style={{ height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECEDF1', marginBottom: 10 }}>
              <Text style={{ fontSize: 14, fontWeight: '600', color: '#15171C' }}>No fill</Text>
            </Pressable>
            <ColorGrid current="" onPick={(c) => onFill(c)} />
          </>
        ) : <>
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
        </>}
      </Card>
    </Modal>
  );
}
