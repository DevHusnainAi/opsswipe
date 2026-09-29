## What and why

<!-- One idea per pull request. What changes, and why? -->

## How it was tested

- [ ] `deno task test` / `deno task check` / `deno task lint` / `deno fmt --check`
- [ ] `cd app && npm run typecheck && npm run lint && npm test` (if the app changed)
- [ ] A new or changed test fails without this change
- [ ] Docs updated (README, docs/SETUP.md, CLAUDE.md) and a line added to CHANGELOG.md under *Unreleased*

## Safety

- [ ] The server still decides what may run; nothing new is trusted from the phone
- [ ] No secrets, and nothing replays requests against production
