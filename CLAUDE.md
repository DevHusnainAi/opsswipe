# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

OpsSwipe: a phone pager that turns production 5xx incidents into swipe-to-fix cards, and only lets a code fix merge after CI
replays the exact production requests that failed. Rationale for most design choices lives in `docs/DECISIONS.md`; operator
and user setup in `docs/SETUP.md`.

**Start with the private handoff** (`../opsswipe-private/HANDOFF.md`, kept outside this public repo): current state, what's untested, the remaining steps, every account ID, and where each
secret lives (secrets are never in the repo).

## Layout

- `supabase/functions/` — Deno Edge Functions (backend). One dir per endpoint, logic in `_shared/`, tests in `tests/`.
- `supabase/migrations/` + `supabase/tests/*.sql` — Postgres schema (RLS, Vault, free-fix meter) and SQL tests.
- `app/` — Expo SDK 57 / React Native client (npm, Node 24). Has its own `app/CLAUDE.md` with Expo rules — read it before
  touching Expo APIs. Note: the app does **not** use Expo Router despite what that file says. `App.tsx` owns the phases
  (welcome → auth → alerts primer → ready) and four state-based tabs (`src/TabBar.tsx`: Incidents, `Services.tsx`,
  `Activity.tsx`, `Settings.tsx`); no navigation library, so it runs in Expo Go and the dev build without a rebuild.
  `src/env.ts` detects Expo Go (no push, RevenueCat preview mode, `exp://` OAuth returns). `src/secure.ts`: the session
  in expo-secure-store, Supabase PKCE, and the fingerprint-locked fix key.
- `evals/suggest/` — labeled incident cases scoring fix suggestions.
- `infra/` — demo target (`demo-web`, Node; runs on the GCP demo VM via `demo-box.sh`; its repo `opsswipe-demo-target` deploys
  with GitHub Actions: tests, then SSH as a deploy-only user), GCP setup, cron SQL, `chaos.sh` to break the demo.

## Commands

Backend (repo root, Deno 2):

