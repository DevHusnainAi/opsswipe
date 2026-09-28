# Decisions

Short records of the choices that shape OpsSwipe, and why.

## 1. Verify fixes, don't just generate them
AI tools already draft fixes and open PRs (Sentry Seer does both), but a human still reviews and merges them against the same
tests that missed the bug. OpsSwipe's job is proof: a fix is only mergeable once it passes the exact production requests that
failed, and only "done" once production recovers.
Sources: [Seer Autofix](https://sentry.io/product/seer/autofix/), [Seer self-healing workflow](https://sentry.io/cookbook/self-healing-workflow-seer/).

## 2. Event-driven detection, polling only for liveness
The app reports its own 5xx responses to `/report` the moment they happen, so incidents open in seconds and carry the failing
requests. A dead service can't report itself, so a once-a-minute health check remains, and it also stamps recovery.

## 3. The phone never holds power
The phone sends an incident id and the name of an offered fix. Who is asking comes from a verified JWT; what can run comes
from the owner's validated service config and the fixes stored on the incident. Platform keys live in Edge Function secrets;
users' Render keys and report secrets live encrypted in Supabase Vault, readable only by server functions.

## 4. Swipe to choose, biometrics to authorize, tap as an alternative
Swipe-to-act suits destructive actions but is easy to trigger by accident, so a fingerprint prompt that names the consequence
confirms every fix. A button and TalkBack actions do the same job without dragging (WCAG 2.2, 2.5.7).
Sources: [NN/g contextual swipe](https://www.nngroup.com/articles/contextual-swipe/), [WCAG 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements.html).

## 5. Entitlements checked on the server, metered in Postgres
Every fix checks the `pro` entitlement with RevenueCat's REST API, and the free fix is counted by an atomic Postgres function
that refunds on failure. Reinstalling the app or tampering with it can't unlock anything.

## 6. CI pushes its proof with OIDC; merges are pinned to the proven commit
The proof workflow sends its result to `/proof` with a GitHub Actions OIDC token, which OpsSwipe verifies against GitHub's keys:
the token itself says which repo and which pull request the run was for, so users store no secrets in their repo. A proof is
accepted only for the head commit OpsSwipe opened, and the merge passes that `sha`, so GitHub refuses (409) if anything was
pushed after the proof.
Sources: [GitHub OIDC reference](https://docs.github.com/en/actions/reference/security/oidc), [merge a PR](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request).

## 7. Replay only in CI, never against production
Replaying a failed `POST /checkout` in production would create real orders. Failing requests are replayed only against the PR's
build in CI; production is verified by watching it recover. Samples are scrubbed: no headers or cookies, secret-looking query
values redacted, bodies capped at 2 KB.

## 8. Rules first, AI second
A deterministic rule picks the fix and writes the reason immediately (recent deploy: roll back, otherwise restart). Claude Opus 5
on Vertex AI may refine it in the background, constrained by a schema to the allowed fixes; any error or refusal keeps the
rule's answer. A labeled eval gates the rules in CI at 100%.

## 9. Free, personal demo infrastructure
A GCP e2-micro VM (free tier) and a Render free web service, both in personal accounts. OpsSwipe's GCP identity can only reset and read that one VM.
No company infrastructure is involved, and the project stays solely ours as the hackathon rules require.

## 10. Few dependencies
GCP auth signs its own JWT with WebCrypto; GitHub and Render are plain `fetch`; tests use `deno test` and Node's built-in runner.
The one SDK is Anthropic's, for Claude.

## 11. Connect without handing over keys where possible
- **GitHub:** a GitHub App installed on chosen repos, acting with 1-hour installation tokens. The post-install
  `installation_id` can be spoofed, so OpsSwipe accepts it only after checking, with the installing user's own OAuth token,
  that the installation is theirs.
  Source: [GitHub App tokens](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app).
- **GCP:** "Connect Google Cloud" works like a GitHub App install. The user signs in with Google once; OpsSwipe keeps
  the refresh token encrypted in Vault so adding more VMs later is just "pick a project, pick a VM", with no new sign-in.
  For each VM added, it grants its own service account a custom role (`compute.instances.reset`,
  `compute.instances.get`) on that one VM; fixes always run as that service account, never as the user. We first used
  one-time tokens deleted after each VM, and changed it because signing in to Google for every VM was the main friction
  in setup. The cost: the stored token can list projects and manage IAM, so it lives only in Vault, is read only by the
  `connect` function, and Disconnect revokes it at Google. The manual `gcloud` commands are still offered for anyone who
  would rather not sign in. Until Google verifies the app, sign-in shows a warning and is capped at 100 users.
  Sources: [instances.setIamPolicy](https://docs.cloud.google.com/compute/docs/reference/rest/v1/instances/setIamPolicy),
  [unverified apps](https://support.google.com/cloud/answer/7454865).
- **Render:** Render has no OAuth and its keys cover the account, so the key is validated, stored in Supabase Vault, read
  only by server functions, and never returned to the app.

## 12. Multi-tenant by row-level security
Every service, connection and incident has an owner. Row-level security lets each user read only their own rows, all writes
go through Edge Functions, and a fix can only be claimed by the incident's owner. A SQL test proves one user can't see
another's services, incidents or connections, and that users can't read the Vault.

## 13. Alerts are server push, not app-side
A pager that only rings while its app is open isn't a pager. The server sends a high-priority push through Expo's push
service when an incident opens and when CI proves a fix; tokens Expo reports as unregistered are deleted. Push tokens
are server-only rows, and a push failure never blocks an incident. Realtime still refreshes the open app.
Source: [Expo push](https://docs.expo.dev/push-notifications/sending-notifications/).

## 14. Accounts from the first screen
OpsSwipe holds access to production, so everything belongs to a real account: no guest mode. First run is the standard
sequence: a three-screen value tour, create an account (Continue with GitHub, or email and password with reset by email),
the notification permission asked with its reason, then a setup checklist in Services. The Supabase user id is also the
RevenueCat appUserID, so the plan follows the account to any phone. Signing out unregisters this phone's push token, so a
shared phone stops receiving the previous account's alerts.

## 15. AI writes fixes, proof decides
"Fix with AI" asks Claude for the smallest change that makes the failing production requests succeed, given the bad
commit's diff, the current content of the files it touched, and those requests. Three limits keep it honest: the schema
only allows files that commit touched, a server-side check drops anything else (and no-op or empty changes), and the
result is just a PR that carries the replay file, so Merge still unlocks only when CI proves it. If Claude declines, the
user sees why and the revert PR is still one tap away.

## 16. Any service can be linked to its repo
Render reports the repo it deploys from; a VM doesn't, so the user picks it (only repos the GitHub App can reach are
accepted). Which commit to revert or fix comes from Render's deploy history, else the `release` the app reports, else
the branch head. Code fixes then work the same on every provider, and the reset or rollback stays the instant fix.

## 17. Agents propose, humans approve
The Approval API lets any AI agent propose a fix the service already allows (never a merge; that needs CI proof). Agents
authenticate with a token stored only as a SHA-256 hash. A proposal becomes a normal incident card marked with the
agent's name and reason, gated by the same swipe, biometrics, entitlement and audit log as every other fix, and the
agent polls for approved, declined or failed. This is where AI SRE tools stop short today: they escalate to a human,
and OpsSwipe is that human's fastest safe yes or no.

## 18. Page only for confirmed outages
False alarms are the top complaint about monitors ("70 false positives a day") and the reason people mute pagers. A
failed health check is retried after 10 s before an incident opens; a health-check incident whose service recovers with
no fix run closes itself and says so; and any card can be dismissed as a false alarm, logged like a fix. Incidents the app
reported stay open on a healthy health check, since `/` can be fine while `/checkout` fails. A failed CI proof re-offers
Fix with AI (and a revert, unless the revert is what failed), and a VM is never offered a reboot while its PR proves: a
reboot boots the same bad code. Sources: [false alerts](https://dev.to/pingvera/70-false-alerts-a-day-why-uptime-monitors-cry-wolf-and-what-the-fix-costs-nnl).

## 19. Free per outage, and billing can't block a fix
Metering each action put a paywall between a revert PR and its proven merge in the middle of the free outage. The free
tier is now one whole incident (an atomic Postgres meter keyed by incident, refunded if its first fix fails). Pro is
checked with RevenueCat's REST API on every fix; RevenueCat webhooks keep a copy of each plan's expiry, used when the
API is unreachable, so a pager never fails because billing did. Sources:
[RevenueCat webhooks](https://www.revenuecat.com/docs/integrations/webhooks),
[Shipaton rules](https://revenuecat-shipaton-2026.devpost.com/rules).

## 20. Meet people where their alerts already are
Solo developers already run Sentry and route alerts to Discord or Slack. Sentry issue alerts open incidents through an
Internal Integration (verified with its Client Secret, request line only, no headers), so no code change is needed in
the app. Alerts also post to one Discord or Slack incoming webhook, allowlisted by host so the field can't reach anything
else. Railway joins Render as a host with restart and rollback over its GraphQL API. Sources:
[Sentry webhooks](https://docs.sentry.io/organization/integrations/integration-platform/webhooks/),
[Railway API](https://docs.railway.com/integrations/api/manage-deployments).

## 21. Revenue at risk, from the user's own RevenueCat
Indie developers feel an outage as lost revenue, and they already keep that revenue in RevenueCat. With a read-only v2
key (Charts & Metrics), OpsSwipe reads the last 28 days of revenue and spreads it per hour: a plain estimate, labelled as
one on every screen, used on the card ("~$4.20/h at risk"), on the recovery ("about $0.08 lost") and next to the price
on the paywall. 28 days smooths weekly swings without going stale; per-endpoint attribution would need the app's
analytics, which OpsSwipe deliberately doesn't collect. The key lives in Vault and is tested before it's stored; the
revenue figure is never put in the shareable incident report. Source:
[RevenueCat Charts & Metrics API](https://www.revenuecat.com/docs/api-v2/charts-and-metrics).

## 22. Confirmed reports, pinned proofs
A single reported 500 no longer pages: it's held, and a second within a minute opens the incident with both samples
(Sentry alerts are already thresholded by their rule). Reported incidents close themselves after 10 quiet minutes on a
healthy service. Code fixes are offered only when there's a request to replay. Proofs are accepted only from the
`opsswipe-proof.yml` workflow of the same repo (the OIDC `job_workflow_ref` claim), and RevenueCat webhooks only when
newer than the stored plan. Source: [GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc).
