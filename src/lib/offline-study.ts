// Study help with no AI at all: for an iPad that's offline and can't run Apple's model. It works
// only from the text read off the page, so it can't invent anything, and it says when a job really
// needs an AI. No imports, so it can be tested alone.

const STOP = new Set('the a an and or but of to in on at for with this that these those is are was were be been it its as by from we you they he she i so if then there here what which who how why do does did have has had will can could should would not no yes just like very also into than them their our your my'.split(' '));
const IMPORTANT = /\b(means?|called|defined?|definition|important|key|formula|equals?|because|therefore|causes?|results? in|remember|always|never|first|second|finally|step|example)\b/i;

const words = (s: string) => (s.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []).filter((w) => w.length > 2 && !STOP.has(w));

/** Page text as tidy sentences. Lines that run on without punctuation are joined. */
export function sentencesOf(text: string): string[] {
  const out: string[] = [];
  let cur = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[\s\-•*·]+/, '').trim();
    if (!line) { if (cur) { out.push(cur); cur = ''; } continue; }
    cur = cur ? `${cur} ${line}` : line;
    if (/[.!?:]$/.test(line) || line.length < 45) { out.push(cur); cur = ''; }
  }
  if (cur) out.push(cur);
  return out.flatMap((s) => s.split(/(?<=[.!?])\s+/)).map((s) => s.trim()).filter((s) => s.length > 2);
}

function frequency(sents: string[]) {
  const freq: Record<string, number> = {};
  for (const s of sents) for (const w of new Set(words(s))) freq[w] = (freq[w] ?? 0) + 1;
  return freq;
}

/** The sentences that carry the most, kept in the order they were written. */
export function topSentences(text: string, most: number): string[] {
  const sents = sentencesOf(text).filter((s) => words(s).length >= 3);
  const freq = frequency(sents);
  const score = (s: string) => {
    const w = words(s);
    return w.reduce((n, x) => n + (freq[x] ?? 0), 0) / Math.max(4, w.length) + (IMPORTANT.test(s) ? 2 : 0);
  };
  const picked = sents.map((s, i) => ({ s, i, v: score(s) })).sort((a, b) => b.v - a.v).slice(0, most).sort((a, b) => a.i - b.i);
  return picked.map((x) => x.s);
}

export type Term = { term: string; meaning: string };

/** Things written as definitions: "mitochondria - makes energy", "Slope: rise over run", "Slope is defined as...". */
export function termsOf(text: string): Term[] {
  const out: Term[] = [];
  const add = (term: string, meaning: string) => {
    const t = term.trim().replace(/^(the|a|an)\s+/i, ''), m = meaning.trim().replace(/[.]+$/, '');
    if (t.length < 2 || t.split(/\s+/).length > 5 || m.split(/\s+/).length < 2 || m.length > 200) return;
    if (!out.some((x) => x.term.toLowerCase() === t.toLowerCase())) out.push({ term: t, meaning: m });
  };
  for (const s of sentencesOf(text)) {
    let m = /^(.{2,40}?)\s*(?:[:=–—]|\s-\s)\s*(.+)$/.exec(s);
    if (m) { add(m[1], m[2]); continue; }
    m = /^(.{2,40}?)\s+(?:is|are)\s+(?:defined as|called|known as)\s+(.+)$/i.exec(s);
    if (m) { add(m[1], m[2]); continue; }
    m = /^(.{2,40}?)\s+(?:means|refers to)\s+(.+)$/i.exec(s);
    if (m) { add(m[1], m[2]); continue; }
    m = /^((?:the |a |an )?[\p{L}'-]+(?: [\p{L}'-]+)?)\s+(is|are)\s+(.+)$/iu.exec(s);
    if (m && !/^(it|this|that|these|those|there|he|she|they|we|you|i)$/i.test(m[1])) add(m[1], `${m[2]} ${m[3]}`);
  }
  return out;
}

const hash = (s: string) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; };

