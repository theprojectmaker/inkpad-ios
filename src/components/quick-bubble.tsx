// The quick button: a round glass button that can be dragged anywhere on a note. A tap flips between
// the eraser and whatever was in hand before; holding it opens a few more things to reach for.
import { accent, ink } from '@/lib/settings';
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import Reanimated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ToolIcon } from '@/components/tool-icons';
import { Glass, Icon, Sheet } from '@/components/ui';
import { type InkTool, useSettings } from '@/lib/settings';

const SIZE = 58;

/** Everything the strip can hold. `tool` ones pick a tool; the rest do something on the note. */
export const BUBBLE_ITEMS: { id: string; label: string; icon: string; tool?: InkTool; group: string }[] = [
  { id: 'undo', label: 'Undo', icon: 'undo', group: 'Actions' },
  { id: 'redo', label: 'Redo', icon: 'redo', group: 'Actions' },
  { id: 'pen', label: 'Pen', icon: 'pen', tool: 'pen', group: 'Tools' },
  { id: 'pencil', label: 'Pencil', icon: 'pencil', tool: 'pencil', group: 'Tools' },
  { id: 'marker', label: 'Highlighter', icon: 'highlighter', tool: 'marker', group: 'Tools' },
  { id: 'eraser', label: 'Eraser', icon: 'eraser', tool: 'eraser', group: 'Tools' },
  { id: 'lasso', label: 'Lasso', icon: 'lasso', tool: 'lasso', group: 'Tools' },
  { id: 'shape', label: 'Shapes', icon: 'shape', tool: 'shape', group: 'Tools' },
  { id: 'brush', label: 'Brushes', icon: 'brush', tool: 'brush', group: 'Tools' },
  { id: 'calligraphy', label: 'Calligraphy', icon: 'calligraphy', tool: 'calligraphy', group: 'Tools' },
  { id: 'tape', label: 'Tape', icon: 'tape', tool: 'tape', group: 'Tools' },
  { id: 'laser', label: 'Laser pointer', icon: 'laser', tool: 'laser', group: 'Tools' },
  { id: 'hand', label: 'Navigate', icon: 'hand', tool: 'hand', group: 'Tools' },
  { id: 'measure', label: 'Measure', icon: 'measure', tool: 'measure', group: 'Tools' },
  { id: 'compass', label: 'Compass', icon: 'compass', tool: 'compass', group: 'Tools' },
  { id: 'flag', label: 'Flag this page', icon: 'flag', group: 'Actions' },
  { id: 'prev', label: 'Previous page', icon: 'up', group: 'Actions' },
  { id: 'next', label: 'Next page', icon: 'down', group: 'Actions' },
  { id: 'addPage', label: 'Add a page', icon: 'media', group: 'Actions' },
  { id: 'scratch', label: 'Scratchpad', icon: 'scratch', group: 'Actions' },
  { id: 'timer', label: 'Focus timer', icon: 'timer', group: 'Actions' },
  { id: 'find', label: 'Find in note', icon: 'find', group: 'Actions' },
  { id: 'zoom', label: 'Zoom window', icon: 'zoom', group: 'Actions' },
  { id: 'ai', label: 'Study with AI', icon: 'ai', group: 'Actions' },
  { id: 'present', label: 'Present', icon: 'present', group: 'Actions' },
];
const DEFAULT_ITEMS = ['undo', 'redo', 'pen', 'marker', 'lasso', 'flag'];
const SHOWN = 7;   // how many fit before the strip scrolls

