import chalk from "chalk";
import type { Finding, ScanResult, Severity } from "../types.js";

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"];

const SEVERITY_COLOR: Record<Severity, (s: string) => string> = {
  high: (s) => chalk.bgRed.white.bold(` ${s} `),
  medium: (s) => chalk.yellow.bold(s),
  low: (s) => chalk.cyan(s),
  info: (s) => chalk.gray(s),
};

export function renderTerminalReport(result: ScanResult): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(chalk.bold(`production-checker report: ${result.target}`));
  lines.push(chalk.dim(`scanned in ${(result.durationMs / 1000).toFixed(1)}s, ${result.requestsMade} requests`));
  lines.push("");

  if (result.findings.length === 0) {
    lines.push(chalk.green("No findings. Nothing suspicious detected by the checks run."));
    return lines.join("\n");
  }

  const counts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of result.findings) counts[f.severity]++;

  lines.push(
    [
      counts.high ? chalk.red.bold(`${counts.high} high`) : null,
      counts.medium ? chalk.yellow(`${counts.medium} medium`) : null,
      counts.low ? chalk.cyan(`${counts.low} low`) : null,
      counts.info ? chalk.gray(`${counts.info} info`) : null,
    ]
      .filter(Boolean)
      .join("  ")
  );
  lines.push("");

  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(chalk.bold.underline(severity.toUpperCase()));
    for (const f of group) {
      lines.push(renderFinding(f));
    }
    lines.push("");
  }

  return lines.join("\n");
}

function renderFinding(f: Finding): string {
  const parts: string[] = [];
  parts.push(`  ${SEVERITY_COLOR[f.severity](f.severity)} ${chalk.bold(f.title)}`);
  parts.push(`    ${f.description}`);
  if (f.url) parts.push(chalk.dim(`    url: ${f.url}`));
  if (f.evidence) parts.push(chalk.dim(`    evidence: ${f.evidence}`));
  if (f.remediation) parts.push(chalk.dim(`    fix: ${f.remediation}`));
  return parts.join("\n");
}
