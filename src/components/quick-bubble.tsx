// The quick button: a round glass button that can be dragged anywhere on a note. A tap flips between
// the eraser and whatever was in hand before; holding it opens a few more things to reach for.
import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, useWindowDimensions, View } from 'react-native';
import Reanimated, { FadeIn, FadeOut, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';

import { ToolIcon } from '@/components/tool-icons';
import { Glass } from '@/components/ui';
import { type InkTool, useSettings } from '@/lib/settings';

const SIZE = 58;

export function QuickBubble({ onUndo, onRedo, onFlag }: { onUndo: () => void; onRedo: () => void; onFlag: () => void }) {
  const { s, set } = useSettings();
  const { width, height } = useWindowDimensions();
  const [open, setOpen] = useState(false);
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
      <ToolIcon name={icon} size={20} color={on ? '#007AFF' : '#3B4252'} />
    </Pressable>
  );
  const onLeft = at.current.x < width / 2;

  return (
    <Reanimated.View pointerEvents="box-none" style={[{ position: 'absolute', left: 0, top: 0, flexDirection: onLeft ? 'row' : 'row-reverse', alignItems: 'center', gap: 8 }, place, onLeft ? null : { marginLeft: -(open ? 6 * 42 + 16 : 0) }]}>
      <View {...pan.panHandlers} accessibilityRole="button" accessibilityLabel={erasing ? 'Quick button: back to the pen. Hold for more.' : 'Quick button: eraser. Hold for more.'}>
        <Glass radius={SIZE / 2} style={{ width: SIZE, height: SIZE, alignItems: 'center', justifyContent: 'center' }}>
          <View pointerEvents="none"><ToolIcon name={erasing ? 'pen' : 'eraser'} size={24} color={erasing ? '#007AFF' : '#3B4252'} /></View>
        </Glass>
      </View>
      {open ? (
        <Reanimated.View entering={FadeIn.duration(140)} exiting={FadeOut.duration(100)}>
          <Glass radius={25} style={{ flexDirection: 'row', padding: 4 }}>
            {item('undo', 'Undo', onUndo)}
            {item('redo', 'Redo', onRedo)}
            {item('pen', 'Pen', () => pick('pen'), s.inkKind === 'pen')}
            {item('highlighter', 'Highlighter', () => pick('marker'), s.inkKind === 'marker')}
            {item('lasso', 'Lasso', () => pick('lasso'), s.inkKind === 'lasso')}
            {item('flag', 'Flag this page', () => { onFlag(); setOpen(false); })}
          </Glass>
        </Reanimated.View>
      ) : null}
    </Reanimated.View>
  );
}
