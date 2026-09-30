# For the judges

OpsSwipe was built for the [RevenueCat Shipaton 2026](https://revenuecat-shipaton-2026.devpost.com/) (Next Gen Award).
This page maps the four criteria to what the video shows and where to check it in the code.

**Demo video (1:52):** https://youtu.be/kKa17His_c4

## In one line

AI can already write the fix. OpsSwipe **proves** it: a code fix can merge only after CI replays the exact requests that
failed in production, and nothing runs without your swipe and fingerprint.

## What the video shows

Everything is real: a real Android phone, real cloud services, real pull requests and real CI runs.

| Scene | What happens | Where to verify |
| --- | --- | --- |
| Google Cloud VM | A bad release breaks `GET /api/price` (500). The card suggests Revert PR; the PR carries the failing request; CI proves `500 → 200`; merge from the phone. **Back up after 2m 44s** in total | [opsswipe-demo-target PR #6](https://github.com/DevHusnainAi/opsswipe-demo-target/pull/6): the failing-requests table and the passing proof check |
| Railway | A deploy just landed, so the card suggests Roll back. The free outage is used, so the **RevenueCat paywall** appears; after the Test Store purchase the rollback runs. **Back up after 52 s** | [opsswipe-demo-railway](https://github.com/DevHusnainAi/opsswipe-demo-railway) |
| Render | Rolled back from the phone. **Back up after 50 s** | [opsswipe-demo-render](https://github.com/DevHusnainAi/opsswipe-demo-render) |
| Team and users | Slack or Discord alerts, the public status page, the postmortem | [Live status page](https://devhusnainai.github.io/opsswipe-status/?s=pitan9ffp6) |

## The four criteria

**Idea.** Tests pass, the PR merges, and production is still broken, because nobody tested the request users actually
sent. OpsSwipe makes that failing traffic the test. It is a phone pager for indie developers: one card per outage with
the likely cause and one fix, and code fixes (a revert, yours, or AI's with a regression test) merge only once CI
replays the failed requests and each one answers 2xx. "Back up" is reported only when production itself answers again.

**Progress.** The full loop runs end to end on three hosts (Google Cloud, Render, Railway): detection (signed 5xx
reports and a minute-by-minute health check), alarm-style paging, fingerprint-bound fixes, proof in CI, a merge pinned
to the proven commit, and recovery checked in production. Also shipped: Slack/Discord alerts, a public status page,
postmortems, team invites by email with 5-minute escalation, shareable incident reports, and an approval API for AI
agents with a Claude Code hook.

**RevenueCat.**

- Free (the first outage, start to finish), **Pro** and **Team**, monthly and yearly, with a 7-day trial offered once
  in onboarding and never mid-outage.
- The paywall appears at the moment of highest intent: production is down and the free outage is used.
- Billing is per outage, not per action, so no paywall sits between a revert PR and its proven merge.
- Entitlements are checked on the server on every fix (`supabase/functions/_shared/entitlement.ts`); a webhook keeps a
  copy so a billing outage never blocks a fix.
- Revenue at risk: connect your own RevenueCat project and every incident shows what the outage costs per hour
  (`_shared/revenue.ts`).
- Project `proj109a2407`, Test Store: no promo code needed.

**Care.** See the [security table in the README](../README.md#security) and [DECISIONS.md](DECISIONS.md) (37 design
records, including an independent security audit and how each finding was fixed at the root).

## Where to look in the code

| File | Why |
| --- | --- |
| `supabase/functions/_shared/flow.ts` | The incident state machine: when a fix resolves an incident and when it stays open |
| `supabase/functions/_shared/proof.ts` | How a CI proof is bound to a commit and graded (a 4xx or a redirect is not a fix) |
| `supabase/functions/_shared/proofKit.ts` | The proof workflow: PR code in locked-down containers, OIDC-signed results |
| `supabase/functions/execute/index.ts` | Every fix: owner, plan, fingerprint-released fix key, then the provider call |
| `supabase/functions/_shared/suggest.ts` | Deterministic rules pick the fix; the AI's opinion is shown, never obeyed |
| `app/src/SwipeCard.tsx` | The card and the swipe |

## Quality

- 112 backend tests (Deno), SQL tests on Postgres 17 for tenant isolation and the free-outage meter.
- A 15-case labeled eval that must score 100% on safety for every fix suggestion (`deno task eval`).
- CI on every push: format, lint, typecheck, tests, eval, shellcheck, SQL tests. CD deploys when `main` is green.

Built by a student, with [Claude Code](https://claude.com/claude-code) as pair programmer.
