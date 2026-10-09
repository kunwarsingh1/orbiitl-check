import type { Finding, ScanResult, Severity, Stage } from "../types.js";

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"];
const SEVERITY_EMOJI: Record<Severity, string> = {
  high: "🔴",
  medium: "🟠",
  low: "🔵",
  info: "⚪",
};
const STAGE_LABEL: Record<Stage, string> = {
  development: "development (code/build)",
  deployment: "deployment (server config)",
  infrastructure: "infrastructure (DNS/network)",
};

export function renderMarkdownReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push(`# production-checker report: ${result.target}`);
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
    .map((s) => `${stageCounts[s]} ${STAGE_LABEL[s]}`);
  if (stageParts.length > 0) lines.push(`**By stage:** ${stageParts.join(", ")}`);
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
  parts.push(`\n- **Stage:** ${f.stage} (owner: ${f.fixOwner})`);
  parts.push(`- **Confidence:** ${f.confidence}`);
  if (f.affectedFile) parts.push(`- **File:** ${f.affectedFile}`);
  if (f.url) parts.push(`- **URL:** ${f.url}`);
  if (f.evidence) parts.push(`- **Evidence:** ${f.evidence}`);
  if (f.remediation) parts.push(`- **Fix:** ${f.remediation}`);
  if (f.reproCommand) parts.push(`- **Repro:** \`${f.reproCommand}\``);
  return parts.join("\n");
}

export function renderHtmlReport(result: ScanResult): string {
  const md = renderMarkdownReport(result);
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
<title>production-checker report: ${escapeHtml(result.target)}</title>
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
