# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpsSwipe: a phone pager that turns production 5xx incidents into swipe-to-fix cards, and only lets a code fix merge after CI
replays the exact production requests that failed. Rationale for most design choices lives in `docs/DECISIONS.md`; operator
and user setup in `docs/SETUP.md`.

## Layout

- `supabase/functions/` — Deno Edge Functions (backend). One dir per endpoint, logic in `_shared/`, tests in `tests/`.
- `supabase/migrations/` + `supabase/tests/*.sql` — Postgres schema (RLS, Vault, free-fix meter) and SQL tests.
- `app/` — Expo SDK 57 / React Native client (npm, Node 24). Has its own `app/CLAUDE.md` with Expo rules — read it before
  touching Expo APIs. Note: the app does **not** use Expo Router despite what that file says; it's a single `App.tsx` plus
  screens/components in `app/src/`.
- `evals/suggest/` — labeled incident cases scoring fix suggestions.
- `infra/` — demo target (`demo-web`, Node, deployed on Render), GCP setup, cron SQL, `chaos.sh` to break the demo.

## Commands

Backend (repo root, Deno 2):

```bash
deno task test                 # all backend tests
deno test --allow-env supabase/functions/tests/flow.test.ts   # one file
deno test --allow-env --filter "revert PR" supabase/functions/tests/   # one test by name
deno task check                # typecheck all function entrypoints + eval
deno task lint
deno fmt                       # CI runs `deno fmt --check` (single quotes, width 120)
deno task eval                 # rule suggestions must score 100% or CI fails; `deno task eval vertex` scores Claude
```

App (`cd app`): `npm run typecheck`, `npm run lint`, `npm test` (Node's built-in runner on `src/**/*.test.ts`),
`npm start`. Add deps with `npx expo install`, not `npm install`.

SQL tests (need a local Postgres 17, mirrors CI):

```bash
psql -v ON_ERROR_STOP=1 -f supabase/tests/setup/supabase-stubs.sql
for m in supabase/migrations/*.sql; do psql -v ON_ERROR_STOP=1 -f "$m"; done
for t in supabase/tests/*.sql; do psql -v ON_ERROR_STOP=1 -f "$t"; done
```

Demo service: `node --test "infra/demo-web/**/*.test.js"`.

## Architecture

Incident lifecycle, spread across functions:

1. **Detect** — `report/` receives HMAC-signed 5xx reports from a user's app (per-service secret, `_shared/hmac.ts`);
   `healthcheck/` runs every minute via pg_cron for liveness and stamps recovery. Both open incidents through
   `_shared/incidents.ts` (one open incident per service), which scrubs and stores failing requests as replay samples
   (`_shared/replay.ts`) and attaches a suggestion.
2. **Suggest** — `_shared/suggest.ts`: deterministic rules always answer; Claude on Vertex AI may refine in the background but
   is schema-constrained to the incident's allowed actions and falls back to rules on any error.
3. **Execute** — `execute/`: the phone sends only an incident id + action name. Owner comes from the verified JWT; allowed
   actions come from the service's validated config (`_shared/targets.ts`) AND the actions stored on the incident. Checks the
   RevenueCat `pro` entitlement server-side (`_shared/entitlement.ts`); the free fix is an atomic Postgres meter refunded on
   failure. Providers: `render.ts` (restart/rollback), `gcp.ts` (VM reset), `github.ts` (revert PR / merge PR via Git Data
   API, no clone).
4. **After the fix** — `_shared/flow.ts` `afterFix()` is the pure state machine deciding whether the incident resolves or stays
   open (a revert PR keeps it open until proven + merged, even if a rollback mitigated production). Change behavior here and
   in `tests/flow.test.ts` together.
5. **Prove** — revert PRs carry `.opsswipe/replays/*.json`; the workflow from `_shared/proofKit.ts` replays them in CI and posts
   to `proof/` with a GitHub Actions OIDC token (`_shared/oidc.ts`). Proof is bound to the head sha OpsSwipe opened
   (`_shared/proof.ts`), and `merge_pr` passes that sha so GitHub 409s if anything was pushed after.

`connect/` + `oauth-callback/` link users' GitHub App installs, Render keys, and Google Cloud (a one-time Google token grants
OpsSwipe's own service account a reset-only custom role on one VM, then is deleted). Secrets live in Supabase Vault and are only
read in `_shared/services.ts`. `_shared/db.ts` holds the service-role client and `env()`.

## Conventions

- Few dependencies by design: JWTs are signed with WebCrypto (`_shared/jwt.ts`), GitHub/Render/GCP/Expo push are plain `fetch`.
  The only SDK is Anthropic's. Don't add libraries for things a few lines of `fetch`/WebCrypto do.
- Edge Functions import with inline `npm:`/`jsr:` specifiers (hence `no-import-prefix` is disabled in `deno.json`).
- Never trust the client for what to run; never replay requests against production (CI only).
- `ponytail:` comments mark deliberate simplifications and name their ceiling.
