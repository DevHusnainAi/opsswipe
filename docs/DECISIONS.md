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
- **GCP:** "Connect Google Cloud" works like a GitHub App install. The user signs in with Google (no refresh token),
  picks a VM, and OpsSwipe uses that token once to grant its own service account a custom role
  (`compute.instances.reset`, `compute.instances.get`) on that one VM, then deletes the token. What remains is exactly
  what the manual `gcloud` commands (still offered) would grant; deleting the binding revokes it. Until Google verifies
  the app, sign-in shows a warning and is capped at 100 users.
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

## 14. Guest first, account by linking
The app starts as an anonymous Supabase user so nothing blocks trying it. Sign in with GitHub links GitHub to that same
user (`linkIdentity`), so the user id, which is also the RevenueCat appUserID, never changes: services, incidents and
Pro carry over. If the GitHub account already has OpsSwipe (a new phone), the app signs into it and logs RevenueCat in.
Source: [Supabase anonymous sign-ins](https://supabase.com/docs/guides/auth/auth-anonymous).
