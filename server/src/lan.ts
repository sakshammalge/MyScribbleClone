import { networkInterfaces } from 'node:os';

/** Non-internal IPv4 addresses of this machine, so players on the LAN know where to connect. */
export function lanAddresses(): string[] {
  return Object.values(networkInterfaces())
    .flatMap((infos) => infos ?? [])
    .filter((info) => info.family === 'IPv4' && !info.internal)
    .map((info) => info.address);
}
