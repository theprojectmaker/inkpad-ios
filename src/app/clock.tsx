// A small Studento inside Quill: a big flap-board clock. With a schedule it
// counts down to the bell (time left in class, what's next); without one it's
// simply the time. The schedule is optional and stays on the iPad.
import { router } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/ui';
import { uid } from '@/lib/model';
import { fmtTime, fmtTimeAP, parseTime, type Period, type Schedule, useSchedule, whereNow } from '@/lib/schedule';

const THEMES = [
  { name: 'Station', bg: '#0E0F12', tile: '#1C1E24', digit: '#F3E9D2', sub: '#9A9384', accent: '#F2B33D' },
  { name: 'Midnight', bg: '#0B1430', tile: '#16224A', digit: '#FFFFFF', sub: '#8FA0CC', accent: '#6EA8FF' },
  { name: 'Paper', bg: '#F4EFE6', tile: '#FFFFFF', digit: '#1D1B18', sub: '#8B8478', accent: '#D9534F' },
  { name: 'Forest', bg: '#0F1F17', tile: '#1A3326', digit: '#E6F4EA', sub: '#86A895', accent: '#5DD39E' },
  { name: 'Sunset', bg: '#2A1424', tile: '#41203A', digit: '#FFE3D3', sub: '#C79AB0', accent: '#FF8A5B' },
];

const two = (n: number) => String(n).padStart(2, '0');
const mmss = (sec: number) => sec >= 3600 ? `${Math.floor(sec / 3600)}:${two(Math.floor(sec / 60) % 60)}:${two(sec % 60)}` : `${Math.floor(sec / 60)}:${two(sec % 60)}`;

