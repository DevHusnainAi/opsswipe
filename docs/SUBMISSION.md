# Submission playbook: video, story, Devpost

Everything a judge sees is the video, the Devpost page and the repo. This guide makes all three tell one story.

## 0. The rules we must hit

From the [official rules](https://revenuecat-shipaton-2026.devpost.com/rules):

| Rule | Quote | How we meet it |
| --- | --- | --- |
| Video length | "should be less than two (2) minutes. Judges are not required to watch beyond two minutes" | Cut to **1:55**. Nothing important after 1:45 |
| Real device | "should include footage that shows the Project functioning on the device for which it was built" | Real Android phone, screen-recorded, plus a hand-cam of the fingerprint |
| Hosting | "must be uploaded to and made publicly visible on YouTube or Vimeo" | YouTube, **Public** (not Unlisted) |
| Repo | "public, open-source code repository, including an open-source license file" with "all necessary source code, assets, and instructions" | Make `DevHusnainAi/opsswipe` public; `LICENSE` (MIT) and `docs/SETUP.md` already exist |
| Eligibility | student email | Your .edu Devpost account |
| Deadline | "Wednesday, September 30, 2026 at 11:45pm PDT" (Oct 1, 11:45am PKT) | Submit by **Sep 29**; Sep 30 is buffer |

Next Gen criteria (no weights published). Every one of them must be answered on screen and on the page:

1. **Idea:** "clear, useful, interesting, or original?"
2. **Progress:** "meaningful progress toward a working app?"
3. **RevenueCat:** "thoughtfully use RevenueCat...?"
4. **Care:** "thoughtful technical choices, product thinking, and care?"

## 1. The story: indie hacker first

The judges build consumer apps and ship them solo or in tiny teams. The winning frame is not "a DevOps tool". It is:

> **You're a solo dev. Your app makes money while you sleep, until the backend breaks while you're at dinner.
> OpsSwipe lets you fix it from your lock screen, and proves the fix worked.**

Why this lands with these judges:

- **They've lived it.** Every indie dev has had a backend go down away from a laptop. Say it plainly; don't explain SRE.
- **Downtime is lost revenue.** Their subscribers hit an error, churn, or ask for refunds. This ties OpsSwipe to RevenueCat's world
  without a stretch: *your RevenueCat revenue depends on your backend being up.*
- **No team, no on-call rotation, no laptop.** Big tools (PagerDuty, incident.io) assume a team. OpsSwipe assumes one person and
  a phone.
- **The builder is the user.** A first-semester student who builds and runs backends, making the pager they wanted. Authentic and
  on-theme for Next Gen.

Words to use: *your app, your backend, one swipe, proof, back in 38 seconds, from your lock screen.*
Words to avoid: *SRE, remediation, observability platform, enterprise, incident management lifecycle.*

The one line to repeat (video, Devpost, README): **"Other tools write fixes. OpsSwipe proves them."**
That is the originality claim, and it's true: Sentry's AI drafts fixes and PRs, but a human still merges them against the same
tests that missed the bug ([Seer self-healing workflow](https://sentry.io/cookbook/self-healing-workflow-seer/)).

## 2. The three moments judges must remember

A great 2-minute video is built around a few scenes people can retell. Ours:

1. **The live save (the hook).** Laptop breaks the site → phone, app closed, buzzes → swipe → fingerprint → site back. A
   visible stopwatch runs the whole time, and the card ends on "down 1m 12s · back 38s after fix". One continuous take, no cut.
   *This answers "working app" beyond doubt.*
2. **The proof (the originality).** A bad release → OpsSwipe opens a revert PR that carries the exact requests that failed in
   production → CI replays them → card shows "3/3 failing production requests now pass" → only then does Merge appear.
   *This is what no other project does.*
3. **The fair paywall (the RevenueCat moment).** First fix free. Second fix: card snaps back, RevenueCat paywall slides up
   *at the moment of need*, Test Store purchase, fix runs. Caption: "Entitlement checked on the server. Nothing unlocks on the
   phone." *This answers "thoughtful RevenueCat use".*

Everything else (Connect, security, tests) gets seconds, not scenes.

## 3. Shot list and script (1:55)

Word budget: ~270 words of narration at a natural pace. Times are targets; fit the voice to the real footage.

| Time | Picture | Voice-over | On-screen text (Remotion) |
| --- | --- | --- | --- |
| 0:00–0:08 | Evening, phone face-down on a dinner table (real or a Higgsfield shot). Buzz. | "You shipped your app. It's Friday night. And your backend just went down." | *Your app. Your backend. You're not at your laptop.* |
| 0:08–0:14 | Logo reveal over the incident card | "This is Ops Swipe. Fix production from your lock screen, and prove it worked." | **OpsSwipe** |
| 0:14–0:26 | Phone: Services → GitHub Connect → Google Cloud: sign in, pick project and VM, link repo, Add (sped up 3x) | "Connect GitHub and Google Cloud in a few taps. Ops Swipe only gets permission to restart what you pick." | *No cloud keys stored. Reset-only access to one VM.* |
| 0:26–1:02 | **Split screen, one take, stopwatch visible:** left laptop runs `chaos.sh gcp`, site stops answering; right phone locked → push → open → card with suggested fix and reason → swipe → fingerprint → banner → laptop site back | "Let's break production for real." *(pause for the buzz)* "My phone wakes me, even with the app closed. Ops Swipe already knows what broke and suggests a fix, with a reason. I swipe. My fingerprint approves it." *(pause)* "Back online." | Stopwatch. Then: **down 1m 12s · back 38s after fix** |
| 1:02–1:32 | Laptop: `chaos.sh release`, site shows 500; phone card offers Revert PR / Fix with AI → Revert PR → GitHub PR page showing `.opsswipe/replays/<sha>.json` → Actions run → phone card "3/3 failing production requests now pass" → Merge PR → site back, "back up" push | "But what if a bad release caused it? Other tools write a fix and hope. Ops Swipe proves it. The pull request carries the exact requests that failed in production. CI replays them against the fix. Three out of three now pass. Only then can I merge, and only that exact commit." | *Replayed: the real failing requests* → **3/3 pass** → *Merge pinned to the proven commit* |
| 1:32–1:45 | Second incident → swipe → card snaps back → RevenueCat paywall → Test Store purchase → fix runs | "Your first fix is free. After that, the paywall appears exactly when you need it. Revenue Cat entitlements are checked on the server, so nothing can be unlocked on the phone." | *RevenueCat: server-side entitlement check* |
| 1:45–1:55 | End card: logo, the one line, repo URL, "Built by a first-semester student" | "Other tools write fixes. Ops Swipe proves them. Open source. Built by a first-semester student." | **Other tools write fixes. OpsSwipe proves them.** github.com/DevHusnainAi/opsswipe |

Replace every number in the script (1m 12s, 38s, 3/3) with what the real take shows. Never narrate a number the picture
doesn't show.

## 4. Recording day

### Prepare the stage

- [ ] The full loop passes `docs/SETUP.md` step 11 at least twice before recording.
- [ ] Fresh state: resolve old incidents, clear Recent fixes if cluttered, free plan unused (so the paywall scene works).
- [ ] Phone: Do Not Disturb **off** for OpsSwipe, all other notifications silenced, full battery, clean status bar, 100% brightness,
      same wallpaper throughout. Set a lock screen (fingerprint needs it).
- [ ] Laptop: big terminal font (20pt+), dark theme, browser zoomed to 125%, only the demo site tab open.
- [ ] **Hide secrets.** No `.env`, API keys, report secrets, emails or tokens anywhere in frame. Pause if a secret field appears.
- [ ] Demo reset before each take: `chaos.sh heal`, wait for the site, resolve old cards. The VM needs ~40s to boot after a reset; start the stopwatch at the swipe, not the boot.

### Capture

- Phone screen: Android's built-in screen recorder (or `scrcpy --record phone.mp4` over USB for crisp 60fps).
- Hand-cam: a second phone on a small stand filming your hand, for the fingerprint and swipe. Real hands build trust.
- Laptop: OBS at 1080p60, recording the terminal and browser, with a visible clock or stopwatch (OBS text source, or a
  `watch -n1 date` pane).
- Record the live save **3 times** and keep the best continuous take. Record the proof and paywall scenes separately; those can
  have cuts because the timing isn't the claim.

### Why the stopwatch matters

A visible clock through the live save proves there's no cut between breaking and fixing. It turns "trust us" into "watch it".
Keep that section uncut; speed ramps are fine elsewhere.

## 5. Voice-over (AI voice)

- Write the narration first (section 3), generate the voice, then cut the footage to the voice.
- Pick one calm, confident voice; medium pace; no hype tone.
- Spell names for the voice: "Ops Swipe", "Revenue Cat", "G-C-P" if used, "C-I". Listen once for each name.
- Short sentences. Break any line over ~15 words into two.
- Leave 1–2 seconds of silence at: the phone buzz, the site coming back, "3/3 pass". Let the footage land.
- Music: soft and low under the voice, dropping out for the buzz. Royalty-free only (YouTube Audio Library).

## 6. Editing (Remotion)

- **Captions burned in** for every line: many judges watch muted, and captions cover any odd pronunciation.
- **Split screen** for the live save: laptop left, phone right, stopwatch on top.
- **Zoom-ins** on the three proof texts: the suggested fix's reason, "down 1m 12s · back 38s after fix", "3/3 failing production
  requests now pass". Hold each for ~1.5 seconds.
- **Callouts** (small labels with an arrow): "App closed", "Fingerprint required", "Real production requests", "Pinned to the
  proven commit", "Server-side entitlement check".
- **Speed ramps** only on setup (Connect) and waiting (CI running). Label them "3x".
- **Higgsfield or other AI video** only for the first 8 seconds of mood. Never for anything that shows the product: a single
  generated-looking product shot makes judges doubt the rest.
- End card on screen for at least 4 seconds, with the repo URL readable.
- Export 1080p, check the length is **under 2:00** (aim 1:55), and watch it once on a phone with sound off.

## 7. YouTube

- Title: **OpsSwipe: fix production from your lock screen, and prove it worked (RevenueCat Shipaton 2026)**
- Thumbnail: the phone showing the card and "back 38s after fix", with the text "Swipe. Fixed. Proven."
- Description: the one-liner, the three moments with timestamps, the repo link, and "Built for the RevenueCat Shipaton 2026
  Next Gen Award".
- Visibility: **Public**. Check it plays in a logged-out browser.

## 8. Devpost page

Put a short **"For the judges"** box at the very top, mapped to the four criteria:

> **Idea:** A pager for solo devs that fixes production from the lock screen, and the only tool that proves a fix works: CI
> replays the exact requests that failed in production before you can merge.
> **Working app:** Real fixes on a real cloud in the video: a Google Cloud VM reset, a revert PR proven in CI, and the merge that deploys it.
> Push alerts with the app closed. One continuous take with a clock.
> **RevenueCat:** Free first fix, paywall at the moment of need, entitlement checked on the server with RevenueCat's REST API,
> metered atomically in Postgres, so nothing unlocks on the phone.
> **Care:** Least privilege everywhere (reset-only role on one VM, 1-hour GitHub tokens, secrets in Vault), per-user row-level
> security, CI proof authenticated by GitHub OIDC, 34 backend tests, SQL tenancy tests, a 12-case AI eval, decision records.

Then Devpost's standard sections:

- **Inspiration:** the solo-dev story, in first person. Why a phone, why proof (tests passed, merged, still broken in production).
- **What it does:** the three moments, one short paragraph each, with a GIF each.
- **How we built it:** the architecture diagram from the README; Expo + Supabase + RevenueCat; Claude on Vertex for suggestions
  (rules first, AI can only pick allowed fixes); built with Claude Code.
- **Challenges:** proving a fix without replaying writes against production (replay only in CI, scrubbed samples);
  connecting clouds without ever holding a user's cloud key.
- **Accomplishments:** the live save under a minute; the verified-fix loop; security without shortcuts.
- **What we learned:** honest and short.
- **What's next:** the README roadmap (Sentry/Datadog alerts in, an approval API for AI SRE agents, team plan).
- **Built with:** expo, react-native, typescript, supabase, postgresql, deno, revenuecat, github-actions, google-cloud,
  claude.
- Images: 3–5 real phone screenshots (card, proof strip, paywall, Services), not mockups.

## 9. The repo, as a judge skims it

A judge gives the repo a minute or two. Make that path obvious:

1. README top: banner, one-liner, badges (CI, license), a hero GIF of the live save.
2. "Proof" section: the real numbers from the video (recovery time, 3/3 replay, test counts), each linked to where it's verified.
3. "For judges: Next Gen criteria" section, same four answers as Devpost.
4. Architecture diagram and the security table.
5. `docs/SETUP.md` works from a clean clone (the rules require the instructions to make it functional).
6. Root `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `CHANGELOG.md`, issue and PR templates: open-source hygiene judges
   notice.

## 10. What loses (avoid)

- Any claim the video doesn't show. Judges notice.
- A slow start: no logo animation or setup before 0:08. The problem first.
- Explaining architecture in the video. The Devpost page and README do that.
- A secret or email visible on screen.
- Video over 2:00, or Unlisted on YouTube.
- Private repo, or setup instructions that don't work.
- "AI-powered" as the pitch. AI is a detail; proof is the pitch.

## 11. Final checklist

- [ ] Video under 2:00, public on YouTube, plays logged out
- [ ] The three moments are all in it, with real numbers on screen
- [ ] Captions burned in; no secrets in frame
- [ ] Repo public, CI green, LICENSE present, SETUP works from a clean clone
- [ ] README: hero GIF, proof numbers, criteria section
- [ ] Devpost: "For the judges" box, 3–5 real screenshots, video and repo links, Next Gen category selected
- [ ] Submitted by Sep 29; re-checked on Sep 30 before 11:45pm PDT
