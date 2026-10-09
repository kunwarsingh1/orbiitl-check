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

/** Who would actually make the fix - mirrors `stage` but phrased for routing/ownership rather than root cause. */
export type FixOwner = "code" | "infra" | "ci-pipeline";

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
  category: "origin-ip" | "exposed-artifacts" | "headers";
  stage: Stage;
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
