import { describe, expect, it } from 'vitest';
import { badName, hasProfanity, maskProfanity } from './profanity';

describe('profanity filter', () => {
  it('catches plain, disguised and stretched words', () => {
    for (const w of [
      'fuck',
      'F U C K'.replace(/ /g, ''),
      'sh1t',
      'fuuuuck',
      'b!tch',
      'a$$',
      'asss',
    ]) {
      expect(hasProfanity(`you ${w} you`)).toBe(true);
    }
  });

  it('leaves innocent words alone', () => {
    for (const w of [
      'as',
      'class',
      'assassin',
      'bass',
      'cocktail',
      'Scunthorpe',
      'shiitake',
      'grape',
      'Dickens',
      'peacock',
      'passion',
      'classic',
      'butterfly',
      'Moby',
      'cucumber',
    ]) {
      expect(hasProfanity(w), w).toBe(false);
    }
  });

  it('masks only the bad word', () => {
    expect(maskProfanity('what the fuck is that')).toBe('what the **** is that');
    expect(maskProfanity('nice cat')).toBe('nice cat');
  });

  it('rejects names with separators between letters', () => {
    expect(badName('f.u.c.k')).toBe(true);
    expect(badName('Sam')).toBe(false);
    expect(badName('Dickens')).toBe(false);
  });
});
