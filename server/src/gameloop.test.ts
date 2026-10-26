import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TURN_TIMING, type ChatMessage, type PrivateState, type RoomState } from '@inkling/shared';
import { RoomManager } from './rooms';

const me = (name: string) => ({ name, avatar: { color: 0, face: 0 } });
const DRAW_MS = 40_000;

describe('game loop', () => {
  let state: RoomState;
  let secrets: Record<string, PrivateState>;
  let heard: Record<string, ChatMessage[]>;
  let rooms: RoomManager;

  beforeEach(() => {
    vi.useFakeTimers();
    secrets = {};
    heard = {};
    rooms = new RoomManager((room) => room && (state = room), 1000, {
      private: (socket, s) => (secrets[socket] = s),
      chat: (sockets, m) => {
        for (const id of sockets) (heard[id] ??= []).push(m);
      },
    });
  });
  afterEach(() => vi.useRealTimers());

  const idOf = (name: string) => state.players.find((p) => p.name === name)!.id;
  const score = (name: string) => state.players.find((p) => p.name === name)!.score;

  /** Ada hosts; the rest join in order. Draw time is shortened to 40s. */
  const lobby = (...names: string[]) => {
    const created = rooms.create('s-' + names[0], me(names[0]!));
    if (!created.ok) throw new Error(created.error);
    for (const n of names.slice(1)) rooms.join('s-' + n, created.room.code, me(n));
    rooms.updateSettings('s-' + names[0], { drawTimeSec: 40, rounds: 2 });
    return created.room.code;
  };

  /** Starts, and has the first drawer take the first offered word. Returns that word. */
  const begin = (drawer: string) => {
    expect(rooms.start('s-Ada')).toEqual({ ok: true });
    expect(state.drawerId).toBe(idOf(drawer));
    return pick(drawer);
  };

  const pick = (drawer: string, index = 0) => {
    const word = secrets['s-' + drawer]!.choices![index]!;
    expect(rooms.chooseWord('s-' + drawer, index)).toEqual({ ok: true });
    expect(state.phase).toBe('drawing');
    return word;
  };

  it('offers the drawer words in private and starts the clock once one is picked', () => {
    lobby('Ada', 'Bo');
    rooms.start('s-Ada');
    expect(state.phase).toBe('choosing');
    expect(secrets['s-Ada']!.choices).toHaveLength(TURN_TIMING.wordChoices);
    expect(secrets['s-Bo']).toEqual({ choices: null, word: null });
    expect(state.hint).toBeNull();
    expect(rooms.chooseWord('s-Bo', 0)).toEqual({ ok: false, error: 'wrong-phase' });
    expect(rooms.chooseWord('s-Ada', 7)).toEqual({ ok: false, error: 'bad-choice' });

    const word = pick('Ada', 1);
    expect(secrets['s-Ada']).toEqual({ choices: null, word });
    expect(secrets['s-Bo']).toEqual({ choices: null, word: null });
    expect(state.hint).toBe(word.replace(/[a-z0-9]/gi, '_'));
    expect(state.phaseEndsAt).toBe(Date.now() + DRAW_MS);
  });

  it('never puts the word in anything a guesser is sent', () => {
    lobby('Ada', 'Bo');
    const word = begin('Ada');
    rooms.chat('s-Bo', 'wrong guess');
    vi.advanceTimersByTime(DRAW_MS * 0.8);
    expect(JSON.stringify(state)).not.toContain(`"${word}"`);
    expect(state.reveal).toBeNull();
    expect(JSON.stringify(secrets['s-Bo'])).not.toContain(word);
    expect(heard['s-Bo']!.some((m) => m.text.includes(word))).toBe(false);
  });

  it('picks for a slow drawer', () => {
    lobby('Ada', 'Bo');
    rooms.start('s-Ada');
    vi.advanceTimersByTime(TURN_TIMING.chooseSec * 1000);
    expect(state.phase).toBe('drawing');
    expect(secrets['s-Ada']!.word).toBeTruthy();
  });

  it('scores a correct guess, hides the word, and ends the turn when all have guessed', () => {
    lobby('Ada', 'Bo', 'Cy');
    const word = begin('Ada');
    vi.advanceTimersByTime(DRAW_MS * 0.25);
    rooms.chat('s-Bo', word.toUpperCase());
    // A quarter of the way in: 100 base + 225 speed + 100 first-guesser bonus.
    expect(score('Bo')).toBe(425);
    expect(state.players.find((p) => p.name === 'Bo')!.guessed).toBe(true);
    expect(state.phase).toBe('drawing');

    // Nothing Bo said reaches Cy; the announcement does, without the word.
    expect(heard['s-Cy']!.map((m) => m.kind)).toContain('correct');
    // (System lines are fixed text, which a short random word can happen to sit inside.)
    const talk = heard['s-Cy']!.filter((m) => m.kind !== 'system');
    expect(talk.some((m) => m.text.toLowerCase().includes(word))).toBe(false);

    rooms.chat('s-Cy', word);
    expect(state.phase).toBe('reveal');
    expect(state.reveal!.word).toBe(word);
    expect(state.reveal!.gains[idOf('Bo')]).toBeGreaterThan(state.reveal!.gains[idOf('Cy')]!);
    expect(score('Ada')).toBeGreaterThan(0);
    expect(state.reveal!.gains[idOf('Ada')]).toBe(score('Ada'));
  });

  it('keeps chat among players who know the word away from those still guessing', () => {
    lobby('Ada', 'Bo', 'Cy');
    const word = begin('Ada');
    rooms.chat('s-Bo', word);
    rooms.chat('s-Bo', 'it was easy');
    rooms.chat('s-Ada', 'nice one');
    rooms.chat('s-Cy', 'is it a cat?');
    const texts = (id: string) => heard[id]!.filter((m) => m.kind === 'say').map((m) => m.text);
    expect(texts('s-Cy')).toEqual(['is it a cat?']);
    expect(texts('s-Bo')).toEqual(['it was easy', 'nice one', 'is it a cat?']);
    expect(texts('s-Ada')).toEqual(['it was easy', 'nice one', 'is it a cat?']);
    // History is filtered the same way for someone who refreshes.
    expect(rooms.chatHistory('s-Cy').some((m) => m.text === 'it was easy')).toBe(false);
    expect(rooms.chatHistory('s-Bo').some((m) => m.text === 'it was easy')).toBe(true);
  });

  it('tells a near miss it is close, privately', () => {
    lobby('Ada', 'Bo', 'Cy');
    const word = begin('Ada');
    const almost = word.length >= 4 ? word.slice(0, -1) : null;
    if (!almost) return;
    rooms.chat('s-Bo', almost);
    expect(heard['s-Bo']!.some((m) => m.kind === 'close')).toBe(true);
    expect(heard['s-Cy']!.some((m) => m.kind === 'close')).toBe(false);
    expect(state.players.find((p) => p.name === 'Bo')!.guessed).toBe(false);
  });

  it('ends the turn when time runs out, reveals the word, then moves to the next drawer', () => {
    lobby('Ada', 'Bo');
    const word = begin('Ada');
    vi.advanceTimersByTime(DRAW_MS);
    expect(state.phase).toBe('reveal');
    expect(state.reveal).toEqual({ word, gains: { [idOf('Ada')]: 0 } });
    vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    expect(state).toMatchObject({ phase: 'choosing', drawerId: idOf('Bo'), round: 1 });
    expect(state.reveal).toBeNull();
  });

  it('uncovers hints as the clock runs down', () => {
    lobby('Ada', 'Bo');
    // Ask until a word with enough letters for hints turns up.
    rooms.start('s-Ada');
    const choices = secrets['s-Ada']!.choices!;
    const index = Math.max(
      0,
      choices.findIndex((w) => w.length >= 6),
    );
    const word = pick('Ada', index);
    if (word.length < 6) return;
    const hidden = () => (state.hint!.match(/_/g) ?? []).length;
    const total = hidden();
    vi.advanceTimersByTime(DRAW_MS * 0.4 + 10);
    expect(hidden()).toBe(total - 1);
    vi.advanceTimersByTime(DRAW_MS * 0.3);
    expect(hidden()).toBe(total - 2);
    // A hint is a real letter in its real place.
    for (const [i, ch] of [...state.hint!].entries()) if (ch !== '_') expect(word[i]).toBe(ch);
  });

  it('rotates through everyone each round, then shows final standings', () => {
    lobby('Ada', 'Bo');
    const order: string[] = [];
    rooms.start('s-Ada');
    for (let turn = 0; turn < 4; turn++) {
      expect(state.phase).toBe('choosing');
      const drawer = state.players.find((p) => p.id === state.drawerId)!.name;
      order.push(drawer);
      const word = pick(drawer);
      const guesser = drawer === 'Ada' ? 'Bo' : 'Ada';
      rooms.chat('s-' + guesser, word);
      expect(state.phase).toBe('reveal');
      vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    }
    expect(order).toEqual(['Ada', 'Bo', 'Ada', 'Bo']);
    expect(state.phase).toBe('ended');
    expect(state.drawerId).toBeNull();
    expect(state.round).toBe(2);
    expect(state.players.every((p) => p.score > 0)).toBe(true);
    expect(heard['s-Ada']!.at(-1)!.text).toMatch(/Game over/);
    // Host can go again from a clean slate.
    rooms.backToLobby('s-Ada');
    expect(state.phase).toBe('lobby');
    expect(state.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('lets the host rematch straight from the final standings, but not mid-game', () => {
    lobby('Ada', 'Bo');
    rooms.start('s-Ada');
    expect(rooms.start('s-Ada')).toEqual({ ok: false, error: 'wrong-phase' });
    for (let turn = 0; turn < 4; turn++) {
      const drawer = state.players.find((p) => p.id === state.drawerId)!.name;
      rooms.chat(drawer === 'Ada' ? 's-Bo' : 's-Ada', pick(drawer));
      vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    }
    expect(state.phase).toBe('ended');
    expect(rooms.start('s-Bo')).toEqual({ ok: false, error: 'not-host' });
    expect(rooms.start('s-Ada')).toEqual({ ok: true });
    expect(state.phase).toBe('choosing');
    expect(state.round).toBe(1);
    expect(state.players.map((p) => p.score)).toEqual([0, 0]);
  });

  it('announces a shared win when the top scores tie', () => {
    lobby('Ada', 'Bo');
    rooms.updateSettings('s-Ada', { rounds: 2 });
    rooms.start('s-Ada');
    // Nobody ever guesses: every turn ends 0-0, so both share first place.
    for (let turn = 0; turn < 4; turn++) {
      pick(state.players.find((p) => p.id === state.drawerId)!.name);
      vi.advanceTimersByTime(DRAW_MS);
      vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    }
    expect(state.phase).toBe('ended');
    expect(heard['s-Ada']!.at(-1)!.text).toBe('Game over! Ada and Bo tie with 0.');
  });

  it('does not repeat a word within one game', () => {
    lobby('Ada', 'Bo');
    rooms.updateSettings('s-Ada', { rounds: 3 });
    rooms.setWords('s-Ada', { words: ['aaa', 'bbb', 'ccc', 'ddd'], only: true });
    const seen = new Set<string>();
    rooms.start('s-Ada');
    for (let turn = 0; turn < 4; turn++) {
      const drawer = state.players.find((p) => p.id === state.drawerId)!.name;
      const word = pick(drawer);
      expect(seen.has(word)).toBe(false);
      seen.add(word);
      vi.advanceTimersByTime(DRAW_MS);
      vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    }
  });

  it('only lets the host set custom words, in the lobby', () => {
    lobby('Ada', 'Bo');
    expect(rooms.setWords('s-Bo', { words: ['x1'], only: false })).toEqual({
      ok: false,
      error: 'not-host',
    });
    expect(rooms.setWords('s-Ada', { words: ['Pizza', 'pizza', 'Tacos'], only: true })).toEqual({
      ok: true,
    });
    expect(state).toMatchObject({ customWordCount: 2, customWordsOnly: true });
    rooms.start('s-Ada');
    expect([...secrets['s-Ada']!.choices!].sort()).toEqual(['pizza', 'tacos']);
    expect(rooms.setWords('s-Ada', { words: [], only: false })).toEqual({
      ok: false,
      error: 'wrong-phase',
    });
    expect(rooms.updateSettings('s-Ada', { rounds: 5 })).toEqual({
      ok: false,
      error: 'wrong-phase',
    });
  });

  it('moves on when the drawer leaves mid-turn', () => {
    lobby('Ada', 'Bo', 'Cy');
    begin('Ada');
    rooms.leave('s-Ada');
    expect(state.phase).toBe('reveal');
    vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    expect(state).toMatchObject({ phase: 'choosing', drawerId: idOf('Bo') });
  });

  it('skips a drawer who left while choosing, and ends the game when one player is left', () => {
    lobby('Ada', 'Bo', 'Cy');
    rooms.start('s-Ada');
    rooms.leave('s-Ada');
    expect(state).toMatchObject({ phase: 'choosing', drawerId: idOf('Bo') });
    rooms.leave('s-Cy');
    expect(state.phase).toBe('ended');
  });

  it('finishes the turn when the only guessers left have all guessed', () => {
    lobby('Ada', 'Bo', 'Cy');
    const word = begin('Ada');
    rooms.chat('s-Bo', word);
    expect(state.phase).toBe('drawing');
    rooms.leave('s-Cy');
    expect(state.phase).toBe('reveal');
  });

  it('puts a late joiner at the end of the round and lets them guess', () => {
    const code = lobby('Ada', 'Bo');
    const word = begin('Ada');
    expect(rooms.join('s-Cy', code, me('Cy'))).toMatchObject({ ok: true });
    expect(rooms.chat('s-Cy', word)).toEqual({ ok: true });
    expect(score('Cy')).toBeGreaterThan(0);
    // Bo has not guessed yet, so the turn goes on until they do.
    expect(state.phase).toBe('drawing');
    rooms.chat('s-Bo', word);
    vi.advanceTimersByTime(TURN_TIMING.revealSec * 1000);
    const next: string[] = [];
    for (let i = 0; i < 2; i++) {
      const drawer = state.players.find((p) => p.id === state.drawerId)!.name;
      next.push(drawer);
      pick(drawer);
      vi.advanceTimersByTime(DRAW_MS + TURN_TIMING.revealSec * 1000);
    }
    expect(next).toEqual(['Bo', 'Cy']);
  });

  it('answers a private-state request for the drawer and for a guesser', () => {
    lobby('Ada', 'Bo');
    const word = begin('Ada');
    expect(rooms.privateState('s-Ada')).toEqual({ choices: null, word });
    expect(rooms.privateState('s-Bo')).toEqual({ choices: null, word: null });
    expect(rooms.privateState('nobody')).toEqual({ choices: null, word: null });
  });
});
