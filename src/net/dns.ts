import * as dns from "node:dns/promises";

export interface ResolvedHost {
  hostname: string;
  addresses: string[]; // IPv4 + IPv6
  cnames: string[];
}

/**
 * Resolves A, AAAA and CNAME records for a hostname. Each lookup is
 * independently try/caught since a hostname commonly has only some of
 * these record types (e.g. no CNAME, or no AAAA).
 */
export async function resolveHost(hostname: string): Promise<ResolvedHost> {
  const addresses = new Set<string>();
  const cnames: string[] = [];

  await Promise.all([
    dns.resolve4(hostname).then((ips) => ips.forEach((ip) => addresses.add(ip))).catch(() => {}),
    dns.resolve6(hostname).then((ips) => ips.forEach((ip) => addresses.add(ip))).catch(() => {}),
    dns.resolveCname(hostname).then((names) => cnames.push(...names)).catch(() => {}),
  ]);

  return { hostname, addresses: Array.from(addresses), cnames };
}

export async function canResolve(hostname: string): Promise<boolean> {
  const res = await resolveHost(hostname);
  return res.addresses.length > 0;
}
