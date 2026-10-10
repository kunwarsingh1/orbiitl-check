import { Chalk } from "chalk";
import type { Finding, ScanResult, Severity, Stage } from "../types.js";
import type { FailedTarget } from "./json.js";
import { LEVEL_LABEL, levelTag } from "./labels.js";

export interface TerminalOptions {
  /** Emit ANSI colors. Defaults to chalk's own terminal detection. */
  color?: boolean;
  /** Wrap width; defaults to the terminal width, clamped to 60-110. */
  width?: number;
}

const SEVERITY_ORDER: Severity[] = ["high", "medium", "low", "info"];
const SEVERITY_ICON: Record<Severity, string> = { high: "✖", medium: "▲", low: "●", info: "ℹ" };
const MAX_EVIDENCE_LINES = 4;

/** Word-wraps `text` to `width`, preserving existing line breaks. */
export function wrap(text: string, width: number): string[] {
  const out: string[] = [];
  for (const para of text.split("\n")) {
    let line = "";
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && line.length + 1 + word.length > width) {
        out.push(line);
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    out.push(line);
  }
  return out;
}

export function renderTerminalReport(result: ScanResult, opts: TerminalOptions = {}): string {
  const c = opts.color === undefined ? new Chalk() : new Chalk({ level: opts.color ? 2 : 0 });
  const cols = opts.width ?? process.stdout.columns ?? 100;
  const width = Math.max(60, Math.min(110, cols));
  const rule = c.dim("─".repeat(width));

  const severityStyle: Record<Severity, (s: string) => string> = {
    high: (s) => c.red.bold(s),
    medium: (s) => c.yellow.bold(s),
    low: (s) => c.cyan(s),
    info: (s) => c.gray(s),
  };

  const lines: string[] = [];
  lines.push("");
  lines.push(`${c.bold("orbiitl-check")}  ${c.dim("·")}  ${c.cyan(result.target)}`);
  lines.push(c.dim(`scanned in ${(result.durationMs / 1000).toFixed(1)}s · ${result.requestsMade} requests`));
  lines.push("");

  if (result.findings.length === 0) {
    lines.push(c.green("✔ No findings. Nothing suspicious detected by the checks run."));
    lines.push("");
    return lines.join("\n");
  }

  // --- Summary -------------------------------------------------------------
  const sevCounts: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of result.findings) sevCounts[f.severity]++;
  const stageCounts: Record<Stage, number> = { development: 0, deployment: 0, infrastructure: 0 };
  for (const f of result.findings) stageCounts[f.stage]++;

  lines.push(rule);
  lines.push(
    `${c.bold("Findings")}   ` +
      SEVERITY_ORDER.map((s) =>
        sevCounts[s] > 0 ? severityStyle[s](`${SEVERITY_ICON[s]} ${sevCounts[s]} ${s}`) : c.dim(`${SEVERITY_ICON[s]} 0 ${s}`)
      ).join("   ")
  );
  const stageOrder: Stage[] = ["development", "deployment", "infrastructure"];
  stageOrder
    .filter((s) => stageCounts[s] > 0)
    .forEach((s, i) => {
      lines.push(`${c.dim((i === 0 ? "Layers" : "").padEnd(8))}   ${String(stageCounts[s]).padStart(2)}  ${LEVEL_LABEL[s]}`);
    });
  lines.push(rule);
  lines.push("");

  // --- Findings, worst first ----------------------------------------------
  for (const severity of SEVERITY_ORDER) {
    const group = result.findings.filter((f) => f.severity === severity);
    if (group.length === 0) continue;
    lines.push(severityStyle[severity](`${severity.toUpperCase()} (${group.length})`));
    lines.push("");
    for (const f of group) {
      lines.push(...renderFinding(f, c, severityStyle, width));
      lines.push("");
    }
  }

  return lines.join("\n");
}

