import { randomInt } from 'node:crypto';
import { CUSTOM_WORDS } from '@inkling/shared';

/** Lower-case, letters and digits only, so "Ice-Cream" and "ice cream" are the same guess. */
export function squash(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function isCorrect(guess: string, word: string): boolean {
  const g = squash(guess);
  return g.length > 0 && g === squash(word);
}

/** Edit distance, bailing out as soon as it is certain to exceed 1. */
function withinOneEdit(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const rest = (s: string) => s.slice(i + 1);
  if (a.length === b.length) return rest(a) === rest(b);
  return a.length > b.length ? rest(a) === b.slice(i) : a.slice(i) === rest(b);
}

/** A near miss worth a nudge: one letter off, on words long enough that it means something. */
export function isClose(guess: string, word: string): boolean {
  const g = squash(guess);
  const w = squash(word);
  return w.length >= 4 && g !== w && withinOneEdit(g, w);
}

const isLetter = (ch: string) => /[a-z0-9]/i.test(ch);

/** The word as the guessers see it: underscores for hidden letters, everything else as written. */
export function maskWord(word: string, revealed: ReadonlySet<number>): string {
  return [...word].map((ch, i) => (!isLetter(ch) || revealed.has(i) ? ch : '_')).join('');
}

/** Letter positions in the order hints will uncover them, never more than about a third. */
export function hintOrder(word: string, hints: number): number[] {
  const slots = [...word].flatMap((ch, i) => (isLetter(ch) ? [i] : []));
  const allowed = Math.min(hints, Math.floor(slots.length / 3));
  for (let i = slots.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [slots[i], slots[j]] = [slots[j]!, slots[i]!];
  }
  return slots.slice(0, allowed);
}

/** Points for a correct guess: faster is worth more, and the first few get a bonus. */
export function guessPoints(remainingFraction: number, place: number): number {
  const speed = Math.round(300 * Math.min(1, Math.max(0, remainingFraction)));
  const bonus = [100, 60, 30][place] ?? 0;
  return 100 + speed + bonus;
}

/** The drawer earns the average guesser's score, scaled by how many of the room found it. */
export function drawerPoints(guesserPoints: number[], guessers: number): number {
  if (guessers <= 0 || guesserPoints.length === 0) return 0;
  return Math.round(guesserPoints.reduce((a, b) => a + b, 0) / guessers);
}

/** Tidy host-supplied words: trimmed, lower-cased, deduplicated and kept to sane lengths. */
export function cleanWords(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const word = item
      .toLowerCase()
      .replace(/[^\p{L}\p{N}' -]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (word.length >= CUSTOM_WORDS.minLength && word.length <= CUSTOM_WORDS.maxLength) {
      seen.add(word);
    }
    if (seen.size >= CUSTOM_WORDS.maxWords) break;
  }
  return [...seen];
}

function sample<T>(list: readonly T[], count: number): T[] {
  const pool = [...list];
  const out: T[] = [];
  while (out.length < count && pool.length) out.push(pool.splice(randomInt(pool.length), 1)[0]!);
  return out;
}

export interface WordPools {
  bank: readonly string[];
  custom: readonly string[];
  customOnly: boolean;
  /** Words already drawn this game; skipped until the pool runs dry. */
  used: Set<string>;
}

/** Offers `count` distinct words, mixing host words in when there are any. */
export function wordChoices(pools: WordPools, count: number): string[] {
  const fresh = (list: readonly string[]) => list.filter((w) => !pools.used.has(w));
  let custom = fresh(pools.custom);
  let bank = fresh(pools.bank);
  if (pools.customOnly && pools.custom.length > 0) {
    const picks = sample(custom, count);
    if (picks.length < count) {
      // The host's list is nearly spent: top up with ones already played rather than offer fewer.
      const spare = pools.custom.filter((w) => !picks.includes(w));
      picks.push(...sample(spare, count - picks.length));
    }
    return picks;
  }
  if (bank.length < count) {
    pools.used.clear();
    bank = [...pools.bank];
    custom = [...pools.custom];
  }
  const picks: string[] = [];
  while (picks.length < count && (custom.length || bank.length)) {
    // Host words get a fair share: half of the slots while any are left.
    const fromCustom = custom.length > 0 && (bank.length === 0 || randomInt(2) === 0);
    const list = fromCustom ? custom : bank;
    const word = list.splice(randomInt(list.length), 1)[0]!;
    if (!picks.includes(word)) picks.push(word);
  }
  return picks;
}
