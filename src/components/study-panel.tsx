// AI Study: a panel beside the note. The AI reads the page you are on (or
// the whole note) and makes a summary, flashcards, a practice quiz, simple
// explanations, or answers your questions. Results are saved with the note.
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { Markdown } from '@/components/markdown';
import type { CanvasHandle } from '@/components/quill-canvas';
import { Icon } from '@/components/ui';
import { askStudy, type Flashcard, type QuizQ } from '@/lib/ai';
import { fsx } from '@/lib/fsx';
import { notePath, renderDir } from '@/lib/noteio';
import { type OcrLine, readText } from '@/lib/ondevice';
import { useTheme } from '@/lib/settings';

type Tab = 'summary' | 'cards' | 'quiz' | 'explain' | 'help' | 'ask';
type Scope = 'page' | 'note';
type Saved = { summary?: string; explain?: string; cards?: Flashcard[]; quiz?: QuizQ[]; title?: string };
type Msg = { role: 'user' | 'assistant'; text: string; err?: boolean };

const TABS: { id: Tab; label: string }[] = [
  { id: 'summary', label: 'Summary' },
  { id: 'cards', label: 'Flashcards' },
  { id: 'quiz', label: 'Quiz' },
  { id: 'explain', label: 'Explain' },
  { id: 'help', label: 'Question help' },
  { id: 'ask', label: 'Ask' },
];
const MAX_PAGES = 6;