function renderFinding(
  f: Finding,
  c: InstanceType<typeof Chalk>,
  severityStyle: Record<Severity, (s: string) => string>,
  width: number
): string[] {
  const indent = "    ";
  const labelWidth = 9;
  const bodyWidth = width - indent.length - labelWidth;
  const out: string[] = [];

  out.push(`  ${severityStyle[f.severity](SEVERITY_ICON[f.severity])} ${c.bold(f.title)}`);
  out.push(`${indent}${c.magenta(levelTag(f))} ${c.dim("·")} ${f.confidence === "confirmed" ? c.green(f.confidence) : c.yellow(f.confidence)}`);

  const field = (label: string, text: string, style: (s: string) => string = (s) => s): void => {
    const wrapped = wrap(text, bodyWidth);
    wrapped.forEach((line, i) => {
      out.push(`${indent}${i === 0 ? c.dim(label.padEnd(labelWidth)) : " ".repeat(labelWidth)}${style(line)}`);
    });
  };

  field("What", f.description);
  if (f.url) field("URL", f.url, c.cyan);
  else if (f.affectedFile) field("File", f.affectedFile, c.cyan);
  if (f.evidence) {
    const evLines = f.evidence.split("\n").filter(Boolean);
    const shown = evLines.length <= MAX_EVIDENCE_LINES + 1 ? evLines : evLines.slice(0, MAX_EVIDENCE_LINES);
    field("Evidence", shown.join("\n"), c.dim);
    if (evLines.length > shown.length) {
      out.push(`${indent}${" ".repeat(labelWidth)}${c.dim(`… and ${evLines.length - shown.length} more`)}`);
    }
  }
  if (f.remediation) field("Fix", f.remediation);
  if (f.reproCommand) field("Verify", f.reproCommand, c.dim);
  return out;
}

/** Aggregate table printed after the per-target reports of a bulk run, worst target first. */
export function renderBulkSummary(results: ScanResult[], failed: FailedTarget[], opts: TerminalOptions = {}): string {
  const c = opts.color === undefined ? new Chalk() : new Chalk({ level: opts.color ? 2 : 0 });
  const cols = opts.width ?? process.stdout.columns ?? 100;
  const width = Math.max(60, Math.min(110, cols));
  const count = (r: ScanResult, s: Severity) => r.findings.filter((f) => f.severity === s).length;

  const rows = results
    .map((r) => ({ target: r.target, high: count(r, "high"), medium: count(r, "medium"), low: count(r, "low"), info: count(r, "info") }))
    .sort((a, b) => b.high - a.high || b.medium - a.medium || b.low - a.low || a.target.localeCompare(b.target));

  const targetWidth = Math.max(6, Math.min(width - 28, Math.max(...rows.map((r) => r.target.length), 6)));
  const num = (n: number, style: (s: string) => string) => (n > 0 ? style(String(n).padStart(4)) : c.dim("   -"));
  const lines: string[] = [];
  lines.push("");
  lines.push(c.dim("─".repeat(width)));
  lines.push(c.bold(`Bulk summary: ${results.length} scanned${failed.length ? `, ${failed.length} failed` : ""}`));
  lines.push(c.dim(`${"Target".padEnd(targetWidth)}  ${"High".padStart(4)} ${"Med".padStart(4)} ${"Low".padStart(4)} ${"Info".padStart(4)}`));
  for (const r of rows) {
    const t = r.target.length > targetWidth ? `${r.target.slice(0, targetWidth - 1)}…` : r.target.padEnd(targetWidth);
    lines.push(`${t}  ${num(r.high, c.red.bold)} ${num(r.medium, c.yellow)} ${num(r.low, c.cyan)} ${num(r.info, c.gray)}`);
  }
  for (const f of failed) lines.push(`${c.red("✖")} ${f.target}  ${c.dim(f.error)}`);
  lines.push(c.dim("─".repeat(width)));
  lines.push("");
  return lines.join("\n");
}
