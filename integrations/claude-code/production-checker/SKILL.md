---
name: production-checker
description: Audit a deployed web app for production-readiness leaks - exposed origin IP bypassing its CDN/WAF, leaked node_modules/.env/.git/sourcemaps/unbuilt source, and missing security headers. Trigger on "is this app production ready", "check this site for leaks", "can I bypass the CDN on this domain", or when asked to audit/pentest a URL the user owns or is authorized to test.
---

# /production-checker

Audits a deployed web app (Node/React/Next.js or Python/Django/Flask/FastAPI)
for exposure that doesn't show up in a normal code review: an origin server
reachable around its CDN/WAF, and dev/build artifacts accidentally served in
production.

## Before you do anything: authorization

**Only run this against a target the user owns or has explicitly stated they
are authorized to test.** This tool makes real HTTP requests, DNS lookups,
and direct-to-IP connections against the target. If the user hasn't said
one way or the other and the target isn't obviously their own (e.g. a
`localhost`/internal/staging URL, or they've been discussing it as "my
site"), ask before scanning. Do not scan a third-party domain on a vague
request like "check if example.com is secure" without confirming authorization
first.

## How to run it

**Preferred: MCP tool, if `scan_target` is available.** Call it directly:

```
scan_target({ app: "https://target.com" })
```

Pass `skipOriginIp`/`skipArtifacts`/`skipHeaders` to narrow the scan, and
`maxRequests`/`delay`/`timeout` to tune politeness for a sensitive target.
The tool returns the full `ScanResult` JSON (see schema below) directly —
no parsing needed.

**Fallback: shell out to the CLI** if the MCP tool isn't configured:

```bash
npx production-checker --app https://target.com --json
```

(If neither is available yet in this environment, `npm install -g
production-checker` first, or guide the user through
`npx production-checker-mcp` as an MCP server entry in their client config —
see this package's README.)

## Reading the result

Each finding has three fields that tell you how to present it — use them,
don't just dump the list:

- **`stage`**: `development` (bug is in the build/repo — sourcemaps shipped,
  `node_modules` committed, unbuilt source served; fix is in build
  config/`.gitignore`/CI), `deployment` (server/proxy config — missing
  headers; fix is in nginx/the reverse proxy), or `infrastructure`
  (DNS/firewall/hosting — origin IP bypasses the CDN; fix is outside the
  app's code entirely).
- **`fixOwner`**: `code` / `ci-pipeline` / `infra` — who would actually make
  the fix. Useful for routing when summarizing to a team.
- **`confidence`**: `confirmed` / `likely` / `unconfirmed`. A `high`-severity
  finding can still be `unconfirmed` (e.g. a candidate origin IP that
  resolved but couldn't be reached to verify) — say so plainly, don't
  present it with the same certainty as a `confirmed` one.

When presenting results to the user:
1. Group by `stage`, not by raw severity list — lead with whichever stage
   has the most/worst findings, since that tells them which team or file to
   go to first.
2. For each finding, give: what it is, the `remediation` line verbatim (it's
   already written for exactly this), and the `reproCommand` if present so
   they can verify it themselves without re-running the whole scan.
3. If `requestsMade` hit (or came close to) the configured `maxRequests`
   budget, say so — it means the scan stopped early and didn't cover
   everything.
4. If every finding is `info`/`low` with none `confirmed` at `high`, say
   that plainly rather than padding the response — "nothing concerning
   found" is a valid, useful result.

## Example

> User: "is my app at https://myapp.example.com production ready? I own this domain."

1. Confirm this reads as authorized (they stated ownership) — proceed.
2. Call `scan_target({ app: "https://myapp.example.com" })`.
3. Group findings by stage, lead with the worst, quote `remediation` for
   each, note confidence on anything not `confirmed`.
