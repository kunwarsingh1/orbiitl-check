# production-checker

A CLI that audits a deployed web app for production-readiness leaks before someone else finds them:

- **Origin IP / CDN bypass** — checks whether the real server behind Cloudflare/Fastly/Akamai/etc. is directly reachable (via DNS history, certificate transparency logs, and common origin-revealing subdomains), confirming any candidate by connecting to it directly with the target's `Host` header and comparing the response to the real site.
- **Exposed dev/build artifacts** — probes for `node_modules/`, unbuilt `.tsx`/`.jsx` source, sourcemaps, `.env`, `.git`, Python `__pycache__`/`manage.py`/`requirements.txt`, Docker files, backups, and more. Uses a baseline-404 fingerprint so custom error pages don't produce false positives.
- **Security headers** — flags missing HSTS and version-leaking headers (`Server`, `X-Powered-By`).

Works against Node/React/Next.js and Python (Django/Flask/FastAPI) apps.

> ⚠️ Only scan targets you own or are explicitly authorized to test. This tool makes real HTTP requests and DNS lookups against the target.

## Install

```bash
npm install
npm run build
npm link   # optional: makes `production-checker` available globally
```

## Usage

```bash
production-checker --app https://target.com
```

### Options

| Flag | Default | Description |
|---|---|---|
| `--app <url>` | required | Target base URL |
| `--json` | off | Emit JSON to stdout instead of the terminal report |
| `--output <file>` | — | Write a `.md` or `.html` report to disk |
| `--concurrency <n>` | 5 | Max concurrent requests |
| `--delay <ms>` | 150 | Delay between requests to the target |
| `--timeout <ms>` | 8000 | Per-request timeout |
| `--max-requests <n>` | 150 | Hard cap on total requests made to the target |
| `--skip-origin-ip` | off | Disable the origin IP / CDN-bypass check |
| `--skip-artifacts` | off | Disable the exposed dev/build-artifact check |
| `--skip-headers` | off | Disable the security-headers check |
| `--no-color` | — | Disable ANSI colors |
| `--verbose` | off | Log each probe as it happens |

Exit code is `1` if any HIGH-severity finding is reported (handy in CI), `0` otherwise.

## Example

```bash
production-checker --app https://target.com --output report.md --verbose
```

## Development

```bash
npm run dev -- --app https://target.com   # run from TS source via tsx
npm test                                    # run unit tests
npm run build                               # compile to dist/
```
