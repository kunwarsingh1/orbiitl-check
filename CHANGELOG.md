# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Bulk mode: `--list <file>` scans many domains/subdomains from a text file, one
  at a time, with `--confirm-authorized` (required) and `--max-targets`
  (default 100). Bulk terminal summary, bulk `--json`, and combined `.md`/`.html`
  reports.
- Authorized-use disclaimer in the README, SECURITY.md, `--help`, the MCP tool
  description and the Claude Code skill.
- `levels`/`alsoFixableAt` on findings and a `summary` block in `--json`;
  reports label findings as code / deployment / infra level.
- A target that can't be reached is now an error, not an empty "no findings" result.
- `stage` (`development`/`deployment`/`infrastructure`), `fixOwner`
  (`code`/`infra`/`ci-pipeline`), and `confidence`
  (`confirmed`/`likely`/`unconfirmed`) fields on every `Finding`, so a scan's
  `--json` output can be routed/triaged automatically (e.g. by an AI agent or
  a CI gate) without re-deriving root cause from the description text.
- `reproCommand` on findings that support it — an exact `curl`/`dig` command
  to independently re-verify the finding.
- `affectedFile` on exposed-artifact findings that can name a specific path.
- Stage breakdown line in both the terminal and Markdown reports.
- MCP server (`orbiitl-check-mcp`, `src/mcp-server.ts`) exposing a
  `scan_target` tool so any MCP-aware agent (Claude Code, Claude Desktop,
  others) can run a scan in-process and get the same structured JSON back,
  without shelling out or parsing terminal output.
- Claude Code skill (`integrations/claude-code/orbiitl-check/SKILL.md`)
  documenting authorized-use checks and how to present `stage`-grouped
  findings; install instructions in the README.
- `--deep` mode (`src/checks/browser.ts`): optional headless-browser pass
  (Playwright) that catches console-logged secrets (AWS/Google/Stripe/Slack
  key shapes, bearer tokens) and framework state dumps
  (`window.__NEXT_DATA__`/`__NUXT__`/`__INITIAL_STATE__`/etc.) that raw HTTP
  fetching can't see. `playwright` is an `optionalDependencies` entry —
  the base install doesn't pull in a Chromium download, and `--deep`
  degrades gracefully (logs + continues the rest of the scan) if Playwright
  or its browser binary isn't installed.
- `--screenshot <file>`: with `--deep`, saves a full-page screenshot of the
  homepage as visual evidence.
- `Dockerfile` (based on Playwright's own image, which ships a matching
  Chromium + system deps pre-installed) for running `--deep` mode in an
  agent sandbox or locked-down CI runner without installing browser
  dependencies on the host. The default scan doesn't need Docker.

## [0.1.0] - 2026-10-08

### Added
- Initial release: `orbiitl-check --app <url>` CLI.
- Origin IP / CDN-bypass detection via DNS, crt.sh certificate transparency
  lookups, and a common origin-revealing subdomain wordlist, confirmed by
  connecting directly to candidate IPs with the target's Host header/SNI.
- Exposed dev/build artifact probing (`node_modules/`, `.env`, `.git`,
  sourcemaps, unbuilt `.tsx`/`.jsx` source, Python `requirements.txt`/
  `manage.py`/`__pycache__`, Docker files, backups) with a baseline-404
  fingerprint to avoid false positives.
- Security header checks (HSTS, version-leak headers).
- Terminal, `--json`, and `--output report.md|.html` report formats.
- Rate limiting (`--delay`, `--concurrency`), per-request timeout, and a
  hard request budget (`--max-requests`) so scans stay polite by default.
- Exit code `1` on any HIGH-severity finding, for CI use.
