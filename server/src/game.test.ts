import { describe, expect, it } from 'vitest';
import {
  cleanWords,
  drawerPoints,
  guessPoints,
  hintOrder,
  isClose,
  isCorrect,
  maskWord,
  wordChoices,
} from './game';
import { WORD_BANK } from './wordlist';

describe('guess checking', () => {
  it('ignores case, spacing, hyphens and accents', () => {
    expect(isCorrect('  ICE   cream ', 'ice-cream')).toBe(true);
    expect(isCorrect('Café', 'cafe')).toBe(true);
    expect(isCorrect('', '')).toBe(false);
    expect(isCorrect('dog', 'dot')).toBe(false);
  });

  it('calls a guess one edit away close, but only for longer words', () => {
    expect(isClose('guitor', 'guitar')).toBe(true);
    expect(isClose('guita', 'guitar')).toBe(true);
    expect(isClose('guitarr', 'guitar')).toBe(true);
    expect(isClose('guitar', 'guitar')).toBe(false);
    expect(isClose('gutar', 'guitar')).toBe(true);
    expect(isClose('gtr', 'guitar')).toBe(false);
    expect(isClose('cot', 'cat')).toBe(false);
    expect(isClose('apple', 'banana')).toBe(false);
  });
});

describe('hints', () => {
  it('masks letters and keeps spaces and hyphens', () => {
    expect(maskWord('ice cream', new Set())).toBe('___ _____');
    expect(maskWord('ice cream', new Set([0, 4]))).toBe('i__ c____');
    expect(maskWord('rock-n-roll', new Set())).toBe('____-_-____');
  });

  it('never gives away more than a third of the letters', () => {
    expect(hintOrder('cat', 2)).toHaveLength(1);
    expect(hintOrder('at', 2)).toHaveLength(0);
    expect(hintOrder('elephant', 2)).toHaveLength(2);
    const order = hintOrder('ice cream', 5);
    expect(new Set(order).size).toBe(order.length);
    expect(order.every((i) => 'ice cream'[i] !== ' ')).toBe(true);
  });
});

describe('scoring', () => {
  it('rewards speed and the first few guessers', () => {
    expect(guessPoints(1, 0)).toBe(500);
    expect(guessPoints(0, 0)).toBe(200);
    expect(guessPoints(0.5, 1)).toBe(310);
    expect(guessPoints(0.5, 3)).toBe(250);
    expect(guessPoints(5, 9)).toBe(400);
  });

  it('pays the drawer for how much of the room got it', () => {
    expect(drawerPoints([], 3)).toBe(0);
    expect(drawerPoints([400, 200], 2)).toBe(300);
    expect(drawerPoints([400], 4)).toBe(100);
  });
});

describe('word choices', () => {
  const pools = (over: Partial<Parameters<typeof wordChoices>[0]> = {}) => ({
    bank: WORD_BANK,
    custom: [],
    customOnly: false,
    used: new Set<string>(),
    ...over,
  });

  it('ships a few thousand words, all lower-case and drawable length', () => {
    expect(WORD_BANK.length).toBeGreaterThan(3000);
    expect(new Set(WORD_BANK).size).toBe(WORD_BANK.length);
    expect(WORD_BANK.every((w) => /^[a-z -]{3,18}$/.test(w))).toBe(true);
  });

  it('offers distinct words and skips ones already used', () => {
    const used = new Set(WORD_BANK.slice(0, WORD_BANK.length - 3));
    const picks = wordChoices(pools({ used }), 3);
    expect(new Set(picks).size).toBe(3);
    expect(picks.every((w) => !used.has(w))).toBe(true);
  });

  it('draws only from host words when asked, and recycles them when spent', () => {
    const custom = ['alpha', 'beta', 'gamma', 'delta'];
    const used = new Set<string>();
    const first = wordChoices(pools({ custom, customOnly: true, used }), 3);
    expect(first.every((w) => custom.includes(w))).toBe(true);
    first.forEach((w) => used.add(w));
    expect(wordChoices(pools({ custom, customOnly: true, used }), 3)).toHaveLength(3);
    expect(wordChoices(pools({ custom: ['solo'], customOnly: true }), 3)).toEqual(['solo']);
  });

  it('mixes host words into the built-in list', () => {
    const custom = ['zzzcustom'];
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      if (wordChoices(pools({ custom }), 3).includes('zzzcustom')) seen++;
    }
    expect(seen).toBeGreaterThan(40);
  });

  it('tidies host words', () => {
    expect(
      cleanWords([' Pizza ', 'pizza', 'x', 'a'.repeat(31), 'Rock & Roll!', 5, 'ice  cream']),
    ).toEqual(['pizza', 'rock roll', 'ice cream']);
    expect(cleanWords('nope')).toEqual([]);
  });
});
