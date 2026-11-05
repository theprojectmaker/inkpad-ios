// More ways to study a page: each is a request to the AI, online or on the iPad. All of them work
// only from what's on the student's page, and none of them make up facts.

export type StudyAction = { id: string; label: string; icon: string; group: string; ask: string };

const G = { learn: 'Understand it', practice: 'Practice it', memory: 'Remember it', work: 'Check your work', write: 'Write about it', language: 'Hebrew' };

export const STUDY_ACTIONS: StudyAction[] = [
  { id: 'simple', group: G.learn, icon: 'lightbulb', label: 'Explain it simply', ask: 'Explain these notes as if I were 12, in plain everyday words, with one small example for each idea.' },
  { id: 'sentences', group: G.learn, icon: 'text.alignleft', label: 'Three sentence summary', ask: 'Sum up these notes in exactly three clear sentences.' },
  { id: 'outline', group: G.learn, icon: 'list.bullet.indent', label: 'Make an outline', ask: 'Turn these notes into a tidy outline with main headings and short sub-points.' },
  { id: 'glossary', group: G.learn, icon: 'character.book.closed', label: 'Key terms', ask: 'List every key term in these notes with a one-line meaning for each.' },
  { id: 'real', group: G.learn, icon: 'globe.americas', label: 'Real-life examples', ask: 'Give one real-life example for each main idea in these notes, so I can see why it matters.' },
  { id: 'compare', group: G.learn, icon: 'arrow.left.arrow.right', label: 'Compare the ideas', ask: 'Find the ideas in these notes that are easy to mix up, and explain how each pair is alike and different. Use a short list for each pair.' },
  { id: 'timeline', group: G.learn, icon: 'calendar', label: 'Put it in order', ask: 'Put the events or steps in these notes in order, as a numbered list. If nothing here has an order, say so.' },
  { id: 'cause', group: G.learn, icon: 'arrow.triangle.branch', label: 'Causes and effects', ask: 'List the causes and effects in these notes, each as "cause → effect". If there are none, say so.' },
  { id: 'gaps', group: G.learn, icon: 'questionmark.circle', label: 'What am I missing?', ask: 'Looking at these notes, what topics seem incomplete or unclear? List what I should go back and fill in. Do not invent facts; only point at the gaps.' },

  { id: 'test', group: G.practice, icon: 'checklist', label: 'Likely test questions', ask: 'Write the 8 questions most likely to be on a test about these notes. Put the answers in a separate list at the end, under "Answers".' },
  { id: 'blanks', group: G.practice, icon: 'square.and.pencil', label: 'Fill in the blanks', ask: 'Write 8 fill-in-the-blank sentences from these notes with _____ for the missing word. Put the answers in a separate list at the end, under "Answers".' },
  { id: 'truefalse', group: G.practice, icon: 'checkmark.circle', label: 'True or false', ask: 'Write 10 true-or-false statements from these notes. Put the answers, with a short reason for each false one, in a separate list at the end, under "Answers".' },
  { id: 'short', group: G.practice, icon: 'pencil.line', label: 'Short answer practice', ask: 'Write 6 short-answer questions from these notes. Put model answers in a separate list at the end, under "Answers".' },
  { id: 'harder', group: G.practice, icon: 'flame', label: 'Harder practice problems', ask: 'Write 5 practice problems like the ones in these notes but a little harder. Put full worked solutions in a separate list at the end, under "Solutions".' },
  { id: 'teach', group: G.practice, icon: 'person.wave.2', label: 'Quiz me out loud', ask: 'Write 6 "explain it in your own words" prompts from these notes that I could answer out loud, each with a checklist of what a good answer should include.' },

  { id: 'mnemonic', group: G.memory, icon: 'brain', label: 'Memory tricks', ask: 'Make memory tricks for the hardest things to remember in these notes: acronyms, rhymes or pictures in the mind.' },
  { id: 'cheat', group: G.memory, icon: 'doc.text', label: 'One page review sheet', ask: 'Make a compact one-page review sheet of these notes: key facts, formulas and definitions, as short as possible.' },
  { id: 'plan', group: G.memory, icon: 'calendar.badge.clock', label: 'Study plan', ask: 'Make a simple study plan for learning these notes over the next 4 days, about 20 minutes a day, saying exactly what to do each day.' },

  { id: 'check', group: G.work, icon: 'checkmark.seal', label: 'Check my work', ask: 'Check my work on this page. Point out each mistake and which line it is on, and explain why it is wrong. If it is all correct, say so. Do not redo the parts that are right.' },
  { id: 'hint', group: G.work, icon: 'lightbulb.max', label: 'Give me a hint', ask: 'Give me a hint for the question I am on, without giving the answer. Say just the next step to try.' },
  { id: 'example', group: G.work, icon: 'function', label: 'Show a similar example', ask: 'Show a fully worked example of a similar problem with different numbers, so I can then do mine myself. Do not solve the problem on my page.' },

  { id: 'essay', group: G.write, icon: 'text.book.closed', label: 'Essay outline', ask: 'Using these notes, suggest a thesis and a five-paragraph essay outline, with the facts from the notes to use in each paragraph. Do not write the essay.' },

  { id: 'hebrew', group: G.language, icon: 'character.bubble', label: 'Translate to Hebrew', ask: 'Translate these notes into clear modern Hebrew.' },
  { id: 'vocab', group: G.language, icon: 'character.book.closed.fill', label: 'Hebrew vocabulary', ask: 'List the Hebrew words in these notes with English meanings, and for each one a short simple example sentence with its translation. If there is no Hebrew here, give the key terms translated into Hebrew instead.' },
];
