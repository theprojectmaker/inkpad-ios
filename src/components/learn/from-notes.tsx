// Type or paste notes, then get flashcards, a quiz, a summary or an answer. All of it is worked out
// on the iPad from the words given (lib/offline-study), so it works with no internet at all.
import { useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';

import { useToast } from '@/components/ui';
import { offlineAnswer, offlineCards, offlineQuiz, offlineSummary, termsOf, topSentences } from '@/lib/offline-study';
import { useTheme } from '@/lib/settings';
import { addDeck } from '@/lib/study-store';

import { Quiz } from './quiz';
import { Box, Enter, OfflineNote, plural } from './shared';

type Tool = 'cards' | 'quiz' | 'summary' | 'ask';
const TOOLS: [Tool, string][] = [['cards', 'Flashcards'], ['quiz', 'Quiz'], ['summary', 'Summary'], ['ask', 'Ask']];
const TOO_SHORT = 'Add a few more full sentences or some "term: meaning" lines, then try again.';

/** Just enough Markdown for the summaries: headings, bullets and bold. */
export function Plain({ text }: { text: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      {text.split('\n').map((line, i) => {
        if (!line.trim()) return <View key={i} style={{ height: 4 }} />;
        const h = /^#{1,3}\s+(.*)$/.exec(line);
        if (h) return <Text key={i} style={{ color: t.text, fontSize: 17, fontWeight: '700', marginTop: i ? 8 : 0 }}>{h[1]}</Text>;
        const b = /^\s*[-*]\s+(.*)$/.exec(line);
        const body = (b ? b[1] : line).split(/\*\*(.+?)\*\*/g).map((part, k) => (k % 2 ? <Text key={k} style={{ fontWeight: '700' }}>{part}</Text> : part.replace(/_(.+?)_/g, '$1')));
        return (
          <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
            {b ? <Text style={{ color: t.faint, fontSize: 15, lineHeight: 22 }}>â€¢</Text> : null}
            <Text style={{ flex: 1, color: t.text, fontSize: 15, lineHeight: 22 }}>{body}</Text>
          </View>
        );
      })}
    </View>
  );
}

export function FromNotes() {
  const t = useTheme();
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [tool, setTool] = useState<Tool>('cards');
  const [run, setRun] = useState(0);
  const [question, setQuestion] = useState('');
  const [answer, setAnswer] = useState<string | null>(null);
  const [made, setMade] = useState<{ cards?: { q: string; a: string }[]; quiz?: ReturnType<typeof offlineQuiz>; summary?: string } | null>(null);
  const [saved, setSaved] = useState(false);

  const go = () => {
    const src = text.trim();
    if (!src) { toast('Type or paste some notes first.'); return; }
    setSaved(false);
    setAnswer(null);
    if (tool === 'cards') setMade({ cards: offlineCards(src).cards });
    else if (tool === 'quiz') setMade({ quiz: offlineQuiz(src) });
    else if (tool === 'summary') setMade({ summary: topSentences(src, 1).length || termsOf(src).length ? offlineSummary(src) : '' });
    else { setMade(null); setAnswer(question.trim() ? offlineAnswer(question, src) : 'Type a question first.'); }
    setRun((r) => r + 1);
  };

  const field = { borderRadius: 14, backgroundColor: t.chip, paddingHorizontal: 14, color: t.text, fontSize: 16 } as const;

  return (
    <View style={{ gap: 14 }}>
      <Box>
        <TextInput accessibilityLabel="Your notes" value={text} onChangeText={setText} multiline textAlignVertical="top"
          placeholder={'Paste or type notes here.\n\nTip: lines like "Photosynthesis: how plants make food from light" make the best cards.'}
          placeholderTextColor={t.faint} style={[field, { minHeight: 170, paddingVertical: 12, lineHeight: 22 }]} />
        <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, padding: 3 }}>
          {TOOLS.map(([k, label]) => (
            <Pressable key={k} accessibilityLabel={label} onPress={() => { setTool(k); setMade(null); setAnswer(null); }}
              style={{ flex: 1, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: tool === k ? t.card : 'transparent' }}>
              <Text style={{ color: tool === k ? t.text : t.sub, fontSize: 14, fontWeight: '600' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {tool === 'ask' ? (
          <TextInput accessibilityLabel="Question" value={question} onChangeText={setQuestion} placeholder="What do my notes say about..." placeholderTextColor={t.faint}
            returnKeyType="go" onSubmitEditing={go} style={[field, { height: 46 }]} />
        ) : null}
        <Pressable accessibilityLabel="Make it" onPress={go} style={({ pressed }) => ({ height: 50, borderRadius: 14, backgroundColor: t.accent, alignItems: 'center', justifyContent: 'center', opacity: pressed ? 0.85 : 1 })}>
          <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>{tool === 'ask' ? 'Find the answer' : `Make ${TOOLS.find((x) => x[0] === tool)![1].toLowerCase()}`}</Text>
        </Pressable>
        <OfflineNote text="Works offline: made on this iPad from the words you give it." />
      </Box>

      {made?.cards ? (
        <Enter key={run} dy={10}>
          <Box title={made.cards.length ? plural(made.cards.length, 'card') : 'No cards yet'} right={made.cards.length && !saved ? (
            <Pressable accessibilityLabel="Save as a set" hitSlop={8} onPress={() => {
              const first = text.trim().split('\n')[0].slice(0, 40);
              addDeck(first || 'From my notes', made.cards!);
              setSaved(true);
              toast('Saved. Find it in Flashcards.');
            }}><Text style={{ color: t.accent, fontSize: 15, fontWeight: '700' }}>Save as a set</Text></Pressable>
          ) : saved ? <Text style={{ color: t.sub, fontSize: 14 }}>Saved</Text> : null}>
            {made.cards.length ? made.cards.map((c, i) => (
              <View key={i} style={{ paddingVertical: 8, borderTopWidth: i ? 1 : 0, borderTopColor: t.line, gap: 2 }}>
                <Text style={{ color: t.text, fontSize: 15, fontWeight: '600' }}>{c.q}</Text>
                <Text style={{ color: t.sub, fontSize: 15 }}>{c.a}</Text>
              </View>
            )) : <Text style={{ color: t.sub, fontSize: 15 }}>{TOO_SHORT}</Text>}
          </Box>
        </Enter>
      ) : null}

      {made?.quiz ? (
        <Enter key={run} dy={10}>
          {made.quiz.questions.length
            ? <Quiz title="Quiz from my notes" questions={made.quiz.questions} onDone={() => setMade(null)} />
            : <Box><Text style={{ color: t.sub, fontSize: 15 }}>{TOO_SHORT}</Text></Box>}
        </Enter>
      ) : null}

      {made?.summary != null ? (
        <Enter key={run} dy={10}>
          <Box>{made.summary ? <Plain text={made.summary} /> : <Text style={{ color: t.sub, fontSize: 15 }}>{TOO_SHORT}</Text>}</Box>
        </Enter>
      ) : null}

      {answer ? (
        <Enter key={run} dy={10}>
          <Box><Plain text={answer} /></Box>
        </Enter>
      ) : null}
    </View>
  );
}
