# Handoff: state of OpsSwipe (Sep 28, 2026, evening PKT)

For the next person or agent picking this up on a new machine. Read this, then `CLAUDE.md`, `docs/SETUP.md`,
`docs/DECISIONS.md` and `docs/SUBMISSION.md`. No secret values are in this repo; this file says where each one lives.

Deadline: **Oct 1, 11:45am PKT** (Sep 30, 11:45pm PDT). Plan: submit by Sep 29, Sep 30 is buffer.
Planning doc (Claude Docs artifact): https://claude.ai/artifact/XjeVRmTo5xBSG2d4BRMHrf (tab "Master plan" has the
latest status at the top).

## Git

- Work is on branch **`app-v2-accounts-ai-agents`** (commit `85f61cc`), pushed; not merged to `main`, no PR opened yet.
- `main` is at `3fce05b` (Connect v2 + submission playbook).

## What's built (and what's verified)

| Area | State |
| --- | --- |
| Backend (all Edge Functions, migrations up to `20260928050000_agents.sql`) | Deployed to Supabase; 45 Deno tests pass |
| Accounts (GitHub or email/password, no guest), onboarding, 4 tabs, Services redesign, Settings | Code passes typecheck/lint/tests; **not yet tested on the phone** |
| Google Cloud stays connected (refresh token in Vault) | Deployed; the Google connection must be made once again in the app |
| Repo linking (Render + GCP), `release` in reports | Deployed; untested end to end |
| Fix with AI (`fix_pr`) | Deployed; **inactive** until Claude is enabled in Vertex Model Garden and `AI_SUGGESTIONS=vertex` is set |
| Approval API (`agent` function, Settings → Agent access) | Deployed; endpoint rejects bad tokens (checked); full flow untested |
| Expo Go support | Works for UI checks; push and purchases only in the dev build |

## Not done yet (in order)

1. Supabase dashboard → Authentication → Sign In / Providers: turn **off** "Confirm email" (built-in mailer ~2/hour) and
   **off** "Allow anonymous sign-ins" (app no longer uses guests).
2. Purge test data, then test from onboarding. It was agreed but **not run**. SQL (run with the DB password; revoke
   Google first so no refresh token survives):
   - Revoke: for each `vault.decrypted_secrets` row referenced by `connections` where `kind='google'`, POST
     `https://oauth2.googleapis.com/revoke?token=<value>`.
   - Delete Vault secrets referenced by `services.report_secret_id` and `connections.secret_id`, then
     `delete from audit_log, usage, incidents, services, connections, push_tokens, agent_tokens`, then `delete from auth.users`.
   - Keep Vault secrets `project_url` and `cron_secret` (used by the cron job).
   - Then: uninstall the OpsSwipe GitHub App on GitHub (Settings → Applications), clear the app's data on the phone.
3. Demo service on the GCP VM (docs/SETUP.md step 8; Render is dropped): create public repo `opsswipe-demo-target`
   from `infra/demo-web`, point the VM at it (metadata + reset), then give it the report URL and secret.
4. Walk docs/SETUP.md step 11 (end-to-end checklist) on the dev build, then chaos tests (`infra/chaos.sh`).
5. Optional: enable AI fixes (Vertex Model Garden → Claude Opus 5 → Enable; `supabase secrets set AI_SUGGESTIONS=vertex`).
6. Merge the branch, video, Devpost (docs/SUBMISSION.md). Decide on Sentry/Datadog/Alertmanager webhooks (parked).

## Accounts and IDs (not secret)

| Thing | Value |
| --- | --- |
| GitHub account / repo | `DevHusnainAi` / `DevHusnainAi/opsswipe` (private until submission) |
| Supabase project ref | `mwkwhfqcgxossweqwibt` (org "DevHusnainAi's Org"), URL `https://mwkwhfqcgxossweqwibt.supabase.co` |
| Supabase publishable key | in `app/.env` (`EXPO_PUBLIC_SUPABASE_KEY`); public by design |
| GitHub App | slug `opsswipe`, App ID `5105120`, Client ID `Iv23liUYnLViQSTBzNoa`, installable only on DevHusnainAi |
| GCP platform project | `project-6b91521e-dd69-4cb2-b1e` ("My First Project", org `mdanishofficial23-org`, billing on). Also runs `voxapk-prod`: never touch it |
| OpsSwipe service account | `opsswipe@project-6b91521e-dd69-4cb2-b1e.iam.gserviceaccount.com` (only `roles/aiplatform.user` + custom `opsswipeReset` on VMs) |
| Demo VM | `opsswipe-demo`, `us-central1-a`, e2-micro, `http://34.135.145.87/`, firewall `opsswipe-allow-http` |
| Google OAuth client (Connect Google Cloud) | Web client in the GCP project above; consent screen External + Testing, test user `syedhussnaintirmizi@gmail.com`; redirect `…/functions/v1/oauth-callback` |
| Firebase (push) | project `opsswipe` (org `mu462075-org`), Android app `dev.husnainai.opsswipe` |
| EAS | project `16d02af2-7f98-431c-a69c-34cc1321ceb1`, owner `devhusnainai`; FCM V1 key and Android keystore stored on EAS |
| RevenueCat | project "OpsSwipe", Test Store; products `monthly_2` ($4.99/mo) and `yearly` ($39.99/yr); entitlement **`pro`**; offering `default` (current) with `$rc_monthly`, `$rc_annual`; paywall linked |
| Healthcheck cron | pg_cron job `opsswipe-healthcheck`, every minute |

