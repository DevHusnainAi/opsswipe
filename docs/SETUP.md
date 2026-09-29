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
Authorization header = the exact `RC_WEBHOOK_AUTH` value. For **Revenue at risk** (in the app, Services → Revenue at risk), create a v2 secret
key with read access to **Charts & Metrics** and **Project configuration** (Project settings → API keys). With both, the
project is detected from the key; with Charts & Metrics only, also paste the project id. This connects *your own app's*
revenue; it's unrelated to OpsSwipe Pro, which needs no setup. It keeps a copy of each plan so a RevenueCat API outage never
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

The demo VM runs the demo app from its own public repo (`infra/demo-box.sh`). The repo's GitHub Actions
(`infra/demo-web/.github/workflows/deploy.yml`) are its CI/CD: every push to `main` runs the tests, and only a green
build deploys, over SSH as a `deploy` user whose key can run nothing but the deploy script. Create the repo:

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

CI/CD: a deploy key whose public half goes on the VM and private half into the repo's secrets (keep it outside the repo):

```bash
ssh-keygen -q -t ed25519 -N '' -f ../opsswipe-private/demo-deploy-key
gcloud compute instances add-metadata opsswipe-demo --zone us-central1-a \
  --metadata-from-file deploy-key=../opsswipe-private/demo-deploy-key.pub
gcloud compute ssh opsswipe-demo --zone us-central1-a --command 'sudo google_metadata_script_runner startup'
ssh-keyscan -t ed25519 <VM IP> > ../opsswipe-private/demo-known-hosts
R=<you>/opsswipe-demo-target
gh secret set DEPLOY_KEY --repo $R < ../opsswipe-private/demo-deploy-key
gh secret set DEPLOY_KNOWN_HOSTS --repo $R < ../opsswipe-private/demo-known-hosts
gh secret set DEPLOY_HOST --repo $R --body <VM IP>
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

Two providers, pick one:

- **NVIDIA** (hosted Nemotron and others, key from build.nvidia.com):
  `npx supabase secrets set AI_SUGGESTIONS=nvidia NVIDIA_API_KEY=nvapi-... NVIDIA_MODEL=<model id>`
  (default model `nvidia/nemotron-3-super-120b-a12b`). Score it first:
  `NVIDIA_API_KEY=nvapi-... deno task eval nvidia` (allowed must be 100%).
  Optional backup when NVIDIA is overloaded, any OpenAI-compatible API, e.g. Groq:
  `npx supabase secrets set AI_FALLBACK_BASE_URL=https://api.groq.com/openai/v1 AI_FALLBACK_API_KEY=gsk_... AI_FALLBACK_MODEL=<model>`
- **Claude on Vertex AI**: in the platform GCP project, **Vertex AI → Model Garden → Claude Opus 5 → Enable**, then
  `npx supabase secrets set AI_SUGGESTIONS=vertex`.

Incidents on services with a linked repo then offer **Fix with AI**, and suggestions are refined by the model. Without
it, everything else works and revert PRs remain the code fix. Whatever the model says, only allowed fixes can be
suggested, patches are limited to the bad commit's files, and CI must prove them before merge.

### Approval API for AI agents

**Settings → Agent access → New agent token**. Then, from any agent:

```bash
curl -X POST https://<ref>.supabase.co/functions/v1/agent -H "Authorization: Bearer ops_..." \
  -d '{"service":"opsswipe-demo-target","action":"restart","reason":"Error rate spiked after the 10:02 deploy"}'
# -> {"id":"<proposal>","status":"pending"}; the owner gets a card and a push
curl -H "Authorization: Bearer ops_..." "https://<ref>.supabase.co/functions/v1/agent?id=<proposal>"
# -> pending | running | approved (with detail / PR) | declined | failed
```

### Slack and Discord (operator, once)

- **Slack:** api.slack.com/apps → Create New App → From a manifest (YAML):
  `display_information.name: OpsSwipe`, `features.bot_user.display_name: OpsSwipe`,
  `oauth_config.redirect_urls: [https://<ref>.supabase.co/functions/v1/oauth-callback]`,
  `oauth_config.scopes.bot: [incoming-webhook]`. Then Manage Distribution → activate public distribution.
- **Discord:** discord.com/developers → New Application → OAuth2 → add the same redirect. No bot needed.
- `npx supabase secrets set SLACK_CLIENT_ID=… SLACK_CLIENT_SECRET=… DISCORD_CLIENT_ID=… DISCORD_CLIENT_SECRET=…`
- Slack refuses sign-in in phone browsers (it redirects Android to the Play Store), so Add to Slack runs in an
  in-app web view that presents as desktop (`app/src/SlackSignIn.tsx`, needs a build with `react-native-webview`).
  Every Connect flow (GitHub, Google, Slack, Discord) finishes on the phone that approved it: the redirect carries a
  one-time claim the same account presents, so a Connect link can't be finished on another device.

### Connect Railway (operator, once)

Railway → your workspace → Settings → OAuth Apps → New (workspace admins only). Redirect URI:
`https://<ref>.supabase.co/functions/v1/oauth-callback`. Then
`npx supabase secrets set RAILWAY_CLIENT_ID=… RAILWAY_CLIENT_SECRET=…`. Users then tap **Connect Railway**, pick
projects on Railway's consent screen (`project:member`), and choose the service from a list; without these secrets
the app offers the pasted API token and dashboard link instead. Render has no OAuth for outside apps, so it stays
an API key.

