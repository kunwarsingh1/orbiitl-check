/**
 * Queries crt.sh's JSON endpoint for certificates issued to `domain` and
 * its subdomains. This surfaces hostnames that were never linked from the
 * site itself (e.g. "origin.example.com", "direct.example.com") but had a
 * cert issued at some point -- often the fingerprint of a pre-CDN origin
 * server that's still reachable.
 *
 * crt.sh is a public, free community service (no auth/key). We query it
 * directly, not through the target, so it is NOT subject to the scan's
 * request budget/throttle for the target host.
 */
export async function queryCrtSh(domain: string, timeoutMs: number): Promise<string[]> {
  const url = `https://crt.sh/?q=${encodeURIComponent("%." + domain)}&output=json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { "User-Agent": "production-checker/0.1" },
    });
    if (!res.ok) return [];
    const text = await res.text();
    if (!text.trim()) return [];
    let rows: Array<{ name_value?: string }>;
    try {
      rows = JSON.parse(text);
    } catch {
      return [];
    }
    const names = new Set<string>();
    for (const row of rows) {
      const raw = row.name_value ?? "";
      for (const line of raw.split("\n")) {
        const clean = line.trim().toLowerCase().replace(/^\*\./, "");
        if (clean && clean.endsWith(domain.toLowerCase())) {
          names.add(clean);
        }
      }
    }
    return Array.from(names);
  } catch {
    return []; // crt.sh being slow/down should never fail the whole scan
  } finally {
    clearTimeout(timer);
  }
}
