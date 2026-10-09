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
        fixOwner: "infra",
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
      fixOwner: "infra",
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
      fixOwner: "infra",
      confidence: "confirmed",
      title: "Strict-Transport-Security header missing",
      description: "No HSTS header was found, so browsers won't automatically upgrade future requests to HTTPS for this domain.",
      remediation: "Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload` once you're confident all subdomains serve HTTPS.",
      reproCommand: `curl -sI '${baseUrl}' | grep -i strict-transport-security`,
    });
  }

  return findings;
}