export function StudyPanel({ noteId, page, pageCount, canvas, absPath, onClose }: {
  noteId: string; page: number; pageCount: number; canvas: React.RefObject<CanvasHandle | null>;
  absPath: (p: string) => string; onClose: () => void;
}) {
  const t = useTheme();
  const [tab, setTab] = useState<Tab>('summary');
  const [scope, setScope] = useState<Scope>(pageCount > 1 ? 'page' : 'note');
  const [saved, setSaved] = useState<Saved>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [chat, setChat] = useState<Msg[]>([]);       // kept here so switching tabs doesn't erase it
  const savePath = notePath(noteId, 'study.json');

  useEffect(() => {
    fsx.readText(savePath).then((s) => { if (s) try { setSaved(JSON.parse(s)); } catch {} });
  }, [savePath]);
  const keep = (patch: Saved) => setSaved((cur) => { const n = { ...cur, ...patch }; fsx.writeText(savePath, JSON.stringify(n)); return n; });

  // Pictures of the pages to read (this page, or the first pages of the note).
  const pageImages = async () => {
    const idx = scope === 'page' ? [page] : Array.from({ length: Math.min(MAX_PAGES, pageCount) }, (_, i) => i);
    const out: string[] = [];
    for (const i of idx) {
      const rel = `${renderDir(noteId)}/study_${i}.jpg`;
      const ok = await canvas.current?.pageThumb(i, absPath(rel), 1100);
      if (ok) out.push(fsx.uri(rel));
    }
    if (!out.length) throw new Error("Couldn't read the page.");
    return out;
  };

  const run = async (what: 'summary' | 'explain' | 'flashcards' | 'quiz') => {
    setBusy(true); setErr('');
    try {
      const imgs = await pageImages();
      const r = await askStudy(what, imgs);
      if (what === 'summary') keep({ summary: r.text });
      else if (what === 'explain') keep({ explain: r.text });
      else if (what === 'flashcards') keep({ cards: (r.data?.cards ?? []).filter((c: Flashcard) => c?.q && c?.a), title: r.data?.title });
      else keep({ quiz: (r.data?.questions ?? []).filter((q: QuizQ) => q?.q && Array.isArray(q.choices) && q.choices.length >= 2), title: r.data?.title });
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(false); }
  };

  const scopeLabel = scope === 'page' ? `page ${page + 1}` : pageCount > MAX_PAGES ? `the first ${MAX_PAGES} pages` : 'the whole note';

  const MakeButton = ({ label, onPress }: { label: string; onPress: () => void }) => (
    <View style={{ alignItems: 'center', paddingVertical: 40, gap: 12 }}>
      <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: t.accent + '1A', alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="sparkles" size={24} color={t.accent} />
      </View>
      <Text style={{ color: t.sub, fontSize: 14, textAlign: 'center', paddingHorizontal: 20 }}>Quill's AI reads {scopeLabel} — handwriting too.</Text>
      <Pressable onPress={onPress} disabled={busy} style={({ pressed }) => ({ height: 42, paddingHorizontal: 20, borderRadius: 21, backgroundColor: t.accent, justifyContent: 'center', opacity: pressed || busy ? 0.7 : 1 })}>
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{label}</Text>
      </Pressable>
    </View>
  );
  const Redo = ({ onPress }: { onPress: () => void }) => (
    <Pressable onPress={onPress} disabled={busy} style={{ alignSelf: 'center', marginTop: 18, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: t.chip }}>
      <Icon name="arrow.clockwise" size={14} color={t.sub} />
      <Text style={{ color: t.sub, fontSize: 13, fontWeight: '600' }}>Make again from {scopeLabel}</Text>
    </Pressable>
  );

  let body: React.ReactNode;
  if (busy) {
    body = (
      <View style={{ alignItems: 'center', paddingVertical: 60, gap: 14 }}>
        <ActivityIndicator color={t.accent} />
        <Text style={{ color: t.sub, fontSize: 14 }}>Reading {scopeLabel}…</Text>
      </View>
    );
  } else if (tab === 'summary') {
    body = saved.summary ? <><Markdown text={saved.summary} /><Redo onPress={() => run('summary')} /></> : <MakeButton label="Write a summary" onPress={() => run('summary')} />;
  } else if (tab === 'explain') {
    body = saved.explain ? <><Markdown text={saved.explain} /><Redo onPress={() => run('explain')} /></> : <MakeButton label="Explain the hard parts" onPress={() => run('explain')} />;
  } else if (tab === 'cards') {
    body = saved.cards?.length ? <><Cards cards={saved.cards} /><Redo onPress={() => run('flashcards')} /></> : <MakeButton label="Make flashcards" onPress={() => run('flashcards')} />;
  } else if (tab === 'help') {
    body = <Helper pages={pageImages} scopeLabel={scopeLabel} />;
  } else if (tab === 'quiz') {
    body = saved.quiz?.length ? <><Quiz questions={saved.quiz} /><Redo onPress={() => run('quiz')} /></> : <MakeButton label="Quiz me" onPress={() => run('quiz')} />;
  } else {
    body = <Ask pageImages={pageImages} scopeLabel={scopeLabel} msgs={chat} setMsgs={setChat} />;
  }

  return (
    <View style={{ width: 380, backgroundColor: t.bg, borderLeftWidth: 1, borderLeftColor: t.line }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8 }}>
        <Icon name="sparkles" size={18} color={t.accent} />
        <Text style={{ flex: 1, marginLeft: 8, color: t.text, fontSize: 18, fontWeight: '800' }}>Study</Text>
        {pageCount > 1 ? (
          <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 9, padding: 2, marginRight: 8 }}>
            {(['page', 'note'] as Scope[]).map((s) => (
              <Pressable key={s} onPress={() => setScope(s)} style={{ paddingHorizontal: 10, height: 26, borderRadius: 7, justifyContent: 'center', backgroundColor: scope === s ? t.elev : 'transparent' }}>
                <Text style={{ color: scope === s ? t.text : t.sub, fontSize: 12, fontWeight: '600' }}>{s === 'page' ? 'This page' : 'Whole note'}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
        <Pressable onPress={onClose} accessibilityLabel="Close study" style={{ width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}>
          <Icon name="xmark" size={13} color={t.sub} />
        </Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, flexShrink: 0 }} contentContainerStyle={{ paddingHorizontal: 12, gap: 6, paddingBottom: 10 }}>
        {TABS.map((x) => (
          <Pressable key={x.id} onPress={() => setTab(x.id)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 16, justifyContent: 'center', backgroundColor: tab === x.id ? t.text : t.chip }}>
            <Text style={{ color: tab === x.id ? t.bg : t.text, fontSize: 13, fontWeight: '600' }}>{x.label}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {tab === 'ask' && !busy ? <View style={{ flex: 1 }}>{body}</View> : (
        <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 40 }}>
          {err ? <Text style={{ color: t.danger, fontSize: 14, marginBottom: 10 }}>{err}</Text> : null}
          {body}
        </ScrollView>
      )}
    </View>
  );
}

function Cards({ cards }: { cards: Flashcard[] }) {
  const t = useTheme();
  const [order, setOrder] = useState(() => cards.map((_, i) => i));
  const [i, setI] = useState(0);
  const [flip, setFlip] = useState(false);
  useEffect(() => { setOrder(cards.map((_, k) => k)); setI(0); setFlip(false); }, [cards]);
  const c = cards[order[i]] ?? cards[0];
  const go = (d: number) => { setI((x) => (x + d + cards.length) % cards.length); setFlip(false); };
  return (
    <View style={{ gap: 14 }}>
      <Pressable onPress={() => setFlip((v) => !v)} style={{ minHeight: 210, borderRadius: 18, padding: 22, justifyContent: 'center', backgroundColor: flip ? t.accent : t.elev,
        shadowColor: '#000', shadowOpacity: 0.1, shadowRadius: 12, shadowOffset: { width: 0, height: 4 }, borderWidth: t.dark ? 1 : 0, borderColor: t.line }}>
        <Text style={{ color: flip ? '#ffffffb0' : t.faint, fontSize: 12, fontWeight: '700', letterSpacing: 0.8, marginBottom: 10 }}>{flip ? 'ANSWER' : 'QUESTION'}</Text>
        <Text style={{ color: flip ? '#fff' : t.text, fontSize: 19, fontWeight: '600', lineHeight: 26 }}>{flip ? c.a : c.q}</Text>
        <Text style={{ position: 'absolute', bottom: 12, right: 16, color: flip ? '#ffffff90' : t.faint, fontSize: 12 }}>Tap to flip</Text>
      </Pressable>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable onPress={() => go(-1)} style={{ width: 44, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}><Icon name="chevron.left" size={16} color={t.text} /></Pressable>
        <Text style={{ color: t.sub, fontSize: 14, fontWeight: '600' }}>{i + 1} / {cards.length}</Text>
        <Pressable onPress={() => go(1)} style={{ width: 44, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chip }}><Icon name="chevron.right" size={16} color={t.text} /></Pressable>
      </View>
      <Pressable onPress={() => { setOrder((o) => [...o].sort(() => Math.random() - 0.5)); setI(0); setFlip(false); }} style={{ alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, height: 32, paddingHorizontal: 12 }}>
        <Icon name="shuffle" size={14} color={t.accent} />
        <Text style={{ color: t.accent, fontSize: 13, fontWeight: '600' }}>Shuffle</Text>
      </Pressable>
    </View>
  );
}

function Quiz({ questions }: { questions: QuizQ[] }) {
  const t = useTheme();
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<number | null>(null);
  const [score, setScore] = useState(0);
  useEffect(() => { setI(0); setPick(null); setScore(0); }, [questions]);
  if (i >= questions.length) {
    return (
      <View style={{ alignItems: 'center', paddingVertical: 30, gap: 10 }}>
        <Text style={{ color: t.text, fontSize: 34, fontWeight: '800' }}>{score} / {questions.length}</Text>
        <Text style={{ color: t.sub, fontSize: 15 }}>{score === questions.length ? 'Perfect!' : score >= questions.length * 0.7 ? 'Nice work.' : 'Keep going — try it again.'}</Text>
        <Pressable onPress={() => { setI(0); setPick(null); setScore(0); }} style={{ marginTop: 8, height: 40, paddingHorizontal: 18, borderRadius: 20, backgroundColor: t.accent, justifyContent: 'center' }}>
          <Text style={{ color: '#fff', fontWeight: '700' }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
  const q = questions[i];
  const ans = Math.max(0, Math.min(q.choices.length - 1, Number(q.answer) || 0));
  return (
    <View style={{ gap: 10 }}>
      <Text style={{ color: t.faint, fontSize: 12, fontWeight: '700', letterSpacing: 0.8 }}>QUESTION {i + 1} OF {questions.length}</Text>
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', lineHeight: 24, marginBottom: 4 }}>{q.q}</Text>
      {q.choices.map((c, k) => {
        const chosen = pick === k, right = pick != null && k === ans, wrong = chosen && k !== ans;
        return (
          <Pressable key={k} disabled={pick != null} onPress={() => { setPick(k); if (k === ans) setScore((s) => s + 1); }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1.5,
              borderColor: right ? '#16A34A' : wrong ? t.danger : t.line, backgroundColor: right ? '#16A34A14' : wrong ? t.danger + '14' : t.elev }}>
            <Text style={{ color: t.faint, fontWeight: '700', width: 18 }}>{'ABCD'[k] ?? k + 1}</Text>
            <Text style={{ flex: 1, color: t.text, fontSize: 15 }}>{c}</Text>
            {right ? <Icon name="checkmark" size={15} color="#16A34A" /> : wrong ? <Icon name="xmark" size={13} color={t.danger} /> : null}
          </Pressable>
        );
      })}
      {pick != null ? (
        <>
          {q.why ? <Text style={{ color: t.sub, fontSize: 14, lineHeight: 20, marginTop: 4 }}>{q.why}</Text> : null}
          <Pressable onPress={() => { setI((x) => x + 1); setPick(null); }} style={{ alignSelf: 'flex-end', marginTop: 6, height: 38, paddingHorizontal: 18, borderRadius: 19, backgroundColor: t.accent, justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{i + 1 < questions.length ? 'Next' : 'See score'}</Text>
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

function Ask({ pageImages, scopeLabel, msgs, setMsgs }: { pageImages: () => Promise<string[]>; scopeLabel: string; msgs: Msg[]; setMsgs: React.Dispatch<React.SetStateAction<Msg[]>> }) {
  const t = useTheme();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const send = async () => {
    const question = q.trim();
    if (!question || busy) return;
    setQ('');
    const history = msgs.filter((m) => !m.err);   // errors aren't part of the conversation
    setMsgs((m) => [...m, { role: 'user', text: question }]);
    setBusy(true);
    try {
      const r = await askStudy('ask', await pageImages(), { question, history });
      setMsgs((m) => [...m, { role: 'assistant', text: r.text || '…' }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'assistant', text: String((e as Error)?.message ?? e), err: true }]);
    } finally { setBusy(false); setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 50); }
  };
  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} contentContainerStyle={{ padding: 16, gap: 10 }}>
        {!msgs.length ? <Text style={{ color: t.sub, fontSize: 14, lineHeight: 20 }}>Ask anything about {scopeLabel} — "what does this mean?", "give me an example", "what will be on the test?"</Text> : null}
        {msgs.map((m, i) => (
          <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%', padding: 11, borderRadius: 14, backgroundColor: m.role === 'user' ? t.accent : t.elev, borderWidth: m.role === 'user' ? 0 : 1, borderColor: t.line }}>
            {m.role === 'user' ? <Text style={{ color: '#fff', fontSize: 15 }}>{m.text}</Text> : <Markdown text={m.text} />}
          </View>
        ))}
        {busy ? <ActivityIndicator color={t.accent} style={{ alignSelf: 'flex-start', marginLeft: 8 }} /> : null}
      </ScrollView>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: t.line }}>
        <TextInput value={q} onChangeText={setQ} onSubmitEditing={send} placeholder="Ask about your notes…" placeholderTextColor={t.faint} returnKeyType="send"
          style={{ flex: 1, height: 40, paddingHorizontal: 12, borderRadius: 20, backgroundColor: t.chip, color: t.text, fontSize: 15 }} />
        <Pressable onPress={send} disabled={!q.trim() || busy} accessibilityLabel="Send" style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: q.trim() && !busy ? t.accent : t.chip }}>
          <Icon name="arrow.up" size={16} color={q.trim() && !busy ? '#fff' : t.faint} />
        </Pressable>
      </View>
    </View>
  );
}

/** The questions on a page: numbered items (1. 2) a. Q3) and lines ending in "?", with their next lines. */
function findQuestions(lines: OcrLine[]): string[] {
  const start = /^(\(?\d{1,2}[.)]|\(?[a-hA-H][.)]|Q\d+[.:)]?)\s+/;
  const out: string[] = [];
  let cur: { text: string; bottom: number; h: number } | null = null;
  for (const l of lines) {
    const t = l.text.trim();
    if (!t) continue;
    if (start.test(t) || (/\?\s*$/.test(t) && !cur)) {
      if (cur) out.push(cur.text);
      cur = { text: t, bottom: l.y + l.h, h: l.h };
    } else if (cur && l.y - cur.bottom < cur.h * 1.2 && !/^_+$/.test(t)) {
      cur.text += ' ' + t; cur.bottom = l.y + l.h;       // the question goes on to the next line
    } else if (cur) { out.push(cur.text); cur = null; }
  }
  if (cur) out.push(cur.text);
  return out.filter((q) => q.replace(start, '').length > 6).slice(0, 30);
}

/**
 * Question helper: finds the questions on the page, and for the one you pick
 * gives hints and the steps to solve it (the answer only when you ask for it).
 */
function Helper({ pages, scopeLabel }: { pages: () => Promise<string[]>; scopeLabel: string }) {
  const t = useTheme();
  const [qs, setQs] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [help, setHelp] = useState('');
  const [answer, setAnswer] = useState('');
  const [busy, setBusy] = useState<'find' | 'help' | 'answer' | null>(null);
  const [err, setErr] = useState('');

  const find = async () => {
    setBusy('find'); setErr('');
    try {
      const found: string[] = [];
      for (const u of await pages()) found.push(...findQuestions(await readText(u)));
      setQs(found);
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(null); }
  };
  const ask = async (q: string, final: boolean) => {
    setBusy(final ? 'answer' : 'help'); setErr('');
    try {
      const question = final
        ? `Now give the final answer to this question, with one line saying how you got it: "${q}"`
        : `Help me with this question from my page: "${q}". Explain what it's asking, then give numbered steps and hints to solve it myself. Don't give the final answer yet.`;
      const r = await askStudy('ask', await pages(), { question });
      if (final) setAnswer(r.text || ''); else { setHelp(r.text || ''); setAnswer(''); }
    } catch (e) { setErr(String((e as Error)?.message ?? e)); }
    finally { setBusy(null); }
  };
  const choose = (q: string) => { setPick(q); setHelp(''); setAnswer(''); ask(q, false); };

  if (pick) {
    return (
      <View style={{ gap: 12 }}>
        <Pressable onPress={() => { setPick(null); setHelp(''); setAnswer(''); }} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
          <Icon name="chevron.left" size={13} color={t.accent} />
          <Text style={{ color: t.accent, fontSize: 14, fontWeight: '600' }}>All questions</Text>
        </Pressable>
        <View style={{ padding: 14, borderRadius: 14, backgroundColor: t.elev, borderWidth: 1, borderColor: t.line }}>
          <Text style={{ color: t.text, fontSize: 16, fontWeight: '600', lineHeight: 22 }}>{pick}</Text>
        </View>
        {err ? <Text style={{ color: t.danger, fontSize: 14 }}>{err}</Text> : null}
        {busy === 'help' ? <ActivityIndicator color={t.accent} style={{ marginTop: 20 }} /> : help ? <Markdown text={help} /> : null}
        {help && !answer ? (
          <Pressable onPress={() => ask(pick, true)} disabled={!!busy} style={{ alignSelf: 'flex-start', height: 38, paddingHorizontal: 16, borderRadius: 19, backgroundColor: t.chip, justifyContent: 'center', opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: t.text, fontSize: 14, fontWeight: '700' }}>{busy === 'answer' ? 'Checking…' : 'Show the answer'}</Text>
          </Pressable>
        ) : null}
        {answer ? (
          <View style={{ padding: 14, borderRadius: 14, backgroundColor: '#16A34A14', borderWidth: 1, borderColor: '#16A34A55' }}>
            <Text style={{ color: '#16A34A', fontSize: 12, fontWeight: '800', letterSpacing: 0.6, marginBottom: 6 }}>ANSWER</Text>
            <Markdown text={answer} />
          </View>
        ) : null}
      </View>
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: t.sub, fontSize: 14, lineHeight: 20 }}>Stuck on a question? Pick it and Quill walks you through it step by step. You see the answer only when you want it.</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput value={typed} onChangeText={setTyped} placeholder="Type a question…" placeholderTextColor={t.faint} returnKeyType="go"
          onSubmitEditing={() => typed.trim() && choose(typed.trim())}
          style={{ flex: 1, height: 40, paddingHorizontal: 12, borderRadius: 20, backgroundColor: t.chip, color: t.text, fontSize: 15 }} />
        <Pressable onPress={() => typed.trim() && choose(typed.trim())} accessibilityLabel="Help with this" style={{ width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: typed.trim() ? t.accent : t.chip }}>
          <Icon name="arrow.up" size={16} color={typed.trim() ? '#fff' : t.faint} />
        </Pressable>
      </View>
      <Pressable onPress={find} disabled={!!busy} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, height: 44, borderRadius: 22, backgroundColor: t.accent, opacity: pressed || busy ? 0.75 : 1 })}>
        {busy === 'find' ? <ActivityIndicator color="#fff" /> : <Icon name="text.viewfinder" size={16} color="#fff" />}
        <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{qs ? 'Look again' : `Find the questions on ${scopeLabel}`}</Text>
      </Pressable>
      {err ? <Text style={{ color: t.danger, fontSize: 14 }}>{err}</Text> : null}
      {qs && !qs.length ? <Text style={{ color: t.sub, fontSize: 14 }}>No numbered questions found. Type the question above instead.</Text> : null}
      {qs?.map((q, i) => (
        <Pressable key={i} onPress={() => choose(q)} style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: t.line, backgroundColor: pressed ? t.chip : t.elev })}>
          <Text numberOfLines={3} style={{ flex: 1, color: t.text, fontSize: 15, lineHeight: 21 }}>{q}</Text>
          <Icon name="chevron.right" size={13} color={t.faint} />
        </Pressable>
      ))}
    </View>
  );
}
