# Changelog

All notable changes to this project are documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- `stage` (`development`/`deployment`/`infrastructure`), `fixOwner`
  (`code`/`infra`/`ci-pipeline`), and `confidence`
  (`confirmed`/`likely`/`unconfirmed`) fields on every `Finding`, so a scan's
  `--json` output can be routed/triaged automatically (e.g. by an AI agent or
  a CI gate) without re-deriving root cause from the description text.
- `reproCommand` on findings that support it — an exact `curl`/`dig` command
  to independently re-verify the finding.
- `affectedFile` on exposed-artifact findings that can name a specific path.
- Stage breakdown line in both the terminal and Markdown reports.

## [0.1.0] - 2026-10-08

### Added
- Initial release: `production-checker --app <url>` CLI.
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
