export const APP_NAME = 'Inkling';
export const DEFAULT_PORT = 3001;

/** Limits for host-editable room settings; enforced by the server, mirrored in the UI. */
export const SETTINGS_LIMITS = {
  rounds: { min: 2, max: 10, default: 3 },
  drawTimeSec: { min: 30, max: 180, default: 80 },
  maxPlayers: { min: 2, max: 12, default: 8 },
} as const;

export interface HelloPayload {
  serverTime: number;
  version: string;
}

/** Events the server emits to clients. */
export interface ServerToClientEvents {
  hello: (payload: HelloPayload) => void;
}

/** Events clients emit to the server. The ack carries the server timestamp. */
export interface ClientToServerEvents {
  ping: (ack: (serverTime: number) => void) => void;
}
