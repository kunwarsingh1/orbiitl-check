# Security Policy

## Responsible use of this tool

`production-checker` makes real HTTP requests, DNS lookups, and direct-to-IP
connections against the target you pass via `--app`. It is intended for:

- Auditing your own applications and infrastructure.
- Authorized penetration tests / security assessments with written permission
  from the target's owner.
- CTF competitions and other environments where active probing is explicitly
  permitted.

**Do not point this tool at a target you do not own or do not have explicit,
documented authorization to test.** Unauthorized scanning of third-party
infrastructure may violate computer-crime laws (e.g. the U.S. CFAA, UK
Computer Misuse Act, or equivalent legislation elsewhere) regardless of
intent. You are solely responsible for how you use this tool.

The maintainers are not responsible for misuse. Issues or PRs that request
features intended for mass/unauthorized scanning (e.g. removing rate limits
by default, adding target-list/batch-scanning modes without an explicit
authorization flag) will be declined.

## Reporting a vulnerability in production-checker itself

If you find a security issue in this tool's own code (e.g. a way a malicious
*target* could exploit a scan to compromise the machine running
`production-checker` — SSRF pivoting, path traversal via `--output`, RCE via
a crafted response, etc.), please report it privately rather than opening a
public issue:

- Email: kunwarsingh040126@gmail.com
- Subject line: `[SECURITY] production-checker — <short description>`

Please include:
- The version/commit affected.
- Steps to reproduce, or a minimal PoC.
- The impact you believe it has.

We'll acknowledge reports within a few days and aim to ship a fix before any
public disclosure. If you don't hear back within two weeks, feel free to
follow up — email can get lost.

## Supported versions

This project is pre-1.0 and under active development. Security fixes land on
the latest published version on npm; there is no separate LTS branch yet.
