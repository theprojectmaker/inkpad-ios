// Editor chrome, kept minimal: one top bar (back · title · tools · undo/redo ·
// share · settings) and a small floating capsule with the current tool's
// colours and sizes. Nothing else sits on the page.
import { useEffect, useRef, useState } from 'react';
import { type GestureResponderEvent, Platform, Pressable, Text, View } from 'react-native';

import { clipboard } from '@/lib/clip';
import { PEN_TYPES } from '@/lib/ink';
import { ERASER_SIZES, HL_COLORS, HL_RANGE, HL_WIDTHS, INK_COLORS, PEN_RANGE, PEN_WIDTHS, TEXT_SIZES } from '@/lib/model';
import { useSettings, useTheme } from '@/lib/settings';
import type { Tool } from './note-view';
import { Icon, IconButton } from './ui';

const TOOLS: { id: Tool; icon: string; label: string }[] = [
  { id: 'pen', icon: 'pencil.tip', label: 'Pen' },
  { id: 'hl', icon: 'highlighter', label: 'Highlighter' },
  { id: 'eraser', icon: 'eraser', label: 'Eraser' },
  { id: 'lasso', icon: 'lasso', label: 'Lasso' },
  { id: 'text', icon: 'textformat', label: 'Text' },
  { id: 'laser', icon: 'wand.and.rays', label: 'Laser pointer' },
];

export function TopBar({ title, onBack, onTitle, tool, setTool, canUndo, canRedo, onUndo, onRedo, onInsert, onAudio, recording, audioOpen, onShare, onSettings, compact }: {
  title: string; onBack: () => void; onTitle: () => void; tool: Tool; setTool: (t: Tool) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  onInsert: () => void; onAudio: () => void; recording: boolean; audioOpen: boolean; onShare: () => void; onSettings: () => void; compact: boolean;
}) {
  const t = useTheme();
  const { s } = useSettings();
  const toolColor = (id: Tool) => (id === 'pen' ? s.penColor : id === 'hl' ? s.hlColor : id === 'laser' ? '#FF2D55' : undefined);
  return (
    <View style={{ height: 52, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, gap: 4, backgroundColor: t.bar, borderBottomWidth: 1, borderBottomColor: t.line }}>
      <IconButton name="chevron.left" label="Library" onPress={onBack} />
      {!compact ? (
        <Pressable onPress={onTitle} style={{ flexShrink: 1, maxWidth: 240, paddingHorizontal: 6, height: 36, justifyContent: 'center' }}>
          <Text numberOfLines={1} style={{ color: t.text, fontSize: 16, fontWeight: '700' }}>{title}</Text>
        </Pressable>
      ) : null}
      <View style={{ flex: 1 }} />
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.chip, borderRadius: 14, padding: 3, gap: 2 }}>
        {TOOLS.map((x) => {
          const on = tool === x.id;
          const c = toolColor(x.id);
          return (
            <Pressable key={x.id} accessibilityRole="button" accessibilityLabel={x.label} onPress={() => setTool(x.id)}
              style={{ width: 42, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.card : 'transparent',
                shadowColor: '#000', shadowOpacity: on && !t.dark ? 0.08 : 0, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }}>
              <Icon name={x.icon} size={19} color={on ? t.text : t.sub} />
              {c ? <View style={{ position: 'absolute', bottom: 3, width: 14, height: 3, borderRadius: 2, backgroundColor: c, opacity: on ? 1 : 0.7 }} /> : null}
            </Pressable>
          );
        })}
        <View style={{ width: 1, height: 20, backgroundColor: t.line, marginHorizontal: 3 }} />
        <Pressable accessibilityRole="button" accessibilityLabel="Insert" onPress={onInsert} style={{ width: 40, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="plus" size={19} color={t.sub} />
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="Audio recording" onPress={onAudio}
          style={{ width: 40, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: audioOpen ? t.card : 'transparent' }}>
          <Icon name={recording ? 'mic.fill' : 'mic'} size={18} color={recording ? '#E5322D' : audioOpen ? t.text : t.sub} />
        </Pressable>
      </View>
      <View style={{ flex: 1 }} />
      <IconButton name="arrow.uturn.backward" label="Undo" disabled={!canUndo} onPress={onUndo} />
      <IconButton name="arrow.uturn.forward" label="Redo" disabled={!canRedo} onPress={onRedo} />
      {!compact ? <IconButton name="square.and.arrow.up" label="Export PDF" onPress={onShare} /> : null}
      <IconButton name="ellipsis" label="More" onPress={onSettings} />
    </View>
  );
}

