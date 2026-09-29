# Changelog

All notable changes to OpsSwipe are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.0] - 2026-09-30

First public release, built for the RevenueCat Shipaton 2026.

### Added

- **Alarm-style paging**: outages ring on an "Outages (alarm)" channel at alarm volume, repeat every 2 minutes until
  someone opens or acts on them, and escalate to the team after 5 minutes.
- **Team invites by email** (Resend): a join link and code; people without an account sign up and are joined.
- **Connect Railway** with OAuth: choose projects on Railway's consent screen, then pick the service from a list.
- **Report status**: each service shows when its last failure report arrived; re-issue the report secret; a test
  report checks the setup without opening an incident. A connected VM receives its report URL and secret
  automatically.
- Searchable, fixed-height pickers for repos, projects, VMs and services.
- The Discord connection shows the server's name.

### Changed

- **"Back up" means the failing requests work**: recovery re-checks an incident's failing GET/HEAD requests before it
  reports back up; a fix still failing after 10 minutes brings the card back.
- **OpsSwipe grades the CI proof itself**: each request must go from 5xx to 2xx, judged against the requests the PR
  carries; per-request statuses are shown in the incident.
- The health check and weekly schedules are created by a migration, so `db push` always restores them.
- Onboarding cards, the logo, the alerts step and the Slack sign-in were fixed on real phones.

### Security

Fixes for every finding of an independent audit, each at its root (see [docs/DECISIONS.md](docs/DECISIONS.md) #34):

- A VM reset is tied to someone who controls the VM, re-checked before every reset and revoked on removal.
- Connections finish only on the phone that approved them (one-time claim).
- The server checks a fingerprint-locked fix key on every fix; sessions are stored in secure storage; sign-in uses PKCE.
- PR code in CI runs in locked-down containers, and the proof can't grade itself.
- The Claude Code hook is default-deny and fails closed.
- Service URLs can't point inside a network; row-level security has regression tests for every client write.
- Fixes can't get stuck mid-run; concurrent writers can't erase each other's incident data.

## [0.2.0] - 2026-09-29

### Added

- **Proven AI fixes**: the AI writes the fix plus a regression test; CI runs the tests and replays the real failing
  production requests before Merge unlocks.
- **Fix ready before you wake up** (Pro): the fix is written, opened and proven automatically when an incident opens.
- The PR diff on your phone before merging, and a postmortem after every resolved outage.
- **AI agent gate**: agents ask your phone before running risky commands; a Claude Code hook.
- **Alert inbox**: alerts from Grafana, Alertmanager or any JSON; many alerts about one service become one card.
- **Teams and escalation**, a **public status page**, a **weekly report**, **Add to Slack / Add to Discord**.
- **Revenue at risk** from the user's own RevenueCat; **Free, Pro and Team** plans with a 7-day trial; onboarding with
  a fingerprint practice run.
- Swappable AI provider (NVIDIA Nemotron with a Groq backup, or Claude on Vertex); rules decide the fix and the model
  gives a second opinion.
- Confirm-before-paging, self-healing incidents, terms of use and privacy policy.

## [0.1.0] - 2026-09-28

### Added

- **The verified-fix loop**: swipe and fingerprint to reboot, restart or roll back; revert PRs carry the failing
  requests and merge only after CI replays them, pinned to the proven commit.
- Connect from the app: GitHub App, Google Cloud, Render, Railway.
- Accounts (GitHub or email), onboarding, four tabs, push alerts, Discord/Slack alerts, Sentry input, Approval API.
- A demo Google Cloud VM that deploys from GitHub Actions, and `chaos.sh` to break it on purpose.

[Unreleased]: https://github.com/DevHusnainAi/opsswipe/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/DevHusnainAi/opsswipe/releases/tag/v1.0.0
[0.2.0]: https://github.com/DevHusnainAi/opsswipe/releases/tag/v0.2.0
[0.1.0]: https://github.com/DevHusnainAi/opsswipe/releases/tag/v0.1.0
