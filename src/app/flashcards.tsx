// Flashcards: import or write a set, then study it several ways. Cards you miss come back sooner.
import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, ConfirmSheet, Icon, IconButton, MenuSheet, PromptSheet, useToast } from '@/components/ui';
import { copyText, speak } from '@/lib/ondevice';
import { useTheme } from '@/lib/settings';
import { answered, type Card, cardsToText, closeEnough, hardest, isDue, mastered, matchRound, parseCards, shuffled } from '@/lib/study-logic';
import { addDeck, logStudy, updateStudy, useStudy } from '@/lib/study-store';

export { parseCards };

type Mode = 'review' | 'all' | 'starred' | 'hard' | 'type' | 'match' | 'edit';

function Flip({ front, back, flipped, onFlip, star, onStar }: { front: string; back: string; flipped: boolean; onFlip: () => void; star?: boolean; onStar?: () => void }) {
  const t = useTheme();
  return (
    <Pressable accessibilityLabel="Flip card" onPress={onFlip} style={{ width: '100%', maxWidth: 640, minHeight: 280, borderRadius: 18, padding: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: flipped ? (t.dark ? t.elev : '#EDF2FE') : t.card, borderWidth: 1, borderColor: t.line }}>
      <Text style={{ color: t.text, fontSize: 24, fontWeight: '600', textAlign: 'center' }}>{flipped ? back : front}</Text>
      <Text style={{ position: 'absolute', bottom: 14, color: t.faint, fontSize: 13 }}>{flipped ? 'Answer' : 'Tap to flip'}</Text>
      <View style={{ position: 'absolute', top: 10, right: 10, flexDirection: 'row' }}>
        <IconButton name="speaker.wave.2" label="Read aloud" onPress={() => speak(flipped ? back : front)} />
        {onStar ? <IconButton name={star ? 'star.fill' : 'star'} label={star ? 'Remove star' : 'Star this card'} color={star ? '#F5B400' : undefined} onPress={onStar} /> : null}
      </View>
    </Pressable>
  );
}

/** Going through cards: the spaced review changes when cards return, practice runs don't. */
function Study({ deckId, cards, spaced, swapped, onEnd }: { deckId: string; cards: Card[]; spaced: boolean; swapped: boolean; onEnd: () => void }) {
  const t = useTheme();
  const { decks } = useStudy();
  const [list, setList] = useState(() => cards);
  const [flip, setFlip] = useState(false);
  const [good, setGood] = useState(0);
  const [seen, setSeen] = useState(0);
  const c = list[0];
  const live = decks.find((d) => d.id === deckId)?.cards.find((x) => x.q === c?.q && x.a === c?.a);

  const change = (fn: (x: Card) => Card) => updateStudy((d) => ({ ...d, decks: d.decks.map((k) => (k.id === deckId ? { ...k, cards: k.cards.map((x) => (x.q === c.q && x.a === c.a ? fn(x) : x)) } : k)) }));
  const next = (knew: boolean) => {
    if (spaced) change((x) => answered(x, knew, Date.now()));
    logStudy({ cards: 1 });
    setSeen((n) => n + 1);
    if (knew) setGood((n) => n + 1);
    setFlip(false);
    // A missed card comes round again later in the same sitting.
    setList((l) => (knew ? l.slice(1) : [...l.slice(1), l[0]]));
  };

  if (!c) {
    return (
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Icon name="checkmark.circle.fill" size={44} color="#30A46C" />
        <Text style={{ color: t.text, fontSize: 22, fontWeight: '700' }}>All done</Text>
        <Text style={{ color: t.sub, fontSize: 15 }}>{seen ? `${good} of ${seen} right first go or after a retry.` : 'Nothing to study here right now.'}</Text>
        <Button title="Back to the set" onPress={onEnd} />
      </View>
    );
  }
  return (
    <View style={{ width: '100%', alignItems: 'center', gap: 18 }}>
      <Text style={{ color: t.faint, fontSize: 14 }}>{list.length} to go</Text>
      <Flip front={swapped ? c.a : c.q} back={swapped ? c.q : c.a} flipped={flip} onFlip={() => setFlip((v) => !v)} star={live?.star} onStar={() => change((x) => ({ ...x, star: !x.star }))} />
      {flip ? (
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="Still learning" onPress={() => next(false)} />
          <Button title="Know it" kind="primary" onPress={() => next(true)} />
        </View>
      ) : <View style={{ height: 42 }} />}
    </View>
  );
}