function Swatch({ color, on, onPress }: { color: string; on: boolean; onPress: () => void }) {
  const t = useTheme();
  return (
    <Pressable onPress={onPress} hitSlop={4} accessibilityLabel={`Colour ${color}`}
      style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: on ? t.text : 'transparent' }}>
      <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: color, borderWidth: color.toUpperCase() === '#FFFFFF' ? 1 : 0, borderColor: t.line }} />
    </Pressable>
  );
}

function Dot({ size, on, onPress, color }: { size: number; on: boolean; onPress: () => void; color: string }) {
  const t = useTheme();
  const d = Math.max(4, Math.min(20, size));
  return (
    <Pressable onPress={onPress} hitSlop={3} style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? t.chip : 'transparent' }}>
      <View style={{ width: d, height: d, borderRadius: d / 2, backgroundColor: color }} />
    </Pressable>
  );
}

function Seg({ items, value, onChange }: { items: [string, string][]; value: string; onChange: (v: string) => void }) {
  const t = useTheme();
  return (
    <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 10, padding: 2 }}>
      {items.map(([k, label]) => (
        <Pressable key={k} onPress={() => onChange(k)} style={{ paddingHorizontal: 10, height: 28, borderRadius: 8, justifyContent: 'center', backgroundColor: value === k ? t.card : 'transparent' }}>
          <Text style={{ color: value === k ? t.text : t.sub, fontSize: 13, fontWeight: '600' }}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

/** Drag to pick any size; logarithmic so small sizes are easy to hit. */
function SizeSlider({ value, range, onChange }: { value: number; range: readonly [number, number]; onChange: (v: number) => void }) {
  const t = useTheme();
  const w = 120;
  const [lo, hi] = range;
  const toX = (v: number) => (Math.log(Math.max(lo, Math.min(hi, v)) / lo) / Math.log(hi / lo)) * w;
  const fromX = (x: number) => lo * Math.pow(hi / lo, Math.max(0, Math.min(1, x / w)));
  const [drag, setDrag] = useState<number | null>(null);
  const shown = drag ?? value;
  const at = (e: GestureResponderEvent) => { const v = Math.round(fromX(e.nativeEvent.locationX) * 10) / 10; setDrag(v); onChange(v); };
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginHorizontal: 6 }}>
      <View style={{ width: w, height: 32, justifyContent: 'center' }} onStartShouldSetResponder={() => true} onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false} onResponderGrant={at} onResponderMove={at} onResponderRelease={() => setDrag(null)}>
        <View pointerEvents="none" style={{ height: 4, borderRadius: 2, backgroundColor: t.line }} />
        <View pointerEvents="none" style={{ position: 'absolute', left: Math.max(0, toX(shown) - 10), width: 20, height: 20, borderRadius: 10, backgroundColor: t.card, borderWidth: 1, borderColor: t.line,
          shadowColor: '#000', shadowOpacity: 0.18, shadowRadius: 3, shadowOffset: { width: 0, height: 1 } }} />
      </View>
      <Text style={{ color: t.sub, fontSize: 12, fontWeight: '700', width: 30, fontVariant: ['tabular-nums'] }}>{shown < 10 ? shown.toFixed(1) : Math.round(shown)}</Text>
    </View>
  );
}

const Sep = () => { const t = useTheme(); return <View style={{ width: 1, height: 22, backgroundColor: t.line, marginHorizontal: 4 }} />; };

