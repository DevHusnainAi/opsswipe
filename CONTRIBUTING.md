# Contributing to OpsSwipe

Thank you for your interest in OpsSwipe. Bug reports, fixes, documentation and new providers are all welcome.
By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

OpsSwipe is small on purpose: few dependencies, plain `fetch` over SDKs, and a test for every path that touches
production. Please keep it that way.

## Ways to contribute

- **Report a bug**: open an issue with the steps to reproduce (use the bug report template).
- **Suggest a feature**: open an issue describing the problem first, before any code.
- **Fix something**: comment on the issue so nobody duplicates the work, then open a pull request.
- **Security issues**: never in a public issue. See [SECURITY.md](SECURITY.md).

## Development setup

Requirements: Node.js 24, Deno 2, Docker (for the SQL tests), and the Supabase CLI via `npx supabase`.

```bash
git clone https://github.com/<you>/opsswipe.git
cd opsswipe
cd app && npm ci && cd ..
```

Running the full system (a Supabase project, the GitHub App, a phone build) is described step by step in
[docs/SETUP.md](docs/SETUP.md). The code map and conventions are in [CLAUDE.md](CLAUDE.md), written for people and AI
coding agents alike; the reasons behind the design are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Checks

Run these before opening a pull request. CI runs the same checks, plus the SQL tests on Postgres 17.

```bash
# Backend
deno fmt && deno task lint && deno task check && deno task test && deno task eval

# App
cd app && npm run typecheck && npm run lint && npm test

# SQL (a local Postgres 17)
psql -v ON_ERROR_STOP=1 -f supabase/tests/setup/supabase-stubs.sql
for m in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$m"; done
for t in supabase/tests/*.sql; do psql -v ON_ERROR_STOP=1 -f "$t"; done

# Scripts
shellcheck infra/*.sh integrations/claude-code/*.sh && bash integrations/claude-code/gate.test.sh
```

## Pull request process

1. Fork the repository and create a branch from `main` (`fix/short-name` or `feat/short-name`).
2. Keep one idea per pull request, with a test that fails without the change.
3. Write commit messages in the imperative mood, with a short subject line and a body that explains why.
4. Update the documentation that your change affects (README, docs/SETUP.md, CLAUDE.md) and add a line to
   [CHANGELOG.md](CHANGELOG.md) under *Unreleased*.
5. Open the pull request with the template filled in. A maintainer reviews it; CI must be green before merging.

## Code guidelines

- **Never trust the client** for what to run: the server decides from validated config.
- **Never replay requests against production.** Replays run only in CI. The one exception is the read-only recovery
  check (GET/HEAD), described in [docs/DECISIONS.md](docs/DECISIONS.md) #35.
- **Never put secrets in the repository.** Server secrets live in Supabase Vault or Edge Function secrets.
- Change incident behaviour in `supabase/functions/_shared/flow.ts` and `tests/flow.test.ts` together.
- `incidents.context` updates merge in the database: send only the keys you change.
- Format with `deno fmt` (single quotes, width 120); follow the app's ESLint rules.
- Mark a deliberate shortcut with a `ponytail:` comment that names its limit and the upgrade path.
- Add dependencies only when a few lines of `fetch` or WebCrypto can't do the job. In the app, add them with
  `npx expo install`.

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
