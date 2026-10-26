import { useEffect, useState } from 'react';
import { socket } from './socket';

/** How far the server's clock is ahead of ours, learned from its greeting. */
let offsetMs = 0;
socket.on('hello', ({ serverTime }) => {
  offsetMs = serverTime - Date.now();
});

export const serverNow = () => Date.now() + offsetMs;

/** Whole seconds left until a server timestamp, and the share of `totalMs` still to go. */
export function useCountdown(endsAt: number | null, totalMs: number) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (endsAt === null) return;
    const timer = setInterval(() => tick((n) => n + 1), 200);
    return () => clearInterval(timer);
  }, [endsAt]);
  if (endsAt === null) return { seconds: 0, fraction: 0 };
  const left = Math.max(0, endsAt - serverNow());
  return {
    seconds: Math.ceil(left / 1000),
    fraction: totalMs > 0 ? Math.min(1, left / totalMs) : 0,
  };
}
