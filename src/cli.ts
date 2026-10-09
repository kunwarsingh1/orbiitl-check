#!/usr/bin/env node
import { Command } from "commander";
import { writeFile } from "node:fs/promises";
import { runScan } from "./scanner.js";
import { renderTerminalReport } from "./report/terminal.js";
import { renderJsonReport } from "./report/json.js";
import { renderMarkdownReport, renderHtmlReport } from "./report/markdown.js";
import type { ScanOptions } from "./types.js";

const program = new Command();

program
  .name("production-checker")
  .description(
    "Audits a deployed web app for production-readiness leaks: exposed origin IPs behind Cloudflare/CDN, " +
      "leaked node_modules/source/.env/.git, sourcemaps, and other dev artifacts. Works against Node and Python apps."
  )
  .requiredOption("--app <url>", "target base URL, e.g. https://target.com")
  .option("--json", "emit JSON to stdout instead of the terminal report", false)
  .option("--output <file>", "write a report to disk; format inferred from extension (.md or .html)")
  .option("--concurrency <n>", "max concurrent requests", "5")
  .option("--delay <ms>", "delay between requests to the target, in ms", "150")
  .option("--timeout <ms>", "per-request timeout, in ms", "8000")
  .option("--max-requests <n>", "hard cap on total requests made to the target", "150")
  .option("--skip-origin-ip", "disable the origin IP / CDN-bypass check", false)
  .option("--skip-artifacts", "disable the exposed dev/build-artifact check", false)
  .option("--skip-headers", "disable the security-headers check", false)
  .option("--deep", "launch a headless browser to catch console-logged secrets and leaked framework state (requires the optional 'playwright' dependency)", false)
  .option("--screenshot <file>", "with --deep, save a full-page screenshot of the homepage to this path")
  .option("--no-color", "disable ANSI colors in terminal output")
  .option("--verbose", "log each probe as it happens", false)
  .version("0.1.0");

program.parse();

const opts = program.opts();

const options: ScanOptions = {
  app: opts.app,
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

async function main() {
  let result;
  try {
    result = await runScan(options);
  } catch (err) {
    console.error(`production-checker: scan failed: ${(err as Error).message}`);
    process.exitCode = 2;
    return;
  }

  if (options.json) {
    console.log(renderJsonReport(result));
  } else {
    console.log(renderTerminalReport(result));
  }

  if (options.output) {
    const isHtml = options.output.toLowerCase().endsWith(".html");
    const content = isHtml ? renderHtmlReport(result) : renderMarkdownReport(result);
    await writeFile(options.output, content, "utf8");
    console.error(`\nReport written to ${options.output}`);
  }

  const hasHigh = result.findings.some((f) => f.severity === "high");
  process.exitCode = hasHigh ? 1 : 0;
}

main();
