# OpsSwipe terms of use

Last updated: 2026-09-29

These terms cover the OpsSwipe app and the OpsSwipe service it talks to. By creating an account you agree to them.
They are written to be read; if something is unclear, open an issue in this repository.

## What OpsSwipe does, and what you decide

OpsSwipe watches the services you connect, pages you when they fail, and offers fixes: restarting or rolling back a
service, rebooting a virtual machine, opening a pull request that reverts a commit or that an AI model wrote, and
merging a pull request once CI has proven it. It also lets AI agents you authorize ask you before running a command.

**Nothing changes your systems until you approve it** with a swipe and your phone's fingerprint or screen lock. The
two exceptions are ones you switch on yourself: "Fix ready before you wake up" opens a pull request (it never merges
one), and alerts you send to your alert inbox open incidents. You are responsible for the fixes and commands you
approve, and for the systems, repositories and accounts you connect. Only connect what you are allowed to manage.

## AI suggestions and AI-written code

Suggestions, fixes, regression tests and postmortems may be written by an AI model. They can be wrong. A code fix can
merge only after your CI runs your tests and replays the requests that failed in production, and only after you
approve it, but passing that proof does not guarantee the change is correct in every case. Review the diff before you
merge, as you would any pull request.

## Your account

Keep your phone locked and your account secure: approvals come from your device. You can delete your account at any
time in **Settings → Delete account**, which removes your data as described in the
[privacy policy](PRIVACY.md). Teammates you invite can see and fix your incidents; they never see your services'
keys or connections. You can remove them at any time.

## Plans and payment

OpsSwipe is free for one service, with your first outage included. **Pro** and **Team** are subscriptions sold
through the App Store or Google Play and managed by RevenueCat:

- They include a 7-day free trial. You are charged when the trial ends unless you cancel before then.
- They renew automatically at the price shown when you subscribed (monthly or yearly) until you cancel.
- Cancel, and request refunds, in the store where you subscribed. Refunds follow that store's rules.
- Features of each plan are listed on the paywall. We may change plans or prices for future renewals and will say so
  before they apply.

## Acceptable use

Do not use OpsSwipe to attack, overload or access systems you are not authorized to manage, to send it data you are
not allowed to share, or to probe or disrupt the service itself. Do not report request bodies that contain other
people's personal data. We may suspend accounts that do.

## No warranty

OpsSwipe is provided as is. It can miss an outage, page late, suggest the wrong fix or fail to run one, including when
a provider we depend on (Supabase, RevenueCat, Expo, GitHub, Google Cloud, Render, Railway, the AI provider) is down.
Keep your own backups and monitoring for anything critical.

## Limitation of liability

To the extent the law allows, OpsSwipe and its maker are not liable for indirect or consequential losses, lost
revenue or lost data arising from the use of OpsSwipe, including from fixes or commands you approved. Our total
liability is limited to what you paid for OpsSwipe in the twelve months before the claim.

## Open source

The OpsSwipe source code is available in this repository under its license. These terms cover the hosted service and
the published app; your use of the source code is governed by the license.

## Changes

We may update these terms. The date at the top changes when we do, and material changes are announced in the app
before they apply. Using OpsSwipe after that means you accept the new terms.

## Contact

Questions: open an issue in this repository.
