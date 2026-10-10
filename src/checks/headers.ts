import { HttpClient } from "../net/http.js";
import type { Finding, ScanContext } from "../types.js";

const VERSION_LEAK_HEADERS = ["server", "x-powered-by", "x-aspnet-version", "x-aspnetmvc-version"];

export async function checkHeaders(ctx: ScanContext, baseUrl: string): Promise<Finding[]> {
  const findings: Finding[] = [];
  const http = new HttpClient(ctx);

  let res;
  try {
    res = await http.fetch(baseUrl);
  } catch {
    return findings;
  }

  for (const headerName of VERSION_LEAK_HEADERS) {
    const value = res.headers[headerName];
    if (value) {
      const str = Array.isArray(value) ? value.join(", ") : value;
      findings.push({
        id: `headers.version-leak.${headerName}`,
        category: "headers",
        severity: "low",
        stage: "deployment",
        alsoFixableAt: headerName === "x-powered-by" ? ["development"] : undefined,
        fixOwner: "deployment",
        confidence: "confirmed",
        title: `${headerName} header reveals server/framework info`,
        description: `Response header "${headerName}: ${str}" discloses software/version details that can help an attacker target known vulnerabilities.`,
        remediation: `Suppress or generalize the "${headerName}" header at the web server/proxy level.`,
        evidence: `${headerName}: ${str}`,
        reproCommand: `curl -sI '${baseUrl}' | grep -i '${headerName}'`,
      });
    }
  }

  const cdnHeaderPresent = Boolean(res.headers["cf-ray"] || /cloudflare/i.test(String(res.headers["server"] ?? "")));
  if (!cdnHeaderPresent) {
    findings.push({
      id: "headers.no-cdn-headers",
      category: "headers",
      severity: "info",
      stage: "deployment",
      fixOwner: "deployment",
      confidence: "confirmed",
      title: "No CDN/WAF response headers detected on the main site",
      description: "No common CDN markers (e.g. cf-ray) were seen in the homepage response headers. If you believe you're behind a CDN/WAF, confirm it's actually proxying this hostname.",
      reproCommand: `curl -sI '${baseUrl}'`,
    });
  }

  const hsts = res.headers["strict-transport-security"];
  if (!hsts) {
    findings.push({
      id: "headers.no-hsts",
      category: "headers",
      severity: "low",
      stage: "deployment",
      alsoFixableAt: ["development"],
      fixOwner: "deployment",
      confidence: "confirmed",
      title: "Strict-Transport-Security header missing",
      description: "No HSTS header was found, so browsers won't automatically upgrade future requests to HTTPS for this domain.",
      remediation: "Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` once you're confident all subdomains serve HTTPS.",
      reproCommand: `curl -sI '${baseUrl}' | grep -i strict-transport-security`,
    });
  }

  const csp = res.headers["content-security-policy"];
  if (!csp) {
    findings.push({
      id: "headers.no-csp",
      category: "headers",
      severity: "medium",
      stage: "deployment",
      alsoFixableAt: ["development"],
      fixOwner: "deployment",
      confidence: "confirmed",
      title: "Content-Security-Policy header missing",
      description: "No Content-Security-Policy header was found, so the browser applies no restrictions on script/style/frame sources, which removes a key mitigation for XSS.",
      remediation: "Add a Content-Security-Policy (start with Report-Only; use nonces/hashes if the app relies on inline scripts).",
      reproCommand: `curl -sI '${baseUrl}' | grep -i content-security-policy`,
    });
  }

  const frameAncestors = /frame-ancestors/i.test(String(Array.isArray(csp) ? csp.join(";") : csp ?? ""));
  if (!res.headers["x-frame-options"] && !frameAncestors) {
    findings.push({
      id: "headers.no-clickjacking-protection",
      category: "headers",
      severity: "medium",
      stage: "deployment",
      alsoFixableAt: ["development"],
      fixOwner: "deployment",
      confidence: "confirmed",
      title: "No clickjacking protection (X-Frame-Options / CSP frame-ancestors)",
      description: "Neither X-Frame-Options nor a CSP frame-ancestors directive was found, so other sites can embed this app in a frame (clickjacking), notably a problem for login/OAuth pages.",
      remediation: "Add `X-Frame-Options: DENY` (or `Content-Security-Policy: frame-ancestors 'none'`).",
      reproCommand: `curl -sI '${baseUrl}' | grep -i -E 'x-frame-options|frame-ancestors'`,
    });
  }

  const missingMinor = (["x-content-type-options", "referrer-policy", "permissions-policy"] as const).filter(
    (h) => !res.headers[h]
  );
  if (missingMinor.length > 0) {
    findings.push({
      id: "headers.missing-hardening-headers",
      category: "headers",
      severity: "low",
      stage: "deployment",
      alsoFixableAt: ["development"],
      fixOwner: "deployment",
      confidence: "confirmed",
      title: `Missing hardening headers: ${missingMinor.join(", ")}`,
      description: `The homepage response does not set: ${missingMinor.join(", ")}. These are low-cost browser hardening headers (MIME sniffing, referrer leakage, feature access).`,
      remediation: "Add `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and a restrictive `Permissions-Policy` at the proxy level.",
      evidence: missingMinor.join(", "),
      reproCommand: `curl -sI '${baseUrl}'`,
    });
  }

  // Does plain HTTP serve the app instead of redirecting to HTTPS?
  if (new URL(baseUrl).protocol === "https:") {
    const httpUrl = baseUrl.replace(/^https:/i, "http:");
    try {
      const plain = await http.fetch(httpUrl, { followRedirects: false });
      const location = String(plain.headers["location"] ?? "");
      let staysOnHttp = false;
      if (plain.status >= 300 && plain.status < 400 && location) {
        try {
          staysOnHttp = new URL(location, httpUrl).protocol === "http:";
        } catch {
          // unparseable Location: don't flag
        }
      }
      if ((plain.status >= 200 && plain.status < 300) || staysOnHttp) {
        findings.push({
          id: "headers.http-no-redirect",
          category: "headers",
          severity: "medium",
          stage: "deployment",
          fixOwner: "deployment",
          confidence: "confirmed",
          title: "Plain HTTP serves content with no redirect to HTTPS",
          description: `${httpUrl} returned HTTP ${plain.status}${staysOnHttp ? ` with Location ${location} (still plain HTTP)` : ""} over plaintext instead of redirecting to HTTPS, so sessions/credentials can be exposed to on-path attackers and HSTS can never be bootstrapped.`,
          remediation: "Redirect all port-80 traffic to HTTPS (301/308) at the proxy, then add HSTS.",
          evidence: `HTTP ${plain.status}${location ? `, Location: ${location}` : ", no Location header"}`,
          reproCommand: `curl -sI '${httpUrl}'`,
        });
      }
    } catch {
      // port 80 closed/unreachable is fine
    }
  }

  return findings;
}
