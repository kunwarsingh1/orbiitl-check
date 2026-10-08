import { describe, it, expect } from "vitest";
import { renderMarkdownReport, renderHtmlReport } from "./markdown.js";
import type { ScanResult } from "../types.js";

const emptyResult: ScanResult = {
  target: "https://example.com/",
  startedAt: "2026-01-01T00:00:00.000Z",
  finishedAt: "2026-01-01T00:00:05.000Z",
  durationMs: 5000,
  findings: [],
  requestsMade: 10,
};

const resultWithFindings: ScanResult = {
  ...emptyResult,
  findings: [
    {
      id: "exposed-artifacts.env",
      category: "exposed-artifacts",
      severity: "high",
      title: ".env file exposed",
      description: "The .env file is publicly accessible.",
      url: "https://example.com/.env",
      remediation: "Remove it from the deploy.",
    },
    {
      id: "headers.no-hsts",
      category: "headers",
      severity: "low",
      title: "Missing HSTS",
      description: "No HSTS header found.",
    },
  ],
};

describe("renderMarkdownReport", () => {
  it("reports no findings cleanly", () => {
    const md = renderMarkdownReport(emptyResult);
    expect(md).toContain("No findings");
  });

  it("groups findings by severity with counts", () => {
    const md = renderMarkdownReport(resultWithFindings);
    expect(md).toContain("1 high, 0 medium, 1 low, 0 info");
    expect(md).toContain("### .env file exposed");
    expect(md).toContain("### Missing HSTS");
  });
});

describe("renderHtmlReport", () => {
  it("escapes HTML-sensitive characters and produces a doctype", () => {
    const html = renderHtmlReport(resultWithFindings);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("<h3>.env file exposed</h3>");
  });
});
