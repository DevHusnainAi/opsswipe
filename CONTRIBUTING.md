# Contributing

Thanks for helping. OpsSwipe is small on purpose: few dependencies, plain `fetch` over SDKs, and tests for every path
that touches production.

## Set up

Follow [docs/SETUP.md](docs/SETUP.md). Architecture and conventions for humans and AI agents are in [CLAUDE.md](CLAUDE.md);
the reasons behind the design are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Before you open a pull request

```bash
deno fmt && deno task lint && deno task check && deno task test && deno task eval   # backend
cd app && npm run typecheck && npm run lint && npm test                             # app
```

CI runs the same checks plus the SQL tests on Postgres 17. Please:

- Keep a change to one idea, with a test that fails without it.
- Change incident behaviour in `supabase/functions/_shared/flow.ts` and `tests/flow.test.ts` together.
- Never trust the client for what to run, never replay requests against production, and never put secrets in the repo.
- Mark a deliberate shortcut with a `ponytail:` comment that names its limit.

## Reporting bugs

Open an issue with the steps to reproduce. For anything security-related, see [SECURITY.md](SECURITY.md) instead.
