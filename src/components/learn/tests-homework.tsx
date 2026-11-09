// Tests as countdown cards, and the homework list. Adding either uses one small sheet.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { Icon, IconButton, Sheet, useToast } from '@/components/ui';
import { uid } from '@/lib/model';
import { useTheme } from '@/lib/settings';
import { daysUntil, readDate } from '@/lib/study-logic';
import { type StudyData, updateStudy } from '@/lib/study-store';

import { Box, Empty, Enter, GREEN, ORANGE } from './shared';

const when = (n: number) => (n < 0 ? 'Late' : n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `${n} days`);
const pretty = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' }); };

export function TestsHomework({ study, now }: { study: StudyData; now: Date }) {
  const t = useTheme();
  const { toast } = useToast();
  const [adding, setAdding] = useState<'test' | 'hw' | null>(null);
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [showPast, setShowPast] = useState(false);

  const upcoming = study.tests.filter((x) => daysUntil(x.date, now) >= 0);
  const past = study.tests.filter((x) => daysUntil(x.date, now) < 0);
  const open = study.homework.filter((h) => !h.done).sort((a, b) => (a.due ?? '9').localeCompare(b.due ?? '9'));
  const finished = study.homework.filter((h) => h.done);

  const field = { height: 46, borderRadius: 12, backgroundColor: t.chip, paddingHorizontal: 12, color: t.text, fontSize: 16 } as const;
  const openSheet = (k: 'test' | 'hw') => { setName(''); setDate(''); setAdding(k); };
  const save = () => {
    const parsed = date.trim() ? readDate(date, now) : null;
    if (date.trim() && !parsed) { toast('Write the date like 11/20 or Nov 20.'); return; }
    if (!name.trim()) { toast(adding === 'test' ? 'Give the test a name.' : 'Write what the homework is.'); return; }
    if (adding === 'test' && !parsed) { toast('Add the test date, like 11/20.'); return; }
    if (adding === 'test') updateStudy((d) => ({ ...d, tests: [...d.tests, { id: uid('t'), name: name.trim(), date: parsed! }].sort((a, b) => a.date.localeCompare(b.date)) }));
    else updateStudy((d) => ({ ...d, homework: [{ id: uid('h'), text: name.trim(), due: parsed ?? undefined }, ...d.homework] }));
    setAdding(null);
  };
  const setDone = (id: string, done: boolean) => updateStudy((d) => ({ ...d, homework: d.homework.map((k) => (k.id === id ? { ...k, done } : k)) }));
  const add = (label: string, k: 'test' | 'hw') => (
    <Pressable accessibilityLabel={label} onPress={() => openSheet(k)} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
      <Icon name="plus" size={15} color={t.accent} />
      <Text style={{ color: t.accent, fontSize: 15, fontWeight: '600' }}>Add</Text>
    </Pressable>
  );

  return (
    <View style={{ gap: 16 }}>
      <Box title="Tests" right={add('Add a test', 'test')}>
        {upcoming.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            {upcoming.map((x, i) => {
              const n = daysUntil(x.date, now);
              const c = n <= 2 ? t.danger : n <= 7 ? ORANGE : t.accent;
              return (
                <Enter key={x.id} dy={10} delay={i * 40} style={{ flexBasis: '31%', flexGrow: 1, minWidth: 170 }}>
                  <View style={{ padding: 16, borderRadius: 16, backgroundColor: `${c}12`, gap: 4 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start' }}>
                      <Text style={{ flex: 1, color: c, fontSize: 34, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{n === 0 ? 'Today' : n}</Text>
                      <IconButton name="xmark" size={14} label={`Remove ${x.name}`} color={t.faint} onPress={() => updateStudy((d) => ({ ...d, tests: d.tests.filter((k) => k.id !== x.id) }))} />
                    </View>
                    {n ? <Text style={{ color: c, fontSize: 13, fontWeight: '600' }}>{n === 1 ? 'day to go' : 'days to go'}</Text> : null}
                    <Text numberOfLines={2} style={{ color: t.text, fontSize: 16, fontWeight: '600', marginTop: 4 }}>{x.name}</Text>
                    <Text style={{ color: t.sub, fontSize: 13 }}>{pretty(x.date)}</Text>
                  </View>
                </Enter>
              );
            })}
          </View>
        ) : <Empty text="Add a test to count down to it." />}
        {past.length ? (
          <View style={{ gap: 6 }}>
            <Pressable accessibilityLabel={showPast ? 'Hide past tests' : 'Show past tests'} onPress={() => setShowPast((v) => !v)} hitSlop={6}>
              <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>{showPast ? 'Hide' : 'Show'} past tests ({past.length})</Text>
            </Pressable>
            {showPast ? past.map((x) => (
              <View key={x.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, opacity: 0.6 }}>
                <Text style={{ flex: 1, color: t.text, fontSize: 15 }}>{x.name} · {pretty(x.date)}</Text>
                <IconButton name="xmark" size={14} label={`Remove ${x.name}`} onPress={() => updateStudy((d) => ({ ...d, tests: d.tests.filter((k) => k.id !== x.id) }))} />
              </View>
            )) : null}
          </View>
        ) : null}
      </Box>

      <Box title="Homework" right={add('Add homework', 'hw')}>
        {open.length ? open.map((h) => {
          const n = h.due ? daysUntil(h.due, now) : null;
          return (
            <Pressable key={h.id} accessibilityLabel={`Done: ${h.text}`} onPress={() => setDone(h.id, true)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 40 }}>
              <Icon name="circle" size={21} color={t.faint} />
              <Text style={{ flex: 1, color: t.text, fontSize: 16 }}>{h.text}</Text>
              {n != null ? <Text style={{ color: n < 0 ? t.danger : n <= 1 ? ORANGE : t.sub, fontSize: 13, fontWeight: '600' }}>{when(n)}</Text> : null}
            </Pressable>
          );
        }) : <Empty text="Nothing to do. Nice." />}
        {finished.slice(0, 5).map((h) => (
          <Pressable key={h.id} accessibilityLabel={`Not done: ${h.text}`} onPress={() => setDone(h.id, false)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 34, opacity: 0.55 }}>
            <Icon name="checkmark.circle.fill" size={21} color={GREEN} />
            <Text style={{ flex: 1, color: t.text, fontSize: 16, textDecorationLine: 'line-through' }}>{h.text}</Text>
          </Pressable>
        ))}
        {finished.length ? (
          <Pressable accessibilityLabel="Clear finished homework" onPress={() => updateStudy((d) => ({ ...d, homework: d.homework.filter((k) => !k.done) }))} hitSlop={6}>
            <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>Clear finished ({finished.length})</Text>
          </Pressable>
        ) : null}
      </Box>

      <Sheet visible={adding != null} onClose={() => setAdding(null)} title={adding === 'test' ? 'Add a test' : 'Add homework'} width={420}>
        <View style={{ gap: 10 }}>
          <TextInput accessibilityLabel={adding === 'test' ? 'Test name' : 'Homework'} value={name} onChangeText={setName} autoFocus placeholder={adding === 'test' ? 'Biology chapter 4' : 'Geometry page 42, 1 to 10'} placeholderTextColor={t.faint} style={field} />
          <TextInput accessibilityLabel="Date" value={date} onChangeText={setDate} placeholder={adding === 'test' ? 'Date, like 11/20' : 'Due date, like 11/20 (optional)'} placeholderTextColor={t.faint} keyboardType="numbers-and-punctuation" returnKeyType="done" onSubmitEditing={save} style={field} />
          <Pressable accessibilityLabel="Save" onPress={save} style={{ height: 46, borderRadius: 12, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Save</Text>
          </Pressable>
        </View>
      </Sheet>
    </View>
  );
}
