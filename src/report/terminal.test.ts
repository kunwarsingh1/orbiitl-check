import { describe, expect, it } from "vitest";
import { renderTerminalReport, wrap } from "./terminal.js";
import type { Finding, ScanResult } from "../types.js";

const finding = (over: Partial<Finding>): Finding => ({
  id: "x",
  title: "Sourcemap exposed",
  severity: "high",
  category: "exposed-artifacts",
  stage: "development",
  alsoFixableAt: ["deployment"],
  fixOwner: "ci-pipeline",
  confidence: "confirmed",
  description: "A map is public.",
  ...over,
});

const result = (findings: Finding[]): ScanResult => ({
  target: "https://example.com/",
  startedAt: "",
  finishedAt: "",
  durationMs: 1500,
  findings,
  requestsMade: 7,
});

describe("wrap", () => {
  it("wraps on word boundaries and keeps explicit line breaks", () => {
    expect(wrap("aaa bbb ccc", 7)).toEqual(["aaa bbb", "ccc"]);
    expect(wrap("a\nb", 10)).toEqual(["a", "b"]);
  });
});

describe("renderTerminalReport", () => {
  it("emits no ANSI codes when color is off and shows level, confidence and fields", () => {
    const out = renderTerminalReport(result([finding({ evidence: "a\nb\nc\nd\ne\nf\ng", reproCommand: "curl -I x" })]), {
      color: false,
      width: 80,
    });
    expect(out).not.toMatch(/\x1b\[/);
    expect(out).toContain("code level + deployment level");
    expect(out).toContain("confirmed");
    expect(out).toContain("Verify");
    expect(out).toContain("… and 3 more");
  });

  it("reports a clean result", () => {
    expect(renderTerminalReport(result([]), { color: false })).toContain("No findings");
  });
});