/** A sentence with its most telling word taken out. */
function cloze(s: string, freq: Record<string, number>) {
  const tokens = [...new Set(s.match(/[\p{L}\p{N}'-]{4,}/gu) ?? [])].filter((w) => !STOP.has(w.toLowerCase()));
  if (!tokens.length) return null;
  const word = [...tokens].sort((a, b) => (freq[a.toLowerCase()] ?? 0) - (freq[b.toLowerCase()] ?? 0) || b.length - a.length)[0];
  return { text: s.replace(word, '_____'), word };
}

export function offlineCards(text: string) {
  const terms = termsOf(text);
  const cards = terms.map((t) => ({ q: t.term, a: t.meaning }));
  const freq = frequency(sentencesOf(text));
  for (const s of topSentences(text, 12)) {
    if (cards.length >= 12) break;
    if (terms.some((t) => s.includes(t.meaning))) continue;
    const c = cloze(s, freq);
    if (c) cards.push({ q: c.text, a: c.word });
  }
  return { title: 'From my notes', cards: cards.slice(0, 12) };
}

export function offlineQuiz(text: string) {
  const sents = sentencesOf(text);
  const freq = frequency(sents);
  const pool = [...new Set(sents.flatMap((s) => s.match(/[\p{L}\p{N}'-]{4,}/gu) ?? []))].filter((w) => !STOP.has(w.toLowerCase()));
  const questions: { q: string; choices: string[]; answer: number; why: string }[] = [];
  for (const s of topSentences(text, 10)) {
    const c = cloze(s, freq);
    if (!c) continue;
    const wrong = pool.filter((w) => w.toLowerCase() !== c.word.toLowerCase() && !s.includes(w)).sort((a, b) => hash(a + s) - hash(b + s)).slice(0, 3);
    if (wrong.length < 2) continue;
    const answer = hash(s) % (wrong.length + 1);
    const choices = [...wrong];
    choices.splice(answer, 0, c.word);
    questions.push({ q: c.text, choices, answer, why: `From your notes: ${s}` });
    if (questions.length >= 6) break;
  }
  return { title: 'From my notes', questions };
}

export function offlineSummary(text: string) {
  const key = topSentences(text, 6), terms = termsOf(text).slice(0, 8);
  return ['## Key ideas', ...key.map((s) => `- ${s}`), ...(terms.length ? ['', '## Important terms', ...terms.map((t) => `- **${t.term}**: ${t.meaning}`)] : [])].join('\n');
}

export function offlineAnswer(question: string, text: string) {
  const want = new Set(words(question));
  const hits = sentencesOf(text).map((s) => ({ s, n: words(s).filter((w) => want.has(w)).length })).filter((x) => x.n > 0).sort((a, b) => b.n - a.n).slice(0, 3);
  if (!hits.length) return "I couldn't find that in your notes on this page.";
  return ['Here\'s what your notes say about that:', ...hits.map((x) => `- ${x.s}`)].join('\n');
}

const NEEDS_AI = "This one needs an AI to think it through, and there's no internet right now and no offline AI on this iPad. It'll work once you're online.";

/** The study tools that can be done by rules; the rest say so rather than make something up. */
export function offlineAction(id: string, text: string): string {
  const terms = termsOf(text);
  const freq = frequency(sentencesOf(text));
  switch (id) {
    case 'sentences': return topSentences(text, 3).join(' ');
    case 'simple': case 'cheat': return offlineSummary(text);
    case 'outline': return sentencesOf(text).map((s) => (s.length < 45 && !/[.!?]$/.test(s) ? `\n## ${s.replace(/:$/, '')}` : `- ${s}`)).join('\n').trim();
    case 'glossary': return terms.length ? terms.map((t) => `- **${t.term}**: ${t.meaning}`).join('\n') : "I couldn't find any definitions written on this page.";
    case 'blanks': case 'test': case 'short': {
      const made = topSentences(text, 8).map((s) => ({ s, c: cloze(s, freq) })).filter((x) => x.c);
      return [...made.map((x, i) => `${i + 1}. ${x.c!.text}`), '', '## Answers', ...made.map((x, i) => `${i + 1}. ${x.c!.word}`)].join('\n');
    }
    case 'truefalse': {
      if (terms.length < 2) return "There aren't enough definitions on this page to make true or false questions from.";
      const list = terms.slice(0, 10);
      const made = list.map((t, i) => {
        const lie = hash(t.term) % 2 === 0;
        return { text: `${t.term}: ${lie ? list[(i + 1) % list.length].meaning : t.meaning}`, truth: lie ? `False. ${t.term}: ${t.meaning}` : 'True' };
      });
      return [...made.map((x, i) => `${i + 1}. ${x.text}`), '', '## Answers', ...made.map((x, i) => `${i + 1}. ${x.truth}`)].join('\n');
    }
    case 'mnemonic': {
      if (terms.length < 2) return "I couldn't find a list of terms on this page to make a memory trick from.";
      const list = terms.slice(0, 8);
      return `First letters: **${list.map((t) => t.term[0].toUpperCase()).join('')}**\n\n${list.map((t) => `- **${t.term[0].toUpperCase()}** is for ${t.term}`).join('\n')}`;
    }
    case 'plan': {
      const key = topSentences(text, 8);
      const half = Math.ceil(key.length / 2);
      return `**Day 1:** read these and say them in your own words:\n${key.slice(0, half).map((s) => `- ${s}`).join('\n')}\n\n**Day 2:** the same with these:\n${key.slice(half).map((s) => `- ${s}`).join('\n')}\n\n**Day 3:** make flashcards from this page and go through them.\n\n**Day 4:** take the quiz, then go back over what you missed.`;
    }
    case 'timeline': return sentencesOf(text).filter((s) => /\b(first|then|next|finally|after|before|step|\d{4})\b/i.test(s)).map((s, i) => `${i + 1}. ${s}`).join('\n') || 'I couldn\'t find any steps or dates on this page.';
    case 'cause': return sentencesOf(text).filter((s) => /\b(because|causes?|results? in|leads? to|so that|therefore)\b/i.test(s)).map((s) => `- ${s}`).join('\n') || "I couldn't find any causes and effects written on this page.";
    default: return NEEDS_AI;
  }
}
