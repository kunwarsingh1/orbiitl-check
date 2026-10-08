import { describe, it, expect } from "vitest";
import { simpleHash, extractTitle } from "./fingerprint.js";

describe("simpleHash", () => {
  it("is deterministic for identical input", () => {
    expect(simpleHash("hello world")).toBe(simpleHash("hello world"));
  });

  it("differs for different input", () => {
    expect(simpleHash("hello")).not.toBe(simpleHash("world"));
  });
});

describe("extractTitle", () => {
  it("extracts a simple title tag", () => {
    expect(extractTitle("<html><head><title>My Site</title></head></html>")).toBe("My Site");
  });

  it("returns empty string when no title present", () => {
    expect(extractTitle("<html><body>no title here</body></html>")).toBe("");
  });

  it("trims whitespace inside the title tag", () => {
    expect(extractTitle("<title>  Spaced Out  </title>")).toBe("Spaced Out");
  });
});
