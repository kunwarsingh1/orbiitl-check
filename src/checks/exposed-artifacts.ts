import { URL } from "node:url";
import { PROBE_PATHS, SOURCE_EXTENSION_GUESSES, type ProbePath } from "../config/paths.js";
import { HttpClient } from "../net/http.js";
import { runPool } from "../utils/concurrency.js";
import { simpleHash } from "../utils/fingerprint.js";
import type { Finding, ScanContext } from "../types.js";
import { RequestBudgetExceededError } from "../utils/rate-limit.js";

interface Baseline {
  status: number;
  hash: string;
  length: number;
}

export async function checkExposedArtifacts(ctx: ScanContext, baseUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const http = new HttpClient(ctx);
  const base = new URL(baseUrl);

  // Baseline: fetch a near-certainly-nonexistent path so we can recognize
  // custom "soft 404" pages that return HTTP 200 with a generic error page.
  // Any probe response matching this baseline's hash/length is NOT a real hit.
  let baseline: Baseline | null = null;
  try {
    const nonceePath = `/__production-checker-404-probe-${Date.now().toString(36)}__`;
    const res = await http.fetch(new URL(nonceePath, base).toString());
    baseline = { status: res.status, hash: simpleHash(res.body), length: res.body.length };
    ctx.log(`Baseline 404 established: status ${res.status}, ${res.body.length} bytes`);
  } catch (err) {
    if (err instanceof RequestBudgetExceededError) throw err;
    ctx.log("  could not establish a 404 baseline; false positives are more likely");
  }

  // Fetch homepage to discover referenced JS bundles (for sourcemap / source-extension guessing).
  let homepageBody = "";
  try {
    const res = await http.fetch(baseUrl);
    homepageBody = res.body;
  } catch (err) {
    if (err instanceof RequestBudgetExceededError) throw err;
  }

  const isHit = (res: { status: number; body: string }): boolean => {
    if (res.status !== 200) return false;
    if (!baseline) return true;
    if (res.status === baseline.status && (simpleHash(res.body) === baseline.hash || res.body.length === baseline.length)) {
      return false; // matches the soft-404 fingerprint
    }
    return true;
  };

  const sanityCheck = (res: { body: string }, probe: ProbePath): boolean => {
    if (!probe.sanityMarkers || probe.sanityMarkers.length === 0) return true;
    return probe.sanityMarkers.some((marker) => res.body.includes(marker));
  };

  ctx.log(`Probing ${PROBE_PATHS.length} known dev/build-artifact paths...`);
  const probeTasks = PROBE_PATHS.map((probe) => async () => {
    try {
      const fullUrl = new URL(probe.path, base).toString();
      const res = await http.fetch(fullUrl);
      if (isHit(res) && sanityCheck(res, probe)) {
        findings.push({
          id: `exposed-artifacts.${probe.path}`,
          category: "exposed-artifacts",
          severity: probe.severity,
          stage: "development",
          fixOwner: "ci-pipeline",
          confidence: "confirmed",
          title: probe.title,
          description: `${probe.path} returned HTTP ${res.status} with content that doesn't match this site's 404 page, indicating it is actually served.`,
          url: fullUrl,
          remediation: remediationFor(probe),
          reproCommand: `curl -sI '${fullUrl}'`,
          affectedFile: probe.path.replace(/^\//, ""),
        });
      }
    } catch (err) {
      if (err instanceof RequestBudgetExceededError) throw err;
      // network error on a single probe path is not worth reporting; skip it
    }
  });

  try {
    await runPool(probeTasks, ctx.options.concurrency);
  } catch (err) {
    if (err instanceof RequestBudgetExceededError) {
      ctx.log(`  stopped probing: ${err.message}`);
    } else {
      throw err;
    }
  }

  // --- Sourcemap and un-built-source discovery from referenced bundles ---
  const scriptSrcs = extractScriptSrcs(homepageBody, baseUrl);
  const bundlesToCheck = scriptSrcs.filter((src) => src.endsWith(".js")).slice(0, 15); // bound this

  if (bundlesToCheck.length > 0) {
    ctx.log(`Checking ${bundlesToCheck.length} referenced JS bundle(s) for sourcemaps / unbuilt source...`);
    const bundleTasks = bundlesToCheck.map((bundleUrl) => async () => {
      let bundleBody = "";
      try {
        const res = await http.fetch(bundleUrl);
        if (res.status !== 200) return;
        bundleBody = res.body;
      } catch (err) {
        if (err instanceof RequestBudgetExceededError) throw err;
        return;
      }

      // 1) Sourcemap reference
      const mapMatch = bundleBody.match(/\/\/#\s*sourceMappingURL=([^\s]+)/);
      if (mapMatch) {
        const mapUrl = new URL(mapMatch[1], bundleUrl).toString();
        try {
          const mapRes = await http.fetch(mapUrl);
          if (mapRes.status === 200 && isHit(mapRes)) {
            findings.push({
              id: `exposed-artifacts.sourcemap.${mapUrl}`,
              category: "exposed-artifacts",
              severity: "high",
              stage: "development",
              fixOwner: "ci-pipeline",
              confidence: "confirmed",
              title: "Sourcemap exposed (full original source reconstructable)",
              description: `${bundleUrl} references a sourcemap at ${mapUrl}, which is publicly accessible. Sourcemaps let anyone reconstruct your original, unminified source code including comments and file paths.`,
              url: mapUrl,
              remediation: "Do not deploy .map files to production, or restrict access to them (e.g. via build config `productionBrowserSourceMaps: false` in Next.js, or excluding .map from the deploy artifact).",
              reproCommand: `curl -s '${mapUrl}' | head -c 500`,
              affectedFile: new URL(mapUrl).pathname.replace(/^\//, ""),
            });
          }
        } catch (err) {
          if (err instanceof RequestBudgetExceededError) throw err;
        }
      }

      // 2) Try swapping the built .js extension for common unbuilt-source extensions.
      for (const ext of SOURCE_EXTENSION_GUESSES) {
        const guessUrl = bundleUrl.replace(/\.js(\?.*)?$/, ext);
        if (guessUrl === bundleUrl) continue;
        try {
          const guessRes = await http.fetch(guessUrl);
          if (isHit(guessRes) && looksLikeSource(guessRes.body)) {
            findings.push({
              id: `exposed-artifacts.unbuilt-source.${guessUrl}`,
              category: "exposed-artifacts",
              severity: "high",
              stage: "development",
              fixOwner: "ci-pipeline",
              confidence: "confirmed",
              title: `Unbuilt source file exposed (${ext})`,
              description: `${guessUrl} (derived by swapping the extension of a referenced bundle ${bundleUrl}) is publicly served and looks like unbuilt source code rather than a compiled bundle.`,
              url: guessUrl,
              remediation: "Ensure your web server / static host only serves the build output directory, not the project source tree.",
              reproCommand: `curl -s '${guessUrl}' | head -c 500`,
              affectedFile: new URL(guessUrl).pathname.replace(/^\//, ""),
            });
          }
        } catch (err) {
          if (err instanceof RequestBudgetExceededError) throw err;
        }
      }
    });

    try {
      await runPool(bundleTasks, ctx.options.concurrency);
    } catch (err) {
      if (err instanceof RequestBudgetExceededError) {
        ctx.log(`  stopped bundle checks: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  return findings;
}

function extractScriptSrcs(html: string, baseUrl: string): string[] {
  const srcs = new Set<string>();
  const re = /<script[^>]+src=["']([^"']+)["']/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      srcs.add(new URL(m[1], baseUrl).toString());
    } catch {
      // ignore malformed URLs
    }
  }
  return Array.from(srcs);
}

function looksLikeSource(body: string): boolean {
  // Heuristic: unbuilt TS/JSX source tends to have readable identifiers,
  // import statements, and JSX-like tags; minified bundles are dense single-line blobs.
  if (body.length === 0) return false;
  const hasImport = /\bimport\s+.+\s+from\s+['"]/.test(body) || /\brequire\(/.test(body);
  const looksMinified = body.split("\n").length < 5 && body.length > 2000;
  return hasImport && !looksMinified;
}

function remediationFor(probe: ProbePath): string {
  if (probe.path.startsWith("/.git")) {
    return "Remove the .git directory from the deployed artifact, or block it at the web server/CDN level.";
  }
  if (probe.path.includes(".env")) {
    return "Never deploy .env files; inject secrets via your platform's environment variable / secrets manager instead.";
  }
  if (probe.path.includes("node_modules")) {
    return "Configure your web server/static host to serve only the build output directory, not the project root.";
  }
  return "Restrict access to this path at the web server or CDN level, or remove it from the deployed artifact.";
}
