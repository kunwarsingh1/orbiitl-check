import { describe, it, expect } from "vitest";
import { ipInCidr, matchCdnByIp, matchCdnByCname, CDN_PROVIDERS } from "./cdn-ranges.js";

describe("ipInCidr", () => {
  it("matches an IP within range", () => {
    expect(ipInCidr("104.16.0.5", "104.16.0.0/13")).toBe(true);
  });

  it("rejects an IP outside range", () => {
    expect(ipInCidr("8.8.8.8", "104.16.0.0/13")).toBe(false);
  });

  it("handles /32 exact match", () => {
    expect(ipInCidr("1.2.3.4", "1.2.3.4/32")).toBe(true);
    expect(ipInCidr("1.2.3.5", "1.2.3.4/32")).toBe(false);
  });

  it("returns false for malformed input rather than throwing", () => {
    expect(ipInCidr("not-an-ip", "1.2.3.4/32")).toBe(false);
  });
});

describe("matchCdnByIp", () => {
  it("identifies a Cloudflare IP from the bundled list", () => {
    const match = matchCdnByIp("104.16.1.1", CDN_PROVIDERS);
    expect(match?.name).toBe("Cloudflare");
  });

  it("returns null for an IP not in any known range", () => {
    expect(matchCdnByIp("8.8.8.8", CDN_PROVIDERS)).toBeNull();
  });
});

describe("matchCdnByCname", () => {
  it("identifies CloudFront by CNAME suffix", () => {
    expect(matchCdnByCname("d123abc.cloudfront.net")?.name).toBe("Amazon CloudFront");
  });

  it("returns null for an unrelated CNAME", () => {
    expect(matchCdnByCname("somehost.example.com")).toBeNull();
  });
});
