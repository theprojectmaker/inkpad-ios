// A comment on the page: a thread you can reply to. Saved in the pin's text as a small JSON list,
// so older comments (plain text) still open.
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useTheme } from '@/lib/settings';
import { Sheet } from './ui';

export type CommentEntry = { text: string; at: number };

export function readThread(raw: string): CommentEntry[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v?.thread)) return v.thread;
  } catch {}
  return [{ text: raw, at: 0 }];
}

export const firstLine = (raw: string) => readThread(raw)[0]?.text ?? '';

const when = (ms: number) => (ms ? new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

export function CommentSheet({ raw, onSave, onClose }: { raw: string | null; onSave: (next: string) => void; onClose: () => void }) {
  const t = useTheme();
  const [thread, setThread] = useState<CommentEntry[]>([]);
  const [draft, setDraft] = useState('');
  useEffect(() => { if (raw != null) { setThread(readThread(raw)); setDraft(''); } }, [raw]);

  const save = (list: CommentEntry[]) => onSave(list.length ? JSON.stringify({ thread: list }) : '');
  const post = () => {
    const text = draft.trim();
    if (!text) return;
    const next = [...thread, { text, at: Date.now() }];
    setThread(next);
    setDraft('');
    save(next);
  };
  // A new pin nothing was written on goes away.
  const close = () => { if (!thread.length) save([]); onClose(); };

  return (
    <Sheet visible={raw != null} onClose={close} title="Comments" width={420}>
      <ScrollView style={{ maxHeight: 320 }} contentContainerStyle={{ gap: 12, paddingBottom: 12 }}>
        {thread.map((c, i) => (
          <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
            <View style={{ width: 28, height: 28, borderRadius: 14, backgroundColor: '#3F6AF2', alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600' }}>Y</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: t.sub, fontSize: 12 }}>You{c.at ? ` · ${when(c.at)}` : ''}</Text>
              <Text style={{ color: t.text, fontSize: 15, lineHeight: 21, marginTop: 1 }}>{c.text}</Text>
            </View>
            <Pressable accessibilityLabel="Delete this comment" hitSlop={8} onPress={() => { const next = thread.filter((_, k) => k !== i); setThread(next); save(next); if (!next.length) onClose(); }}>
              <Text style={{ color: t.faint, fontSize: 13 }}>Delete</Text>
            </Pressable>
          </View>
        ))}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <TextInput accessibilityLabel="Write a comment" value={draft} onChangeText={setDraft} onSubmitEditing={post} autoFocus returnKeyType="send"
          placeholder={thread.length ? 'Reply' : 'Add a comment'} placeholderTextColor={t.faint}
          style={{ flex: 1, height: 40, paddingHorizontal: 12, borderRadius: 10, backgroundColor: t.chip, color: t.text, fontSize: 15 }} />
        <Pressable accessibilityLabel="Post" onPress={post} disabled={!draft.trim()} style={{ height: 40, paddingHorizontal: 14, borderRadius: 10, justifyContent: 'center', backgroundColor: draft.trim() ? '#3F6AF2' : t.chip }}>
          <Text style={{ color: draft.trim() ? '#fff' : t.faint, fontSize: 15, fontWeight: '600' }}>Post</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
