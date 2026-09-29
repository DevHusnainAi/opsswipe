# OpsSwipe privacy policy

Last updated: 2026-09-29 (teams, alert inbox, status page, AI provider). See also the [terms](TERMS.md).

OpsSwipe is an open-source app that pages you when your service breaks and lets you approve a fix. This page says
what it stores, why, and how to delete it. The code that does all of this is in this repository.

## What OpsSwipe stores

| Data | Why | Where |
| --- | --- | --- |
| Your account: email, or your GitHub username and id | To sign you in on any phone | Supabase Auth |
| The services you add: name, URL, provider ids, linked repo | To check them and run the fixes you approve | Supabase Postgres, visible only to you (row-level security) |
| Credentials you connect: Render and Railway API keys, the Google Cloud refresh token, report and Sentry secrets, an optional Discord or Slack webhook URL | To act on your behalf when you approve | Supabase Vault, encrypted, read only by the server; never sent back to the phone |
| Incidents and the fix history (audit log) | To show what broke, what ran and who approved it | Supabase Postgres, visible only to you |
| Failing request samples: method, path, status, and the body your app chose to report (at most 2 KB) | To replay them in your CI before a fix can merge | On the incident, and in the PR OpsSwipe opens in your repo. Headers and cookies are never accepted; query parameters named like credentials (token, key, secret, password…) are redacted. Don't report bodies that hold personal data |
| Push notification tokens | To page your phones | Supabase Postgres, server only |
| Teammates you invite, and teams you join | So a teammate can fix your incidents and be paged when nobody answers | Supabase Postgres. Teammates see your incidents only, never your services' keys or connections |
| Alerts sent to your alert inbox that match none of your services: alert name, summary, target | To count them in your weekly report instead of paging you | Supabase Postgres, visible only to you |
| Your status page link (a random id) | To publish your status page | Supabase Postgres. The page shows only service names, up/down, daily downtime and incident titles: never errors, paths or keys |
| Your plan | To unlock Pro | RevenueCat, keyed by your OpsSwipe user id; a copy of the expiry date in Supabase |

OpsSwipe has no ads, no analytics SDK and no tracking. It does not sell or share data.

## Services that process data

- **Supabase** hosts the database, auth and server functions.
- **RevenueCat** and the app stores handle purchases.
- **Expo** delivers push notifications.
- **GitHub, Google Cloud, Render, Railway** receive the calls needed for fixes you approve.
- **The AI provider**, when AI is switched on (currently NVIDIA's hosted models, with Groq as a backup; Claude on Google
  Cloud Vertex AI is supported too): the failing requests, the changed files of the commit that broke production, an
  example test from your repo, and the fixes that ran are sent to suggest a fix, write one, or write the postmortem.
- **Discord or Slack**, only if you connect a channel: incident titles, short summaries and your weekly report.
- **GitHub Pages** serves the status page, which reads the public status data described above.

## Deleting your data

**Settings → Delete account** deletes your account, services, connections, incidents and history, and revokes
Google access at Google. Remove the OpsSwipe GitHub App on GitHub, and cancel a subscription in the store where you
bought it. Questions: open an issue in this repository.
