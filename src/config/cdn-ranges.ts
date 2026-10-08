/**
 * Known CDN/WAF providers, identified either by IP CIDR ranges or by
 * CNAME-suffix (for providers where matching IP ranges is impractical,
 * e.g. CloudFront's huge/rotating AWS ranges -- we instead recognize
 * their CNAME target suffix).
 *
 * The Cloudflare list is refreshed at runtime from Cloudflare's own
 * published endpoint (see `refreshCloudflareRanges`); everything else
 * uses this static, occasionally-stale-but-good-enough bundled list.
 */

export interface CdnProvider {
  name: string;
  cidrs: string[];
  cnameSuffixes: string[];
}

// Minimal IPv4 CIDR containment check (good enough for /8 - /32 ranges below).
export function ipInCidr(ip: string, cidr: string): boolean {
  const [range, bitsStr] = cidr.split("/");
  const bits = parseInt(bitsStr, 10);
  const ipToInt = (addr: string): number | null => {
    const parts = addr.split(".").map((p) => parseInt(p, 10));
    if (parts.length !== 4 || parts.some((p) => Number.isNaN(p) || p < 0 || p > 255)) return null;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  };
  const ipInt = ipToInt(ip);
  const rangeInt = ipToInt(range);
  if (ipInt === null || rangeInt === null) return false;
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (~0 << (32 - bits)) >>> 0;
  return (ipInt & mask) === (rangeInt & mask);
}

export const BUNDLED_CLOUDFLARE_IPV4: string[] = [
  "173.245.48.0/20",
  "103.21.244.0/22",
  "103.22.200.0/22",
  "103.31.4.0/22",
  "141.101.64.0/18",
  "108.162.192.0/18",
  "190.93.240.0/20",
  "188.114.96.0/20",
  "197.234.240.0/22",
  "198.41.128.0/17",
  "162.158.0.0/15",
  "104.16.0.0/13",
  "104.24.0.0/14",
  "172.64.0.0/13",
  "131.0.72.0/22",
];

export const CDN_PROVIDERS: CdnProvider[] = [
  {
    name: "Cloudflare",
    cidrs: BUNDLED_CLOUDFLARE_IPV4,
    cnameSuffixes: [],
  },
  {
    name: "Fastly",
    cidrs: ["151.101.0.0/16", "199.232.0.0/16", "23.235.32.0/20", "43.249.72.0/22"],
    cnameSuffixes: ["fastly.net"],
  },
  {
    name: "Akamai",
    cidrs: ["23.32.0.0/11", "23.192.0.0/11", "104.64.0.0/10"],
    cnameSuffixes: ["akamaiedge.net", "akamai.net", "akamaized.net"],
  },
  {
    name: "Amazon CloudFront",
    cidrs: [],
    cnameSuffixes: ["cloudfront.net"],
  },
  {
    name: "Google Cloud CDN / Load Balancer",
    cidrs: ["34.96.0.0/14", "34.100.0.0/14"],
    cnameSuffixes: ["googleusercontent.com"],
  },
  {
    name: "Vercel",
    cidrs: ["76.76.21.0/24"],
    cnameSuffixes: ["vercel-dns.com", "vercel.app"],
  },
  {
    name: "Netlify",
    cidrs: ["104.198.14.52/32"],
    cnameSuffixes: ["netlify.app", "netlifyglobalcdn.com"],
  },
];

export function matchCdnByIp(ip: string, providers: CdnProvider[] = CDN_PROVIDERS): CdnProvider | null {
  for (const provider of providers) {
    for (const cidr of provider.cidrs) {
      if (ipInCidr(ip, cidr)) return provider;
    }
  }
  return null;
}

export function matchCdnByCname(cname: string): CdnProvider | null {
  const lower = cname.toLowerCase();
  for (const provider of CDN_PROVIDERS) {
    if (provider.cnameSuffixes.some((suffix) => lower.endsWith(suffix))) return provider;
  }
  return null;
}

/**
 * Attempts to fetch Cloudflare's current published IPv4 range list and
 * merge it into a fresh copy of CDN_PROVIDERS. Falls back silently to the
 * bundled list on any network failure or timeout -- this must never throw
 * or block the scan.
 */
export async function refreshCloudflareRanges(timeoutMs: number): Promise<CdnProvider[]> {
  const providers = CDN_PROVIDERS.map((p) => ({ ...p, cidrs: [...p.cidrs] }));
  const cf = providers.find((p) => p.name === "Cloudflare")!;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const res = await fetch("https://www.cloudflare.com/ips-v4", { signal: controller.signal });
    clearTimeout(timer);
    if (res.ok) {
      const text = await res.text();
      const ranges = text
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^\d+\.\d+\.\d+\.\d+\/\d+$/.test(l));
      if (ranges.length > 0) cf.cidrs = ranges;
    }
  } catch {
    // keep bundled fallback
  }
  return providers;
}
