# What orbiitl-check looks for

Every finding has a stable `id`, a `severity`, a `confidence`, and the layer(s)
where it can be fixed: **code level**, **deployment level** or **infra level**
(see the README for the JSON shape). Severity is "how bad if true";
confidence is "how sure are we it is true".

For how to fix each one, see [fixing-findings.md](fixing-findings.md).

## Origin IP / CDN posture (`origin-ip.*`)

| ID | Severity | Level | Meaning |
|---|---|---|---|
| `origin-ip.cdn-detected` | info | infra | The domain resolves into a known CDN/WAF range. |
| `origin-ip.no-cdn` | medium | infra | The domain resolves directly to a server that is not in a known CDN range. Fine if you run your own proxy/WAF on purpose. |
| `origin-ip.confirmed.<ip>` | high | infra | A candidate IP (from subdomains / certificate-transparency history) served the real site when contacted directly with your `Host` header, so the CDN/WAF can be bypassed. |
| `origin-ip.candidate-unconfirmed.<ip>` | low | infra | A candidate IP answered but did not match the homepage. Worth a manual look. |
| `origin-ip.candidate-unreachable.<ip>` | info | infra | A candidate IP did not answer. |
| `origin-ip.direct-ip-reachable.<ip>` | info | infra | The main domain's own IP was probed bare (no Host/SNI) and with the real Host header; the evidence lists each result. |
| `origin-ip.direct-ip-serves-app.<ip>` | low | infra | The bare IP serves the same page as the site, so the default vhost does not refuse unknown hosts. |

## Exposed dev/build artifacts (`exposed-artifacts.*`)

| ID | Severity | Level | Meaning |
|---|---|---|---|
| `exposed-artifacts.<path>` | varies | code + deployment | A known dev/build path (`/.env`, `/.git/HEAD`, `/node_modules/`, `/package.json`, `/requirements.txt`, backups, ...) is actually served. A baseline "404" fingerprint and content markers are used so SPA catch-all pages do not cause false positives. |
| `exposed-artifacts.sourcemap.<url>` | high | code + deployment | A JavaScript sourcemap is publicly reachable. The finding lists how many `src/` and `node_modules/` files it names and whether `sourcesContent` embeds the full original source. Large maps are read from their first part. If the response is not a parseable map it is reported as medium / likely. |
| `exposed-artifacts.unbuilt-source.<url>` | high | code + deployment | Unbuilt source (`.ts`, `.tsx`, `.jsx`) is served next to a built bundle. |

Sourcemaps are looked for on the entry bundle and on lazy chunks discovered
from the page and the entry bundle (up to 40 bundles).

## Security headers and transport (`headers.*`)

| ID | Severity | Level | Meaning |
|---|---|---|---|
| `headers.http-no-redirect` | medium | deployment | Plain `http://` serves content instead of redirecting to HTTPS. |
| `headers.no-hsts` | low | deployment (+ code) | No `Strict-Transport-Security`. |
| `headers.no-csp` | medium | deployment (+ code) | No `Content-Security-Policy`. |
| `headers.no-clickjacking-protection` | medium | deployment (+ code) | Neither `X-Frame-Options` nor CSP `frame-ancestors`. |
| `headers.missing-hardening-headers` | low | deployment (+ code) | One or more of `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` missing. |
| `headers.version-leak.<header>` | low | deployment (+ code for `x-powered-by`) | `Server` / `X-Powered-By` style headers reveal software or versions. |
| `headers.no-cdn-headers` | info | deployment | No CDN/WAF markers (e.g. `cf-ray`) in the homepage response. |

## Browser checks (`browser.*`, only with `--deep`)

| ID | Severity | Level | Meaning |
|---|---|---|---|
| `browser.console-secret.<type>` | high | code | A console message matched the shape of a credential (cloud keys, bearer tokens, ...). |
| `browser.framework-state.<name>` | info | code | A framework state dump (`__NEXT_DATA__`, `__NUXT__`, ...) is readable by any script. Review it for data the client should not see. |
| `browser.react-devtools-hook` | info | code | The React DevTools hook is present in a production build. |

## What it does not do

- It does not log in, so anything behind authentication is not checked.
- It does not test application logic, injection, or dependency vulnerabilities.
- A clean report is not proof of security. It means these specific checks found
  nothing.
- Unreachable targets are reported as failures, not as clean results.
