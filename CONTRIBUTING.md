# Contributing to orbiitl-check

Thanks for considering a contribution. This is a young project, so the bar
for a useful PR is low — fixing a bug, tightening a false-positive check, or
adding a new check for a real-world leak pattern are all welcome.

## Before you start

- For anything bigger than a small fix (a new check category, a new output
  format, a dependency addition), open an issue first describing what you
  want to do. It's a lot easier to agree on the shape of a check before code
  is written than after.
- Read [SECURITY.md](SECURITY.md) — PRs that weaken the tool's default
  politeness (rate limiting, request budget) or add batch/mass-scanning
  features without an explicit opt-in/authorization flag will be declined.

## Development setup

```bash
git clone https://github.com/kunwarsingh1/orbiitl-check.git
cd orbiitl-checknpm install
npm run build
npm test
```

Run against a target from source without building first:

```bash
npm run dev -- --app https://example.com --verbose
```

## Project layout

- `src/checks/*` — one file per check category (origin-ip, exposed-artifacts,
  headers). Each exports a `checkX(ctx, baseUrl) -> Promise<Finding[]>`.
- `src/net/*` — low-level HTTP/DNS/crt.sh clients, shared by checks.
- `src/config/*` — static data: probe path lists, CDN IP ranges, subdomain
  wordlists. Most "add support for X" contributions are a data change here.
- `src/report/*` — terminal/JSON/Markdown renderers. All three read the same
  `ScanResult`/`Finding` shape from `src/types.ts`.
- `src/scanner.ts` — orchestrates checks and assembles the final `ScanResult`.
- `src/mcp-server.ts` — MCP server wrapper exposing `scan_target`; calls
  `runScan()` directly (no subprocess), so if you change `ScanOptions` or
  `ScanResult` in `src/types.ts`, update this file's tool schema too.
- `integrations/claude-code/orbiitl-check/SKILL.md` — the Claude Code
  skill shipped alongside the MCP server; update it if `Finding`'s fields
  change, since it documents how an agent should read `stage`/`fixOwner`/
  `confidence`.
- `src/checks/browser.ts` — the `--deep` check. Dynamically `import("playwright")`
  so the base package never requires it at install time (it's an
  `optionalDependencies` entry); both the "module not installed" and
  "Chromium binary not downloaded" failure modes must degrade to a logged
  message + empty findings, never throw and abort the whole scan.
- `Dockerfile` — packages `--deep` mode for environments that can't install
  Chromium's system deps themselves. Only relevant to `--deep`; the default
  scan never needs it.

## Adding a new check

1. Decide its `category` and, for every finding it produces, the right
   `stage` (`development` | `deployment` | `infrastructure`) and `fixOwner`
   (`code` | `infra` | `ci-pipeline`) — see the doc comments on those types in
   `src/types.ts`. This is what makes the report useful to both humans and
   agents consuming `--json`, so don't skip it.
2. Respect the shared request budget and throttle: issue requests through
   `HttpClient` (`src/net/http.ts`), never a raw `fetch`/`http.request` call,
   so `--max-requests`/`--delay`/`--timeout` apply uniformly.
   `RequestBudgetExceededError` must propagate, not be swallowed, so a scan
   stops cleanly instead of silently truncating results.
3. Avoid false positives: if your check probes paths that might return a
   "soft 200" (custom error page with status 200), diff against a baseline
   fetch the way `checks/exposed-artifacts.ts` does, rather than trusting
   status code alone.
4. Wire it into `src/scanner.ts` and add a `--skip-<name>` flag in `src/cli.ts`
   following the existing pattern.
5. Add unit tests for any pure-function logic (parsing, matching, scoring) —
   see `src/config/cdn-ranges.test.ts` for the pattern. Checks that make real
   network calls aren't unit-tested; verify those manually against a target
   you control and describe how you tested in the PR description.

## Adding a probe path / CDN range / subdomain

These are plain data changes in `src/config/paths.ts`, `cdn-ranges.ts`, or
`subdomains.ts` — no new logic needed. Include the severity and a one-line
rationale for why the path/range is worth checking.

## Pull requests

- Keep PRs focused — one check/feature/fix per PR.
- `npm run build && npm test` must pass.
- Describe how you tested a network-touching change (target used, flags
  passed, what you expected vs. saw).
- Be explicit in the PR body if your change affects default scan behavior
  (request volume, timing, new paths probed by default) — these need extra
  scrutiny since this tool runs against other people's infrastructure.

## Docs to update with a new check

- Add its finding ID(s), severity and layer to [docs/checks.md](docs/checks.md).
- Add a fix snippet to [docs/fixing-findings.md](docs/fixing-findings.md) if the
  fix is not obvious.
- Note it under `[Unreleased]` in [CHANGELOG.md](CHANGELOG.md).
