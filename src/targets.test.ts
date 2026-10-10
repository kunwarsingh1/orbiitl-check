import { describe, expect, it } from "vitest";
import { parseTargetList } from "./targets.js";

describe("parseTargetList", () => {
  it("normalizes bare hosts, skips comments and blanks, and de-duplicates", () => {
    const { targets, rejected } = parseTargetList(
      ["# my domains", "", "app.example.com", "https://api.example.com/  # prod api", "app.example.com", "HTTP://old.example.com"].join("\n")
    );
    expect(targets).toEqual(["https://app.example.com/", "https://api.example.com/", "http://old.example.com/"]);
    expect(rejected).toEqual([]);
  });

  it("handles CRLF files and a UTF-8 BOM", () => {
    const { targets } = parseTargetList("﻿a.example.com\r\nb.example.com\r\n");
    expect(targets).toEqual(["https://a.example.com/", "https://b.example.com/"]);
  });

  it("rejects wildcards, whitespace and junk with line numbers", () => {
    const { targets, rejected } = parseTargetList("*.example.com\nfoo bar.com\nnotahost\nok.example.com");
    expect(targets).toEqual(["https://ok.example.com/"]);
    expect(rejected.map((r) => [r.line, r.value])).toEqual([
      [1, "*.example.com"],
      [2, "foo bar.com"],
      [3, "notahost"],
    ]);
  });
});
