## What this does

## How you tested it
(Which target/flags did you run against? `npm run build && npm test` output?)

## Does this change default scan behavior?
(New probe paths, more requests, different timing, etc. — if yes, explain why
the new default is still polite/safe. See CONTRIBUTING.md.)

## Checklist
- [ ] `npm run build` passes
- [ ] `npm test` passes
- [ ] New findings set `stage`/`fixOwner`/`confidence` appropriately (src/types.ts)
- [ ] Network-touching code goes through `HttpClient` (respects `--delay`/`--timeout`/`--max-requests`)
