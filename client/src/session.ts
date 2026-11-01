import {
  AVATAR_PARTS,
  type Avatar,
  DEVICE_ID_PATTERN,
  cleanName,
  type Profile,
} from '@inkling/shared';
import { randomAvatar } from './AvatarEditor';

const PROFILE_KEY = 'inkling.profile';
const SEAT_KEY = 'inkling.seat';
const DEVICE_KEY = 'inkling.device';

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
  return { name: '', avatar: randomAvatar() };
}

/** The name and avatar remembered across visits, in localStorage. */
export function loadProfile(): Profile {
  const saved = read<Profile>(localStorage, PROFILE_KEY);
  const fallback = randomProfile();
  if (!saved) return fallback;
  const avatar = { ...fallback.avatar } as Record<string, number>;
  for (const key of Object.keys(AVATAR_PARTS) as (keyof Avatar)[]) {
    const v = saved.avatar?.[key];
    if (Number.isInteger(v) && (v as number) >= 0 && (v as number) < AVATAR_PARTS[key]) {
      avatar[key] = v as number;
    }
  }
  return { name: cleanName(saved.name) ?? '', avatar: avatar as unknown as Avatar };
}

let memoryDeviceId: string | null = null;

/**
 * This browser's all-time identity: 128 random bits made on the first visit and kept in
 * localStorage. Clearing site data (or switching browser) starts a fresh player.
 */
export function getDeviceId(): string {
  try {
    const saved = localStorage.getItem(DEVICE_KEY);
    if (saved && DEVICE_ID_PATTERN.test(saved)) return saved;
  } catch {
    // Blocked storage: fall through to an id that lasts as long as this page.
  }
  if (!memoryDeviceId) {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    memoryDeviceId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  try {
    localStorage.setItem(DEVICE_KEY, memoryDeviceId);
  } catch {
    // Not remembered; stats then follow this page load only.
  }
  return memoryDeviceId;
}

export const saveProfile = (p: Profile) => write(localStorage, PROFILE_KEY, p);

/** The seat is per tab (sessionStorage) so two tabs can be two players. */
export const loadSeat = () => read<Seat>(sessionStorage, SEAT_KEY);
export const saveSeat = (s: Seat | null) => write(sessionStorage, SEAT_KEY, s);