## Secrets: where each lives

### Files on this machine (gitignored; copy them to the new machine by a private channel, never git or chat)

| File | What | If lost |
| --- | --- | --- |
| `app/.env` | Supabase URL, publishable key, RevenueCat Test Store public key | Rebuild from `app/.env.example` + dashboards |
| `gcp-sa-key.json` | Key for the OpsSwipe service account | New key: IAM → Service accounts → opsswipe → Keys (org policy override is on for this project) |
| `opsswipe.private-key.pem` | GitHub App private key | GitHub App settings → Private keys → Generate |
| `google-oauth-client.json` | Google OAuth client ID + secret | GCP → Google Auth Platform → Clients |
| `firebase-fcm-key.json` | Firebase admin key (already uploaded to EAS) | Firebase → Service accounts → Generate |
| `app/google-services.json` | Firebase Android config (committed; not secret) | Firebase project settings |

### Set on the server (Supabase Edge Function secrets; `npx supabase secrets list` shows names only)

`GITHUB_APP_ID`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`,
`GCP_SA_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `REVENUECAT_SECRET_KEY` (a **v1** secret key), `CRON_SECRET`.
Not set: `AI_SUGGESTIONS`. These survive a machine change; only re-set them when rotating. When setting JSON or PEM values,
use an env file with **single quotes** (`KEY='…'`); double quotes corrupted `GCP_SA_KEY` once.

### Supabase Vault (database)

`project_url` and `cron_secret` (the cron job reads them); plus per-user secrets written by the app (Render keys, Google
refresh tokens, report secrets).

### Only in the dashboards / your head

Supabase database password (Settings → Database), Supabase secret key, Supabase personal access token for the CLI
(`npx supabase login` on the new machine creates a new one), GitHub App client secret, RevenueCat secret key.

### Rotate after the hackathon (these were pasted into a chat session)

Supabase DB password, Supabase secret key (`sb_secret_…`), Supabase personal access token (`sbp_…`, also delete it at
supabase.com/dashboard/account/tokens), GitHub App private key and client secret, RevenueCat secret key. After
rotating, re-set the matching Supabase secrets.

### Security settings to undo after the hackathon

- Org policy `iam.disableServiceAccountKeyCreation` was disabled for projects `project-6b91521e-dd69-4cb2-b1e` and
  `opsswipe`: `gcloud resource-manager org-policies enable-enforce iam.disableServiceAccountKeyCreation --project <id>`.
- `syedhussnaintirmizi@gmail.com` was granted `roles/orgpolicy.policyAdmin` on both orgs; remove if not wanted.
- Delete the demo VM when done: `gcloud compute instances delete opsswipe-demo --zone us-central1-a`.

## New machine setup (short)

```bash
git clone https://github.com/DevHusnainAi/opsswipe.git && cd opsswipe && git checkout app-v2-accounts-ai-agents
# copy the gitignored files listed above into the same paths
(cd app && npm ci)
npm i -g eas-cli && eas login
npx supabase login && npx supabase link --project-ref mwkwhfqcgxossweqwibt
gcloud auth login   # personal account syedhussnaintirmizi@gmail.com; project project-6b91521e-dd69-4cb2-b1e
cd app && npx expo start --dev-client    # the OpsSwipe dev build is already on the phone
```

The phone and laptop must be on the same Wi-Fi. For Expo Go instead of the dev build: `npx expo start` and press `s`.
GitHub sign-in inside Expo Go returns through `…/functions/v1/oauth-callback` (Supabase refuses raw IP redirects); that
URL with `**` is in Supabase's redirect allow-list, next to `opsswipe://auth`.
