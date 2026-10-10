import { URL } from "node:url";
import { PROBE_PATHS, SOURCE_EXTENSION_GUESSES, type ProbePath } from "../config/paths.js";
import { HttpClient } from "../net/http.js";
import { runPool } from "../utils/concurrency.js";
import { simpleHash } from "../utils/fingerprint.js";
import type { Finding, ScanContext } from "../types.js";
import { RequestBudgetExceededError } from "../utils/rate-limit.js";

const MAX_BUNDLES = 40; // entry bundles + lazy chunks, total
const MAP_MAX_BYTES = 8 * 1024 * 1024; // sourcemaps are large; parse them whole when possible

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
    const nonceePath = `/__orbiitl-check-404-probe-${Date.now().toString(36)}__`;
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
          alsoFixableAt: ["deployment"],
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
    // Lazy chunks (route/dynamic-import chunks) aren't <script> tags in the HTML; they're
    // named inside the entry bundles and the HTML flight data. Collect them so their
    // sourcemaps get checked too, within a hard cap.
    const seenBundles = new Set<string>(bundlesToCheck.map(stripQuery));
    const lazyChunks: string[] = [];
    const discover = (text: string, fromUrl: string): void => {
      for (const u of extractChunkUrls(text, fromUrl)) {
        const key = stripQuery(u);
        if (seenBundles.has(key) || seenBundles.size >= MAX_BUNDLES) continue;
        seenBundles.add(key);
        lazyChunks.push(u);
      }
    };
    discover(homepageBody, baseUrl);
    const makeBundleTask = (bundleUrl: string, isLazy: boolean) => async () => {
      let bundleBody = "";
      let bundleTail = "";
      try {
        const res = await http.fetch(bundleUrl);
        if (res.status !== 200) return;
        bundleBody = res.body;
        bundleTail = res.tail;
        if (!isLazy) discover(bundleBody, bundleUrl);
      } catch (err) {
        if (err instanceof RequestBudgetExceededError) throw err;
        return;
      }

      // 1) Sourcemap reference
      // The comment sits at the very end of the file, which is past the body cap
      // for large bundles, so search the preserved tail as well.
      const mapMatch = (bundleTail + "\n" + bundleBody).match(/\/\/[#@]\s*sourceMappingURL=([^\s]+)/);
      const mapRef = mapMatch ? mapMatch[1] : `${bundleUrl.replace(/\?.*$/, "")}.map`;
      if (mapRef && !mapRef.startsWith("data:")) {
        const mapUrl = new URL(mapRef, bundleUrl).toString();
        try {
          const mapRes = await http.fetch(mapUrl, { maxBodyBytes: MAP_MAX_BYTES });
          if (mapRes.status === 200 && isHit(mapRes)) {
            const summary = summarizeSourceMap(mapRes.body);
            findings.push({
              id: `exposed-artifacts.sourcemap.${mapUrl}`,
              category: "exposed-artifacts",
              severity: summary ? "high" : "medium",
              stage: "development",
              alsoFixableAt: ["deployment"],
              fixOwner: "ci-pipeline",
              confidence: summary ? "confirmed" : "likely",
              title: "Sourcemap exposed (full original source reconstructable)",
              description:
                `${bundleUrl} references a sourcemap at ${mapUrl}, which is publicly accessible. Sourcemaps let anyone reconstruct your original, unminified source code including comments and file paths.` +
                (summary
                  ? ` Parsed map lists ${summary.total} source file(s): ${summary.appSources} application (src), ${summary.nodeModules} from node_modules; sourcesContent ${summary.hasSourcesContent === null ? "could not be determined (map larger than the download cap)" : summary.hasSourcesContent ? "IS embedded (full source recoverable)" : "is not embedded"}.${summary.partial ? " The map was larger than the download cap, so the list was read from its first part and counts are exact for `sources` only." : ""}`
                  : " The response did not parse as a sourcemap JSON document (possibly truncated or a non-map 200 page), so this is unverified."),
              evidence: summary ? summary.examples.join("\n") : undefined,
              url: mapUrl,
              remediation: "Do not deploy .map files to production, or restrict access to them (e.g. via build config `productionBrowserSourceMaps: false` in Next.js, or excluding .map from the deploy artifact). Deployment-level stopgap: block `*.map` at the proxy (Caddy: `@maps path *.map` then `respond @maps 404`).",
              reproCommand: `curl -s '${mapUrl}' | head -c 500`,
              affectedFile: new URL(mapUrl).pathname.replace(/^\//, ""),
            });
          }
        } catch (err) {
          if (err instanceof RequestBudgetExceededError) throw err;
        }
      }

      // 2) Try swapping the built .js extension for common unbuilt-source extensions.
      // (Entry bundles only: guessing on every lazy chunk would burn the request budget.)
      for (const ext of isLazy ? [] : SOURCE_EXTENSION_GUESSES) {
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
              alsoFixableAt: ["deployment"],
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
    };

    try {
      await runPool(
        bundlesToCheck.map((u) => makeBundleTask(u, false)),
        ctx.options.concurrency
      );
      if (lazyChunks.length > 0) {
        ctx.log(`Checking ${lazyChunks.length} lazy-loaded chunk(s) discovered from entry bundles...`);
        await runPool(
          lazyChunks.map((u) => makeBundleTask(u, true)),
          ctx.options.concurrency
        );
      }
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

function stripQuery(u: string): string {
  return u.replace(/[?#].*$/, "");
}

/**
 * Finds JS chunk URLs named inside HTML / bundle text: absolute-path or
 * `_next`-relative strings like "/_next/static/chunks/app/page-ab12.js" or
 * "static/chunks/293-ab12.js", and webpack-style "./chunk.js" imports
 * (resolved against the file they appear in).
 */
export function extractChunkUrls(text: string, fromUrl: string): string[] {
  const out = new Set<string>();
  const origin = new URL(fromUrl).origin;
  const add = (ref: string, base: string): void => {
    try {
      const u = new URL(ref, base);
      if (u.origin === origin && u.pathname.endsWith(".js")) out.add(u.toString());
    } catch {
      // ignore malformed
    }
  };
  let m: RegExpExecArray | null;
  // The leading/trailing quote may be a JSON-escaped quote (\") inside RSC flight data.
  const nextRe = /["'\\]((?:\/_next\/)?static\/[\w\-./%[\]()]+?\.js)(?:\?[^"'\s\\]*)?["'\\]/g;
  while ((m = nextRe.exec(text))) add(m[1].startsWith("/") ? m[1] : `/_next/${m[1]}`, origin);
  const relRe = /["'](\.{1,2}\/[\w\-./]+?\.js)["']/g;
  while ((m = relRe.exec(text))) add(m[1], fromUrl);
  return Array.from(out);
}

interface SourceMapSummary {
  total: number;
  nodeModules: number;
  appSources: number;
  /** true/false when known; null when the map was cut off before `sourcesContent` could be seen. */
  hasSourcesContent: boolean | null;
  /** True when the body was not complete JSON and `sources` was recovered from the readable prefix. */
  partial: boolean;
  examples: string[];
}

/**
 * Reads the `"sources": [...]` array out of a possibly truncated sourcemap body.
 * Bundlers write `sources` before `sourcesContent`/`mappings`, so it is usually
 * fully inside the prefix even when a 15 MB map was cut at the download cap.
 * Returns null if there is no complete `sources` array.
 */
function extractSourcesFromPrefix(body: string): string[] | null {
  const start = /"sources"\s*:\s*\[/.exec(body);
  if (!start) return null;
  const out: string[] = [];
  const item = /\s*("(?:[^"\\]|\\.)*")\s*([,\]])/y;
  item.lastIndex = start.index + start[0].length;
  if (/\s*\]/y.test(body.slice(item.lastIndex, item.lastIndex + 8))) return out; // empty array
  for (;;) {
    const m = item.exec(body);
    if (!m) return null; // cut off mid-array, or not a sources array
    try {
      out.push(JSON.parse(m[1]) as string);
    } catch {
      return null;
    }
    if (m[2] === "]") return out;
  }
}

/**
 * Summarizes a sourcemap body; returns null if it doesn't look like a sourcemap.
 * Works on truncated bodies (`partial: true`) by recovering the `sources` list.
 */
export function summarizeSourceMap(body: string): SourceMapSummary | null {
  let sources: string[] | null = null;
  let hasSourcesContent: boolean | null = null;
  let partial = false;

  try {
    const map = JSON.parse(body) as { sources?: unknown; sourcesContent?: unknown };
    if (!map || !Array.isArray(map.sources)) return null;
    sources = map.sources.filter((x): x is string => typeof x === "string");
    hasSourcesContent =
      Array.isArray(map.sourcesContent) && map.sourcesContent.some((c) => typeof c === "string" && c.length > 0);
  } catch {
    // Not complete JSON (most likely cut at the download cap): recover what is readable.
    if (!/^\s*\{/.test(body)) return null;
    sources = extractSourcesFromPrefix(body);
    if (!sources) return null;
    partial = true;
    const content = /"sourcesContent"\s*:\s*\[\s*(null|"|\])/.exec(body);
    if (content) hasSourcesContent = content[1] === '"';
  }

  const nodeModules = sources.filter((x) => x.includes("node_modules")).length;
  const app = sources.filter((x) => !x.includes("node_modules"));
  return {
    total: sources.length,
    nodeModules,
    appSources: app.length,
    hasSourcesContent,
    partial,
    examples: (app.length > 0 ? app : sources).slice(0, 5),
  };
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
