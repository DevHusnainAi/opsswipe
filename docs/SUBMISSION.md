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

> **You're a solo dev. AI writes half your code now, and your app makes money while you sleep, until the backend
> breaks at dinner. OpsSwipe shows what it's costing you, lets you fix it from your lock screen, and won't let any fix,
> yours or the AI's, merge until the real failing requests pass.**

Why this lands with these judges:

- **They've lived it.** Every indie dev has had a backend go down away from a laptop. Say it plainly; don't explain SRE.
- **Downtime is lost revenue, and now they see the number.** OpsSwipe reads their own RevenueCat revenue and puts
  *~$4.20/h at risk* on the card and *about $0.08 lost* on the recovery. RevenueCat becomes part of the product, not just
  the paywall.
- **AI writes their code.** Claude Code and Cursor ship code they didn't write line by line; the fear is an AI fix
  making it worse at 3am. OpsSwipe's answer: proven against real traffic, approved by your fingerprint.
- **No team, no on-call rotation, no laptop.** Big tools (PagerDuty, incident.io) assume a team. OpsSwipe assumes one person and
  a phone.
- **The builder is the user.** A first-semester student who builds and runs backends, making the pager they wanted. Authentic and
  on-theme for Next Gen.

Words to use: *your app, your backend, one swipe, proof, back in 38 seconds, from your lock screen.*
Words to avoid: *SRE, remediation, observability platform, enterprise, incident management lifecycle.*

The one line to repeat (video, Devpost, README): **"AI writes your fixes. OpsSwipe proves them."** (short form of
the README headline; say "first", never "only")
That is the originality claim, and it's true: Sentry's AI drafts fixes and PRs, but a human still merges them against the same
tests that missed the bug ([Seer self-healing workflow](https://sentry.io/cookbook/self-healing-workflow-seer/)).

## 2. The three moments judges must remember

A great 2-minute video is built around a few scenes people can retell. Ours:

1. **The live save (the hook).** Laptop breaks the site; the phone, app closed, buzzes; swipe; fingerprint; site back. A
   visible stopwatch runs the whole time; the card shows "~$X/h at risk" from RevenueCat and ends on "back Ns after fix".
   One continuous take, no cut. *This answers "working app" beyond doubt.*
2. **Fixed while you slept (the originality).** A bad release breaks an untested route. Before you look, OpsSwipe has
   already written the fix and a regression test, opened the PR and let CI replay the exact requests that failed:
   "A fix is ready and proven, 3/3 pass". You read the diff on the phone, swipe Merge, and the postmortem says why it
   broke. *This is what no other entry does.*
3. **Your AI agent asks first, and RevenueCat is part of the product.** Claude Code tries `git push --force`; the phone
   asks; decline; Claude is told no. Then 10 seconds on the plan: the trial offered during onboarding, revenue at risk on
   the card, Pro/Team on the paywall. *This answers "timely idea" and "thoughtful RevenueCat use".*

Everything else (Connect, alert inbox, teams, status page, security, tests) gets seconds, not scenes.

## 3. Shot list and script (1:55)

Word budget: ~270 words of narration at a natural pace. Times are targets; fit the voice to the real footage.

| Time | Picture | Voice-over | On-screen text (Remotion) |
| --- | --- | --- | --- |
| 0:00–0:10 | Evening, phone face-down on a dinner table. Buzz: "checkout-api is down, ~$38/h at risk" | "I'm a student. My app makes money while I sleep, until the backend breaks." | *Your app. Your backend. You're not at your laptop.* |
| 0:10–0:18 | Title card over the incident card | "Pagers wake you up. They don't fix anything. This is Ops Swipe." | *90% of overnight pages aren't critical. The rest need a laptop.* **OpsSwipe** |
| 0:18–0:48 | **Split screen, one take, stopwatch:** laptop runs `chaos.sh gcp`; phone locked, push, card with cause, cost and suggested fix; swipe; fingerprint; site back | "Let's break production for real. My phone knows first. One card: what broke, what it's costing me from my Revenue Cat, and the fix. Swipe. Fingerprint. Back online." | Stopwatch, then **back Ns after the fix** |
| 0:48–1:22 | `chaos.sh release`; push: "A fix is ready and proven, 3/3 failing requests pass"; open the card, the diff with the fix and the regression test; swipe Merge; "back up"; the postmortem | "When the bug is in the code, Ops Swipe has the fix waiting before I wake up. The AI wrote it and a test. CI replayed the exact requests that failed in production. Only then can I merge, and only that exact commit. Then it tells me why it broke." | *Written by AI · proven in CI · merged by you* → **3/3 pass** |
| 1:22–1:38 | Laptop: Claude Code runs `git push --force origin main`; phone: "Claude Code asks to run a command"; decline; terminal shows it was blocked | "And my AI agents ask my phone before they touch production." | *AI agents ask first* |
| 1:38–1:48 | Onboarding trial screen, Pro/Team paywall, revenue at risk | "First outage free. Pro and Team with a seven-day trial. Revenue Cat entitlements are checked on the server." | *RevenueCat: part of the product* |
| 1:48–1:55 | End card: logo, the line, repo URL, "Built by a student with Claude Code" | "AI writes your fixes. Ops Swipe proves them." | **AI writes your fixes. OpsSwipe proves them.** github.com/DevHusnainAi/opsswipe |

Replace every number in the script (seconds, 3/3, $/h) with what the real take shows. Never narrate a number the picture
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

> **Idea:** AI writes your fixes; OpsSwipe proves them. A pager for solo devs that turns an outage into one card with a
> fix attached, has the AI fix and a regression test ready before you wake, lets it merge only after CI replays the
> exact requests that failed in production, and makes AI agents ask your phone before touching production.
> **Progress:** Real fixes on real infrastructure in the video: a Google Cloud VM reboot, an AI fix PR proven in CI and
> merged pinned to that commit, push alerts with the app closed, the agent gate. One continuous take with a clock.
> **RevenueCat:** Your own RevenueCat revenue turns every incident into $/hour at risk. First outage free; Free / Pro /
> Team with monthly and yearly plans and a 7-day trial offered during onboarding, never mid-outage; entitlements checked
> on the server, with a webhook-kept copy so a billing outage never blocks a fix.
> **Care:** Least privilege (reboot-only role on one VM, 1-hour GitHub tokens, secrets in Vault), row-level security,
> OIDC-signed proofs with the PR's code isolated in Docker, prompts that treat request data as data, 108 backend tests,
> SQL tests on Postgres 17, a 14-case AI eval, CI and CD, decision records, privacy policy and terms.

Then Devpost's standard sections:

- **Inspiration:** the solo-dev story, in first person. Why a phone, why proof (tests passed, merged, still broken in production).
- **What it does:** the three moments, one short paragraph each, with a GIF each.
- **How we built it:** the architecture diagram from the README; Expo + Supabase + RevenueCat; NVIDIA Nemotron with a Groq
  backup for suggestions, fixes and postmortems (rules decide, AI output is checked by code); built with Claude Code.
- **Challenges:** proving a fix without replaying writes against production (replay only in CI, scrubbed samples);
  connecting clouds without ever holding a user's cloud key.
- **Accomplishments:** the live save under a minute; the verified-fix loop; security without shortcuts.
- **What we learned:** honest and short.
- **What's next:** the README roadmap (iOS, call/SMS escalation, OAuth for Railway and RevenueCat, more hosts, an MCP server).
- **Built with:** expo, react-native, typescript, supabase, postgresql, deno, revenuecat, github-actions, google-cloud,
  nvidia, claude-code.
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