export default function ClockScreen() {
  const ins = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const { s, save } = useSchedule();
  const [now, setNow] = useState(() => new Date());
  const [editing, setEditing] = useState(false);
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);

  const th = THEMES[s.theme % THEMES.length];
  const w = whereNow(s, now);
  const h12 = now.getHours() % 12 || 12;
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  const timeNow = `${h12}:${two(now.getMinutes())}`;

  const big = w.kind === 'class' ? mmss(w.left) : w.kind === 'passing' ? mmss(w.left) : `${timeNow}:${two(now.getSeconds())}`;
  const label = w.kind === 'class' ? w.period.name.toUpperCase()
    : w.kind === 'passing' ? `${w.next.name.toUpperCase()} STARTS IN`
    : now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase();

  // Tiles as big as the screen allows.
  const n = big.length;
  const gap = Math.max(6, width * 0.008);
  const tileW = Math.min(150, (Math.min(width, 1100) - 64 - gap * (n - 1)) / n, (height * 0.38) / 1.45);
  const tileH = tileW * 1.45;

  return (
    <View style={{ flex: 1, backgroundColor: th.bg, paddingTop: ins.top, paddingBottom: ins.bottom }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 14, height: 52 }}>
        <Pressable onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))} accessibilityLabel="Back to notes" hitSlop={8}
          style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: th.tile }}>
          <Icon name="chevron.left" size={16} color={th.digit} />
        </Pressable>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => save({ ...s, theme: (s.theme + 1) % THEMES.length })} accessibilityLabel="Change look"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: th.tile }}>
            <View style={{ width: 12, height: 12, borderRadius: 6, backgroundColor: th.accent }} />
            <Text style={{ color: th.digit, fontSize: 14, fontWeight: '700' }}>{th.name}</Text>
          </Pressable>
          <Pressable onPress={() => setEditing(true)} accessibilityLabel="Edit schedule"
            style={{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 40, paddingHorizontal: 14, borderRadius: 20, backgroundColor: th.tile }}>
            <Icon name="calendar" size={14} color={th.digit} />
            <Text style={{ color: th.digit, fontSize: 14, fontWeight: '700' }}>Schedule</Text>
          </Pressable>
        </View>
      </View>

      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 }}>
        <Text numberOfLines={1} style={{ color: th.accent, fontSize: 17, fontWeight: '800', letterSpacing: 2.5, marginBottom: 22, textAlign: 'center' }}>{label}</Text>
        <View style={{ flexDirection: 'row', gap }}>
          {[...big].map((ch, i) => ch === ':' ? (
            <View key={i} style={{ width: tileW * 0.32, height: tileH, alignItems: 'center', justifyContent: 'center', gap: tileH * 0.18 }}>
              <View style={{ width: tileW * 0.12, height: tileW * 0.12, borderRadius: tileW, backgroundColor: th.digit, opacity: 0.85 }} />
              <View style={{ width: tileW * 0.12, height: tileW * 0.12, borderRadius: tileW, backgroundColor: th.digit, opacity: 0.85 }} />
            </View>
          ) : (
            <View key={i} style={{ width: tileW, height: tileH, borderRadius: tileW * 0.12, backgroundColor: th.tile, alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
              shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } }}>
              <Text style={{ color: th.digit, fontSize: tileH * 0.72, fontWeight: '700', fontVariant: ['tabular-nums'], includeFontPadding: false }}>{ch}</Text>
              {/* the flap's hinge line */}
              <View style={{ position: 'absolute', left: 0, right: 0, top: tileH / 2 - 1, height: 2, backgroundColor: th.bg, opacity: 0.55 }} />
            </View>
          ))}
        </View>

        {w.kind === 'class' ? (
          <View style={{ width: Math.min(560, width - 80), height: 6, borderRadius: 3, backgroundColor: th.tile, marginTop: 34, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round((1 - w.left / w.total) * 100)}%`, height: 6, borderRadius: 3, backgroundColor: th.accent }} />
          </View>
        ) : null}

        <Text style={{ color: th.sub, fontSize: 17, fontWeight: '600', marginTop: w.kind === 'class' ? 18 : 30, textAlign: 'center' }}>
          {w.kind === 'free' ? ampm : `${timeNow} ${ampm}`}
          {w.kind === 'class' ? ` · ends at ${fmtTime(w.period.end)}` : ''}
        </Text>
        {w.kind === 'class' && w.next ? (
          <Text style={{ color: th.sub, fontSize: 15, marginTop: 6, textAlign: 'center' }}>Next: {w.next.name} at {fmtTime(w.next.start)}</Text>
        ) : null}
        {!s.periods.length ? (
          <Pressable onPress={() => setEditing(true)} style={{ marginTop: 26 }}>
            <Text style={{ color: th.sub, fontSize: 15, textDecorationLine: 'underline', textAlign: 'center' }}>Add your class schedule to count down to the bell (optional)</Text>
          </Pressable>
        ) : null}
      </View>

      <ScheduleEditor visible={editing} s={s} onClose={(next) => { setEditing(false); if (next) save(next); }} />
    </View>
  );
}

type Row = { id: string; name: string; start: string; end: string };

/** The periods of a school day. Leave it empty and the clock just shows the time. */
function ScheduleEditor({ visible, s, onClose }: { visible: boolean; s: Schedule; onClose: (next?: Schedule) => void }) {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    if (visible) setRows(s.periods.map((p) => ({ id: p.id, name: p.name, start: fmtTimeAP(p.start), end: fmtTimeAP(p.end) })));
  }, [visible, s.periods]);

  const add = () => setRows((r) => {
    const last = r[r.length - 1];
    const startMin = (last && parseTime(last.end)) != null ? parseTime(last.end)! + 4 : 8 * 60;
    return [...r, { id: uid('pd'), name: `Period ${r.length + 1}`, start: fmtTimeAP(startMin), end: fmtTimeAP(startMin + 45) }];
  });
  const set = (id: string, k: keyof Row, v: string) => setRows((r) => r.map((x) => (x.id === id ? { ...x, [k]: v } : x)));

  const done = () => {
    const periods: Period[] = [];
    for (const r of rows) {
      const a = parseTime(r.start), b = parseTime(r.end);
      if (a != null && b != null && b > a) periods.push({ id: r.id, name: r.name.trim() || 'Class', start: a, end: b });
    }
    onClose({ ...s, periods: periods.sort((x, y) => x.start - y.start) });
  };

  // A time Quill can't read (or a class ending before it starts) is outlined in red instead of quietly dropped.
  const bad = (v: string) => parseTime(v) == null;
  const ends = (r: Row) => { const a = parseTime(r.start), b = parseTime(r.end); return a != null && b != null && b <= a; };
  const badField = { borderWidth: 1.5, borderColor: '#D93025' } as const;
  const field = { height: 42, borderRadius: 10, backgroundColor: '#F1F1F4', paddingHorizontal: 12, fontSize: 16, color: '#17181C' } as const;
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={done}>
      <View style={{ flex: 1, backgroundColor: '#fff' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, height: 60, borderBottomWidth: 1, borderBottomColor: '#ECECEF' }}>
          <Text style={{ flex: 1, fontSize: 20, fontWeight: '800', color: '#17181C' }}>Class schedule</Text>
          <Pressable onPress={done} style={{ height: 36, paddingHorizontal: 16, borderRadius: 18, backgroundColor: '#2563EB', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </View>
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }} keyboardShouldPersistTaps="handled">
          <Text style={{ color: '#6B6F7A', fontSize: 14.5, lineHeight: 20, marginBottom: 6 }}>
            Optional. Same periods every school day (Mon–Fri). Times like 8:00 or 1:45; afternoon is worked out for you.
          </Text>
          {rows.map((r) => (
            <View key={r.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
              <TextInput value={r.name} onChangeText={(v) => set(r.id, 'name', v)} placeholder="Class" style={[field, { flex: 1 }]} />
              <TextInput value={r.start} onChangeText={(v) => set(r.id, 'start', v)} placeholder="8:00" keyboardType="numbers-and-punctuation" style={[field, { width: 104, textAlign: 'center' }, bad(r.start) ? badField : null]} />
              <Text style={{ color: '#9A9EA8' }}>–</Text>
              <TextInput value={r.end} onChangeText={(v) => set(r.id, 'end', v)} placeholder="8:45" keyboardType="numbers-and-punctuation" style={[field, { width: 104, textAlign: 'center' }, bad(r.end) || ends(r) ? badField : null]} />
              <Pressable onPress={() => setRows((x) => x.filter((y) => y.id !== r.id))} accessibilityLabel="Remove" hitSlop={6}
                style={{ width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FDECEC' }}>
                <Icon name="minus" size={14} color="#D93025" />
              </Pressable>
            </View>
          ))}
          <Pressable onPress={add} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: 44, marginTop: 4 }}>
            <Icon name="plus.circle.fill" size={20} color="#2563EB" />
            <Text style={{ color: '#2563EB', fontSize: 16, fontWeight: '700' }}>Add a period</Text>
          </Pressable>
        </ScrollView>
      </View>
    </Modal>
  );
}
