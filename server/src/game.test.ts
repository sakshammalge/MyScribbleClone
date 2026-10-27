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
import { WORD_BANK, WORD_TIERS } from './wordlist';

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
    expect(guessPoints(1, 0, 0)).toBe(500);
    expect(guessPoints(0, 0, 0)).toBe(200);
    expect(guessPoints(0.5, 1, 0)).toBe(310);
    expect(guessPoints(0.5, 3, 0)).toBe(250);
    expect(guessPoints(5, 9, 0)).toBe(400);
  });

  it('pays more for harder words', () => {
    const [easy, medium, hard] = [0, 1, 2].map((tier) => guessPoints(0.5, 1, tier));
    expect(easy).toBe(310);
    expect(medium).toBeGreaterThan(easy!);
    expect(hard).toBeGreaterThan(medium!);
    expect(hard).toBe(465);
  });

  it('takes a little off for each hint already shown, but never more than half', () => {
    expect(guessPoints(0.5, 1, 0, 1)).toBe(279);
    expect(guessPoints(0.5, 1, 0, 2)).toBe(248);
    expect(guessPoints(0.5, 1, 0, 20)).toBe(155);
  });

  it('pays the drawer for how much of the room got it', () => {
    expect(drawerPoints([], 3)).toBe(0);
    expect(drawerPoints([400, 200], 3)).toBe(200);
    expect(drawerPoints([400], 4)).toBe(100);
  });

  it('gives the drawer a bonus when everyone guessed', () => {
    expect(drawerPoints([400, 200], 2)).toBe(350);
    expect(drawerPoints([400], 1)).toBe(450);
  });
});

describe('word choices', () => {
  const pools = (over: Partial<Parameters<typeof wordChoices>[0]> = {}) => ({
    tiers: WORD_TIERS,
    custom: [],
    customOnly: false,
    used: new Set<string>(),
    ...over,
  });
  const words = (picks: { word: string }[]) => picks.map((p) => p.word);

  it('ships a curated list, all lower-case, drawable length and without repeats', () => {
    expect(WORD_BANK.length).toBeGreaterThan(450);
    expect(WORD_BANK.length).toBeLessThan(1000);
    expect(new Set(WORD_TIERS.flat()).size).toBe(WORD_TIERS.flat().length);
    expect(WORD_BANK.every((w) => /^[a-z -]{3,18}$/.test(w))).toBe(true);
    expect(WORD_TIERS.every((t) => t.length >= 100)).toBe(true);
  });

  it('offers one word from each tier', () => {
    for (let i = 0; i < 50; i++) {
      const picks = wordChoices(pools(), 3);
      expect(picks.map((p) => p.tier)).toEqual([0, 1, 2]);
      picks.forEach((p) => expect(WORD_TIERS[p.tier]).toContain(p.word));
    }
  });

  it('skips words already used', () => {
    const used = new Set(
      WORD_TIERS.flat().filter((w) => w !== 'cat' && w !== 'tiger' && w !== 'yacht'),
    );
    expect(words(wordChoices(pools({ used }), 3))).toEqual(['cat', 'tiger', 'yacht']);
  });

  it('draws only from host words when asked, and recycles them when spent', () => {
    const custom = ['alpha', 'beta', 'gamma', 'delta'];
    const used = new Set<string>();
    const first = wordChoices(pools({ custom, customOnly: true, used }), 3);
    expect(words(first).every((w) => custom.includes(w))).toBe(true);
    words(first).forEach((w) => used.add(w));
    expect(wordChoices(pools({ custom, customOnly: true, used }), 3)).toHaveLength(3);
    expect(wordChoices(pools({ custom: ['solo'], customOnly: true }), 3)).toEqual([
      { word: 'solo', tier: 1 },
    ]);
  });

  it('mixes host words into the built-in list as medium words', () => {
    const custom = ['zzzcustom'];
    let seen = 0;
    for (let i = 0; i < 200; i++) {
      const picks = wordChoices(pools({ custom }), 3);
      expect(new Set(words(picks)).size).toBe(3);
      const mine = picks.find((p) => p.word === 'zzzcustom');
      if (mine) {
        seen++;
        expect(mine.tier).toBe(1);
      }
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
