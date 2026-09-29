# Changelog

Built for the RevenueCat Shipaton 2026, Sep 27 to Oct 1.

## 2026-09-29

- **Proven AI fixes:** the AI writes the fix plus a regression test; CI runs the tests and replays the real failing
  production requests before Merge unlocks. The PR's code runs in Docker and can't sign its own proof.
- **Fix ready before you wake up** (Pro): the fix is written, opened and proven automatically when an incident opens.
- **Read the diff on your phone** before merging; a **postmortem** after every resolved outage.
- **AI agent gate:** agents ask your phone before running risky commands; a Claude Code hook that fails closed.
- **Alert inbox:** alerts from Grafana, Alertmanager or any JSON; 50 alerts about one service become one card.
- **Teams and escalation:** teammates can fix your incidents (never see your keys) and are paged after 5 minutes.
- **Public status page**, a **weekly report**, one-click **Add to Slack / Add to Discord**.
- **Revenue at risk** from the user's own RevenueCat; **Free, Pro and Team** plans with monthly and yearly pricing
  and a 7-day trial; onboarding with a fingerprint practice run and a trial offer.
- **AI provider swappable:** NVIDIA Nemotron with a Groq backup, or Claude on Vertex; rules decide the fix and the
  model gives a second opinion. Prompts use a standard structure with escaped, tagged input.
- Confirm before paging, self-healing incidents, pinned proofs, new icon, terms of use, privacy policy.

## 2026-09-28

- **The verified-fix loop:** swipe and fingerprint to reboot, restart or roll back; revert PRs carry the failing
  requests and merge only after CI replays them, pinned to the proven commit.
- **Connect from the app:** GitHub App, Google Cloud (sign in, then pick a project and VM), Render, Railway.
- Accounts (GitHub or email), onboarding, four tabs, push alerts, Discord/Slack alerts, Sentry input, Approval API.
- The demo: a GCP VM that deploys from GitHub Actions, and `chaos.sh` to break it on purpose.
