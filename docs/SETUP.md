# Setup runbook

Two roles, both you for the demo:

- **Operator** (once per OpsSwipe deployment): Supabase, the GitHub App, the GCP platform identity, RevenueCat.
- **User** (anyone, from the app): signs in with GitHub, connects GitHub, Render and Google Cloud, adds services,
  installs the proof workflow.

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

1. New project. **Authentication → Providers → Anonymous sign-ins: on.** Under **Authentication → Sign In / Providers**
   also turn on **Allow manual linking**, and add `opsswipe://auth` to **URL Configuration → Redirect URLs**.
   (The GitHub provider is turned on in step 3, with the GitHub App's credentials.)
2. `npx supabase login && npx supabase link --project-ref <ref> && npx supabase db push`
3. Run `infra/cron.sql` in the SQL editor (project URL + a `CRON_SECRET` you choose).

### 2. GCP platform identity and demo VM (personal account with credits)

```bash
gcloud auth login                     # personal Google account, not a work one
gcloud projects create opsswipe-<suffix>
# link billing (your credits) in the console, then:
PROJECT=opsswipe-<suffix> ./infra/gcp-setup.sh
```

Then **Connect Google Cloud** sign-in, in the same project:

1. **APIs & Services → OAuth consent screen**: External, publishing status **Testing**, add your Google account (and
   any tester) under **Test users**. Scopes are requested at runtime: `openid`, `email`, `cloud-platform`.
2. **Credentials → Create credentials → OAuth client ID → Web application**, authorized redirect URI
   `https://<ref>.supabase.co/functions/v1/oauth-callback`. Keep the client ID and secret for step 5.

Until Google verifies the app, users see an "unverified app" screen and at most 100 users can connect
([Google](https://support.google.com/cloud/answer/7454865)). The `gcloud` commands in the app remain as a fallback.

This creates `opsswipe@<project>.iam.gserviceaccount.com`, OpsSwipe's identity. It has **no access to any VM** until
a user grants it a reset-only role on theirs. The script also creates a free-tier demo VM and grants it, exactly as the
app tells users to. It writes `gcp-sa-key.json` (gitignored). If key creation is blocked by an organization policy,
use a project outside any organization. Optional AI: enable Claude in **Vertex AI → Model Garden**.

### 3. GitHub App

GitHub → **Settings → Developer settings → GitHub Apps → New GitHub App**:

| Setting | Value |
| --- | --- |
| Name | e.g. `OpsSwipe-<you>` (the URL slug is used below) |
| Callback URLs | `https://<ref>.supabase.co/functions/v1/oauth-callback` (install) and `https://<ref>.supabase.co/auth/v1/callback` (Sign in with GitHub) |
| Request user authorization (OAuth) during installation | **On** (OpsSwipe verifies each installation belongs to the user) |
| Webhook | **Off** |
| Repository permissions | Contents: **Read and write**, Pull requests: **Read and write**, Workflows: **Read and write**, Metadata: Read |
| Where can it be installed | Any account (or only yours for the demo) |

Then note the **App ID** and **Client ID**, generate a **client secret** and a **private key** (`.pem`). Under
**Account permissions** set **Email addresses: Read-only**, so sign-in works. In Supabase, **Authentication → Providers
→ GitHub**: on, with the same Client ID and client secret. One app does both install and sign-in.

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
  GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com GOOGLE_CLIENT_SECRET=xxx \
  REVENUECAT_SECRET_KEY=sk_... CRON_SECRET=<same as cron.sql> \
  RC_WEBHOOK_AUTH="Bearer $(openssl rand -hex 24)" \
  AI_SUGGESTIONS=vertex   # optional; omit for rules only
npx supabase functions deploy execute connect healthcheck report proof oauth-callback agent sentry revenuecat-webhook
```

RevenueCat → Project → Integrations → Webhooks: URL `https://<ref>.supabase.co/functions/v1/revenuecat-webhook`,
Authorization header = the exact `RC_WEBHOOK_AUTH` value. It keeps a copy of each plan so a RevenueCat API outage never
blocks a paying user's fix. Optional, for the Monetization story: a 7-day trial on the annual product, a second offering
whose paywall copy talks about outages, and an Experiment between the two.

No per-service keys here: users' Render keys and report secrets live encrypted in Supabase Vault, and GitHub access
comes from 1-hour installation tokens.

### 6. Push notifications

Alerts are sent by the server through Expo's push service, so they reach a closed app
([Expo](https://docs.expo.dev/push-notifications/push-notifications-setup/)):

1. `cd app && npx eas-cli init`. This writes `extra.eas.projectId` into `app.json`; commit that.
2. Firebase console: new project, **Add app → Android**, package `dev.husnainai.opsswipe`. Download
   `google-services.json` into `app/` and set `"android": { "googleServicesFile": "./google-services.json" }`.
3. Firebase **Project settings → Service accounts → Generate new private key**, then
   `npx eas-cli credentials` → Android → **Google Service Account → FCM V1** and upload that key.
   Keep the key file out of git.

Without these, everything else works and the open app still updates in real time; only closed-app alerts are missing.

### 7. App

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

### 8. Demo service on the GCP VM

The demo VM runs the demo app from its own public repo and redeploys within ~30s whenever `main` moves, like a PaaS
(`infra/demo-box.sh`). Create the repo:

```bash
cp -r infra/demo-web ../opsswipe-demo-target && cd ../opsswipe-demo-target
git init -q && git add . && git commit -qm "Demo target"
gh repo create opsswipe-demo-target --public --source . --push
cd -
```

Point the VM at it and apply (gcloud on your **personal** account; `gcp-setup.sh` does this for a new VM):

```bash
gcloud compute instances add-metadata opsswipe-demo --zone us-central1-a \
  --metadata-from-file startup-script=infra/demo-box.sh \
  --metadata demo-repo=https://github.com/<you>/opsswipe-demo-target
gcloud compute instances reset opsswipe-demo --zone us-central1-a   # the startup script deploys on boot
```

Render works too (New → Web Service from the same repo, env `CHAOS_KEY`, health check `/livez`); the demo uses the VM.

### 9. Connect everything from the app

First launch: the welcome tour, **Create account** (Continue with GitHub, or email and password), **Turn on alerts**,
then the **Services** tab's setup checklist.

1. **Connections → GitHub → Connect**: install the GitHub App on `opsswipe-demo-target`.
2. **Add → Google Cloud VM**: sign in with Google once (accept the unverified-app screen), pick the project, then
   `opsswipe-demo`, check the URL, link `opsswipe-demo-target` as the repo, **Add**. Google stays connected, so the
   next VM is just project → VM. (`gcp-setup.sh` already granted the demo VM; adding it again is harmless.)
3. Give the VM the two values the app shows once, then reset it so the app reports its 5xx with the deployed commit:
   `gcloud compute instances add-metadata opsswipe-demo --zone us-central1-a --metadata opsswipe-report-url=<URL>,report-secret=<SECRET>`
   and `gcloud compute instances reset opsswipe-demo --zone us-central1-a`.
4. **Setup checklist → Turn on proof.** Merge the PR it opens (check the install, test and start commands first).
   From now on every PR runs the proof, authenticated by GitHub OIDC with no secrets.

### Fix with AI (optional)

In the platform GCP project: **Vertex AI → Model Garden → Claude Opus 5 → Enable**, then
`npx supabase secrets set AI_SUGGESTIONS=vertex`. Incidents on services with a linked repo then offer **Fix with AI**,
and suggestions are refined by Claude. Without it, everything else works and revert PRs remain the code fix.

### Approval API for AI agents

**Settings → Agent access → New agent token**. Then, from any agent:

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/agent -H "Authorization: Bearer ops_..." \
  -d '{"service":"opsswipe-demo-target","action":"restart","reason":"Error rate spiked after the 10:02 deploy"}'
# -> {"id":"<proposal>","status":"pending"}; the owner gets a card and a push
curl -H "Authorization: Bearer ops_..." "https://<ref>.supabase.co/functions/v1/agent?id=<proposal>"
# -> pending | running | approved (with detail / PR) | declined | failed
```

## 10. Break things

```bash
./infra/chaos.sh gcp                                        # demo app stopped -> Reset VM
DEMO_REPO=../opsswipe-demo-target ./infra/chaos.sh release  # bad release -> Revert PR / Fix with AI -> proof -> Merge
DEMO_REPO=../opsswipe-demo-target ./infra/chaos.sh heal     # between rehearsals: good release again
```

## 11. End-to-end checklist

- [ ] Onboarding: alerts on, Sign in with GitHub, Services opens; Account shows "Signed in as @you"
- [ ] Connect: GitHub shows "Connected as @you"; Google Cloud lists your projects and VMs; the VM appears under
      Watching with `opsswipe-demo-target` linked; the checklist ticks off Turn on proof
- [ ] With the app **closed**, `chaos.sh gcp` sends a push; tapping it opens the card
- [ ] Reinstall the app, Sign in with GitHub: your services and plan are back
- [ ] A card appears after each chaos command, with a suggested fix and a reason
- [ ] Swipe and the fingerprint button both run the selected fix after biometrics
- [ ] The site comes back; the home screen shows "<service> is back up" with the times, and a push arrives if closed
- [ ] Try a sample incident (fresh account): swipe, fingerprint, practice recovery; nothing real changes
- [ ] Bad release: the card appears within seconds (reported by the app, not polling); fixes offered are **Reset**,
      **Revert PR** and **Fix with AI**
- [ ] **Revert PR** opens a real PR containing `.opsswipe/replays/<sha>.json`; the card shows "CI is replaying..."
- [ ] The proof workflow runs; the card shows "N/N failing production requests now pass" and offers **Merge PR**
- [ ] **Merge PR** merges; the VM deploys `main` within ~30s; "back up" arrives. Pushing to the PR after the proof
      makes merge refuse
- [ ] The whole first outage is free (revert and merge both run); a fix on a second outage: card snaps back, paywall
      names the service, Test Store purchase, fix runs
- [ ] A one-off blip (stop and start the demo app within 10 s) pages nobody; a stop that lasts pages once
- [ ] Start the app again yourself: the card closes and "recovered on its own" arrives
- [ ] **Dismiss, it's a false alarm** closes a card; Activity shows Dismissed and no "back up" push follows
- [ ] A PR whose proof fails (push a broken commit to it): the card offers Fix with AI again
- [ ] Settings → Discord or Slack: the test message arrives; the next incident posts there too
- [ ] Sentry (optional): an issue alert on the linked project opens a card with the failing request
- [ ] Activity: week stats show; Share on a recovery opens the share sheet with the report
- [ ] Activity shows Executed / Paywalled / Failed / Dismissed; the PR row opens the PR
- [ ] Settings → Delete account (a throwaway account): signed out, services gone, Google access revoked
- [ ] A second test user (another phone, or reinstall) sees none of your services or incidents
