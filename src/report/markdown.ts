import type { Finding, ScanResult, Severity, Stage } from "../types.js";
import { LEVEL_LABEL, levelTag } from "./labels.js";
import type { FailedTarget } from "./json.js";

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"];
const SEVERITY_EMOJI: Record<Severity, string> = {
  high: "🔴",
  medium: "🟠",
  low: "🔵",
  info: "⚪",
};

export function renderMarkdownReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`# orbiitl-check report: ${result.target}`);
  lines.push("");
  lines.push(`Scanned in ${(result.durationMs / 1000).toFixed(1)}s, ${result.requestsMade} requests, on ${result.finishedAt}.`);
  lines.push("");

  if (result.findings.length === 0) {
    lines.push("No findings. Nothing suspicious detected by the checks run.");
    return lines.join("\n");
  }

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of result.findings) counts[f.severity]++;
  lines.push(
    `**Summary:** ${counts.high} high, ${counts.medium} medium, ${counts.low} low, ${counts.info} info`
  );

  const stageCounts: Record<Stage, number> = { development: 0, deployment: 0, infrastructure: 0 };
  for (const f of result.findings) stageCounts[f.stage]++;
  const stageParts = (Object.keys(stageCounts) as Stage[])
    .filter((s) => stageCounts[s] > 0)
    .map((s) => `${stageCounts[s]} ${LEVEL_LABEL[s]}`);
  if (stageParts.length > 0) lines.push(`**By level:** ${stageParts.join(", ")}`);
  lines.push("");

  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(`## ${SEVERITY_EMOJI[severity]} ${severity.toUpperCase()}`);
    lines.push("");
    for (const f of group) {
      lines.push(renderFindingMd(f));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderFindingMd(f: Finding): string {
  const parts: string[] = [`### ${f.title}`, "", f.description];
  parts.push(`\n- **Level:** ${levelTag(f)} (primary stage: ${f.stage}, fix owner: ${f.fixOwner})`);
  parts.push(`- **Confidence:** ${f.confidence}`);
  if (f.affectedFile) parts.push(`- **File:** ${f.affectedFile}`);
  if (f.url) parts.push(`- **URL:** ${f.url}`);
  if (f.evidence) parts.push(`- **Evidence:** ${f.evidence}`);
  if (f.remediation) parts.push(`- **Fix:** ${f.remediation}`);
  if (f.reproCommand) parts.push(`- **Repro:** \`${f.reproCommand}\``);
  return parts.join("\n");
}

/** Bulk report: an overview table, then each target's full report. */
export function renderBulkMarkdownReport(results: ScanResult[], failed: FailedTarget[] = []): string {
  const count = (r: ScanResult, s: Severity) => r.findings.filter((f) => f.severity === s).length;
  const rows = results
    .map((r) => ({ r, high: count(r, "high"), medium: count(r, "medium"), low: count(r, "low"), info: count(r, "info") }))
    .sort((a, b) => b.high - a.high || b.medium - a.medium || b.low - a.low || a.r.target.localeCompare(b.r.target));

  const lines: string[] = [];
  lines.push("# orbiitl-check bulk report");
  lines.push("");
  lines.push(`${results.length} scanned, ${failed.length} failed.`);
  lines.push("");
  lines.push("| Target | High | Medium | Low | Info |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const x of rows) lines.push(`| ${x.r.target} | ${x.high} | ${x.medium} | ${x.low} | ${x.info} |`);
  for (const f of failed) lines.push(`| ${f.target} | failed: ${f.error} | | | |`);
  lines.push("");
  for (const x of rows) {
    lines.push("---");
    lines.push("");
    // Demote each per-target report one level so the document has a single H1.
    lines.push(
      renderMarkdownReport(x.r)
        .split("\n")
        .map((l) => (/^#{1,3} /.test(l) ? `#${l}` : l))
        .join("\n")
    );
    lines.push("");
  }
  return lines.join("\n");
}

export function renderHtmlReport(result: ScanResult): string {
  return markdownToHtml(renderMarkdownReport(result), `orbiitl-check report: ${result.target}`);
}

export function renderBulkHtmlReport(results: ScanResult[], failed: FailedTarget[] = []): string {
  return markdownToHtml(renderBulkMarkdownReport(results, failed), "orbiitl-check bulk report");
}

function markdownToHtml(md: string, title: string): string {
  // Minimal, dependency-free Markdown->HTML: good enough for a quick shareable file
  // without pulling in a full markdown parser dependency.
  const escaped = md
    .split("\n")
    .map((line) => {
      if (line.startsWith("### ")) return `<h3>${escapeHtml(line.slice(4))}</h3>`;
      if (line.startsWith("## ")) return `<h2>${escapeHtml(line.slice(3))}</h2>`;
      if (line.startsWith("# ")) return `<h1>${escapeHtml(line.slice(2))}</h1>`;
      if (line.startsWith("- ")) return `<li>${escapeHtml(line.slice(2))}</li>`;
      if (line.trim() === "") return "<br/>";
      return `<p>${escapeHtml(line)}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: -apple-system, Segoe UI, Roboto, sans-serif; max-width: 860px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; }
  h1 { border-bottom: 2px solid #eee; padding-bottom: .5rem; }
  h2 { margin-top: 2rem; }
  h3 { margin-top: 1.25rem; }
  li { margin: .25rem 0 .25rem 1rem; }
</style>
</head>
<body>
${escaped}
</body>
</html>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
