---
name: Bug report
about: Something doesn't work as expected (false positive/negative, crash, wrong flag behavior)
title: ""
labels: bug
---

**Note:** if this is a security vulnerability in production-checker itself
(not a finding it reported about a target), please follow [SECURITY.md](../../SECURITY.md)
instead of opening a public issue.

**What happened**

**What you expected**

**How to reproduce**
- Command run (redact the real target domain if it's sensitive):
  ```
  production-checker --app https://REDACTED --json
  ```
- Node version (`node -v`):
- production-checker version (`npm ls production-checker` or the npm version you installed):
- OS:

**Relevant output**
(Paste terminal/JSON output. Redact anything sensitive about the target.)
