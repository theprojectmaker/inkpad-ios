// Find in this note: typed words, handwriting and the words on PDF and photo pages
// (read by the iPad), plus what was said in the recordings.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import Reanimated, { FadeIn } from 'react-native-reanimated';

import type { CanvasHandle } from '@/components/quill-canvas';
import { Icon, IconButton } from '@/components/ui';
import { loadPageText, readPages, snapPages } from '@/lib/handindex';
import type { NoteDoc, Recording } from '@/lib/model';
import type { OcrLine } from '@/lib/ondevice';
import { useTheme } from '@/lib/settings';

type Hit =
  | { kind: 'page'; key: string; page: number; line: OcrLine }
  | { kind: 'audio'; key: string; rec: Recording; t: number; text: string };

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

export function FindPanel({ noteId, doc, canvas, absPath, stale, onRead, onHear, onClose }: {
  noteId: string; doc: NoteDoc; canvas: React.RefObject<CanvasHandle | null>; absPath: (p: string) => string;
  stale: () => number[];          // pages written on since they were read
  onRead: () => void;
  onHear: (r: Recording, t: number) => void; onClose: () => void;
}) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [text, setText] = useState<Record<string, { lines: OcrLine[] }>>({});
  const [step, setStep] = useState<string | null>('Reading your pages…');
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    (async () => {
      const have = await loadPageText(noteId);
      if (!live.current) return;
      setText(have);
      const dirty = new Set(stale());
      const need = doc.pages.flatMap((p, i) => (!have[p.id] || dirty.has(i) ? [i] : []));
      if (need.length) {
        const shots = await snapPages(noteId, doc, need, canvas.current, absPath);
        const fresh = await readPages(noteId, shots, (d, n) => { if (live.current) setStep(`Reading page ${d} of ${n}…`); });
        if (live.current) setText(fresh);
        onRead();
      }
      if (live.current) setStep(null);
    })();
    return () => { live.current = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [noteId]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return [];
    const out: Hit[] = [];
    doc.pages.forEach((p, page) => (text[p.id]?.lines ?? []).forEach((line, i) => {
      if (line.text.toLowerCase().includes(needle)) out.push({ kind: 'page', key: `${p.id}_${i}`, page, line });
    }));
    for (const r of doc.recordings ?? []) (r.transcript ?? []).forEach((l, i) => {
      if (l.text.toLowerCase().includes(needle)) out.push({ kind: 'audio', key: `${r.id}_${i}`, rec: r, t: l.t, text: l.text });
    });
    return out;
  }, [q, text, doc]);

  const go = (h: Hit) => {
    if (h.kind === 'page') canvas.current?.flash(h.page, h.line.x, h.line.y, h.line.w, h.line.h);
    else onHear(h.rec, h.t);
  };

  return (
    <Reanimated.View entering={FadeIn.duration(180)} style={{ width: 320, backgroundColor: t.side, borderLeftWidth: 1, borderLeftColor: t.line, paddingTop: 66 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 }}>
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, height: 38, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.chip }}>
          <Icon name="magnifyingglass" size={14} color={t.faint} />
          <TextInput value={q} onChangeText={setQ} autoFocus placeholder="Find in this note" placeholderTextColor={t.faint} autoCorrect={false} style={{ flex: 1, color: t.text, fontSize: 15, height: 38 }} />
        </View>
        <IconButton name="xmark" label="Close find" onPress={onClose} />
      </View>
      {step ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingBottom: 8 }}>
          <ActivityIndicator size="small" color={t.sub} />
          <Text style={{ color: t.sub, fontSize: 13 }}>{step}</Text>
        </View>
      ) : null}
      <FlatList data={hits} keyExtractor={(h) => h.key} keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingHorizontal: 8, paddingBottom: 30 }}
        ListEmptyComponent={q.trim() && !step ? <Text style={{ color: t.faint, fontSize: 14, textAlign: 'center', marginTop: 30 }}>Nothing found</Text> : null}
        renderItem={({ item: h }) => (
          <Pressable onPress={() => go(h)} style={({ pressed }) => ({ padding: 10, borderRadius: 10, backgroundColor: pressed ? t.chip : 'transparent' })}>
            <Text numberOfLines={2} style={{ color: t.text, fontSize: 14.5 }}>{h.kind === 'page' ? h.line.text : h.text}</Text>
            <Text style={{ color: t.faint, fontSize: 12, marginTop: 3 }}>{h.kind === 'page' ? `Page ${h.page + 1}` : `Recording · ${clock(h.t)}`}</Text>
          </Pressable>
        )} />
    </Reanimated.View>
  );
}
