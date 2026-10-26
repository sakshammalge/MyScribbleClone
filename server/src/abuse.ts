import type { IncomingHttpHeaders } from 'node:http';

/**
 * The address a request really came from. Behind a reverse proxy (Render, nginx, Cloudflare)
 * every connection arrives from the proxy, so with `trustProxy` set to the number of proxies in
 * front of us we read the address they appended to X-Forwarded-For. With 0 the header is ignored,
 * because anyone can forge it when there is no proxy to overwrite it.
 */
export function clientIp(
  req: { address: string; headers: IncomingHttpHeaders },
  trustProxy: number,
): string {
  if (trustProxy > 0) {
    const raw = req.headers['x-forwarded-for'];
    const hops = (Array.isArray(raw) ? raw.join(',') : (raw ?? ''))
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);
    // The proxy closest to us appended the last entry; skip the other trusted ones from the right.
    const hop = hops[hops.length - trustProxy];
    if (hop) return stripV4Prefix(hop);
  }
  return stripV4Prefix(req.address);
}

const stripV4Prefix = (ip: string) => ip.replace(/^::ffff:/i, '');

/** Reads INKLING_TRUST_PROXY: "true" is one proxy, a number is that many, anything else none. */
export function parseTrustProxy(value: string | undefined): number {
  if (!value) return 0;
  if (value.toLowerCase() === 'true') return 1;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : 0;
}

/** Counts how many of something (sockets, rooms) each address holds, against a ceiling. */
export class PerIpCounter {
  private counts = new Map<string, number>();

  constructor(private max: number) {}

  /** Takes a slot for the address, or returns false when it is already at the ceiling. */
  acquire(ip: string): boolean {
    const n = this.counts.get(ip) ?? 0;
    if (n >= this.max) return false;
    this.counts.set(ip, n + 1);
    return true;
  }

  release(ip: string): void {
    const n = (this.counts.get(ip) ?? 0) - 1;
    if (n > 0) this.counts.set(ip, n);
    else this.counts.delete(ip);
  }

  count(ip: string): number {
    return this.counts.get(ip) ?? 0;
  }
}