```bash
deno task test                 # all backend tests
deno test --allow-env supabase/functions/tests/flow.test.ts   # one file
deno test --allow-env --filter "revert PR" supabase/functions/tests/   # one test by name
deno task check                # typecheck all function entrypoints + eval
deno task lint
deno fmt                       # CI runs `deno fmt --check` (single quotes, width 120)
deno task eval                 # rules must score 100% or CI fails; `deno task eval nvidia` / `openai` / `vertex` score a model
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
2. **Suggest** — `_shared/suggest.ts`: deterministic rules decide the suggested fix. An AI model (`AI_SUGGESTIONS=nvidia`:
   NVIDIA Nemotron via `_shared/llm.ts`, retrying and falling back to an OpenAI-compatible backup such as Groq; or `vertex`:
   Claude) runs in the background; its reason is used only when it picks the same fix, and its opinion is stored in
   `context.ai` either way (shown in the app's incident detail). Measured on the eval, models picked worse fixes, hence the rule.
3. **Execute** — `execute/`: the phone sends only an incident id + action name, plus its fix key (`x-fix-key`,
   released by the phone's secure hardware after the fingerprint; `_shared/fixKeys.ts`, enrolled via
   `connect register_fix_key` only right after a sign-in). Owner comes from the verified JWT; allowed
   actions come from the service's validated config (`_shared/targets.ts`) AND the actions stored on the incident. Checks the
   RevenueCat `pro` entitlement server-side (`_shared/entitlement.ts`); the free fix is an atomic Postgres meter refunded on
   failure. Providers: `render.ts` (restart/rollback), `gcp.ts` (VM reset), `github.ts` (revert PR / merge PR via Git Data
   API, no clone).
4. **After the fix** — `_shared/flow.ts` `afterFix()` is the pure state machine deciding whether the incident resolves or stays
   open (a revert PR keeps it open until proven + merged, even if a rollback mitigated production). Change behavior here and
   in `tests/flow.test.ts` together.
5. **Prove** — revert PRs carry `.opsswipe/replays/*.json`; the workflow from `_shared/proofKit.ts` replays them in CI and posts
   to `proof/` with a GitHub Actions OIDC token (`_shared/oidc.ts`). Proof is bound to the head sha OpsSwipe opened
   (`_shared/proof.ts`), and `merge_pr` passes that sha so GitHub 409s if anything was pushed after. The server grades it:
   each request the PR carries (`pr.replay`) must have been 5xx and now answer 2xx. PR code runs in locked-down
   containers; only the reporter step sees the OIDC token.

`connect/` + `oauth-callback/` link users' GitHub App installs (Connect starts at GitHub's authorize page), Render and Railway
keys, Discord/Slack alerts, RevenueCat (revenue at risk), and Google Cloud. `connect` issues a one-time `oauth_states` row;
`oauth-callback` exchanges the code and keeps the result under a one-time claim sent only in the redirect to the device
that approved; `connect oauth_claim` finishes it for the account that started it (`_shared/oauthState.ts`). The Google
refresh token stays in Vault so VMs can be added later; each added VM (`gcp_add`, with the user's own IAM rights) gets a
reset-only custom role for OpsSwipe's own service account; `execute` checks the owner can still manage the VM before
each reset (`google.ts canManage`), and remove/disconnect/delete take the role off at Google (`revokeReset`). `connect` is one action switch (status, add_render, gcp_*, link_repo, agent_token_*,
decline, register/unregister_push, rotate_report_secret…). `oauth-callback` bounces codes and Supabase sessions back to `opsswipe://` or a
LAN-only `exp://` (`_shared/appLink.ts`). Secrets live in Supabase Vault and are only read in `_shared/services.ts`.
`_shared/db.ts` holds the service-role client and `env()`.

Code fixes work for any service with a linked repo (`targets.ts` `actionsFor`): `revert_pr`, `fix_pr` (the AI model writes a patch
limited to the bad commit's files, `_shared/patch.ts`, gated by `checkPatch`; needs `AI_SUGGESTIONS` set) and `merge_pr`.
The bad commit comes from Render deploys, else the app's reported `release`, else the branch head (`execute/badCommit`).
The code fixes live in `_shared/codeFix.ts` (used by `execute/` and by `incidents.ts` `prepareFix`, which opens the
AI fix PR as soon as an incident opens on a service with `config.autofix`). The AI fix adds one regression test at a
path OpsSwipe picks (`patch.ts` `regressionTestPath`). `connect` also serves `pr_diff`, `postmortem` (written once
after resolve, `_shared/postmortem.ts`), `status_page`, team actions (`team_members`: teammates see/fix the owner's
incidents via RLS and `ownersFor`, never services or keys) and one-click Slack/Discord (`alerts_start`, finished in
`oauth-callback`). `healthcheck` also escalates incidents untouched for 5 min to the team (`flow.ts`
`needsEscalation`). `status/` (public JSON for `status-page/index.html`) and `weekly/` (Monday report, pg_cron) are
new functions. `agent/` is the Approval API: agents with a hashed `ops_` token propose a fix, it becomes an incident card
(`suggested_by='agent'`), the human approves or declines, the agent polls (`_shared/agents.ts`).

## Conventions

- Few dependencies by design: JWTs are signed with WebCrypto (`_shared/jwt.ts`), GitHub/Render/GCP/Expo push are plain `fetch`.
  The only SDK is Anthropic's. Don't add libraries for things a few lines of `fetch`/WebCrypto do.
- Edge Functions import with inline `npm:`/`jsr:` specifiers (hence `no-import-prefix` is disabled in `deno.json`).
- Never trust the client for what to run; never replay requests against production (CI only).
- `incidents.context` updates merge in the database (trigger): send only the keys you change.
- Service URLs must be public (`_shared/netguard.ts`); probes re-check after DNS.
- `ponytail:` comments mark deliberate simplifications and name their ceiling.
