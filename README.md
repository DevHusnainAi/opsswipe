# OpsSwipe

**Your app's backend breaks while you're at dinner. Fix it from your phone, and OpsSwipe proves it worked.**

OpsSwipe is a pager for indie developers and small teams. When production fails, you get an incident card with one suggested
fix. Swipe, confirm with your fingerprint, and it runs. And unlike other tools, OpsSwipe won't let you merge a code fix until it
passes **the exact requests that failed in production**, then confirms production actually recovered.

Built for the RevenueCat Shipaton 2026 (Next Gen Award), with Claude Code.

> Demo video: _link_

## Why

Tests pass, the PR merges, and production still breaks, because nobody tested the request that real users sent. AI tools can
now draft fixes (Sentry Seer opens fix PRs), but you still merge them against the same tests that missed the bug. OpsSwipe
closes that gap: **the failing production traffic becomes the test.**

## The verified-fix loop

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
    GH->>OS: CI: 3/3 failing production requests now pass, tests pass
    OS->>You: Merge PR unlocked
    You->>OS: swipe + fingerprint
    OS->>GH: merge the exact commit CI proved
    OS->>You: production verified: back in 1m 12s
```

## What it does

| Feature | How |
| --- | --- |
| **Instant detection** | Your app signs and reports every 5xx; a 60 s liveness check covers services too dead to report |
| **Fixes across clouds** | Restart or roll back a Render service; reset a GCP VM; open a revert PR; merge a proven PR |
| **Suggested fix with a reason** | Rules answer instantly (recent deploy: roll back); Claude Opus 5 on Vertex AI refines it, and can only pick allowed fixes |
| **Proof before merge** | Failing requests ride into the PR as `.opsswipe/replays/*.json`; CI replays them and runs your tests; merge unlocks only on a full pass, pinned to that commit |
| **Proof after deploy** | The first healthy check after a fix records it: "down 3m 12s, back 41s after fix" |
| **Swipe + fingerprint** | A deliberate swipe picks the fix; biometrics authorize it; a tap button and TalkBack actions do the same without dragging |
| **Audit log** | Every attempt is recorded: executed, paywalled, failed, with PR links |

## Monetization (RevenueCat)

| Plan | What you get |
| --- | --- |
| Free | Your first fix, so you see it work on a real outage |
| Pro ($4.99/month, $39.99/year) | Unlimited fixes |

- The paywall appears at the moment of highest intent: production is down and your free fix is used. It's a RevenueCat Paywall,
  so pricing and copy change from the dashboard.
- **Nothing can be unlocked on the phone.** Every fix checks the `pro` entitlement with RevenueCat's REST API on the server, and
  the free fix is counted by an atomic Postgres function, refunded if the fix fails.

## Security model

| Threat | Mitigation |
| --- | --- |
| Stolen or unlocked phone | Every fix requires biometrics, and the prompt names the consequence |
| Leaked client secrets | The app holds only public keys; cloud, GitHub and RevenueCat secrets stay in Edge Function secrets |
| Client picks what to run | The phone sends an incident id and an offered fix; the server checks the `TARGETS` allowlist and the incident |
| Leaked GCP key | Its custom role can only `reset` and `get` one VM |
| Forged failure reports or proofs | HMAC-SHA256 signatures, verified in constant time |
| Merging something other than what was proven | Proof is bound to the PR's head commit, and the merge is pinned to that `sha` (GitHub returns 409 otherwise) |
| Replay causing side effects | Requests are replayed only against the PR build in CI, never production; samples carry no headers or cookies |
| Double swipe | The incident is claimed atomically; the second request gets 409 |
| Tampered state | Row-level security: clients only read their own audit and usage rows; every write goes through the server |

More in [docs/DECISIONS.md](docs/DECISIONS.md).

## Quality

- **Tests:** 24 Deno tests (providers, rollback, revert and merge PRs, signing, sample scrubbing, proof binding, incident flow, suggestions),
  SQL tests for the free-fix meter and incident rules on Postgres 17, 4 tests for the demo service's reporting and replay, and
  app tests for the recovery timeline.
- **Eval:** 12 labeled incident scenarios score fix suggestions on allowlist safety (must be 100%), correctness and concision.
  `deno task eval` runs the rules in CI; `deno task eval vertex` scores Claude.
- **CI:** format, lint, typecheck, tests, eval, migrations and app checks on every push.

## Stack

Expo SDK 57, React Native, Reanimated 4, Gesture Handler, expo-haptics, expo-local-authentication, expo-notifications, Geist
fonts, Phosphor icons · RevenueCat (`react-native-purchases`, `react-native-purchases-ui`) · Supabase (Postgres, Realtime, Edge
Functions, Cron, Vault) · Claude Opus 5 on Vertex AI · GitHub Git Data API and Actions · Render · GCP Compute Engine

## Run it

Everything, step by step: [docs/SETUP.md](docs/SETUP.md). Then break something:

```bash
DEMO_REPO=../opsswipe-demo-target ./infra/chaos.sh release   # a bad release: roll back, revert, prove, merge
```

## Roadmap

- Reports from Sentry, Datadog and Alertmanager, not just our SDK-free reporter
- AI-written patch PRs that go through the same proof
- More fixes: scale up, restart a Kubernetes deployment, roll back on Fly and Vercel
- An approval API so any AI SRE agent can ask a human to approve a proven fix
- Team plan, two-person approval for risky fixes

## License

MIT
