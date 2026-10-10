import { describe, expect, it } from "vitest";
import { levelTag } from "./labels.js";

describe("levelTag", () => {
  it("shows a single level when there is only one place to fix it", () => {
    expect(levelTag({ stage: "infrastructure" })).toBe("infra level");
  });

  it("lists primary level first, then the other layers it can also be fixed at", () => {
    expect(levelTag({ stage: "development", alsoFixableAt: ["deployment"] })).toBe("code level + deployment level");
  });

  it("does not repeat the primary level", () => {
    expect(levelTag({ stage: "deployment", alsoFixableAt: ["deployment", "development"] })).toBe(
      "deployment level + code level"
    );
  });
});