/** Floating capsule under the top bar with the current tool's options. */
export function ToolOptions({ tool, onColors, onPaste }: { tool: Tool; onColors: () => void; onPaste: () => void }) {
  const t = useTheme();
  const { s, set } = useSettings();
  const [hasClip, setHasClip] = useState(!!clipboard.get());
  useEffect(() => clipboard.subscribe(() => setHasClip(!!clipboard.get())), []);

  // Five quick colours: recent picks first, then the defaults.
  const quick = (defaults: string[], cur: string) => {
    const list = [...s.recentColors.filter((c) => !defaults.slice(0, 5).includes(c)).slice(0, 2), ...defaults].filter((c, i, a) => a.indexOf(c) === i).slice(0, 5);
    return list.includes(cur) ? list : [cur, ...list.slice(0, 4)];
  };

  let body: React.ReactNode = null;
  if (tool === 'pen' || tool === 'text') {
    body = (
      <>
        {quick(INK_COLORS, s.penColor).map((c) => <Swatch key={c} color={c} on={s.penColor === c} onPress={() => set({ penColor: c })} />)}
        <Pressable onPress={onColors} accessibilityLabel="More colours" hitSlop={4} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={11} color={t.sub} /></View>
        </Pressable>
        <Sep />
        {tool === 'pen' ? (
          <>
            {PEN_WIDTHS.map((w) => <Dot key={w} size={4 + w * 2.2} color={s.penColor.toUpperCase() === '#FFFFFF' ? '#999' : s.penColor} on={Math.abs(s.penWidth - w) < 0.05} onPress={() => set({ penWidth: w })} />)}
            <SizeSlider value={s.penWidth} range={PEN_RANGE} onChange={(v) => set({ penWidth: v })} />
          </>
        ) : TEXT_SIZES.map((z) => (
          <Pressable key={z} onPress={() => set({ textSize: z })} style={{ paddingHorizontal: 8, height: 30, borderRadius: 9, justifyContent: 'center', backgroundColor: s.textSize === z ? t.chip : 'transparent' }}>
            <Text style={{ color: t.text, fontSize: 10 + z / 3, fontWeight: '600' }}>Aa</Text>
          </Pressable>
        ))}
      </>
    );
  } else if (tool === 'hl') {
    body = (
      <>
        {quick(HL_COLORS, s.hlColor).map((c) => <Swatch key={c} color={c} on={s.hlColor === c} onPress={() => set({ hlColor: c })} />)}
        <Pressable onPress={onColors} accessibilityLabel="More colours" hitSlop={4} style={{ width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }}>
          <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}><Icon name="plus" size={11} color={t.sub} /></View>
        </Pressable>
        <Sep />
        {HL_WIDTHS.map((w) => <Dot key={w} size={6 + w * 0.4} color={s.hlColor} on={Math.abs(s.hlWidth - w) < 0.5} onPress={() => set({ hlWidth: w })} />)}
        <SizeSlider value={s.hlWidth} range={HL_RANGE} onChange={(v) => set({ hlWidth: v })} />
      </>
    );
  } else if (tool === 'eraser') {
    body = (
      <>
        <Seg items={[['partial', 'Precise'], ['stroke', 'Whole stroke']]} value={s.eraser} onChange={(v) => set({ eraser: v as 'partial' | 'stroke' })} />
        <Sep />
        {ERASER_SIZES.map((z) => <Dot key={z} size={z * 0.65} color={t.faint} on={s.eraserSize === z} onPress={() => set({ eraserSize: z })} />)}
      </>
    );
  } else if (tool === 'lasso') {
    body = (
      <>
        <Text style={{ color: t.sub, fontSize: 13, marginHorizontal: 8 }}>Circle to select · tap an item</Text>
        {hasClip ? <Pressable onPress={onPaste} style={{ paddingHorizontal: 12, height: 30, borderRadius: 10, justifyContent: 'center', backgroundColor: t.chip }}><Text style={{ color: t.text, fontWeight: '600', fontSize: 13 }}>Paste</Text></Pressable> : null}
      </>
    );
  }
  if (tool === 'laser') body = <Text style={{ color: t.sub, fontSize: 13, marginHorizontal: 10 }}>Laser pointer: draw to point at things, it fades away</Text>;
  if (!body) return null;
  const capsule = { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 2, paddingHorizontal: 8, height: 44, borderRadius: 22, backgroundColor: t.elev,
    borderWidth: t.dark ? 1 : 0, borderColor: t.line, shadowColor: '#000', shadowOpacity: Platform.OS === 'ios' ? 0.12 : 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 4 }, elevation: 4 };
  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', top: 10, left: 0, right: 0, alignItems: 'center', zIndex: 5, gap: 8 }}>
      <View style={capsule}>{body}</View>
      {tool === 'pen' ? (
        <View style={capsule}>
          {PEN_TYPES.map((p) => (
            <Pressable key={p.id} onPress={() => set({ penType: p.id })} accessibilityLabel={p.name}
              style={{ paddingHorizontal: 11, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: (s.penType ?? 'fountain') === p.id ? t.chip : 'transparent' }}>
              <Text style={{ color: (s.penType ?? 'fountain') === p.id ? t.text : t.sub, fontSize: 13, fontWeight: '600' }}>{p.name}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}
