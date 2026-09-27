# Setup runbook

Two roles, both you for the demo:

- **Operator** (once per OpsSwipe deployment): Supabase, the GitHub App, the GCP platform identity, RevenueCat.
- **User** (anyone, from the app): connects GitHub and Render, adds services, installs the proof workflow.

About 2 hours the first time. All accounts are personal and free tier.

## 0. Clone and check

```bash
git clone git@github.com:DevHusnainAi/opsswipe.git && cd opsswipe
(cd app && npm ci && cp .env.example .env)
deno task test && deno task eval && deno task lint
(cd app && npm run typecheck && npm run lint && npm test)
node --test "infra/demo-web/**/*.test.js"
```

## Operator setup

### 1. Supabase

1. New project. **Authentication → Providers → Anonymous sign-ins: on.**
2. `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. Run `infra/cron.sql` in the SQL editor (project URL + a `CRON_SECRET` you choose).

### 2. GCP platform identity and demo VM (personal account with credits)

```bash
gcloud auth login                     # personal Google account, not a work one
gcloud projects create opsswipe-<suffix>
# link billing (your credits) in the console, then:
PROJECT=opsswipe-<suffix> ./infra/gcp-setup.sh
```

This creates `opsswipe@<project>.iam.gserviceaccount.com`, OpsSwipe's identity. It has **no access to any VM** until
a user grants it a reset-only role on theirs. The script also creates a free-tier demo VM and grants it, exactly as the
app tells users to. It writes `gcp-sa-key.json` (gitignored). If key creation is blocked by an organization policy,
use a project outside any organization. Optional AI: enable Claude in **Vertex AI → Model Garden**.

### 3. GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting | Value |
| --- | --- |
| Name | e.g. `OpsSwipe-<you>` (the URL slug is used below) |
| Callback URL | `https://<ref>.supabase.co/functions/v1/github-callback` |
| Request user authorization (OAuth) during installation | **On** (OpsSwipe verifies each installation belongs to the user) |
| Webhook | **Off** |
| Repository permissions | Contents: **Read and write**, Pull requests: **Read and write**, Workflows: **Read and write**, Metadata: Read |
| Where can it be installed | Any account (or only yours for the demo) |

Then note the **App ID** and **Client ID**, generate a **client secret** and a **private key** (`.pem`).

### 4. RevenueCat

New project (Test Store included) → products `opsswipe_pro_monthly` $4.99 and `opsswipe_pro_annual` $39.99 on the
Test Store → entitlement `pro` with both → offering `default` → a Paywall. The Test Store public key goes in
`app/.env` as `EXPO_PUBLIC_RC_KEY`; keep the secret key for the next step.

### 5. Secrets and deploy

```bash
npx supabase secrets set \
  GCP_SA_KEY="$(cat gcp-sa-key.json)" \
  GITHUB_APP_ID=123456 GITHUB_APP_CLIENT_ID=Iv1.xxx GITHUB_APP_CLIENT_SECRET=xxx \
  GITHUB_APP_SLUG=opsswipe-you GITHUB_APP_PRIVATE_KEY="$(cat opsswipe.private-key.pem)" \
  REVENUECAT_SECRET_KEY=sk_... CRON_SECRET=<same as cron.sql> \
  AI_SUGGESTIONS=vertex   # optional; omit for rules only
npx supabase functions deploy execute connect healthcheck report proof github-callback
```

No per-service keys here: users' Render keys and report secrets live encrypted in Supabase Vault, and GitHub access
comes from 1-hour installation tokens.

### 6. App

Fill `app/.env` (Supabase URL, publishable key, RevenueCat Test Store key), then one of:

```bash
cd app && npx expo run:android      # Android emulator / USB phone (Android Studio)
cd app && npx expo run:ios          # iOS simulator (macOS). Enroll Face ID: Features → Face ID → Enrolled
cd app && npx eas-cli build -p android --profile development   # cloud build, install the APK
```

A development build loads `app/.env` from your machine through Metro. A standalone build (`--profile preview`)
does not see `.env` (it's gitignored), so first add the three `EXPO_PUBLIC_` values with
`npx eas-cli env:create --environment preview`.

## User setup (in the app)

### 7. Demo service on Render

Render deploys from Git, so the demo service lives in its own public repo:

```bash
cp -r infra/demo-web ../opsswipe-demo-target && cd ../opsswipe-demo-target
git init -q && git add . && git commit -qm "Demo target"
gh repo create opsswipe-demo-target --public --source . --push
cd -
```

Render: **New → Web Service → opsswipe-demo-target**, plan **Free**, start `npm start`, health check path `/livez`,
env `CHAOS_KEY` (any long random string). Keep auto-deploy on. Create an API key (**Account settings → API keys**).

### 8. Connect everything from the app

1. **Services (plug icon) → GitHub → Connect**: install the GitHub App on `opsswipe-demo-target`.
2. **Render → paste the API key → Save key.**
3. **Add a service → Render → `opsswipe-demo-target` → Add.** Copy the two values it shows once
   (`OPSSWIPE_REPORT_URL`, `REPORT_SECRET`) into the Render service's environment. It redeploys.
4. **Your services → `opsswipe-demo-target` → Add proof to repo.** Merge the PR it opens (check the install, test and
   start commands first). From now on every PR runs the proof, authenticated by GitHub OIDC with no secrets.
5. **Add a service → GCP VM:** project, zone, `opsswipe-demo`, `http://<ip>/` → **Verify access and add**.
   (The script already granted access; a real user runs the two commands shown.)

## 9. Break things

```bash
RENDER_URL=https://<name>.onrender.com CHAOS_KEY=... ./infra/chaos.sh render   # wedged -> Restart
./infra/chaos.sh gcp                                                          # nginx down -> Reset VM
DEMO_REPO=../opsswipe-demo-target ./infra/chaos.sh release                    # bad release -> Roll back / Revert PR
```

## 10. End-to-end checklist

- [ ] Connect: GitHub shows "Connected as @you"; Render lists your services; both services appear under Your services
- [ ] A card appears after each chaos command, with a suggested fix and a reason
- [ ] Swipe and the fingerprint button both run the selected fix after biometrics
- [ ] The site comes back; **Recent fixes** shows "down Xm Ys · back Ns after fix"
- [ ] Bad release: the card appears within seconds (reported by the app, not polling); suggestion is **Roll back**
- [ ] **Revert PR** opens a real PR containing `.opsswipe/replays/<sha>.json`; the card shows "CI is replaying..."
- [ ] The proof workflow runs; the card shows "N/N failing production requests now pass" and offers **Merge PR**
- [ ] **Merge PR** merges; Render deploys; the card shows recovery. Pushing to the PR after the proof makes merge refuse
- [ ] Roll back while the PR is open: the site comes back, the card says "Waiting for the CI proof", Merge PR still works
- [ ] Second fix on the free plan: card snaps back, paywall, Test Store purchase, fix runs
- [ ] Activity shows Executed / Paywalled / Failed; the PR row opens the PR
- [ ] A second test user (another phone, or reinstall) sees none of your services or incidents
