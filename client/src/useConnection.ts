import { useEffect, useState } from 'react';
import { socket } from './socket';

export type ConnectionState = 'connecting' | 'connected' | 'disconnected';

/** Connects the shared socket while mounted and reports its state and round-trip latency. */
export function useConnection() {
  const [state, setState] = useState<ConnectionState>('connecting');
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  useEffect(() => {
    const onConnect = () => {
      setState('connected');
      const sent = performance.now();
      socket.emit('ping', () => setLatencyMs(Math.round(performance.now() - sent)));
    };
    const onDisconnect = () => {
      setState('disconnected');
      setLatencyMs(null);
    };
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.connect();
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.disconnect();
    };
  }, []);

  return { state, latencyMs };
}
