// A short flip-card session inside the hub: due cards from every set, or the ones missed most.
// Answers move cards along the same spaced schedule the Flashcards screen uses.
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Reanimated, { interpolate, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

import { useTheme } from '@/lib/settings';
import { answered, type Card } from '@/lib/study-logic';
import { logStudy, updateStudy } from '@/lib/study-store';

import { Box, ease, Enter, GREEN, plural } from './shared';

export type ReviewPick = { deckId: string; deck: string; card: Card };

function save(p: ReviewPick, knew: boolean) {
  const now = Date.now();
  updateStudy((d) => ({
    ...d,
    decks: d.decks.map((k) => (k.id !== p.deckId ? k : { ...k, cards: k.cards.map((c) => (c.q === p.card.q && c.a === p.card.a ? answered(c, knew, now) : c)) })),
  }));
  logStudy({ cards: 1 });
}

function FlipCard({ front, back, flipped, onFlip, deck }: { front: string; back: string; flipped: boolean; onFlip: () => void; deck: string }) {
  const t = useTheme();
  const reduced = useReducedMotion();
  const r = useSharedValue(0);
  useEffect(() => { r.value = reduced ? (flipped ? 1 : 0) : withTiming(flipped ? 1 : 0, { duration: 260, easing: ease }); }, [flipped, r, reduced]);
  const face = { position: 'absolute' as const, top: 0, left: 0, right: 0, bottom: 0, borderRadius: 20, padding: 28, alignItems: 'center' as const, justifyContent: 'center' as const, borderWidth: 1, borderColor: t.line, backfaceVisibility: 'hidden' as const };
  const frontLook = useAnimatedStyle(() => ({ opacity: r.value < 0.5 ? 1 : 0, transform: [{ perspective: 900 }, { rotateY: `${interpolate(r.value, [0, 1], [0, 180])}deg` }] }));
  const backLook = useAnimatedStyle(() => ({ opacity: r.value >= 0.5 ? 1 : 0, transform: [{ perspective: 900 }, { rotateY: `${interpolate(r.value, [0, 1], [-180, 0])}deg` }] }));
  return (
    <Pressable accessibilityLabel={flipped ? `Answer: ${back}` : `Question: ${front}. Tap to flip`} onPress={onFlip} style={{ height: 300 }}>
      <Reanimated.View style={[face, { backgroundColor: t.card }, frontLook]}>
        <Text style={{ color: t.text, fontSize: 24, fontWeight: '600', textAlign: 'center' }}>{front}</Text>
        <Text style={{ position: 'absolute', bottom: 16, color: t.faint, fontSize: 13 }}>{deck} Â· tap to flip</Text>
      </Reanimated.View>
      <Reanimated.View style={[face, { backgroundColor: t.dark ? t.elev : '#EDF2FE' }, backLook]}>
        <Text style={{ color: t.text, fontSize: 24, fontWeight: '600', textAlign: 'center' }}>{back}</Text>
        <Text style={{ position: 'absolute', bottom: 16, color: t.faint, fontSize: 13 }}>Answer</Text>
      </Reanimated.View>
    </Pressable>
  );
}

export function QuickReview({ picks, empty, onDone }: { picks: ReviewPick[]; empty: string; onDone: () => void }) {
  const t = useTheme();
  const [list] = useState(picks);
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  const [known, setKnown] = useState(0);

  if (!list.length) return <Box><Text style={{ color: t.sub, fontSize: 15, lineHeight: 21 }}>{empty}</Text></Box>;

  if (i >= list.length) {
    return (
      <Enter dy={10}>
        <Box style={{ alignItems: 'center', paddingVertical: 32, gap: 14 }}>
          <Text style={{ color: t.text, fontSize: 44, fontWeight: '800' }}>{known}/{list.length}</Text>
          <Text style={{ color: t.sub, fontSize: 16 }}>{known === list.length ? 'You knew every one.' : `${plural(list.length - known, 'card')} will come back soon.`}</Text>
          <Pressable accessibilityLabel="Done" onPress={onDone} style={{ height: 46, paddingHorizontal: 28, borderRadius: 12, backgroundColor: t.accent, justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Done</Text>
          </Pressable>
        </Box>
      </Enter>
    );
  }

  const p = list[i];
  const next = (knew: boolean) => { save(p, knew); if (knew) setKnown((k) => k + 1); setFlip(false); setI((x) => x + 1); };
  return (
    <View style={{ gap: 16 }}>
      <Text style={{ color: t.sub, fontSize: 14, fontVariant: ['tabular-nums'] }}>Card {i + 1} of {list.length}</Text>
      <Enter key={i} dx={30}>
        <FlipCard front={p.card.q} back={p.card.a} flipped={flip} onFlip={() => setFlip((f) => !f)} deck={p.deck} />
      </Enter>
      {flip ? (
        <Enter dy={8} style={{ flexDirection: 'row', gap: 12 }}>
          <Pressable accessibilityLabel="Missed it" onPress={() => next(false)} style={{ flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${t.danger}1A` }}>
            <Text style={{ color: t.danger, fontSize: 16, fontWeight: '700' }}>Missed it</Text>
          </Pressable>
          <Pressable accessibilityLabel="Knew it" onPress={() => next(true)} style={{ flex: 1, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: `${GREEN}1F` }}>
            <Text style={{ color: GREEN, fontSize: 16, fontWeight: '700' }}>Knew it</Text>
          </Pressable>
        </Enter>
      ) : (
        <Pressable accessibilityLabel="Show answer" onPress={() => setFlip(true)} style={{ height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Show answer</Text>
        </Pressable>
      )}
    </View>
  );
}
