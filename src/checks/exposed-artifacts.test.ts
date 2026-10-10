import { describe, it, expect } from "vitest";
import { extractChunkUrls, summarizeSourceMap } from "./exposed-artifacts.js";

describe("extractChunkUrls", () => {
  it("finds next static chunks in flight data and webpack runtime strings", () => {
    const text =
      'self.__next_f.push([1,"[\\"static/chunks/app/login/page-abc123.js\\"]"]);' +
      'e.u=function(e){return"static/chunks/"+e+".js"};var u="/_next/static/chunks/293-deadbeef.js?v=1";';
    const urls = extractChunkUrls(text, "https://example.com/");
    expect(urls).toContain("https://example.com/_next/static/chunks/app/login/page-abc123.js");
    expect(urls).toContain("https://example.com/_next/static/chunks/293-deadbeef.js");
  });

  it("resolves ./chunk.js imports relative to the bundle and ignores other origins", () => {
    const text = 'import("./lazy.123.js");import("https://cdn.other.com/x.js");';
    const urls = extractChunkUrls(text, "https://example.com/assets/index.js");
    expect(urls).toEqual(["https://example.com/assets/lazy.123.js"]);
  });
});

describe("summarizeSourceMap", () => {
  it("counts node_modules vs app sources and detects sourcesContent", () => {
    const map = JSON.stringify({
      version: 3,
      sources: ["webpack://app/src/App.tsx", "webpack://app/node_modules/react/index.js"],
      sourcesContent: ["export default 1", "module.exports = {}"],
    });
    expect(summarizeSourceMap(map)).toMatchObject({
      total: 2,
      appSources: 1,
      nodeModules: 1,
      hasSourcesContent: true,
    });
  });

  it("returns null for non-map bodies", () => {
    expect(summarizeSourceMap("<html>404</html>")).toBeNull();
    expect(summarizeSourceMap('{"hello":1}')).toBeNull();
  });
});

describe("summarizeSourceMap on truncated maps", () => {
  const full = JSON.stringify({
    version: 3,
    sources: ["../../src/main.tsx", "../../node_modules/react/index.js", "../../src/App.tsx"],
    sourcesContent: ["a", "b", "c"],
    mappings: "AAAA",
  });

  it("recovers sources and sourcesContent when the sourcesContent array has started", () => {
    const cut = full.slice(0, full.indexOf('"mappings"') - 4);
    const s = summarizeSourceMap(cut)!;
    expect(s.partial).toBe(true);
    expect(s.total).toBe(3);
    expect(s.nodeModules).toBe(1);
    expect(s.appSources).toBe(2);
    expect(s.hasSourcesContent).toBe(true);
  });

  it("reports sourcesContent as unknown when cut before it appears", () => {
    const cut = full.slice(0, full.indexOf('"sourcesContent"') - 1);
    const s = summarizeSourceMap(cut)!;
    expect(s.partial).toBe(true);
    expect(s.hasSourcesContent).toBeNull();
    expect(s.total).toBe(3);
  });

  it("returns null when cut inside the sources array or not a map", () => {
    expect(summarizeSourceMap(full.slice(0, 40))).toBeNull();
    expect(summarizeSourceMap("<!doctype html><html></html>")).toBeNull();
  });

  it("still handles complete maps", () => {
    const s = summarizeSourceMap(full)!;
    expect(s.partial).toBe(false);
    expect(s.hasSourcesContent).toBe(true);
  });
});
