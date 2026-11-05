// What's kept about studying, on the iPad: flashcard sets, time studied, tests and homework.
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useSyncExternalStore } from 'react';

import { uid } from './model';
import { type Card, dayKey, type StudyDay } from './study-logic';

export type Deck = { id: string; title: string; cards: Card[]; made: number };
export type TestDate = { id: string; name: string; date: string };
export type Homework = { id: string; text: string; cls?: string; due?: string; done?: boolean };
export type QuizScore = { title: string; score: number; total: number; at: number };
export type StudyData = {
  decks: Deck[];
  days: Record<string, StudyDay>;
  goalCards: number;
  goalMinutes: number;
  tests: TestDate[];
  homework: Homework[];
  quizzes: QuizScore[];
};

const KEY = 'quill.study.v2';
const OLD_DECKS = 'quill.flashcards.v1';
const START: StudyData = { decks: [], days: {}, goalCards: 20, goalMinutes: 25, tests: [], homework: [], quizzes: [] };

let data = START;
let loaded = false;
const listeners = new Set<() => void>();

async function load() {
  if (loaded) return;
  loaded = true;
  try {
    const v = await AsyncStorage.getItem(KEY);
    if (v) data = { ...START, ...JSON.parse(v) };
    else {
      const old = await AsyncStorage.getItem(OLD_DECKS);
      if (old) data = { ...START, decks: JSON.parse(old) };
    }
  } catch {}
  listeners.forEach((l) => l());
}

export function updateStudy(fn: (d: StudyData) => StudyData) {
  data = fn(data);
  listeners.forEach((l) => l());
  AsyncStorage.setItem(KEY, JSON.stringify(data)).catch(() => {});
}

export function useStudy(): StudyData {
  load();
  return useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, () => data, () => data);
}

export function logStudy(add: StudyDay) {
  const k = dayKey(new Date());
  updateStudy((d) => {
    const cur = d.days[k] ?? {};
    return { ...d, days: { ...d.days, [k]: { minutes: (cur.minutes ?? 0) + (add.minutes ?? 0), cards: (cur.cards ?? 0) + (add.cards ?? 0) } } };
  });
}

export function addDeck(title: string, cards: Pick<Card, 'q' | 'a'>[]) {
  const id = uid('d');
  updateStudy((d) => ({ ...d, decks: [{ id, title: title.trim() || 'Flashcards', cards: cards.map((c) => ({ q: c.q, a: c.a, box: 0, due: 0 })), made: Date.now() }, ...d.decks] }));
  return id;
}

export function logQuiz(title: string, score: number, total: number) {
  updateStudy((d) => ({ ...d, quizzes: [{ title, score, total, at: Date.now() }, ...d.quizzes].slice(0, 50) }));
}
