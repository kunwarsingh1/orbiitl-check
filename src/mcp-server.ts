#!/usr/bin/env node
/**
 * MCP (Model Context Protocol) server wrapper around production-checker.
 *
 * This is deliberately a thin shell: it exposes one tool, `scan_target`,
 * whose output IS the same ScanResult/Finding shape as `production-checker
 * --json` -- no translation layer, so any MCP-aware agent (Claude Code,
 * Claude Desktop, or others) gets the structured stage/fixOwner/confidence
 * fields directly, and calls `runScan()` in-process rather than shelling
 * out to a subprocess.
 *
 * Run standalone: `production-checker-mcp` (stdio transport).
 * Configure in an MCP client as a command: `npx production-checker-mcp`.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { runScan } from "./scanner.js";
import type { ScanOptions } from "./types.js";

const server = new McpServer({
  name: "production-checker",
  version: "0.1.0",
});

server.registerTool(
  "scan_target",
  {
    title: "Scan a web app for production-readiness leaks",
    description:
      "Audits a deployed web app for: (1) origin IP exposure that bypasses its CDN/WAF (Cloudflare/Fastly/etc.), " +
      "confirmed by connecting directly to candidate IPs; (2) exposed dev/build artifacts (node_modules, .env, .git, " +
      "sourcemaps, unbuilt .tsx/.jsx source, Python requirements.txt/manage.py/__pycache__, Docker files, backups); " +
      "(3) missing/leaky security headers. Each finding is tagged with `stage` (development/deployment/infrastructure) " +
      "and `fixOwner` (code/infra/ci-pipeline) so results can be routed without re-parsing free text. " +
      "Only scan targets you own or are explicitly authorized to test.",
    inputSchema: {
      app: z.string().describe("Target base URL, e.g. https://target.com"),
      concurrency: z.number().int().positive().optional().describe("Max concurrent requests (default 5)"),
      delay: z.number().int().nonnegative().optional().describe("Delay in ms between requests to the target (default 150)"),
      timeout: z.number().int().positive().optional().describe("Per-request timeout in ms (default 8000)"),
      maxRequests: z.number().int().positive().optional().describe("Hard cap on total requests made to the target (default 150)"),
      skipOriginIp: z.boolean().optional().describe("Disable the origin IP / CDN-bypass check"),
      skipArtifacts: z.boolean().optional().describe("Disable the exposed dev/build-artifact check"),
      skipHeaders: z.boolean().optional().describe("Disable the security-headers check"),
      deep: z
        .boolean()
        .optional()
        .describe(
          "Launch a headless browser to catch console-logged secrets and leaked framework state dumps. Slower; requires the optional 'playwright' dependency + a downloaded Chromium build on the machine running this server."
        ),
    },
  },
  async (args) => {
    const options: ScanOptions = {
      app: args.app,
      json: true,
      concurrency: args.concurrency ?? 5,
      delay: args.delay ?? 150,
      timeout: args.timeout ?? 8000,
      maxRequests: args.maxRequests ?? 150,
      skipOriginIp: args.skipOriginIp ?? false,
      skipArtifacts: args.skipArtifacts ?? false,
      skipHeaders: args.skipHeaders ?? false,
      color: false,
      verbose: false,
      deep: args.deep ?? false,
    };

    try {
      const result = await runScan(options);
      const hasHigh = result.findings.some((f) => f.severity === "high");
      return {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        isError: false,
        _meta: { hasHighSeverityFinding: hasHigh },
      };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Scan failed: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("production-checker-mcp failed to start:", err);
  process.exit(1);
});
