// Import Flashcards: paste a set (from Quizlet, a doc, anywhere), then study it. Cards you
// miss come back sooner (spaced repetition).
import AsyncStorage from '@react-native-async-storage/async-storage';
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Icon, IconButton, useToast } from '@/components/ui';
import { uid } from '@/lib/model';
import { useTheme } from '@/lib/settings';

type Card = { q: string; a: string; box: number; due: number };
type Deck = { id: string; title: string; cards: Card[]; made: number };
const KEY = 'quill.flashcards.v1';
const DAY = 86400000;
const GAPS = [0, 1, 3, 7, 14, 30];   // days until a card comes back, by how well you know it

/** Each line is one card: a tab, " - ", ":" or "," splits the front from the back. */
export function parseCards(text: string): Card[] {
  const out: Card[] = [];
  for (const line of text.split(/\r?\n/)) {
    const l = line.trim();
    if (!l) continue;
    const m = l.split(/\t| - | – | — /);
    const [q, ...rest] = m.length > 1 ? m : l.includes(':') ? l.split(':') : l.split(',');
    const a = rest.join(' ').trim();
    if (q?.trim() && a) out.push({ q: q.trim(), a, box: 0, due: 0 });
  }
  return out;
}

export default function Flashcards() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { toast } = useToast();
  const [decks, setDecks] = useState<Deck[]>([]);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [flip, setFlip] = useState(false);
  useEffect(() => { AsyncStorage.getItem(KEY).then((v) => { if (v) try { setDecks(JSON.parse(v)); } catch {} }).catch(() => {}); }, []);
  const save = (d: Deck[]) => { setDecks(d); AsyncStorage.setItem(KEY, JSON.stringify(d)).catch(() => {}); };
  const parsed = useMemo(() => parseCards(text), [text]);
  const deck = decks.find((d) => d.id === open);
  const now = Date.now();
  const queue = deck ? deck.cards.map((c, i) => ({ c, i })).filter((x) => x.c.due <= now) : [];
  const cur = queue[0];

  const answer = (knew: boolean) => {
    if (!deck || !cur) return;
    const box = knew ? Math.min(GAPS.length - 1, cur.c.box + 1) : 0;
    const cards = deck.cards.slice();
    cards[cur.i] = { ...cur.c, box, due: knew ? now + GAPS[box] * DAY : now + 60000 };
    save(decks.map((d) => (d.id === deck.id ? { ...d, cards } : d)));
    setFlip(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <IconButton name="arrow.left" label="Back" onPress={() => { if (open) setOpen(null); else if (adding) setAdding(false); else router.back(); }} />
        <Text style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '800', marginLeft: 6 }}>{deck?.title ?? 'Flashcards'}</Text>
        {!open && !adding ? <Button title="Import Flashcards" kind="primary" icon="plus" onPress={() => { setTitle(''); setText(''); setAdding(true); }} /> : null}
      </View>
      {adding ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <TextInput accessibilityLabel="Set name" value={title} onChangeText={setTitle} placeholder="Name this set" placeholderTextColor={t.faint} style={{ height: 46, borderWidth: 1, borderColor: t.line, borderRadius: 11, paddingHorizontal: 12, color: t.text, fontSize: 17 }} />
          <Text style={{ color: t.sub, fontSize: 14 }}>Paste your cards, one per line, with a tab, dash, colon or comma between the front and the back. Copying a set out of Quizlet works as it is.</Text>
          <TextInput accessibilityLabel="Cards" value={text} onChangeText={setText} multiline placeholder={'mitochondria - makes energy\nnucleus - holds the DNA'} placeholderTextColor={t.faint} style={{ minHeight: 260, borderWidth: 1, borderColor: t.line, borderRadius: 11, padding: 12, color: t.text, fontSize: 16, textAlignVertical: 'top' }} />
          <Button title={parsed.length ? `Add ${parsed.length} card${parsed.length === 1 ? '' : 's'}` : 'Add cards'} kind="primary" disabled={!parsed.length} onPress={() => {
            save([{ id: uid('d'), title: title.trim() || 'Flashcards', cards: parsed, made: Date.now() }, ...decks]);
            setAdding(false);
            toast(`${parsed.length} cards added`);
          }} />
        </ScrollView>
      ) : deck ? (
        <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          {cur ? (
            <>
              <Text style={{ color: t.faint, fontSize: 14 }}>{queue.length} to go</Text>
              <Pressable accessibilityLabel="Flip card" onPress={() => setFlip((v) => !v)} style={{ width: '100%', maxWidth: 640, minHeight: 300, borderRadius: 22, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: flip ? '#EDF2FE' : t.card, borderWidth: 1, borderColor: t.line }}>
                <Text style={{ color: flip ? '#15171C' : t.text, fontSize: 26, fontWeight: '700', textAlign: 'center' }}>{flip ? cur.c.a : cur.c.q}</Text>
                <Text style={{ position: 'absolute', bottom: 14, color: t.faint, fontSize: 13 }}>{flip ? 'Answer' : 'Tap to flip'}</Text>
              </Pressable>
              {flip ? (
                <View style={{ flexDirection: 'row', gap: 14 }}>
                  <Button title="Still learning" onPress={() => answer(false)} />
                  <Button title="Know it" kind="primary" onPress={() => answer(true)} />
                </View>
              ) : null}
            </>
          ) : (
            <>
              <Icon name="checkmark.circle.fill" size={46} color="#30A46C" />
              <Text style={{ color: t.text, fontSize: 22, fontWeight: '800' }}>All done for now</Text>
              <Text style={{ color: t.sub, fontSize: 15 }}>Cards come back when it's time to review them.</Text>
              <Button title="Study them all again" onPress={() => save(decks.map((d) => (d.id === deck.id ? { ...d, cards: d.cards.map((c) => ({ ...c, due: 0 })) } : d)))} />
            </>
          )}
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10 }}>
          {decks.length ? decks.map((d) => (
            <Pressable key={d.id} accessibilityLabel={d.title} onPress={() => { setFlip(false); setOpen(d.id); }} onLongPress={() => save(decks.filter((x) => x.id !== d.id))} style={{ padding: 16, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '700' }}>{d.title}</Text>
              <Text style={{ color: t.faint, fontSize: 13, marginTop: 3 }}>{d.cards.length} cards · {d.cards.filter((c) => c.due <= now).length} to review · hold to delete</Text>
            </Pressable>
          )) : <Text style={{ color: t.sub, fontSize: 16, textAlign: 'center', marginTop: 60 }}>Import a set of flashcards to start studying.</Text>}
        </ScrollView>
      )}
    </View>
  );
}