### Email invites (operator, once)

Settings → Team → **Invite by email** sends a join link and the code through Resend (free: 3,000 a month).
Verify a domain in Resend (a few DNS records), create an API key, then:
`npx supabase secrets set RESEND_API_KEY=re_… MAIL_FROM=invites@your-domain.com`. Without a verified domain Resend
only delivers to your own address. The link opens the app and joins the team; someone without an account signs up
first and is joined right after.

### Paging

Outages arrive on the app's **Outages (alarm)** channel: alarm volume (heard with the ringer on silent), a long
vibration, on the lock screen. An unanswered outage is paged again every 2 minutes, 5 pages in all, until someone
opens it or acts on it; the team is paged at 5 minutes as before. To ring through Do Not Disturb, allow it in
Android's settings for OpsSwipe → Notifications → Outages (alarm).

### Claude Code gate

`integrations/claude-code/README.md`: create an agent token in Settings → Agent access, export
`OPSSWIPE_AGENT_TOKEN`, add the PreToolUse hook. Only read-only commands run unasked; everything else waits for your
swipe (`OPSSWIPE_GATE_MODE=deny` switches to a best-effort list of risky commands). No answer, no `jq` or no token
means not run.

### Status page and weekly report

- The page is static HTML (`status-page/index.html`, served by GitHub Pages from `DevHusnainAi/opsswipe-status`)
  reading the public `status` function: Supabase serves HTML as text/plain without a custom domain.
  Override the link base with the `STATUS_PAGE_URL` secret.
- The weekly report is a second pg_cron job (`infra/cron.sql`, `opsswipe-weekly`, Mondays 04:00 UTC).

### RevenueCat plans (operator, once)

- Test Store products: `opsswipe_pro_monthly` ($14.99), `opsswipe_pro_yearly` ($119.99), `opsswipe_team_monthly`
  ($39.99), `opsswipe_team_yearly` ($359.99), each with a 7-day free trial.
- Entitlements: `pro` on the Pro products, `team` on the Team products (the server treats Team as including Pro).
- Offering `default`: packages `$rc_monthly`, `$rc_annual`, `team_monthly`, `team_annual`, with a Pro / Team paywall.
- Webhook "OpsSwipe plan sync" to `/functions/v1/revenuecat-webhook` with the `RC_WEBHOOK_AUTH` value.

### Testing teams with one phone

1. Account A: Settings → Plan → buy Team (Test Store, nothing is charged). Settings → Team → Invite a teammate.
2. Sign out, create account B, Settings → Team → join with the code. Stay signed in as B.
3. `./infra/chaos.sh gcp` breaks A's demo VM. B sees the incident at once; after 5 unanswered minutes B's phone gets
   "Escalated: …"; B can fix it with B's own fingerprint; B's Services tab stays empty.

### CD

`.github/workflows/deploy.yml` applies migrations and deploys every function when CI passes on `main`. Add repo secrets
`SUPABASE_ACCESS_TOKEN` and `SUPABASE_DB_PASSWORD`. Function secrets stay in Supabase (`supabase secrets set`).

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
- [ ] The proof workflow runs; the card shows "N/N failing production requests now answer 2xx" and offers **Merge PR**;
      the incident detail lists each request's status then and now
- [ ] **Merge PR** merges; CI tests and deploys `main` in about a minute; "back up" arrives. Pushing to the PR after the proof
      makes merge refuse
- [ ] The whole first outage is free (revert and merge both run); a fix on a second outage: card snaps back, paywall
      names the service, Test Store purchase, fix runs
- [ ] A one-off blip (stop and start the demo app within 10 s) pages nobody; a stop that lasts pages once
- [ ] One reported 500 (a single request to a broken path) pages nobody; two within a minute open a card
- [ ] With RevenueCat connected, the card shows "~$X/h at risk" and the recovery "about $Y lost"; the practice card
      shows a sample figure
- [ ] Start the app again yourself: the card closes and "recovered on its own" arrives
- [ ] **Dismiss, it's a false alarm** closes a card; Activity shows Dismissed and no "back up" push follows
- [ ] A PR whose proof fails (push a broken commit to it): the card offers Fix with AI again
- [ ] Settings → Discord or Slack: the test message arrives; the next incident posts there too
- [ ] Sentry (optional): an issue alert on the linked project opens a card with the failing request
- [ ] Activity: week stats show; Share on a recovery opens the share sheet with the report
- [ ] Services: each service shows "Last failure report … ago" (or none yet); on a VM, adding it or **New secret**
      writes the URL and secret onto the VM's metadata ("Already on <vm>"), and the demo app picks them up within a
      minute with no restart; running the test command shows "(test)" and opens no card
- [ ] The first fix after installing asks for the fingerprint to set up the fix key (onboarding's practice swipe does
      it for new accounts); signed in long ago, the app asks you to sign in again first
- [ ] Removing a VM service: `gcloud compute instances get-iam-policy <vm>` no longer lists OpsSwipe's account
- [ ] Activity shows Executed / Paywalled / Failed / Dismissed; the PR row opens the PR
- [ ] Settings → Delete account (a throwaway account): signed out, services gone, Google access revoked
- [ ] A second test user (another phone, or reinstall) sees none of your services or incidents
