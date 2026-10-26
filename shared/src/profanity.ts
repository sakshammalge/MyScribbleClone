/**
 * A small, dependency-free filter for player names and chat. It is a baseline for a game played
 * with strangers, not a moderation system: it catches common words and the usual disguises
 * (leetspeak, stretched letters, dots between letters) without flagging innocent words.
 */

// Matched anywhere inside a word: long enough that innocent words almost never contain them.
const STEMS = [
  'fuck',
  'shit',
  'cunt',
  'nigga',
  'faggot',
  'bitch',
  'whore',
  'slut',
  'cocksuck',
  'motherfuck',
  'asshole',
  'dickhead',
  'bollock',
  'blowjob',
  'handjob',
  'porn',
  'hitler',
];

// Matched only as whole words, because they sit inside plenty of harmless ones.
const WORDS = [
  'ass',
  'arse',
  'cock',
  'dick',
  'pussy',
  'twat',
  'cum',
  'nigger',
  'niggers',
  'wank',
  'wanker',
  'jizz',
  'fag',
  'fags',
  'tits',
  'penis',
  'vagina',
  'rape',
  'rapist',
  'nazi',
  'kike',
  'spic',
  'chink',
  'gook',
  'coon',
  'dyke',
  'tranny',
  'retard',
  'retarded',
  'bastard',
  'piss',
  'slutty',
  'sex',
  'sexy',
  'boner',
];

// Harmless words that happen to contain a stem.
const ALLOWED = ['scunthorpe', 'shiitake', 'shitake', 'cocktail', 'bassist', 'hancock'];

const LEET: Record<string, string> = {
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '@': 'a',
  $: 's',
  '!': 'i',
  '+': 't',
};

/** Lower-cases, undoes leetspeak and drops everything but letters. */
function letters(raw: string): string {
  let out = '';
  for (const ch of raw.toLowerCase()) {
    const c = LEET[ch] ?? ch;
    if (c >= 'a' && c <= 'z') out += c;
  }
  return out;
}

/** Squeezes every repeated letter ("fuuuck" becomes "fuck"). */
const squash = (s: string) => s.replace(/(.)\1+/g, '$1');
/** Trims long stretches to a pair ("asss" becomes "ass") so double letters still match. */
const trim = (s: string) => s.replace(/(.)\1{2,}/g, '$1$1');

const STEM_SET = STEMS.map((w) => squash(letters(w)));
const WORD_EXACT = new Set(WORDS.map(letters));
// Squashed forms only for longer words, so "ass" never turns into the harmless "as".
const WORD_SQUASHED = new Set(WORDS.map((w) => squash(letters(w))).filter((w) => w.length >= 4));
const ALLOWED_SET = ALLOWED.map((w) => squash(letters(w)));

function tokenBad(token: string): boolean {
  const raw = letters(token);
  if (raw.length < 2) return false;
  if (WORD_EXACT.has(raw) || WORD_EXACT.has(trim(raw)) || WORD_SQUASHED.has(squash(raw))) {
    return true;
  }
  const s = ALLOWED_SET.reduce((acc, a) => acc.split(a).join(''), squash(raw));
  return STEM_SET.some((stem) => s.includes(stem));
}

/** True when a word in the text is on the list. */
export function hasProfanity(text: string): boolean {
  return text.split(/\s+/).some(tokenBad);
}

/**
 * Stricter check for names, which are short and shown everywhere: also catches letters spread
 * out with spaces or dots ("f.u.c.k") by looking at the name with every separator removed.
 */
export function badName(name: string): boolean {
  if (hasProfanity(name)) return true;
  const all = squash(letters(name));
  return STEM_SET.some((stem) => all.includes(stem) && !ALLOWED_SET.some((a) => all.includes(a)));
}

/** Replaces each listed word with asterisks, leaving the rest of the line alone. */
export function maskProfanity(text: string): string {
  return text.replace(/\S+/g, (token) => (tokenBad(token) ? '*'.repeat(token.length) : token));
}
