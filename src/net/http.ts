import * as http from "node:http";
import * as https from "node:https";
import { isIP } from "node:net";
import { URL } from "node:url";
import { Throttle, RequestBudgetExceededError } from "../utils/rate-limit.js";
import type { ScanContext } from "../types.js";

export interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
  /** Last ~4KB of the response, kept even when `body` was truncated (e.g. trailing `//# sourceMappingURL=` comments). */
  tail: string;
  bodyTruncated: boolean;
  finalUrl: string;
}

export interface FetchOpts {
  method?: "GET" | "HEAD";
  /** Override the IP/host actually connected to, while keeping the Host header / SNI as `hostnameForTlsAndHost`. */
  connectIp?: string;
  hostnameForTlsAndHost?: string;
  timeoutMs: number;
  maxBodyBytes?: number;
  followRedirects?: boolean;
  extraHeaders?: Record<string, string>;
}

const TAIL_BYTES = 4 * 1024;
const DEFAULT_MAX_BODY = 512 * 1024; // 512KB cap, plenty to fingerprint pages/bundles without downloading huge files

/**
 * Low-level fetch built on node:http/https (not global fetch) because we
 * need to override the connection target IP while preserving the Host
 * header and TLS SNI -- this is how we confirm an origin IP actually
 * serves the target app while bypassing a CDN at the DNS layer.
 */
export function rawFetch(targetUrl: string, opts: FetchOpts): Promise<FetchResult> {
  return new Promise((resolve, reject) => {
    const url = new URL(targetUrl);
    const isHttps = url.protocol === "https:";
    const transport = isHttps ? https : http;
    const host = opts.hostnameForTlsAndHost ?? url.hostname;

    const requestOptions: https.RequestOptions = {
      method: opts.method ?? "GET",
      host: opts.connectIp ?? url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      headers: {
        Host: host,
        "User-Agent": "orbiitl-check/0.1 (+https://www.npmjs.com/package/orbiitl-check)",
        Accept: "*/*",
        ...opts.extraHeaders,
      },
      timeout: opts.timeoutMs,
    };
    if (isHttps) {
      // SNI must be a hostname; sending an IP literal as SNI is invalid (and deprecated in Node).
      if (!isIP(host.replace(/^\[|\]$/g, ""))) (requestOptions as https.RequestOptions).servername = host;
      (requestOptions as https.RequestOptions).rejectUnauthorized = false; // origin IPs often have mismatched/self-signed certs; we're fingerprinting, not trusting
    }

    const req = transport.request(requestOptions, (res) => {
      const chunks: Buffer[] = [];
      let total = 0;
      const maxBytes = opts.maxBodyBytes ?? DEFAULT_MAX_BODY;
      let truncated = false;
      let tailBuf: Buffer = Buffer.alloc(0);

      res.on("data", (chunk: Buffer) => {
        tailBuf = Buffer.concat([tailBuf, chunk]);
        if (tailBuf.length > TAIL_BYTES) tailBuf = tailBuf.subarray(tailBuf.length - TAIL_BYTES);
        if (total >= maxBytes) {
          truncated = true;
          return;
        }
        total += chunk.length;
        chunks.push(chunk);
      });

      res.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        const tail = tailBuf.toString("utf8");
        const status = res.statusCode ?? 0;

        const redirect = status >= 300 && status < 400 && res.headers.location;
        if ((opts.followRedirects ?? true) && redirect) {
          let nextUrl: string;
          try {
            nextUrl = new URL(res.headers.location as string, targetUrl).toString();
          } catch {
            resolve({ status, headers: res.headers, body, tail, bodyTruncated: truncated, finalUrl: targetUrl });
            return;
          }
          // Only follow once, and only if we're not overriding the connect IP
          // (following a redirect while pinned to a candidate IP would silently
          // escape back to normal DNS resolution, defeating the point of the probe).
          if (!opts.connectIp) {
            rawFetch(nextUrl, { ...opts, followRedirects: false }).then(resolve, reject);
            return;
          }
        }

        resolve({ status, headers: res.headers, body, tail, bodyTruncated: truncated, finalUrl: targetUrl });
      });
    });

    req.on("timeout", () => {
      req.destroy(new Error(`Request timed out after ${opts.timeoutMs}ms`));
    });
    req.on("error", reject);
    req.end();
  });
}

/**
 * Throttled, budget-tracked fetch for use inside checks. Shares a single
 * Throttle + request counter (via ScanContext) across the whole scan so
 * probing stays polite and bounded regardless of which check issues the request.
 */
export class HttpClient {
  private readonly throttle: Throttle;

  constructor(private readonly ctx: ScanContext) {
    this.throttle = new Throttle(ctx.options.delay);
  }

  async fetch(url: string, opts: Partial<FetchOpts> = {}): Promise<FetchResult> {
    if (this.ctx.requestCounter.count >= this.ctx.options.maxRequests) {
      throw new RequestBudgetExceededError(this.ctx.options.maxRequests);
    }
    await this.throttle.wait();
    this.ctx.requestCounter.count++;
    if (this.ctx.options.verbose) {
      this.ctx.log(`  -> ${opts.method ?? "GET"} ${url}${opts.connectIp ? ` (via ${opts.connectIp})` : ""}`);
    }
    return rawFetch(url, { timeoutMs: this.ctx.options.timeout, ...opts });
  }
}
