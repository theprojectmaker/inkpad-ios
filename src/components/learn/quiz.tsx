// Multiple choice, one question at a time. Used for "Quiz from a set" (choices are the set's own
// answers) and for quizzes made offline from typed notes.
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useTheme } from '@/lib/settings';
import { type Card, shuffled } from '@/lib/study-logic';
import { logQuiz } from '@/lib/study-store';

import { Bar, Box, Enter, GREEN, plural } from './shared';

export type Question = { q: string; choices: string[]; answer: number; why?: string };

/** Questions from a set: each card's answer, mixed in with up to three other answers from the same set. */
export function deckQuestions(cards: Pick<Card, 'q' | 'a'>[], most = 10): Question[] {
  const pool = [...new Set(cards.map((c) => c.a.trim()).filter(Boolean))];
  if (pool.length < 3) return [];
  return shuffled(cards).slice(0, most).map((c) => {
    const wrong = shuffled(pool.filter((a) => a.toLowerCase() !== c.a.trim().toLowerCase())).slice(0, 3);
    const choices = shuffled([c.a.trim(), ...wrong]);
    return { q: c.q, choices, answer: choices.indexOf(c.a.trim()) };
  });
}

export function Quiz({ title, questions, onDone, onAnswer, note }: { title: string; questions: Question[]; onDone: () => void; onAnswer?: (i: number, right: boolean) => void; note?: React.ReactNode }) {
  const t = useTheme();
  const [i, setI] = useState(0);
  const [picked, setPicked] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  const [round, setRound] = useState(0);

  if (!questions.length) return <Box><Text style={{ color: t.sub, fontSize: 15 }}>There isn't enough here to make a quiz from yet.</Text></Box>;

  if (i >= questions.length) {
    const pct = Math.round((score / questions.length) * 100);
    return (
      <Enter dy={10}>
        <Box style={{ alignItems: 'center', paddingVertical: 32, gap: 14 }}>
          <Text style={{ color: t.text, fontSize: 44, fontWeight: '800' }}>{score}/{questions.length}</Text>
          <Text style={{ color: t.sub, fontSize: 16 }}>{pct >= 90 ? 'Excellent.' : pct >= 70 ? 'Good work.' : 'Worth another go.'} Saved to your progress.</Text>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Pressable accessibilityLabel="Try again" onPress={() => { setI(0); setScore(0); setPicked(null); setRound((r) => r + 1); }} style={{ height: 46, paddingHorizontal: 22, borderRadius: 12, backgroundColor: t.chip, justifyContent: 'center' }}>
              <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>Try again</Text>
            </Pressable>
            <Pressable accessibilityLabel="Done" onPress={onDone} style={{ height: 46, paddingHorizontal: 28, borderRadius: 12, backgroundColor: t.accent, justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Done</Text>
            </Pressable>
          </View>
        </Box>
      </Enter>
    );
  }

  const q = questions[i];
  const choose = (k: number) => {
    if (picked != null) return;
    setPicked(k);
    const right = k === q.answer;
    if (right) setScore((s) => s + 1);
    onAnswer?.(i, right);
  };
  const next = () => {
    const last = i + 1 >= questions.length;
    if (last) logQuiz(title, score, questions.length);
    setPicked(null);
    setI((x) => x + 1);
  };

  return (
    <View style={{ gap: 14 }}>
      <View style={{ gap: 8 }}>
        <Text style={{ color: t.sub, fontSize: 14, fontVariant: ['tabular-nums'] }}>Question {i + 1} of {questions.length} · {plural(score, 'right', 'right')}</Text>
        <Bar value={i / questions.length} color={t.accent} height={5} />
      </View>
      <Enter key={`${round}-${i}`} dx={30} style={{ gap: 12 }}>
        <Box><Text style={{ color: t.text, fontSize: 21, fontWeight: '600', lineHeight: 28 }}>{q.q}</Text></Box>
        {q.choices.map((c, k) => {
          const isRight = picked != null && k === q.answer;
          const isWrong = picked === k && k !== q.answer;
          const tint = isRight ? GREEN : isWrong ? t.danger : null;
          return (
            <Pressable key={k} accessibilityLabel={c} onPress={() => choose(k)}
              style={({ pressed }) => ({ minHeight: 54, paddingHorizontal: 16, paddingVertical: 12, borderRadius: 14, justifyContent: 'center', borderWidth: 1.5,
                borderColor: tint ?? t.line, backgroundColor: tint ? `${tint}14` : pressed ? t.chip : t.card, opacity: picked != null && !isRight && !isWrong ? 0.55 : 1 })}>
              <Text style={{ color: tint ?? t.text, fontSize: 16, fontWeight: tint ? '700' : '500' }}>{c}</Text>
            </Pressable>
          );
        })}
      </Enter>
      {picked != null ? (
        <Enter dy={8} style={{ gap: 12 }}>
          {q.why ? <Text style={{ color: t.sub, fontSize: 14, lineHeight: 20 }}>{q.why}</Text> : null}
          <Pressable accessibilityLabel="Next question" onPress={next} style={{ height: 50, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: t.accent }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{i + 1 >= questions.length ? 'See score' : 'Next'}</Text>
          </Pressable>
        </Enter>
      ) : null}
      {note}
    </View>
  );
}
