<div align="center">

# OpsSwipe

**The on-call pager that proves a fix before it touches production.**

When production breaks, OpsSwipe puts one card on your phone with the likely cause and a fix. Code fixes, including
ones written by AI, can merge only after CI replays the exact requests that failed in production. Nothing runs without
your swipe and fingerprint.

[![CI](https://github.com/DevHusnainAi/opsswipe/actions/workflows/ci.yml/badge.svg)](https://github.com/DevHusnainAi/opsswipe/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
![Platform: Android](https://img.shields.io/badge/platform-Android-3DDC84.svg)
![Expo SDK 57](https://img.shields.io/badge/Expo-SDK%2057-000020.svg)
![Backend: Supabase](https://img.shields.io/badge/backend-Supabase-3ECF8E.svg)
[![PRs welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](CONTRIBUTING.md)

![OpsSwipe: a phone card showing a failing service with an AI fix proven in CI, ready to swipe to merge](docs/brand/banner.png)

[Features](#features) · [How it works](#how-it-works) · [Getting started](#getting-started) ·
[Security](#security) · [Contributing](#contributing) · [Demo video](#demo)

</div>

## Table of contents

- [About](#about)
- [Features](#features)
- [How it works](#how-it-works)
- [Getting started](#getting-started)
- [Configuration](#configuration)
- [Usage](#usage)
- [Plans and billing](#plans-and-billing)
- [Security](#security)
- [Testing and quality](#testing-and-quality)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)
- [Contributing](#contributing)
- [License](#license)
- [Acknowledgements](#acknowledgements)

## About

Tests pass, the pull request merges, and production still breaks, because nobody tested the request real users sent.
AI tools now draft fixes, but those fixes are merged against the same tests that missed the bug.

OpsSwipe closes that gap: **the failing production traffic becomes the test.** It is built for indie developers and
small teams on Render, Railway, Google Cloud or any host that deploys from GitHub:

1. **A fix you can trust.** A revert, your own fix, or one written by AI with a regression test merges only after CI
   passes the requests that failed in production. OpsSwipe then checks production itself before it says "back up".
2. **Every AI agent asks your phone first.** Agents propose fixes or ask to run risky commands; you approve or decline
   with your fingerprint, and every answer is logged. A Claude Code hook is included.
3. **You see what the outage costs.** Connect your RevenueCat project and each incident shows revenue at risk.

## Features

**Detect**

- Signed 5xx reports from your app, Sentry alerts, alerts from any tool (Grafana, Alertmanager, JSON), and a
  health check every minute. One open incident per service.
- No false alarms: a failed check is retried, a single reported error is held until a second one confirms it, and an
  incident that recovers on its own closes itself.

**Page**

- Outages ring like an alarm: alarm volume, long vibration, lock screen. Unanswered pages repeat every 2 minutes, and
  your team is paged after 5 minutes.
- Optional Discord or Slack channel, a public status page, and a weekly report.

**Fix**

- Restart or roll back on Render and Railway, reboot a Google Cloud VM, open a revert PR, or let AI write the smallest
  fix plus a regression test.
- A suggested fix with a reason: deterministic rules decide; an AI model gives a second opinion that is shown, never
  obeyed.
- Swipe and fingerprint to run it. The server checks a key that the phone's secure hardware releases only after the
  fingerprint.

**Prove**

- Failing requests travel into the PR. CI replays them in locked-down containers and runs your tests; OpsSwipe grades
  the run itself (every request was 5xx and now answers 2xx).
- Merge is pinned to the exact commit that was proven.
- "Back up" arrives only when the failing requests work in production. A fix that didn't take brings the card back.

**Team and agents**

- Invite teammates by email or code. They can fix your incidents but never see your keys.
- An approval API for AI agents, with a ready-made Claude Code hook that fails closed.

**Learn**

- A postmortem after every real outage, the PR diff on your phone before you merge, and a shareable incident report.

## How it works

```mermaid
sequenceDiagram
    participant App as Your app
    participant OS as OpsSwipe
    participant GH as GitHub
    participant You as Your phone
    App->>OS: reports its 500s the moment they happen
    OS->>You: card: Roll back now, or Revert PR (with a reason)
    You->>OS: swipe + fingerprint
    OS->>GH: revert PR + the failing requests as a replay test
    GH->>OS: CI: GET /api/price was 500, now 200, tests pass
    OS->>You: Merge PR unlocked
    You->>OS: swipe + fingerprint
    OS->>GH: merge the exact commit CI proved
    OS->>You: back up: /api/price answers again, down 1m 12s
```

```mermaid
flowchart LR
    subgraph signals["Signals"]
        direction TB
        app["Your app<br/>signed 5xx reports"]
        sentry["Sentry<br/>issue alerts"]
        inbox["Alert inbox<br/>Grafana, Alertmanager, JSON"]
        health["Health check<br/>every minute"]
        agents["AI agents<br/>Claude Code hook"]
    end

    subgraph backend["OpsSwipe backend (Supabase)"]
        direction TB
        engine["Incident engine<br/>one card per service<br/>rules pick the fix"]
        execute["execute<br/>checks owner, fix key, plan"]
        proof["proof<br/>grades the signed CI result"]
        db[("Postgres + RLS<br/>Vault holds every key")]
    end

    subgraph you["You"]
        direction TB
        notify["Alarm push<br/>Slack, Discord"]
        phone["Phone app<br/>swipe + fingerprint"]
    end

    subgraph outside["Acts on"]
        direction TB
        cloud["Your services<br/>GCP VM, Render, Railway"]
        github["GitHub<br/>revert / AI fix PR, merge"]
        ci["GitHub Actions<br/>replays failing requests"]
        ai["AI models<br/>second opinion, fix + test"]
        rc["RevenueCat<br/>plans, revenue at risk"]
    end

    signals --> engine
    engine --> notify --> phone
    engine --> ai
    phone -- "incident id + fix + fix key" --> execute
    execute -- "reboot, restart, roll back" --> cloud
    execute -- "open PR, merge proven commit" --> github
    execute -- "entitlement" --> rc
    github --> ci -- "OIDC-signed results" --> proof
    proof -- "Merge unlocked" --> engine
```

Everything that holds a key runs on the server (Supabase Edge Functions); the phone only approves. The reasoning
behind each design choice is in [docs/DECISIONS.md](docs/DECISIONS.md), and the code map in [CLAUDE.md](CLAUDE.md).

## Getting started

### Prerequisites

- [Node.js](https://nodejs.org/) 24 and npm
- [Deno](https://deno.com/) 2 (backend tests and tooling)
- A [Supabase](https://supabase.com/) project and the Supabase CLI (`npx supabase`)
- An [Expo](https://expo.dev/) account for EAS builds, and an Android phone
- A GitHub account to create the OpsSwipe GitHub App
- Optional: a Google Cloud project, a RevenueCat project, Slack/Discord/Railway OAuth apps, a Resend domain

### Quick start

```bash
git clone https://github.com/DevHusnainAi/opsswipe.git
cd opsswipe

# Backend: schema, functions, secrets
npx supabase link --project-ref <your-project-ref>
npx supabase db push
npx supabase secrets set CRON_SECRET=... GITHUB_APP_ID=... # see Configuration
npx supabase functions deploy

# App
cd app
npm ci
cp .env.example .env     # EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_KEY, EXPO_PUBLIC_RC_KEY
npx eas-cli build --platform android --profile development
npx expo start --dev-client
```

The full runbook (GitHub App, Google Cloud identity, push notifications, the demo service and an end-to-end
checklist) is in **[docs/SETUP.md](docs/SETUP.md)**.

### Try it

```bash
./infra/chaos.sh gcp                                         # the demo app stops: reboot the VM from the card
DEMO_REPO=../opsswipe-demo-target ./infra/chaos.sh release   # a bad release: revert or AI fix, prove, merge
./infra/chaos.sh heal                                        # back to a good release
```

Demo targets: [opsswipe-demo-target](https://github.com/DevHusnainAi/opsswipe-demo-target) (Google Cloud VM),
[opsswipe-demo-render](https://github.com/DevHusnainAi/opsswipe-demo-render),
[opsswipe-demo-railway](https://github.com/DevHusnainAi/opsswipe-demo-railway).

## Configuration

Server settings are Supabase Edge Function secrets (`npx supabase secrets set NAME=value`). Only the first group is
required; each optional group switches one feature on.

| Secret | Required | Purpose |
| --- | --- | --- |
| `CRON_SECRET` | yes | Authenticates the scheduled health check and weekly report |
| `GITHUB_APP_ID`, `GITHUB_APP_SLUG`, `GITHUB_APP_PRIVATE_KEY`, `GITHUB_APP_CLIENT_ID`, `GITHUB_APP_CLIENT_SECRET` | yes | Revert, fix and merge PRs; connecting GitHub |
| `REVENUECAT_SECRET_KEY`, `RC_WEBHOOK_AUTH` | yes | Server-side plan checks and the RevenueCat webhook |
| `GCP_SA_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | for Google Cloud | Reboot VMs; Connect Google Cloud |
| `AI_SUGGESTIONS` (`nvidia` or `vertex`), `NVIDIA_API_KEY`, `NVIDIA_MODEL`, `AI_FALLBACK_*` | for AI | Second opinions, Fix with AI, postmortems |
| `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | for chat | Add to Slack / Add to Discord |
| `RAILWAY_CLIENT_ID`, `RAILWAY_CLIENT_SECRET` | for Railway OAuth | Connect Railway (a pasted API token works without it) |
| `RESEND_API_KEY`, `MAIL_FROM` | for email invites | Invite teammates by email |
| `STATUS_PAGE_URL` | no | Where the static status page is hosted |

The app reads three public values from `app/.env`: `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_KEY` (the
publishable key) and `EXPO_PUBLIC_RC_KEY` (the RevenueCat public SDK key).

## Usage

Connect everything from the app's **Services** screen:

| Connect | How | What OpsSwipe gets |
| --- | --- | --- |
| **Account** | Continue with GitHub, or email and password | Your services, fixes and plan on any phone |
| **GitHub** | Install the OpsSwipe GitHub App on the repos you choose | 1-hour tokens to open and merge PRs there |
| **Google Cloud** | Sign in with Google, then pick a project and a VM | A custom role on each VM you add: read its status and reboot it; the report URL and secret are written to the VM for you |
| **Render** | Paste an API key (Render has no OAuth for outside apps) | Restart, roll back and read deploys |
| **Railway** | Connect Railway and choose projects on Railway's consent screen, or paste a token | Restart the live deployment or roll back |
| **Failure reports** | Two environment variables and a small snippet (below) | Your app's 5xx responses the moment they happen |
| **Sentry** | An Internal Integration with the webhook URL the app shows | Sentry issue alerts open incidents |
| **Slack or Discord** | Settings → Add to Slack / Add to Discord | Alerts in the channel you pick |
| **Proof in CI** | Services → Add proof to repo, then merge the PR | A workflow that replays saved production failures on every PR |

### Failure reports

Any stack works: POST a JSON body to `OPSSWIPE_REPORT_URL`, signed with HMAC-SHA256 of the exact body under
`REPORT_SECRET`, in the header `x-opsswipe-signature: sha256=<hex>`. Only 5xx responses count. `release` (the deployed
commit) is optional and tells a revert which commit broke production. Add `"test": true` to check your setup without
opening an incident. Express:

```js
// Express, Node 18+: report every 5xx to OpsSwipe (method, path, status only)
const { createHmac } = require('node:crypto');
app.use((req, res, next) => {
  res.on('finish', () => {
    const { OPSSWIPE_REPORT_URL: url, REPORT_SECRET: key, GIT_SHA } = process.env;
    if (res.statusCode < 500 || !url || !key) return;
    const body = JSON.stringify({ method: req.method, path: req.originalUrl, status: res.statusCode, release: GIT_SHA });
    const sig = 'sha256=' + createHmac('sha256', key).update(body).digest('hex');
    fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-opsswipe-signature': sig }, body }).catch(() => {});
  });
  next();
});
```

## Plans and billing

Billing runs on [RevenueCat](https://www.revenuecat.com/). Entitlements are checked on the server, with a copy kept by
webhook so a billing outage never blocks a fix.

| Plan | What you get |
| --- | --- |
| **Free** | One service; your first outage start to finish (the revert, the proof and the merge); status page; weekly report |
| **Pro** ($14.99/month or $119.99/year) | Every outage, AI fixes with regression tests, fix ready before you wake up, alert inbox, agent approvals |
| **Team** ($39.99/month or $359.99/year, up to 10 people) | Everything in Pro, teammates who can fix your incidents, 5-minute escalation |

Every paid plan starts with a 7-day free trial, offered once during onboarding and never in the middle of an outage.
Billing is per outage, not per action, so no paywall sits between a revert PR and its proven merge.

## Security

OpsSwipe can restart services, reboot machines and merge code, so it is built to be safe by default:

| Threat | Mitigation |
| --- | --- |
| A stolen or unlocked phone | Every fix needs the fingerprint, and the server checks a key the phone's secure hardware releases only after it. A copied session can't run a fix |
| The client choosing what runs | The phone sends only an incident id and a fix name; the server decides from validated config |
| Another user's data | Row-level security on every table; a SQL test grants clients full rights and checks every write is still refused |
| Cloud keys | Kept in Supabase Vault and read only by server code. Google Cloud access is a custom reset-only role, re-checked against your own account before every reset and removed when you disconnect |
| A connect link sent to someone else | Connections finish only on the phone that approved them, for the account that started them |
| Crafted sign-in links | Sign-in uses PKCE; tokens in a link are never accepted |
| Forged or gamed CI proofs | OIDC-signed, bound to the commit OpsSwipe opened, PR code in locked-down containers, graded by OpsSwipe (a 4xx is not a fix) |
| Probing internal networks | Service URLs must be public, re-checked after DNS before every probe |
| Prompt injection | Request data reaches the AI as escaped, tagged data; its output is checked by code |
| Rogue AI agents | Agents only propose; the Claude Code hook is default-deny and fails closed |

Report a vulnerability privately: see **[SECURITY.md](SECURITY.md)**. Design decisions, including an independent audit
and its fixes, are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Testing and quality

```bash
deno task test && deno task check && deno task lint && deno fmt --check   # backend
deno task eval                                                            # fix suggestions: must be 100% safe
cd app && npm run typecheck && npm run lint && npm test                   # app
```

- **108 backend tests** (Deno): providers, OAuth completion, proof grading, recovery checks, paging, the incident state
  machine, signing, scrubbing, network guard and more.
- **SQL tests** on Postgres 17: row-level security, the free-outage meter, and client writes refused under full grants.
- **Eval**: 15 labeled incidents score fix suggestions on safety (must be 100%), correctness and concision; any model
  can be scored with `deno task eval nvidia`.
- **Shell tests** for the Claude Code hook; app tests for formatting and reports.
- **CI** on every push: format, lint, typecheck, tests, eval, shellcheck and SQL tests. **CD** deploys migrations and
  functions when `main` is green.

## Project structure

```text
app/                   Expo / React Native client (Android)
supabase/functions/    Edge Functions, one per endpoint; shared logic in _shared/, tests in tests/
supabase/migrations/   Postgres schema: RLS, Vault, meters, schedules
supabase/tests/        SQL tests
evals/suggest/         Labeled incidents that score fix suggestions
infra/                 Demo service, Google Cloud setup, chaos script
integrations/          Claude Code approval hook
status-page/           Static public status page
docs/                  Setup runbook, design decisions, brand assets
```

## Roadmap

- One-tap Connect for RevenueCat revenue (OAuth) instead of a read-only key
- iOS build (the app is cross-platform; Android ships first)
- More fixes: scale up, Kubernetes restarts, Fly, Vercel and Coolify rollbacks
- Phone-call and SMS escalation, on-call rotations, two-person approval for risky fixes
- An MCP server so any agent can ask for approval
- Connect probes to the checked IP (closes DNS rebinding); a list of signed-in phones to revoke fix keys
- Google OAuth verification, so Connect Google Cloud shows no warning screen

## Contributing

Contributions are welcome. Read [CONTRIBUTING.md](CONTRIBUTING.md) for setup and the checks CI runs, and follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 Syed Husnain Khalid. See also the [privacy policy](PRIVACY.md) and [terms of use](TERMS.md).

## Acknowledgements

Built for the [RevenueCat Shipaton 2026](https://www.revenuecat.com/shipaton/) (Next Gen Award) with
[Claude Code](https://claude.com/claude-code). Judges: the submission, demo script and what to look at are in
[docs/SUBMISSION.md](docs/SUBMISSION.md).

### Demo

> Demo video: _link_
