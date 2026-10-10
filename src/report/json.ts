import type { Finding, ScanResult, Severity, Stage } from "../types.js";

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"];

/** Same names the terminal/markdown reports use ("code level" etc.), as machine-friendly values. */
const LEVEL_NAME: Record<Stage, "code" | "deployment" | "infrastructure"> = {
  development: "code",
  deployment: "deployment",
  infrastructure: "infrastructure",
};

/**
 * Bumped only on breaking changes to this document's shape. Version 1 is
 * additive over the original flat output: every original field is kept.
 */
const SCHEMA_VERSION = 1;

/**
 * Renders the machine-readable report: a summary block first, then findings
 * sorted worst-first, with a fixed key order and no optional-field gaps so
 * scripts and agents can rely on the shape.
 */
export function renderJsonReport(result: ScanResult): string {
  return JSON.stringify(buildDocument(result), null, 2);
}

function buildDocument(result: ScanResult) {
  const findings = [...result.findings]
    .sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) || a.id.localeCompare(b.id))
    .map(normalizeFinding);

  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  const byLevel = { code: 0, deployment: 0, infrastructure: 0 };
  for (const f of findings) {
    bySeverity[f.severity]++;
    byLevel[LEVEL_NAME[f.stage]]++;
  }

  return {
    schemaVersion: SCHEMA_VERSION,
    target: result.target,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
    durationMs: result.durationMs,
    requestsMade: result.requestsMade,
    summary: {
      total: findings.length,
      bySeverity,
      byLevel,
      /** What the CLI exits with: 1 if any high-severity finding, else 0. */
      exitCode: bySeverity.high > 0 ? 1 : 0,
    },
    findings,
  };
}

export interface FailedTarget {
  target: string;
  error: string;
}

/**
 * Bulk document: an aggregate summary, then one per-target document (same shape
 * as the single-target output), then the targets that could not be scanned.
 */
export function renderBulkJsonReport(results: ScanResult[], failed: FailedTarget[] = []): string {
  const docs = results.map(buildDocument);
  const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  const byLevel = { code: 0, deployment: 0, infrastructure: 0 };
  for (const d of docs) {
    for (const k of SEVERITY_ORDER) bySeverity[k] += d.summary.bySeverity[k];
    byLevel.code += d.summary.byLevel.code;
    byLevel.deployment += d.summary.byLevel.deployment;
    byLevel.infrastructure += d.summary.byLevel.infrastructure;
  }
  const exitCode = bySeverity.high > 0 ? 1 : docs.length === 0 && failed.length > 0 ? 2 : 0;
  return JSON.stringify(
    {
      schemaVersion: SCHEMA_VERSION,
      mode: "bulk",
      summary: {
        targets: results.length + failed.length,
        scanned: results.length,
        failed: failed.length,
        totalFindings: docs.reduce((n, d) => n + d.summary.total, 0),
        bySeverity,
        byLevel,
        exitCode,
      },
      /** One row per scanned target, worst first. */
      overview: docs
        .map((d) => ({ target: d.target, ...d.summary }))
        .sort(compareOverview),
      results: docs,
      failed,
    },
    null,
    2
  );
}

function compareOverview(a: { bySeverity: Record<Severity, number>; target: string }, b: typeof a): number {
  for (const s of SEVERITY_ORDER) {
    if (a.bySeverity[s] !== b.bySeverity[s]) return b.bySeverity[s] - a.bySeverity[s];
  }
  return a.target.localeCompare(b.target);
}

function normalizeFinding(f: Finding) {
  const also = (f.alsoFixableAt ?? []).filter((s) => s !== f.stage);
  return {
    id: f.id,
    title: f.title,
    severity: f.severity,
    confidence: f.confidence,
    /** Primary place to fix it, then every other layer where it can also be fixed (same naming as the reports). */
    levels: [f.stage, ...also].map((s) => LEVEL_NAME[s]),
    stage: f.stage,
    alsoFixableAt: also,
    fixOwner: f.fixOwner,
    category: f.category,
    description: f.description,
    evidence: f.evidence ?? null,
    url: f.url ?? null,
    affectedFile: f.affectedFile ?? null,
    remediation: f.remediation ?? null,
    reproCommand: f.reproCommand ?? null,
  };
}
