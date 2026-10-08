/**
 * Common subdomain labels that often point directly at an origin server
 * rather than through a CDN/WAF -- either because they were set up before
 * the CDN, or because they're internal/ops subdomains nobody bothered to
 * proxy. Kept short and high-signal to limit DNS queries per scan.
 */
export const ORIGIN_CANDIDATE_SUBDOMAINS: string[] = [
  "direct",
  "origin",
  "origin-www",
  "server",
  "app",
  "api",
  "ftp",
  "mail",
  "webmail",
  "cpanel",
  "admin",
  "staging",
  "stage",
  "dev",
  "test",
  "beta",
  "old",
  "backup",
  "vpn",
  "host",
];