function TypeAnswer({ cards, swapped, onEnd }: { cards: Card[]; swapped: boolean; onEnd: () => void }) {
  const t = useTheme();
  const [list, setList] = useState(() => shuffled(cards));
  const [typed, setTyped] = useState('');
  const [result, setResult] = useState<boolean | null>(null);
  const [right, setRight] = useState(0);
  const [total] = useState(cards.length);
  const c = list[0];
  if (!c) {
    return (
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Text style={{ color: t.text, fontSize: 34, fontWeight: '700' }}>{right} / {total}</Text>
        <Text style={{ color: t.sub, fontSize: 15 }}>right on the first try</Text>
        <Button title="Back to the set" onPress={onEnd} />
      </View>
    );
  }
  const ask = swapped ? c.a : c.q, want = swapped ? c.q : c.a;
  const check = () => {
    if (!typed.trim()) return;
    const ok = closeEnough(typed, want);
    setResult(ok);
    if (ok) setRight((n) => n + 1);
    logStudy({ cards: 1 });
  };
  const go = () => { setList((l) => l.slice(1)); setTyped(''); setResult(null); };
  return (
    <View style={{ width: '100%', maxWidth: 640, gap: 14 }}>
      <Text style={{ color: t.faint, fontSize: 14, textAlign: 'center' }}>{list.length} to go</Text>
      <Text style={{ color: t.text, fontSize: 24, fontWeight: '600', textAlign: 'center', paddingVertical: 24 }}>{ask}</Text>
      <TextInput accessibilityLabel="Your answer" value={typed} onChangeText={setTyped} onSubmitEditing={result == null ? check : go} autoFocus editable={result == null} placeholder="Type the answer" placeholderTextColor={t.faint} autoCorrect={false}
        style={{ height: 48, borderRadius: 11, borderWidth: 1.5, borderColor: result == null ? t.line : result ? '#16A34A' : t.danger, paddingHorizontal: 14, color: t.text, fontSize: 17 }} />
      {result === false ? <Text style={{ color: t.text, fontSize: 16 }}>The answer: <Text style={{ fontWeight: '700' }}>{want}</Text></Text> : null}
      {result === true ? <Text style={{ color: '#16A34A', fontSize: 16, fontWeight: '600' }}>Right{typed.trim().toLowerCase() !== want.toLowerCase() ? `: ${want}` : ''}</Text> : null}
      {result == null ? <Button title="Check" kind="primary" onPress={check} /> : <Button title="Next" kind="primary" onPress={go} />}
    </View>
  );
}

