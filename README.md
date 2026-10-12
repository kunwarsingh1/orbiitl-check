# orbiitl-check

> Audit a deployed web app for production-readiness leaks before someone else finds them.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)](package.json)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

**Contents:** [What it checks](#what-it-checks) · [Install](#install) · [Usage](#usage) · [Bulk scanning](#bulk-scanning---list) · [Deep mode](#deep-mode---deep) · [MCP / AI agents](#using-it-from-an-ai-agent-mcp) · [Docs](#documentation) · [Limitations](#limitations) · [Contributing](#contributing) · [Disclaimer](#disclaimer)

A CLI that audits a deployed web app for production-readiness leaks before someone else finds them:

- **Origin IP / CDN bypass** — checks whether the real server behind Cloudflare/Fastly/Akamai/etc. is directly reachable (via DNS history, certificate transparency logs, and common origin-revealing subdomains), confirming any candidate by connecting to it directly with the target's `Host` header and comparing the response to the real site.
- **Exposed dev/build artifacts** — probes for `node_modules/`, unbuilt `.tsx`/`.jsx` source, sourcemaps, `.env`, `.git`, Python `__pycache__`/`manage.py`/`requirements.txt`, Docker files, backups, and more. Uses a baseline-404 fingerprint so custom error pages don't produce false positives.
- **Security headers** — flags missing HSTS and version-leaking headers (`Server`, `X-Powered-By`).
- **Deep mode (`--deep`, opt-in)** — launches a headless browser to catch what raw HTTP fetching can't see: secrets printed via `console.log` in the client bundle, and framework state dumps (`window.__NEXT_DATA__`, `__NUXT__`, `__INITIAL_STATE__`, etc.) that often carry more server data than the page renders.

Works against Node/React/Next.js and Python (Django/Flask/FastAPI) apps.

> ⚠️ **Authorized use only.** Only scan targets you own or are explicitly authorized to test. This tool makes real HTTP requests and DNS lookups against the target.
>
> **Disclaimer:** orbiitl-check is for education and for auditing systems you own or are explicitly authorized to test. Scanning systems without permission may be illegal. The author(s) and contributors have no connection to, and accept no responsibility for, any misuse or malicious activity carried out with this tool.

## What it checks

| Area | Examples | Fix lives at |
|---|---|---|
| **Origin IP / CDN bypass** | Origin reachable around Cloudflare/CloudFront; bare IP serves the app; no CDN/WAF | infra level |
| **Leaked artifacts** | `.env`, `.git`, `node_modules/`, `package.json`, sourcemaps (and what they list), unbuilt `.tsx` source | code + deployment level |
| **Transport & headers** | HTTP not redirected to HTTPS, HSTS, CSP, clickjacking, nosniff/referrer/permissions, `Server`/`X-Powered-By` | deployment level |
| **Browser leaks** (`--deep`) | Secrets in `console.log`, framework state dumps, React DevTools hook | code level |

Each finding says which layer to fix it at: **code level**, **deployment level**
or **infra level**. The full list of finding IDs is in [docs/checks.md](docs/checks.md).

### Sample output (abridged, illustrative)

```text
orbiitl-check  ·  https://app.example.com/
scanned in 18.4s · 49 requests

────────────────────────────────────────────────────────────────────
Findings   ✖ 1 high   ▲ 2 medium   ● 1 low   ℹ 0 info
Layers      1  code level (app source / build)
            2  deployment level (server config)
            1  infra level (DNS / CDN / network)
────────────────────────────────────────────────────────────────────

HIGH (1)

  ✖ Sourcemap exposed (full original source reconstructable)
    code level + deployment level · confirmed
    What     .../assets/index-CSk3Agkr.js references a sourcemap which is publicly
             accessible. Parsed map lists 2425 source file(s): 257 application (src),
             2168 from node_modules; sourcesContent IS embedded.
    URL      https://app.example.com/assets/index-CSk3Agkr.js.map
    Fix      Do not deploy .map files to production. Stopgap: block *.map at the proxy.
    Verify   curl -s 'https://app.example.com/assets/index-CSk3Agkr.js.map' | head -c 500
```

## Install

```bash
npm install
npm run build
npm link   # optional: makes `orbiitl-check` available globally
```

## Usage

```bash
orbiitl-check --app https://target.com
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--app <url>` | required | Target base URL |
| `--list <file>` | — | Bulk mode: text file with one domain, subdomain or URL per line (see [Bulk scanning](#bulk-scanning---list)). Use instead of `--app` |
| `--confirm-authorized` | off | Required with `--list`: confirms you own or are authorized to test every target in the file |
| `--max-targets <n>` | 100 | Bulk mode: refuse lists longer than this |
| `--json` | off | Emit JSON to stdout instead of the terminal report |
| `--output <file>` | — | Write a `.md` or `.html` report to disk |
| `--concurrency <n>` | 5 | Max concurrent requests |
| `--delay <ms>` | 150 | Delay between requests to the target |
| `--timeout <ms>` | 8000 | Per-request timeout |
| `--max-requests <n>` | 150 | Hard cap on total requests made to the target |
| `--skip-origin-ip` | off | Disable the origin IP / CDN-bypass check |
| `--skip-artifacts` | off | Disable the exposed dev/build-artifact check |
| `--skip-headers` | off | Disable the security-headers check |
| `--deep` | off | Launch a headless browser for console-leak / framework-state-dump detection (see [Deep mode](#deep-mode---deep)) |
| `--screenshot <file>` | — | With `--deep`, save a full-page screenshot of the homepage |
| `--no-color` | — | Disable ANSI colors |
| `--verbose` | off | Log each probe as it happens |

### Bulk scanning (`--list`)

Check many of your own domains and subdomains in one run:

```text
# domains.txt - one per line, "#" starts a comment, bare hosts get https://
app.example.com
api.example.com
https://staging.example.com/  # explicit URL is fine
```

```bash
orbiitl-check --list domains.txt --confirm-authorized
orbiitl-check --list domains.txt --confirm-authorized --json --output bulk.md
```

- Targets are scanned **one at a time**; `--max-requests`, `--delay` etc. apply per target.
- Blank lines, comments and duplicates are ignored. Wildcards (`*.example.com`)
  and malformed lines are skipped with a message that names the line.
- `--confirm-authorized` is mandatory: you are stating that you own, or have
  explicit permission to test, **every** host in the file. Lists longer than
  `--max-targets` (default 100) are refused.
- Output: each target's report, then a summary table (worst target first).
  `--json` prints one document with `summary`, a worst-first `overview`,
  per-target `results`, and `failed`; `--output` writes a combined `.md`/`.html`.
- A target that can't be reached is reported as **failed**, never as a clean
  result. Exit code is `1` if any target has a HIGH finding, `2` if no target
  could be scanned.

### Exit codes

| Code | Meaning |
|---|---|
| `0` | Scan completed, no high-severity findings |
| `1` | At least one high-severity finding |
| `2` | The scan could not run (bad arguments, unreadable list, or no target could be reached) |

### Finding shape (`--json`)

`--json` prints one document: a `summary` block (counts by severity and by
level, plus the `exitCode` the CLI will use), then `findings` sorted worst-first.
Every finding has the same keys; missing values are `null`/`[]`, never absent.
`levels` lists where it can be fixed (`code`, `deployment`, `infrastructure`),
primary first, matching the "code level / deployment level / infra level" tags
in the terminal report.

Every finding is tagged with *where the root cause lives* and *how sure we
are*, so the output is routable by a script, a CI gate, or an AI agent
without re-parsing free text:

```jsonc
{
  "id": "origin-ip.confirmed.203.0.113.9",
  "severity": "high",
  "stage": "infrastructure",      // "development" | "deployment" | "infrastructure"
  "fixOwner": "infra",            // "code" | "ci-pipeline" | "deployment" | "infra"
  "confidence": "confirmed",      // "confirmed" | "likely" | "unconfirmed"
  "title": "Origin server exposed directly at 203.0.113.9 (bypasses CDN/WAF)",
  "description": "...",
  "remediation": "...",
  "reproCommand": "curl -sk --resolve target.com:443:203.0.113.9 https://target.com/"
}
```

- **`stage`** — which layer the problem lives in. The terminal/markdown
  reports label these **code level**, **deployment level** and **infra level**:
  `development` = code level (baked into the build/repo: shipped sourcemaps,
  committed `node_modules`, unbuilt source served — fix in app source/build
  config/CI), `deployment` = deployment level (server/proxy config: HTTPS
  redirect, security headers — fix in Caddy/nginx), `infrastructure` = infra
  level (DNS/CDN/firewall/hosting — fix outside the app and its server config).
- **`alsoFixableAt`** — optional list of other layers where the same problem can
  also be fixed or mitigated (e.g. a shipped sourcemap is a code/build problem
  that can also be blocked at the proxy). Reports show these as
  `code level + deployment level`.
- **`fixOwner`** — who makes the fix: `code`, `ci-pipeline`, `deployment` or `infra`.
- **`confidence`** — distinct from severity: a HIGH finding can still be
  `unconfirmed` (e.g. a candidate origin IP that resolved but couldn't be
  reached to verify).
- **`reproCommand`** — copy-pasteable, independent of this tool, so a
  finding can be re-verified by hand or by another tool.

## Example

```bash
orbiitl-check --app https://target.com --output report.md --verbose
```

## Deep mode (`--deep`)

The default scan is pure HTTP/DNS — fast, and all it needs is Node. `--deep`
adds a headless-browser pass (via [Playwright](https://playwright.dev)) that
actually renders the page, catching things raw fetching can't:

- Secrets (AWS/Google/Stripe/Slack keys, bearer tokens) printed to the
  console by leftover debug logging.
- Framework state dumps (`window.__NEXT_DATA__`, `__NUXT__`,
  `__INITIAL_STATE__`, `__APOLLO_STATE__`, …) — these often carry more
  server-rendered data than the component actually uses.
- Optionally, a full-page screenshot (`--screenshot report.png`) as visual
  evidence for any findings.

Playwright is an **optional** dependency — the base install/`npm install
orbiitl-check` doesn't pull in a Chromium download. To use `--deep`:

```bash
npm install playwright
npx playwright install chromium
orbiitl-check --app https://target.com --deep
```

If Chromium isn't installed, `--deep` logs a clear message and the rest of
the scan still runs normally — it doesn't fail the whole scan.

### Running `--deep` in Docker

If you're running this somewhere you can't (or don't want to) install
Chromium's system dependencies yourself — an agent sandbox, a locked-down CI
runner — use the provided image, which ships a matching Chromium build
pre-installed:

```bash
docker build -t orbiitl-check .
docker run --rm orbiitl-check --app https://target.com --deep --json
```

The default (non-`--deep`) scan doesn't need Docker at all; just run the CLI
directly as shown above.

## Using it from an AI agent (MCP)

orbiitl-check ships an [MCP](https://modelcontextprotocol.io) server
exposing one tool, `scan_target`, whose output is the exact same
`stage`/`fixOwner`/`confidence`-tagged JSON described above — no subprocess
parsing needed by the agent.

`scan_target` accepts a `deep: true` argument too, matching `--deep` — but
note that requires the MCP server's own machine to have Playwright + Chromium
installed (see [Deep mode](#deep-mode---deep) above); if they're missing, the
tool call still succeeds, just without the browser-based findings.

Add it to your MCP client config (Claude Desktop, Claude Code, etc.):

```jsonc
{
  "mcpServers": {
    "orbiitl-check": {
      "command": "npx",
      "args": ["-y", "-p", "orbiitl-check", "orbiitl-check-mcp"]
    }
  }
}
```

Or run it directly: `npx -y -p orbiitl-check orbiitl-check-mcp` (talks JSON-RPC over
stdio — it's not meant to be run interactively).

### Claude Code skill

A skill that tells an agent how to use `scan_target` responsibly (authorization
check first, how to group/present `stage`-tagged findings) lives at
[`integrations/claude-code/orbiitl-check/`](integrations/claude-code/orbiitl-check/).
Install it globally or per-project:

```bash
# Global (available in every project):
cp -r integrations/claude-code/orbiitl-check ~/.claude/skills/

# Project-scoped (this project only):
mkdir -p .claude/skills && cp -r integrations/claude-code/orbiitl-check .claude/skills/
```

## Development

```bash
npm run dev -- --app https://target.com   # run from TS source via tsx
npm test                                    # run unit tests
npm run build                               # compile to dist/
```

## Documentation

| Doc | What's in it |
|---|---|
| [docs/checks.md](docs/checks.md) | Every finding ID, its severity, layer and meaning |
| [docs/fixing-findings.md](docs/fixing-findings.md) | Caddy / nginx / Next.js / Vite snippets for each fix |
| [examples/domains.txt](examples/domains.txt) | Sample targets file for `--list` |
| [CONTRIBUTING.md](CONTRIBUTING.md) | Project layout, how to add a check, review bar |
| [CHANGELOG.md](CHANGELOG.md) | What changed |
| [SECURITY.md](SECURITY.md) | Responsible use, and how to report a vulnerability in this tool |
| [SUPPORT.md](SUPPORT.md) | Where to ask for help |

## Limitations

- It does not log in, so anything behind authentication is not checked.
- It looks for leaks and misconfiguration; it does not test application logic,
  injection or dependency vulnerabilities.
- Heuristics can be wrong: a HIGH finding can still be `unconfirmed`, and a
  clean report is not proof of security.
- Lazy chunk URLs built at runtime by a bundler (not written out literally) are
  not discovered.

## Contributing

PRs welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) for the project layout,
how to add a new check, and what the review bar looks like.

## Security

Found a vulnerability in orbiitl-check itself (not a finding it
reported *about* a target)? See [SECURITY.md](SECURITY.md) for how to report
it privately. See also the authorized-use notice above — only scan targets
you own or are explicitly authorized to test.

## License

[MIT](LICENSE)

## Disclaimer

orbiitl-check is for education and for auditing systems you own or are
explicitly authorized to test. Scanning systems without permission may be
illegal. The author(s) and contributors have no connection to, and accept no
responsibility for, any misuse or malicious activity carried out with this tool.
It is provided "as is" under the [MIT License](LICENSE).