export function QuickBubble({ onAction }: { onAction: (id: string) => void }) {
  const { s, set } = useSettings();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const chosen = (s.bubbleTools ?? DEFAULT_ITEMS).filter((id) => BUBBLE_ITEMS.some((x) => x.id === id));
  const stripW = Math.min(chosen.length + 1, SHOWN) * 42 + 8;
  const start = s.bubbleAt ?? { x: width - SIZE - 18, y: Math.round(height * 0.62) };
  const x = useSharedValue(start.x), y = useSharedValue(start.y), press = useSharedValue(0);
  const at = useRef({ ...start });
  const erasing = s.inkKind === 'eraser';

  // The screen turned or changed size: the button stays on it.
  useEffect(() => {
    const nx = Math.max(8, Math.min(width - SIZE - 8, at.current.x)), ny = Math.max(70, Math.min(height - SIZE - 20, at.current.y));
    at.current = { x: nx, y: ny };
    x.value = nx;
    y.value = ny;
  }, [width, height, x, y]);

  const live = useRef({ s, set, open, width, height });
  live.current = { s, set, open, width, height };
  const flip = () => {
    const { s: cur, set: put } = live.current;
    if (cur.inkKind === 'eraser') put({ inkKind: cur.lastTool && cur.lastTool !== 'eraser' ? cur.lastTool : 'pen', lastTool: 'eraser' });
    else put({ inkKind: 'eraser', lastTool: cur.inkKind });
  };
  const hold = useRef<ReturnType<typeof setTimeout> | null>(null);
  const state = useRef({ dragging: false, held: false });
  const pan = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      state.current = { dragging: false, held: false };
      press.value = withSpring(1, { damping: 14, stiffness: 300 });
      hold.current = setTimeout(() => { state.current.held = true; setOpen(true); }, 420);
    },
    onPanResponderMove: (_, g) => {
      if (!state.current.dragging && Math.hypot(g.dx, g.dy) < 8) return;
      if (!state.current.dragging) { state.current.dragging = true; if (hold.current) clearTimeout(hold.current); setOpen(false); }
      x.value = at.current.x + g.dx;
      y.value = at.current.y + g.dy;
    },
    onPanResponderRelease: (_, g) => {
      if (hold.current) clearTimeout(hold.current);
      press.value = withSpring(0, { damping: 10, stiffness: 220 });
      const { width: w, height: h } = live.current;
      if (state.current.dragging) {
        // It settles against whichever side is nearer, like the system's floating controls.
        const nx = at.current.x + g.dx + SIZE / 2 < w / 2 ? 12 : w - SIZE - 12;
        const ny = Math.max(70, Math.min(h - SIZE - 20, at.current.y + g.dy));
        at.current = { x: nx, y: ny };
        x.value = withSpring(nx, { damping: 16, stiffness: 180 });
        y.value = withSpring(ny, { damping: 16, stiffness: 180 });
        live.current.set({ bubbleAt: { x: nx, y: ny } });
      } else if (!state.current.held) {
        if (live.current.open) setOpen(false); else flip();
      }
    },
    onPanResponderTerminate: () => { if (hold.current) clearTimeout(hold.current); press.value = withSpring(0); },
  })).current;

  const place = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }, { translateY: y.value }, { scale: 1 - 0.08 * press.value }] }));
  const pick = (tool: InkTool) => { if (tool !== s.inkKind) set({ inkKind: tool, lastTool: s.inkKind }); setOpen(false); };
  const item = (icon: string, label: string, onPress: () => void, on = false) => (
    <Pressable key={label} accessibilityLabel={label} onPress={onPress} style={({ pressed }) => ({ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? 'rgba(0,122,255,0.16)' : pressed ? 'rgba(60,60,67,0.12)' : 'transparent' })}>
      <ToolIcon name={icon} size={20} color={on ? accent() : ink()} />
    </Pressable>
  );
  const onLeft = at.current.x < width / 2;

  const body = (
    <Reanimated.View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, top: 0, flexDirection: onLeft ? 'row' : 'row-reverse', alignItems: 'center', gap: 8 }, place, onLeft ? null : { marginLeft: -(open ? stripW + 8 : 0) }]}>
      <View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={erasing ? 'Quick button: back to the pen. Hold for more.' : 'Quick button: eraser. Hold for more.'}>
        <Glass radius={SIZE / 2} style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
          <View pointerEvents="none"><ToolIcon name={erasing ? 'pen' : 'eraser'} size={24} color={erasing ? accent() : ink()} /></View>
        </Glass>
      </View>
      {open ? (
        <Reanimated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)}>
          <Glass radius={25} style={{ width: stripW, padding: 4 }}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
              {chosen.map((id) => {
                const x = BUBBLE_ITEMS.find((i) => i.id === id)!;
                return x.tool ? item(x.icon, x.label, () => pick(x.tool!), s.inkKind === x.tool) : item(x.icon, x.label, () => { onAction(x.id); if (x.id !== 'undo' && x.id !== 'redo' && x.id !== 'prev' && x.id !== 'next') setOpen(false); });
              })}
              {item('settings', 'Choose what is on this strip', () => { setOpen(false); setEditing(true); })}
            </ScrollView>
          </Glass>
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
  const toggle = (id: string) => set({ bubbleTools: chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id] });
  return (
    <>
      {body}
      <Sheet visible={editing} onClose={() => setEditing(false)} title="Quick button" width={420}>
        <Text style={{ color: '#6B7385', fontSize: 14, marginBottom: 6 }}>Hold the quick button to open its strip. Tick what you want on it; things appear in the order you tick them.</Text>
        {['Tools', 'Actions'].map((g) => (
          <View key={g}>
            <Text style={{ color: '#6B7385', fontSize: 12.5, fontWeight: '700', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 14, marginBottom: 4 }}>{g}</Text>
            {BUBBLE_ITEMS.filter((x) => x.group === g).map((x) => {
              const on = chosen.includes(x.id);
              return (
                <Pressable key={x.id} accessibilityLabel={x.label} accessibilityState={{ selected: on }} onPress={() => toggle(x.id)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, height: 44, paddingHorizontal: 8, borderRadius: 10, backgroundColor: pressed ? 'rgba(60,60,67,0.1)' : 'transparent' })}>
                  <ToolIcon name={x.icon} size={20} color={on ? accent() : ink()} />
                  <Text style={{ flex: 1, fontSize: 16, color: '#15171C' }}>{x.label}</Text>
                  <Icon name={on ? 'checkmark.circle.fill' : 'circle'} size={20} color={on ? accent() : '#B8BFCC'} />
                </Pressable>
              );
            })}
          </View>
        ))}
        <Pressable accessibilityLabel="Put the strip back to how it started" onPress={() => set({ bubbleTools: undefined })} style={{ height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 10 }}>
          <Text style={{ color: accent(), fontSize: 16 }}>Back to the starting set</Text>
        </Pressable>
      </Sheet>
    </>
  );
}
