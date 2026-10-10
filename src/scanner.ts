import type { Finding, ScanContext, ScanOptions, ScanResult } from "./types.js";
import { checkOriginIp } from "./checks/origin-ip.js";
import { checkExposedArtifacts } from "./checks/exposed-artifacts.js";
import { checkHeaders } from "./checks/headers.js";
import { checkBrowser } from "./checks/browser.js";
import { RequestBudgetExceededError } from "./utils/rate-limit.js";
import { rawFetch } from "./net/http.js";

export async function runScan(options: ScanOptions): Promise<ScanResult> {
  const startedAt = new Date();
  const requestCounter = { count: 0 };
  const log = options.verbose || !options.json ? (msg: string) => console.error(msg) : () => {};

  const ctx: ScanContext = { options, log, requestCounter };
  const findings: Finding[] = [];

  const normalizedUrl = normalizeTarget(options.app);

  // Every check swallows network errors per request, so an unreachable host would
  // otherwise come back as a clean "no findings" - a false all-clear. Fail loudly instead.
  try {
    await rawFetch(normalizedUrl, { timeoutMs: options.timeout, followRedirects: false, maxBodyBytes: 1024 });
  } catch (err) {
    throw new Error(`target unreachable (${(err as Error).message || "connection failed"})`);
  }

  const checks: Array<{ name: string; run: () => Promise<Finding[]> }> = [];
  if (!options.skipOriginIp) checks.push({ name: "origin-ip", run: () => checkOriginIp(ctx, normalizedUrl) });
  if (!options.skipArtifacts) checks.push({ name: "exposed-artifacts", run: () => checkExposedArtifacts(ctx, normalizedUrl) });
  if (!options.skipHeaders) checks.push({ name: "headers", run: () => checkHeaders(ctx, normalizedUrl) });
  if (options.deep) checks.push({ name: "browser", run: () => checkBrowser(ctx, normalizedUrl) });

  for (const check of checks) {
    try {
      const results = await check.run();
      findings.push(...results);
    } catch (err) {
      if (err instanceof RequestBudgetExceededError) {
        log(`[${check.name}] ${err.message}`);
      } else {
        log(`[${check.name}] failed: ${(err as Error).message}`);
      }
    }
  }

  const finishedAt = new Date();
  return {
    target: normalizedUrl,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    findings,
    requestsMade: requestCounter.count,
  };
}

function normalizeTarget(input: string): string {
  let value = input.trim();
  if (!/^https?:\/\//i.test(value)) {
    value = `https://${value}`;
  }
  // Validate & strip trailing slash for consistent URL joins downstream.
  const url = new URL(value);
  url.pathname = url.pathname === "/" ? "/" : url.pathname;
  return url.toString();
}
