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

A deterministic rule picks the fix and writes the reason immediately (a known bad release: roll back or revert;
otherwise restart or reboot). An AI model (NVIDIA Nemotron with a Groq backup, or Claude on Vertex) gives a second
opinion in the background; its words replace the rule's only when it picks the same fix, and its view is stored and
shown either way (#23, #24). Measured on the eval, models picked worse fixes, so they explain, rules decide. A labeled
eval gates the rules in CI at 100%.

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

## 23. The AI provider is swappable

Claude on Vertex needs Model Garden access that isn't available on every account, so the model is a setting:
`AI_SUGGESTIONS=vertex` (Claude) or `nvidia` (NVIDIA's hosted models such as Nemotron, OpenAI-compatible, plain fetch).
The safety doesn't depend on the model: suggestions are checked against the allowlist, patches go through `checkPatch`,
and nothing merges without the CI proof. `deno task eval nvidia` scores a model on the same labeled cases before it's
switched on. Source: [NVIDIA API reference](https://docs.api.nvidia.com/nim/reference/llm-apis).

## 24. Rules decide, the model explains (and writes code CI must prove)

Measured on the labeled eval, NVIDIA Nemotron 3 Super picked a worse fix than the rules on 7–27% of cases across runs
(a reboot for a VM whose code is failing, a rollback with no earlier deploy). A pager that swaps a right answer for a
wrong one at 3am is worse than no AI. So the suggested fix is always the rules'; the model's reason is used only when it
independently picks the same fix. The model's real job is Fix with AI, where every patch is limited by `checkPatch` and
merges only after CI replays the failing requests. NVIDIA calls retry on 429/5xx and can fall back to a second
OpenAI-compatible provider (e.g. Groq) via `AI_FALLBACK_BASE_URL`, `AI_FALLBACK_API_KEY`, `AI_FALLBACK_MODEL`.

## 25. Revenue at risk: an API key today, OAuth next

Two RevenueCat accounts are involved and easy to confuse. OpsSwipe's own RevenueCat sells OpsSwipe Pro: users subscribe with
one tap and never see a key. Revenue at risk reads *the user's* app revenue, in *their* RevenueCat account, which OpsSwipe
can only read with their permission. RevenueCat's OAuth (a consent screen where the developer picks projects and
permissions, no keys) is the right way and needs OpsSwipe registered as an OAuth client through RevenueCat support, so
this entry uses a read-only v2 key, detects the project from it when the key may read project configuration, and keeps
the whole feature optional: nothing in setup depends on it. Source:
[RevenueCat OAuth](https://www.revenuecat.com/docs/projects/oauth-overview).

## 26. The AI writes a regression test, at a path we choose

A fix that passes the replay proves this outage is over; a test keeps it over. So Fix with AI also writes one regression
test, modelled on a test already in the repo. It may only create a file at a path OpsSwipe picks (`opsswipe-<sha>.test.*`
next to the repo's tests): it can't rewrite or weaken an existing test, and a test with no code change is rejected.

## 27. The proof runs the PR's code in containers

The proof workflow must run the PR's code (install scripts, tests, the app) and must also sign its result with an OIDC
token. In one job, the PR's code could mint that token and sign a fake "3/3 passed". Now install, tests and the app run
in Docker on copies of the repo: they can't see the runner's memory, environment or token. Update (#34): the containers
are locked down, and the claim was narrowed to what's true: on `pull_request` GitHub runs the workflow file as the PR
has it, so this guards against a PR's code, not against someone who can already push workflows (they can mint tokens
anyway). `pull_request_target` would load the workflow from `main`, but hands fork PRs the token: GitHub's "pwn
request" pattern. The sha pin is what makes a forged verdict useless.

## 28. Prompts as specifications, input as escaped data

The three prompts (triage, fix, postmortem) follow one structure: role, what happens to the answer, input, rules, output,
what to do when unsure. Input arrives as `<tag>JSON</tag>` with `<` escaped, so a request path or commit message can't
close the tag and pose as instructions, and every prompt says request data is data. Code still checks every answer.
With the new triage prompt, Nemotron answered 10 of 10 eval cases correctly (was 93%).

## 29. Fix ready before you wake up, only for code bugs

Writing and proving the fix before anyone looks is the moment people remember, and it only opens a pull request; merging
still needs a swipe. It runs only when a known release broke the service: a stopped VM or a network blip isn't a code
bug, and an AI PR for it would be noise. It's opt-in per service and part of Pro.

## 30. Teams through row-level security, never through shared keys

A teammate needs to see and fix the owner's incidents, not the owner's cloud. Incident and audit policies allow the
owner's team; services, connections and keys stay owner-only, and `execute` bills the owner's plan whoever swipes. A SQL
test proves a teammate sees the incident and nothing else. Escalation pages the team once, after 5 unanswered minutes.

## 31. Flat plans, because stores can't sell seats

Per-seat pricing is the norm for pagers, and users hate it. App-store subscriptions can't be priced per seat anyway, so
Pro is one price and Team is one price for up to 10 people, monthly or yearly, each with a 7-day trial. The trial is
offered once in onboarding after a practice fix; the paywall otherwise appears only when the free outage is used.

## 32. An alert inbox instead of more integrations

Teams already run Grafana, Alertmanager and uptime monitors, and a real outage fires dozens of alerts. One private
webhook URL takes them all: an alert about a watched service joins that service's one card; everything else stays
quiet and is counted in the weekly report. That turns "only 2 to 5% of pages need a human" into the product.

## 33. The status page lives on GitHub Pages

Supabase serves HTML as plain text without a custom domain, so the status data is a public JSON function and the page
is one static HTML file on GitHub Pages. It shows service names, up or down and daily downtime, never errors or paths.

## 34. The Sep 29 security audit, fixed at the root

An outside line-by-line audit found 28 issues. Each fix went where the cause was, not where the symptom showed:

- **A VM reset is tied to someone who controls the VM.** The manual add path proved access with OpsSwipe's shared
  identity, so anyone could add a VM another user had connected. It's gone; adding needs your own IAM rights on the VM,
  every reset first checks your Google account still manages it, and removing takes the role off at Google.
- **Connections finish on the phone that approved them.** A state names who started a flow, but whoever gets the link
  can approve on their own account. The callback now keeps the result under a one-time claim that only reaches the
  device that approved, and only the account that started it can present it.
- **The fingerprint is checked by the server.** The phone's fix key is released by its secure hardware only after the
  fingerprint; `execute` requires it. Enrolling a key needs a fresh sign-in (JWT `amr`), so a copied refresh token
  can't add its own. Sign-in uses PKCE, so a crafted link can't swap the account.
- **OpsSwipe grades the proof.** CI reports what each request returns now; a request counts only if it was 5xx and now
  answers 2xx, judged against the requests the PR carries. A 4xx that hides the bug isn't "proven". Trade-off: a
  correct "500 becomes 400 on bad input" fix shows as not proven, with its statuses, and merges on GitHub instead.
- **The Claude Code hook is default-deny and fails closed.** A denylist over shell strings can't be made safe.
- **Nothing gets stuck, nothing gets overwritten.** Everything after the claim is inside one try, and the health check
  hands back a fix whose function died; `incidents.context` updates merge in the database, so concurrent writers keep
  each other's keys. Caps (team size) live in the database.
- **Reports can be checked.** Each service shows when a signed report last arrived, the secret can be re-issued, and a
  test report checks the whole path: the live demo lost an hour to a VM holding an old secret.

## 35. "Back up" means the failing requests work

In rehearsal a revert was proven and merged, but GitHub never sent the push event for the merge, so the deploy never
ran; the homepage (the health URL) was fine throughout, and OpsSwipe said "back up" while `/api/price` still failed.
Recovery now re-checks the incident's own failing requests against the service, GET and HEAD only (the same kind of
request the health check makes; nothing that could change data is ever sent to production). A fix still failing 10
minutes later brings the card back once, with the production fixes ("Merged, but production still fails GET
/api/price: the deploy may not have run. Reboot to load the new code").

## 36. Railway through OAuth, Render through a key

Railway now offers OAuth with project-scoped consent (`project:member`): the user chooses which projects OpsSwipe may
touch, which beats an account-wide token, so Connect Railway uses it (same claim flow as Google), keeping the grant in
Vault and saving each rotated refresh token. Render has no OAuth for outside apps; its API key is the only way, so it
stays a pasted key, encrypted and used only for restart, rollback and reading deploys.

## 37. A pager that rings like one

A push that looks like any other notification gets missed at 3am. Outages go to their own Android channel with alarm
audio usage (heard with the ringer on silent), a long vibration and lock-screen visibility, and are re-paged every 2
minutes until someone opens or acts on them (5 pages, push only). A custom siren or a full-screen ringing screen would
need native changes and a new build; the default sound at alarm volume doesn't.