function Match({ cards, onEnd }: { cards: Card[]; onEnd: () => void }) {
  const t = useTheme();
  const [tiles, setTiles] = useState(() => matchRound(cards));
  const [gone, setGone] = useState<number[]>([]);
  const [held, setHeld] = useState<{ id: string; pair: number } | null>(null);
  const [miss, setMiss] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [took, setTook] = useState(0);
  const pairs = tiles.length / 2;
  const done = gone.length === pairs;
  const tap = (x: { id: string; pair: number }) => {
    if (!held) { setHeld(x); setMiss(null); return; }
    if (held.id === x.id) { setHeld(null); return; }
    if (held.pair === x.pair) {
      const left = [...gone, x.pair];
      setGone(left);
      if (left.length === pairs) { setTook(Math.round((Date.now() - startedAt) / 1000)); logStudy({ cards: pairs }); }
    } else setMiss(x.id);
    setHeld(null);
  };
  if (done) {
    return (
      <View style={{ alignItems: 'center', gap: 12 }}>
        <Text style={{ color: t.text, fontSize: 34, fontWeight: '700' }}>{took} seconds</Text>
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <Button title="Back to the set" onPress={onEnd} />
          <Button title="Play again" kind="primary" onPress={() => { setTiles(matchRound(cards)); setGone([]); setHeld(null); setMiss(null); setStartedAt(Date.now()); }} />
        </View>
      </View>
    );
  }
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, justifyContent: 'center', maxWidth: 760 }}>
      {tiles.map((x) => {
        if (gone.includes(x.pair)) return <View key={x.id} style={{ width: 230, height: 96 }} />;
        const on = held?.id === x.id, bad = miss === x.id;
        return (
          <Pressable key={x.id} accessibilityLabel={x.text} onPress={() => tap(x)} style={{ width: 230, height: 96, borderRadius: 12, padding: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: on ? '#3F6AF2' : bad ? t.danger : t.line, backgroundColor: on ? '#3F6AF21A' : t.card }}>
            <Text numberOfLines={4} style={{ color: t.text, fontSize: 15, textAlign: 'center' }}>{x.text}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function EditCards({ deckId, cards }: { deckId: string; cards: Card[] }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [a, setA] = useState('');
  const set = (fn: (c: Card[]) => Card[]) => updateStudy((d) => ({ ...d, decks: d.decks.map((k) => (k.id === deckId ? { ...k, cards: fn(k.cards) } : k)) }));
  const field = { flex: 1, height: 42, borderRadius: 10, backgroundColor: t.chip, paddingHorizontal: 12, color: t.text, fontSize: 15 } as const;
  return (
    <ScrollView keyboardShouldPersistTaps="handled" style={{ alignSelf: 'stretch' }} contentContainerStyle={{ maxWidth: 720, width: '100%', alignSelf: 'center', gap: 8, paddingBottom: 60 }}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput accessibilityLabel="New card front" value={q} onChangeText={setQ} placeholder="Front" placeholderTextColor={t.faint} style={field} />
        <TextInput accessibilityLabel="New card back" value={a} onChangeText={setA} placeholder="Back" placeholderTextColor={t.faint} style={field} />
        <Button title="Add" kind="primary" disabled={!q.trim() || !a.trim()} onPress={() => { set((c) => [{ q: q.trim(), a: a.trim(), box: 0, due: 0 }, ...c]); setQ(''); setA(''); }} />
      </View>
      {cards.map((c, i) => (
        <View key={`${i}-${c.q}`} style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
          <TextInput accessibilityLabel={`Card ${i + 1} front`} defaultValue={c.q} onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v) set((l) => l.map((x, k) => (k === i ? { ...x, q: v } : x))); }} style={field} />
          <TextInput accessibilityLabel={`Card ${i + 1} back`} defaultValue={c.a} onEndEditing={(e) => { const v = e.nativeEvent.text.trim(); if (v) set((l) => l.map((x, k) => (k === i ? { ...x, a: v } : x))); }} style={field} />
          <IconButton name="trash" label={`Delete card ${i + 1}`} onPress={() => set((l) => l.filter((_, k) => k !== i))} />
        </View>
      ))}
    </ScrollView>
  );
}

export default function Flashcards() {
  const t = useTheme();
  const ins = useSafeAreaInsets();
  const { toast } = useToast();
  const { decks } = useStudy();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [mode, setMode] = useState<Mode | null>(null);
  const [run, setRun] = useState<Card[]>([]);
  const [swapped, setSwapped] = useState(false);
  const [random, setRandom] = useState(true);
  const [menu, setMenu] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const parsed = useMemo(() => parseCards(text), [text]);
  const deck = decks.find((d) => d.id === open);
  const now = Date.now();
  useEffect(() => { if (open && !deck) { setOpen(null); setMode(null); } }, [open, deck]);

  const start = (m: Mode, cards: Card[]) => { setRun(random && m !== 'review' ? shuffled(cards) : cards); setMode(m); };
  const target = decks.find((d) => d.id === (menu ?? renaming ?? deleting));
  const back = () => { if (mode) setMode(null); else if (open) setOpen(null); else if (adding) setAdding(false); else router.back(); };

  const modeRow = (icon: string, label: string, sub: string, cards: Card[], m: Mode) => (
    <Pressable key={label} accessibilityLabel={label} disabled={!cards.length && m !== 'edit'} onPress={() => start(m, cards)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderRadius: 12, backgroundColor: pressed ? t.chip : t.card, borderWidth: 1, borderColor: t.line, opacity: !cards.length && m !== 'edit' ? 0.45 : 1 })}>
      <Icon name={icon} size={19} color="#3F6AF2" />
      <View style={{ flex: 1 }}>
        <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>{label}</Text>
        <Text style={{ color: t.sub, fontSize: 13 }}>{sub}</Text>
      </View>
      <Icon name="chevron.right" size={13} color={t.faint} />
    </Pressable>
  );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg, paddingTop: ins.top }}>
      <View style={{ height: 56, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10 }}>
        <IconButton name="arrow.left" label="Back" onPress={back} />
        <Text numberOfLines={1} style={{ flex: 1, color: t.text, fontSize: 20, fontWeight: '700', marginLeft: 6 }}>{deck?.title ?? 'Flashcards'}</Text>
        {deck && !mode ? <IconButton name="ellipsis.circle" label="Set options" onPress={() => setMenu(deck.id)} /> : null}
        {!open && !adding ? <Button title="New set" kind="primary" icon="plus" onPress={() => { setTitle(''); setText(''); setAdding(true); }} /> : null}
      </View>

      {adding ? (
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 20, gap: 12, maxWidth: 720, width: '100%', alignSelf: 'center' }}>
          <TextInput accessibilityLabel="Set name" value={title} onChangeText={setTitle} placeholder="Name this set" placeholderTextColor={t.faint} style={{ height: 46, borderWidth: 1, borderColor: t.line, borderRadius: 11, paddingHorizontal: 12, color: t.text, fontSize: 17 }} />
          <Text style={{ color: t.sub, fontSize: 14 }}>Paste your cards, one per line, with a tab, dash, colon or comma between the front and the back. Copying a set out of Quizlet works as it is.</Text>
          <TextInput accessibilityLabel="Cards" value={text} onChangeText={setText} multiline placeholder={'mitochondria - makes energy\nnucleus - holds the DNA'} placeholderTextColor={t.faint} style={{ minHeight: 260, borderWidth: 1, borderColor: t.line, borderRadius: 11, padding: 12, color: t.text, fontSize: 16, textAlignVertical: 'top' }} />
          <Button title={parsed.length ? `Add ${parsed.length} card${parsed.length === 1 ? '' : 's'}` : 'Add cards'} kind="primary" disabled={!parsed.length} onPress={() => {
            addDeck(title, parsed);
            setAdding(false);
            toast(`${parsed.length} cards added`);
          }} />
        </ScrollView>
      ) : deck && mode ? (
        <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }}>
          {mode === 'type' ? <TypeAnswer cards={run} swapped={swapped} onEnd={() => setMode(null)} />
            : mode === 'match' ? <Match cards={run} onEnd={() => setMode(null)} />
            : mode === 'edit' ? <EditCards deckId={deck.id} cards={deck.cards} />
            : <Study deckId={deck.id} cards={run} spaced={mode === 'review'} swapped={swapped} onEnd={() => setMode(null)} />}
        </View>
      ) : deck ? (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10, maxWidth: 640, width: '100%', alignSelf: 'center' }}>
          <View style={{ height: 6, borderRadius: 3, backgroundColor: t.chip, overflow: 'hidden' }}>
            <View style={{ height: 6, width: `${Math.round(mastered(deck.cards) * 100)}%`, backgroundColor: '#30A46C' }} />
          </View>
          <Text style={{ color: t.sub, fontSize: 13, marginBottom: 6 }}>{Math.round(mastered(deck.cards) * 100)}% learned · {deck.cards.length} cards</Text>
          {modeRow('clock.arrow.circlepath', 'Review what\'s due', `${deck.cards.filter((c) => isDue(c, now)).length} ready. Missed cards come back sooner.`, deck.cards.filter((c) => isDue(c, now)), 'review')}
          {modeRow('rectangle.stack', 'Go through them all', "Cram without changing when cards come back.", deck.cards, 'all')}
          {modeRow('keyboard', 'Type the answers', 'Small typos are fine.', deck.cards, 'type')}
          {modeRow('square.grid.2x2', 'Match game', 'Pair them up against the clock.', deck.cards.length >= 2 ? deck.cards : [], 'match')}
          {modeRow('star', 'Starred cards', `${deck.cards.filter((c) => c.star).length} starred`, deck.cards.filter((c) => c.star), 'starred')}
          {modeRow('flame', 'Hardest cards', 'The ones you miss most.', hardest(deck.cards), 'hard')}
          {modeRow('pencil', 'Edit cards', 'Add, change or delete cards.', [], 'edit')}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
            <Pressable accessibilityLabel="Answer first" onPress={() => setSwapped((v) => !v)} style={{ flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: swapped ? '#3F6AF21A' : t.chip }}>
              <Text style={{ color: swapped ? '#3F6AF2' : t.text, fontSize: 14, fontWeight: '500' }}>{swapped ? 'Showing answers first' : 'Show answers first'}</Text>
            </Pressable>
            <Pressable accessibilityLabel="Shuffle" onPress={() => setRandom((v) => !v)} style={{ flex: 1, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: random ? '#3F6AF21A' : t.chip }}>
              <Text style={{ color: random ? '#3F6AF2' : t.text, fontSize: 14, fontWeight: '500' }}>{random ? 'Shuffled' : 'In order'}</Text>
            </Pressable>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={{ padding: 20, gap: 10, maxWidth: 760, width: '100%', alignSelf: 'center' }}>
          {decks.length ? decks.map((d) => (
            <Pressable key={d.id} accessibilityLabel={d.title} onPress={() => setOpen(d.id)} onLongPress={() => setMenu(d.id)} style={{ padding: 16, borderRadius: 14, borderWidth: 1, borderColor: t.line, backgroundColor: t.card }}>
              <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>{d.title}</Text>
              <Text style={{ color: t.sub, fontSize: 13, marginTop: 3 }}>{d.cards.length} cards · {d.cards.filter((c) => isDue(c, now)).length} to review · {Math.round(mastered(d.cards) * 100)}% learned</Text>
            </Pressable>
          )) : <Text style={{ color: t.sub, fontSize: 16, textAlign: 'center', marginTop: 60 }}>Paste in a set, or make cards from a note in Learn.</Text>}
        </ScrollView>
      )}

      <MenuSheet visible={!!menu} onClose={() => setMenu(null)} title={target?.title} items={target ? [
        { label: 'Rename', icon: 'pencil', onPress: () => setRenaming(target.id) },
        { label: 'Copy the whole set', icon: 'doc.on.doc', onPress: () => { copyText(cardsToText(target.cards)); toast('Copied. It pastes into any other flashcard app.'); } },
        { label: 'Start over', icon: 'arrow.counterclockwise', onPress: () => updateStudy((d) => ({ ...d, decks: d.decks.map((k) => (k.id === target.id ? { ...k, cards: k.cards.map((c) => ({ ...c, box: 0, due: 0, missed: 0 })) } : k)) })) },
        { label: 'Delete', icon: 'trash', danger: true, onPress: () => setDeleting(target.id) },
      ] : []} />
      <PromptSheet visible={!!renaming} title="Rename this set" initial={target?.title ?? ''} onCancel={() => setRenaming(null)}
        onSubmit={(v) => { const id = renaming; setRenaming(null); if (v.trim()) updateStudy((d) => ({ ...d, decks: d.decks.map((k) => (k.id === id ? { ...k, title: v.trim() } : k)) })); }} />
      <ConfirmSheet visible={!!deleting} title={`Delete "${target?.title ?? ''}"?`} message="Its cards and progress go too." onCancel={() => setDeleting(null)}
        onConfirm={() => { const id = deleting; setDeleting(null); setOpen(null); updateStudy((d) => ({ ...d, decks: d.decks.filter((k) => k.id !== id) })); }} />
    </View>
  );
}
