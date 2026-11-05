// Notes with no AI at all, for an iPad that's offline and can't run Apple's model: picks out what
// the teacher stressed and matches it to what's on the page. No imports, so it can be tested alone.

const CUES = /\b(means?|called|defined?|definition|important|remember|key|formula|equals?|because|therefore|so that|note that|first|second|third|finally|step|example|rule|always|never|on the test|quiz|exam|homework|due|write this down|for example)\b/gi;
const STOP = new Set('the a an and or but of to in on at for with this that these those is are was were be been it its as by from we you they he she i so if then there here what which who how why do does did have has had will can could should would not no yes just like okay ok right um uh now going get got one two'.split(' '));

export const wordsOf = (text: string) => (text.toLowerCase().match(/[a-z0-9']+/g) ?? []).filter((w) => w.length > 2 && !STOP.has(w));

const sentences = (text: string) => text.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter(Boolean);

function similar(a: string, b: string) {
  const x = new Set(wordsOf(a)), y = new Set(wordsOf(b));
  if (!x.size || !y.size) return 0;
  let same = 0;
  x.forEach((w) => { if (y.has(w)) same++; });
  return same / Math.min(x.size, y.size);
}

/** The likely notes in what was said, in the order they were said. */
export function basicNotes(said: string, screen: string, previous: string[], most = 3): string[] {
  const onPage = new Set(wordsOf(screen));
  const scored = sentences(said).map((s, i) => {
    const words = wordsOf(s);
    if (words.length < 4 || s.length > 240) return { s, i, score: 0 };
    const cues = (s.match(CUES) ?? []).length;
    const shared = words.filter((w) => onPage.has(w)).length;
    return { s, i, score: cues * 2 + Math.min(3, shared) };
  }).filter((x) => x.score >= 2 && !previous.some((p) => similar(p, x.s) > 0.7));

  const picked: typeof scored = [];
  for (const x of scored.sort((a, b) => b.score - a.score)) {
    if (picked.length >= most) break;
    if (!picked.some((p) => similar(p.s, x.s) > 0.7)) picked.push(x);
  }
  return picked.sort((a, b) => a.i - b.i).map((x) => x.s);
}

/** The line on the page that best matches what's being said, if one clearly does. */
export function matchPage(said: string, screen: string): string | null {
  const heard = new Set(wordsOf(said));
  let best = '', score = 0;
  for (const line of screen.split('\n')) {
    const words = wordsOf(line);
    if (words.length < 2) continue;
    const hits = words.filter((w) => heard.has(w)).length;
    const s = hits >= 2 ? hits / words.length + hits * 0.05 : 0;
    if (s > score) { score = s; best = line.trim(); }
  }
  return score >= 0.4 ? best : null;
}

/** The AI's reply as what's happening now and new notes. Copes with it not following the format exactly. */
export function parseReply(reply: string): { now: string; notes: string[] } {
  const clean = reply.replace(/\*\*/g, '').trim();
  const nowMatch = clean.match(/^\s*NOW:\s*(.+)$/im);
  const split = clean.search(/^\s*NOTES:/im);
  const body = split >= 0 ? clean.slice(split).replace(/^\s*NOTES:\s*/i, '') : clean.replace(/^\s*NOW:.*$/im, '');
  const notes = body.split('\n')
    .map((l) => l.replace(/^\s*(?:[-•*]|\d+[.)])\s*/, '').trim())
    .filter((l) => l && !/^none\.?$/i.test(l) && !/^now:/i.test(l));
  return { now: nowMatch?.[1]?.trim() ?? '', notes };
}
