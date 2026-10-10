export type Severity = "info" | "low" | "medium" | "high";

/**
 * Where the root cause lives, so an agent (or a human triaging the report)
 * can route the finding to the right owner without re-deriving context:
 * - "development": baked into the build/repo (shipped sourcemaps, committed
 *   node_modules, unbuilt source served) - fixed in build config / .gitignore / CI.
 * - "deployment": how the running server is configured (missing headers,
 *   wrong server-level settings) - fixed in the reverse proxy / server config.
 * - "infrastructure": how/where it's hosted or networked (origin IP bypassing
 *   the CDN, firewall not restricted to CDN ranges) - fixed in DNS/firewall/hosting.
 */
export type Stage = "development" | "deployment" | "infrastructure";

/**
 * Who would actually make the fix - mirrors `stage` but phrased for routing/ownership rather than root cause.
 * - "code": the application source repo (CSP in next.config.js, console.log secrets).
 * - "ci-pipeline": build/deploy artifact config (don't ship .map files, .env, node_modules).
 * - "deployment": the reverse proxy / server config that serves the app (redirects, headers).
 * - "infra": DNS, CDN/WAF, firewall, hosting network.
 */
export type FixOwner = "code" | "ci-pipeline" | "deployment" | "infra";

/**
 * How sure we are this finding is real, distinct from `severity` (which is
 * "how bad if true"). A HIGH-severity finding can still be "unconfirmed"
 * (e.g. a candidate origin IP we couldn't reach to verify).
 */
export type Confidence = "confirmed" | "likely" | "unconfirmed";

export interface Finding {
  id: string;
  title: string;
  severity: Severity;
  category: "origin-ip" | "exposed-artifacts" | "headers" | "browser";
  /** The layer where the root cause lives (the primary place to fix it). */
  stage: Stage;
  /**
   * Other layers where the same problem can also be fixed or mitigated, e.g. a
   * shipped sourcemap is a build problem (stage "development") that can also be
   * blocked at the proxy ("deployment"). Omitted when there is only one place to fix it.
   */
  alsoFixableAt?: Stage[];
  fixOwner: FixOwner;
  confidence: Confidence;
  description: string;
  evidence?: string;
  remediation?: string;
  url?: string;
  /** Exact command to re-run and independently verify this finding (e.g. a curl invocation). */
  reproCommand?: string;
  /** Specific source file implicated, when a check can name one (e.g. a path guessed from a sourcemap/bundle). */
  affectedFile?: string;
}

export interface ScanOptions {
  app: string;
  json: boolean;
  output?: string;
  concurrency: number;
  delay: number;
  timeout: number;
  maxRequests: number;
  skipOriginIp: boolean;
  skipArtifacts: boolean;
  skipHeaders: boolean;
  color: boolean;
  verbose: boolean;
  /** Opt-in: launch a headless browser (Playwright) to catch console-logged secrets and leaked framework state that raw HTTP fetching can't see. Requires the optional `playwright` dependency + a downloaded Chromium build. */
  deep: boolean;
  /** With --deep: save a full-page screenshot of the target's homepage to this path, as visual evidence. */
  screenshot?: string;
}

export interface ScanResult {
  target: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  findings: Finding[];
  requestsMade: number;
}

export interface ScanContext {
  options: ScanOptions;
  log: (msg: string) => void;
  requestCounter: { count: number };
}
