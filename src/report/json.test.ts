import { describe, expect, it } from "vitest";
import { renderBulkJsonReport, renderJsonReport } from "./json.js";
import type { Finding, ScanResult } from "../types.js";

const f = (over: Partial<Finding>): Finding => ({
  id: "a",
  title: "t",
  severity: "low",
  category: "headers",
  stage: "deployment",
  fixOwner: "deployment",
  confidence: "confirmed",
  description: "d",
  ...over,
});

const result = (findings: Finding[]): ScanResult => ({
  target: "https://example.com/",
  startedAt: "s",
  finishedAt: "e",
  durationMs: 10,
  findings,
  requestsMade: 3,
});

describe("renderJsonReport", () => {
  const doc = JSON.parse(
    renderJsonReport(
      result([
        f({ id: "b-low" }),
        f({ id: "a-high", severity: "high", stage: "development", alsoFixableAt: ["deployment"], fixOwner: "ci-pipeline" }),
        f({ id: "c-med", severity: "medium", stage: "infrastructure", fixOwner: "infra" }),
      ])
    )
  );

  it("sorts findings worst-first", () => {
    expect(doc.findings.map((x: { id: string }) => x.id)).toEqual(["a-high", "c-med", "b-low"]);
  });

  it("includes a summary with counts and the CLI exit code", () => {
    expect(doc.summary).toEqual({
      total: 3,
      bySeverity: { high: 1, medium: 1, low: 1, info: 0 },
      byLevel: { code: 1, deployment: 1, infrastructure: 1 },
      exitCode: 1,
    });
  });

  it("names levels like the reports and always emits every field", () => {
    const high = doc.findings[0];
    expect(high.levels).toEqual(["code", "deployment"]);
    expect(high.stage).toBe("development"); // original field kept
    const low = doc.findings[2];
    expect(low.alsoFixableAt).toEqual([]);
    expect(low.evidence).toBeNull();
    expect(Object.keys(low)).toEqual(Object.keys(high));
  });
});

describe("renderBulkJsonReport", () => {
  const clean = { ...result([]), target: "https://clean.example.com/" };
  const bad = { ...result([f({ id: "x", severity: "high", stage: "development", fixOwner: "ci-pipeline" })]), target: "https://bad.example.com/" };
  const doc = JSON.parse(renderBulkJsonReport([clean, bad], [{ target: "https://down.example.com/", error: "target unreachable" }]));

  it("aggregates counts and counts failed targets separately", () => {
    expect(doc.mode).toBe("bulk");
    expect(doc.summary).toMatchObject({ targets: 3, scanned: 2, failed: 1, totalFindings: 1, exitCode: 1 });
    expect(doc.summary.bySeverity.high).toBe(1);
  });

  it("lists the worst target first in the overview and keeps per-target documents", () => {
    expect(doc.overview.map((o: { target: string }) => o.target)).toEqual(["https://bad.example.com/", "https://clean.example.com/"]);
    expect(doc.results).toHaveLength(2);
    expect(doc.failed).toEqual([{ target: "https://down.example.com/", error: "target unreachable" }]);
  });

  it("exits 2 when nothing could be scanned", () => {
    const none = JSON.parse(renderBulkJsonReport([], [{ target: "https://down.example.com/", error: "x" }]));
    expect(none.summary.exitCode).toBe(2);
  });
});
