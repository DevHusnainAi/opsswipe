# Setup runbook

From a fresh clone to a phone (or emulator) fixing real servers. About 2 hours the first time.
All accounts are personal and free tier.

## 0. Clone and check

```bash
git clone git@github.com:DevHusnainAi/opsswipe.git && cd opsswipe
(cd app && npm ci && cp .env.example .env)
deno task test && deno task eval && deno task lint
(cd app && npm run typecheck && npm run lint && npm test)
node --test infra/demo-web/
```

## 1. GCP demo VM (personal account with credits)

```bash
gcloud auth login                     # personal Google account, not a work one
gcloud projects create opsswipe-<suffix>
# link billing (your credits) in the console, then:
PROJECT=opsswipe-<suffix> ./infra/gcp-setup.sh
```

Creates a free-tier `e2-micro` VM with nginx, a service account whose custom role can only `reset` and `get`
that one VM, and `gcp-sa-key.json` (gitignored). It prints the `TARGETS` entry. If key creation is blocked by an
organization policy, use a project outside any organization. Optional AI: enable Claude in **Vertex AI → Model Garden**.

## 2. Render demo service

Render deploys from Git, so the demo service lives in its own public repo:

```bash
cp -r infra/demo-web ../opsswipe-demo-target && cd ../opsswipe-demo-target
git init -q && git add . && git commit -qm "Demo target"
gh repo create opsswipe-demo-target --public --source . --push
cd -
```

Render: **New → Web Service → opsswipe-demo-target**, plan **Free**, start `npm start`, health check path
`/livez`. Keep auto-deploy on. Environment variables:

| Variable | Value |
| --- | --- |
| `CHAOS_KEY` | any long random string |
| `OPSSWIPE_REPORT_URL` | `https://<ref>.supabase.co/functions/v1/report` |
| `REPORT_SECRET` | same value as the Supabase secret below |
| `OPSSWIPE_TARGET` | `render-web` (the name used in `TARGETS`) |

Note the service id (`srv-...`) and URL, and create an API key (**Account settings → API keys**).

In the **demo repo** on GitHub, add Actions secrets `OPSSWIPE_PROOF_URL`
(`https://<ref>.supabase.co/functions/v1/proof`) and `PROOF_SECRET` (same as Supabase). The
`opsswipe-proof` workflow then replays saved production failures on every PR and reports the result.

## 3. GitHub token (revert and merge PRs)

Fine-grained personal access token for **only** `opsswipe-demo-target`: **Contents: read and write**,
**Pull requests: read and write**. PRs are opened with this token (not `GITHUB_TOKEN`) so the proof
workflow runs on them.

## 4. Supabase

1. New project. **Authentication → Providers → Anonymous sign-ins: on.**
2. `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. Secrets (`TARGETS` is the allowlist; nothing outside it can be touched):

```bash
npx supabase secrets set \
  TARGETS='{"gcp-vm":{"provider":"gcp","project":"<p>","zone":"us-central1-a","instance":"opsswipe-demo","url":"http://<ip>/"},"render-web":{"provider":"render","serviceId":"srv-...","url":"https://<name>.onrender.com/","repo":"DevHusnainAi/opsswipe-demo-target","branch":"main"}}' \
  GCP_SA_KEY="$(cat gcp-sa-key.json)" RENDER_API_KEY=rnd_... GITHUB_TOKEN=github_pat_... \
  REVENUECAT_SECRET_KEY=sk_... CRON_SECRET="$(openssl rand -hex 24)" \
  REPORT_SECRET=<random> PROOF_SECRET=<random> \
  AI_SUGGESTIONS=vertex   # optional; omit for rules only
npx supabase functions deploy execute healthcheck report proof
```

4. Run `infra/cron.sql` in the SQL editor (project URL + the same `CRON_SECRET`).

## 5. RevenueCat

New project (Test Store included) → products `opsswipe_pro_monthly` $4.99 and `opsswipe_pro_annual` $39.99 on the
Test Store → entitlement `pro` with both → offering `default` → a Paywall. Test Store public key goes in
`app/.env` as `EXPO_PUBLIC_RC_KEY`; the secret key went into Supabase.

## 6. App

Fill `app/.env`, then one of:

```bash
cd app && npx expo run:android      # Android emulator / USB phone (Android Studio)
cd app && npx expo run:ios          # iOS simulator (macOS). Enroll Face ID: Features → Face ID → Enrolled
cd app && npx eas-cli build -p android --profile development   # cloud build, install the APK
```

## 7. Break things

```bash
RENDER_URL=https://<name>.onrender.com CHAOS_KEY=... ./infra/chaos.sh render   # wedged -> Restart
./infra/chaos.sh gcp                                                          # nginx down -> Reset VM
DEMO_REPO=../opsswipe-demo-target ./infra/chaos.sh release                    # bad release -> Roll back / Revert PR
```

## 8. End-to-end checklist

- [ ] A card appears after each chaos command, with a suggested fix and a reason
- [ ] Swipe and the fingerprint button both run the selected fix after biometrics
- [ ] The site comes back; **Recent fixes** shows "down Xm Ys · back Ns after fix"
- [ ] Bad release: the card appears within seconds (reported by the app, not polling); suggestion is **Roll back**
- [ ] **Revert PR** opens a real PR containing `.opsswipe/replays/<sha>.json`; the card shows "CI is replaying..."
- [ ] The proof workflow runs; the card shows "N/N failing production requests now pass" and offers **Merge PR**
- [ ] **Merge PR** merges; Render deploys; the card shows recovery. Pushing to the PR after the proof makes merge refuse
- [ ] Second fix on the free plan: card snaps back, paywall, Test Store purchase, fix runs
- [ ] Activity shows Executed / Paywalled / Failed; the PR row opens the PR
