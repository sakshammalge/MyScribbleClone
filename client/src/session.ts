import { AVATAR_COLORS, AVATAR_FACES, cleanName, type Profile } from '@inkling/shared';

const PROFILE_KEY = 'inkling.profile';
const SEAT_KEY = 'inkling.seat';

export interface Seat {
  code: string;
  token: string;
}

function read<T>(store: Storage, key: string): T | null {
  try {
    const raw = store.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(store: Storage, key: string, value: unknown) {
  try {
    if (value === null) store.removeItem(key);
    else store.setItem(key, JSON.stringify(value));
  } catch {
    // Storage can be blocked (private mode); the app still works without it.
  }
}

export function randomProfile(): Profile {
  return {
    name: '',
    avatar: {
      color: Math.floor(Math.random() * AVATAR_COLORS),
      face: Math.floor(Math.random() * AVATAR_FACES),
    },
  };
}

/** The name and avatar remembered across visits, in localStorage. */
export function loadProfile(): Profile {
  const saved = read<Profile>(localStorage, PROFILE_KEY);
  const fallback = randomProfile();
  if (!saved) return fallback;
  return {
    name: cleanName(saved.name) ?? '',
    avatar: {
      color: Number.isInteger(saved.avatar?.color) ? saved.avatar.color : fallback.avatar.color,
      face: Number.isInteger(saved.avatar?.face) ? saved.avatar.face : fallback.avatar.face,
    },
  };
}

export const saveProfile = (p: Profile) => write(localStorage, PROFILE_KEY, p);

/** The seat is per tab (sessionStorage) so two tabs can be two players. */
export const loadSeat = () => read<Seat>(sessionStorage, SEAT_KEY);
export const saveSeat = (s: Seat | null) => write(sessionStorage, SEAT_KEY, s);
