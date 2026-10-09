import { URL } from "node:url";
import { resolveHost } from "../net/dns.js";
import { queryCrtSh } from "../net/crtsh.js";
import { refreshCloudflareRanges, matchCdnByIp, matchCdnByCname } from "../config/cdn-ranges.js";
import { ORIGIN_CANDIDATE_SUBDOMAINS } from "../config/subdomains.js";
import { HttpClient } from "../net/http.js";
import { runPool } from "../utils/concurrency.js";
import type { Finding, ScanContext } from "../types.js";
import { simpleHash, extractTitle } from "../utils/fingerprint.js";

interface Candidate {
  hostname: string;
  ip: string;
  source: "subdomain-wordlist" | "crt.sh";
}

export async function checkOriginIp(ctx: ScanContext, baseUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const url = new URL(baseUrl);
  const domain = url.hostname;
  const http = new HttpClient(ctx);

  ctx.log("Checking DNS / CDN posture for the main domain...");
  const mainResolved = await resolveHost(domain);
  const providers = await refreshCloudflareRanges(ctx.options.timeout);

  const mainCdnMatches = new Set<string>();
  for (const ip of mainResolved.addresses) {
    const m = matchCdnByIp(ip, providers);
    if (m) mainCdnMatches.add(m.name);
  }
  for (const cname of mainResolved.cnames) {
    const m = matchCdnByCname(cname);
    if (m) mainCdnMatches.add(m.name);
  }

  if (mainCdnMatches.size > 0) {
    findings.push({
      id: "origin-ip.cdn-detected",
      category: "origin-ip",
      severity: "info",
      stage: "infrastructure",
      fixOwner: "infra",
      confidence: "confirmed",
      title: `Main domain is fronted by ${Array.from(mainCdnMatches).join(", ")}`,
      description:
        "The target domain resolves to a known CDN/WAF provider. This is good practice, but only protects traffic that goes through the CDN hostname -- the origin server itself may still be directly reachable.",
      reproCommand: `dig +short ${domain}`,
    });
  } else if (mainResolved.addresses.length > 0) {
    findings.push({
      id: "origin-ip.no-cdn",
      category: "origin-ip",
      severity: "medium",
      stage: "infrastructure",
      fixOwner: "infra",
      confidence: "confirmed",
      title: "Main domain does not appear to be behind a known CDN/WAF",
      description:
        `${domain} resolves directly to ${mainResolved.addresses.join(", ")}, which doesn't match any known CDN provider range. If this is intentional (e.g. you run your own reverse proxy/WAF), no action is needed -- otherwise the origin server is fully exposed to direct traffic, DDoS, and IP-based scanning.`,
      evidence: mainResolved.addresses.join(", "),
      reproCommand: `dig +short ${domain}`,
    });
  }

  // Fetch the real homepage once, through normal DNS, to build a fingerprint
  // we can compare candidate origin IPs against.
  let realFingerprint: { status: number; title: string; hash: string } | null = null;
  try {
    const res = await http.fetch(baseUrl, { method: "GET" });
    realFingerprint = { status: res.status, title: extractTitle(res.body), hash: simpleHash(res.body) };
  } catch {
    ctx.log("  (could not fetch homepage for fingerprinting; origin confirmation will be skipped)");
  }

  // --- Gather candidate hostnames/IPs ---
  const candidates: Candidate[] = [];

  ctx.log(`Checking ${ORIGIN_CANDIDATE_SUBDOMAINS.length} common origin-revealing subdomains...`);
  const subResults = await runPool(
    ORIGIN_CANDIDATE_SUBDOMAINS.map((label) => async () => {
      const host = `${label}.${domain}`;
      const resolved = await resolveHost(host);
      return { host, resolved };
    }),
    6
  );
  for (const { host, resolved } of subResults) {
    for (const ip of resolved.addresses) {
      candidates.push({ hostname: host, ip, source: "subdomain-wordlist" });
    }
  }

  ctx.log("Querying crt.sh certificate transparency logs for historical subdomains...");
  const crtNames = await queryCrtSh(domain, Math.min(ctx.options.timeout, 10000));
  const crtNamesToCheck = crtNames.filter((n) => n !== domain && !n.startsWith("*.")).slice(0, 25); // bound this
  if (crtNamesToCheck.length > 0) {
    const crtResults = await runPool(
      crtNamesToCheck.map((host) => async () => ({ host, resolved: await resolveHost(host) })),
      6
    );
    for (const { host, resolved } of crtResults) {
      for (const ip of resolved.addresses) {
        candidates.push({ hostname: host, ip, source: "crt.sh" });
      }
    }
  }

  // De-dupe by IP, prefer keeping the first hostname seen for each.
  const seenIps = new Map<string, Candidate>();
  for (const c of candidates) {
    if (!seenIps.has(c.ip)) seenIps.set(c.ip, c);
  }
  const uniqueCandidates = Array.from(seenIps.values()).filter((c) => c.ip !== mainResolved.addresses[0]);

  if (uniqueCandidates.length === 0) {
    ctx.log("  no candidate origin IPs found via subdomains or crt.sh");
    return findings;
  }

  ctx.log(`Found ${uniqueCandidates.length} candidate IP(s); checking CDN membership and confirming against homepage...`);

  for (const candidate of uniqueCandidates) {
    const provider = matchCdnByIp(candidate.ip, providers);
    if (provider) {
      // Still behind a CDN -- not an origin bypass, skip confirmation probe.
      continue;
    }

    // Try to confirm this IP actually serves the same app as the real site,
    // by connecting directly to the IP with the target's Host header + SNI.
    if (!realFingerprint) {
      findings.push({
        id: `origin-ip.candidate-unconfirmed.${candidate.ip}`,
        category: "origin-ip",
        severity: "info",
        stage: "infrastructure",
        fixOwner: "infra",
        confidence: "unconfirmed",
        title: `Unconfirmed candidate origin IP: ${candidate.ip}`,
        description: `${candidate.hostname} resolves to ${candidate.ip}, which is not in any known CDN range. Could not confirm whether it serves the same application (homepage fingerprint unavailable).`,
        evidence: `${candidate.hostname} -> ${candidate.ip} (via ${candidate.source})`,
        reproCommand: `curl -sk --resolve ${domain}:${url.port || (url.protocol === "https:" ? 443 : 80)}:${candidate.ip} ${url.protocol}//${domain}/`,
      });
      continue;
    }

    try {
      const hostForUrl = candidate.ip.includes(":") ? `[${candidate.ip}]` : candidate.ip;
      const probeUrl = `${url.protocol}//${hostForUrl}${url.port ? ":" + url.port : ""}/`;
      const res = await http.fetch(probeUrl, {
        method: "GET",
        connectIp: candidate.ip,
        hostnameForTlsAndHost: domain,
        followRedirects: false,
      });
      const candidateFingerprint = { title: extractTitle(res.body), hash: simpleHash(res.body) };
      const matches =
        res.status === realFingerprint.status &&
        (candidateFingerprint.hash === realFingerprint.hash ||
          (candidateFingerprint.title !== "" && candidateFingerprint.title === realFingerprint.title));
      const reproCommand = `curl -sk --resolve ${domain}:${url.port || (url.protocol === "https:" ? 443 : 80)}:${candidate.ip} ${url.protocol}//${domain}/`;

      if (matches) {
        findings.push({
          id: `origin-ip.confirmed.${candidate.ip}`,
          category: "origin-ip",
          severity: "high",
          stage: "infrastructure",
          fixOwner: "infra",
          confidence: "confirmed",
          title: `Origin server exposed directly at ${candidate.ip} (bypasses CDN/WAF)`,
          description:
            `Connecting directly to ${candidate.ip} with Host: ${domain} returned the same page as the real site (status ${res.status}, title "${candidateFingerprint.title}"). ` +
            `This confirms the origin server is reachable without going through ${domain}'s CDN/WAF, so any protection configured on the CDN (rate limiting, WAF rules, DDoS mitigation) can be bypassed by attacking this IP directly. ` +
            `Discovered via ${candidate.source}${candidate.source === "crt.sh" ? ` (hostname: ${candidate.hostname})` : ` (hostname: ${candidate.hostname})`}.`,
          evidence: `${candidate.hostname} -> ${candidate.ip}`,
          remediation:
            "Restrict the origin server's firewall to only accept traffic from your CDN's published IP ranges, and/or rotate to a new origin IP not previously exposed via DNS history.",
          reproCommand,
        });
      } else {
        findings.push({
          id: `origin-ip.candidate-unconfirmed.${candidate.ip}`,
          category: "origin-ip",
          severity: "low",
          stage: "infrastructure",
          fixOwner: "infra",
          confidence: "unconfirmed",
          title: `Candidate IP found but did not match homepage: ${candidate.ip}`,
          description: `${candidate.hostname} resolves to ${candidate.ip} (not a known CDN range), but a direct request with Host: ${domain} returned a different page than the real site. Likely unrelated infrastructure, but worth a manual look.`,
          evidence: `${candidate.hostname} -> ${candidate.ip}, status ${res.status}`,
          reproCommand,
        });
      }
    } catch (err) {
      findings.push({
        id: `origin-ip.candidate-unreachable.${candidate.ip}`,
        category: "origin-ip",
        severity: "info",
        stage: "infrastructure",
        fixOwner: "infra",
        confidence: "unconfirmed",
        title: `Candidate IP unreachable: ${candidate.ip}`,
        description: `${candidate.hostname} resolves to ${candidate.ip} (not a known CDN range), but a direct connection failed (${(err as Error).message}). Could not confirm or rule it out.`,
        evidence: `${candidate.hostname} -> ${candidate.ip}`,
      });
    }
  }

  return findings;
}
