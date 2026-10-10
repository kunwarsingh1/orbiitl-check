#!/usr/bin/env node
import { Command } from "commander";
import { readFile, writeFile } from "node:fs/promises";
import { runScan } from "./scanner.js";
import { renderTerminalReport, renderBulkSummary } from "./report/terminal.js";
import { renderJsonReport, renderBulkJsonReport, type FailedTarget } from "./report/json.js";
import {
  renderMarkdownReport,
  renderHtmlReport,
  renderBulkMarkdownReport,
  renderBulkHtmlReport,
} from "./report/markdown.js";
import { parseTargetList } from "./targets.js";
import { DISCLAIMER } from "./disclaimer.js";
import type { ScanOptions, ScanResult } from "./types.js";

const program = new Command();

program
  .name("orbiitl-check")
  .description(
    "Audits a deployed web app for production-readiness leaks: exposed origin IPs behind Cloudflare/CDN, " +
      "leaked node_modules/source/.env/.git, sourcemaps, and other dev artifacts. Works against Node and Python apps."
  )
  .option("--app <url>", "target base URL, e.g. https://target.com")
  .option("--list <file>", "bulk mode: text file with one domain, subdomain or URL per line (# starts a comment)")
  .option("--confirm-authorized", "bulk mode: confirm you own, or are explicitly authorized to test, every target in the list", false)
  .option("--max-targets <n>", "bulk mode: refuse lists with more targets than this", "100")
  .option("--json", "emit JSON to stdout instead of the terminal report", false)
  .option("--output <file>", "write a report to disk; format inferred from extension (.md or .html)")
  .option("--concurrency <n>", "max concurrent requests", "5")
  .option("--delay <ms>", "delay between requests to the target, in ms", "150")
  .option("--timeout <ms>", "per-request timeout, in ms", "8000")
  .option("--max-requests <n>", "hard cap on total requests made to each target", "150")
  .option("--skip-origin-ip", "disable the origin IP / CDN-bypass check", false)
  .option("--skip-artifacts", "disable the exposed dev/build-artifact check", false)
  .option("--skip-headers", "disable the security-headers check", false)
  .option("--deep", "launch a headless browser to catch console-logged secrets and leaked framework state (requires the optional 'playwright' dependency)", false)
  .option("--screenshot <file>", "with --deep, save a full-page screenshot of the homepage to this path (single target only)")
  .option("--no-color", "disable ANSI colors in terminal output")
  .option("--verbose", "log each probe as it happens", false)
  .addHelpText(
    "after",
    `
Exit codes: 0 = no high-severity findings, 1 = at least one high-severity finding, 2 = the scan could not run.

Disclaimer: ${DISCLAIMER}`
  )
  .version("0.1.0");

program.parse();

const opts = program.opts();

const baseOptions: Omit<ScanOptions, "app"> = {
  json: Boolean(opts.json),
  output: opts.output,
  concurrency: parseIntOption(opts.concurrency, 5),
  delay: parseIntOption(opts.delay, 150),
  timeout: parseIntOption(opts.timeout, 8000),
  maxRequests: parseIntOption(opts.maxRequests, 150),
  skipOriginIp: Boolean(opts.skipOriginIp),
  skipArtifacts: Boolean(opts.skipArtifacts),
  skipHeaders: Boolean(opts.skipHeaders),
  color: opts.color !== false,
  verbose: Boolean(opts.verbose),
  deep: Boolean(opts.deep),
  screenshot: opts.screenshot,
};

function parseIntOption(value: string, fallback: number): number {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function fail(message: string): void {
  console.error(`orbiitl-check: ${message}`);
  process.exitCode = 2;
}

async function writeReport(isBulk: boolean, results: ScanResult[], failed: FailedTarget[]): Promise<void> {
  if (!baseOptions.output) return;
  const isHtml = baseOptions.output.toLowerCase().endsWith(".html");
  let content: string;
  if (isBulk) content = isHtml ? renderBulkHtmlReport(results, failed) : renderBulkMarkdownReport(results, failed);
  else content = isHtml ? renderHtmlReport(results[0]) : renderMarkdownReport(results[0]);
  await writeFile(baseOptions.output, content, "utf8");
  console.error(`\nReport written to ${baseOptions.output}`);
}

async function runSingle(): Promise<void> {
  let result: ScanResult;
  try {
    result = await runScan({ ...baseOptions, app: opts.app });
  } catch (err) {
    fail(`scan failed: ${(err as Error).message}`);
    return;
  }

  if (baseOptions.json) console.log(renderJsonReport(result));
  else console.log(renderTerminalReport(result, { color: baseOptions.color ? undefined : false }));

  await writeReport(false, [result], []);
  process.exitCode = result.findings.some((f) => f.severity === "high") ? 1 : 0;
}

async function runBulk(): Promise<void> {
  if (!opts.confirmAuthorized) {
    fail(
      "bulk mode requires --confirm-authorized, confirming you own or are explicitly authorized to test every target in the list"
    );
    return;
  }

  let text: string;
  try {
    text = await readFile(opts.list, "utf8");
  } catch (err) {
    fail(`could not read --list file: ${(err as Error).message}`);
    return;
  }

  const { targets, rejected } = parseTargetList(text);
  for (const r of rejected) console.error(`orbiitl-check: skipping line ${r.line} "${r.value}": ${r.reason}`);
  if (targets.length === 0) {
    fail("no valid targets found in the --list file");
    return;
  }
  const maxTargets = parseIntOption(opts.maxTargets, 100);
  if (targets.length > maxTargets) {
    fail(`${targets.length} targets exceeds --max-targets ${maxTargets}; raise --max-targets to confirm a larger run`);
    return;
  }
  if (baseOptions.screenshot) {
    fail("--screenshot is only supported for a single --app target");
    return;
  }

  console.error(
    `Bulk mode: ${targets.length} target(s) from ${opts.list}, scanned one at a time.\n` +
      `Only scan systems you own or are explicitly authorized to test.\n`
  );

  const results: ScanResult[] = [];
  const failed: FailedTarget[] = [];
  for (const [i, target] of targets.entries()) {
    console.error(`[${i + 1}/${targets.length}] ${target}`);
    try {
      const result = await runScan({ ...baseOptions, app: target });
      results.push(result);
      if (!baseOptions.json) console.log(renderTerminalReport(result, { color: baseOptions.color ? undefined : false }));
    } catch (err) {
      const error = (err as Error).message;
      failed.push({ target, error });
      console.error(`orbiitl-check: ${target}: scan failed: ${error}`);
    }
  }

  if (baseOptions.json) console.log(renderBulkJsonReport(results, failed));
  else console.log(renderBulkSummary(results, failed, { color: baseOptions.color ? undefined : false }));

  await writeReport(true, results, failed);

  if (results.some((r) => r.findings.some((f) => f.severity === "high"))) process.exitCode = 1;
  else if (results.length === 0) process.exitCode = 2;
  else process.exitCode = 0;
}

async function main() {
  if (opts.app && opts.list) {
    fail("use either --app <url> or --list <file>, not both");
    return;
  }
  if (!opts.app && !opts.list) {
    fail("one of --app <url> or --list <file> is required (see --help)");
    return;
  }
  if (opts.list) await runBulk();
  else await runSingle();
}

main();
