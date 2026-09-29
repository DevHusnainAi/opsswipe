# Recording the demo

A shot list for recording the phone footage in about 10 minutes of screen time, in one sitting, so the rest of the day
goes to editing. Record each shot as its own clip. Waiting time (the health check, CI) is cut in the edit, so never
hurry: let each step finish on screen.

## Before you start (15 minutes, once)

**Laptop**

```bash
cd opsswipe
./infra/demo.sh reset      # good release live, demo app running, no open incident, no leftover PRs
./infra/demo.sh check      # every line must say OK
cd app && npx expo start --dev-client --tunnel
```

**Phone**

- Open OpsSwipe and connect to the dev server. Shake → dev menu → turn **off** the floating tools button.
- **Account state for the video:** the VM `opsswipe-demo` added with `opsswipe-demo-target` linked, proof on,
  GitHub connected, Slack or Discord connected, revenue at risk connected (the card shows "~$X/h at risk").
- **Stay on the Free plan** (skip the trial in onboarding): outage 1 uses the free outage, so outage 2 shows the
  RevenueCat paywall, the Test Store purchase, and the fix continuing. That's the RevenueCat moment judges look for.
- Sound: ringer on, **alarm volume up**, Do Not Disturb off. Battery above 50 %, Wi-Fi on, notifications from other
  apps silenced (Settings → Notifications), dark mode.
- Screen recorder: Android's built-in recorder with **device audio** (so the alarm is heard), touches shown.

## The shots

| # | Shot | Do | What must be on screen | Length |
| --- | --- | --- | --- | --- |
| 1 | **Calm** | Open the app on Incidents | "All clear", the service with its green dot | 5 s |
| 2 | **Services** | Services tab, scroll slowly | the VM, "Last failure report …", proof on, connections | 10 s |
| 3 | **Outage 1 rings** | Lock the phone. Laptop: `./infra/demo.sh down`. Wait | the lock screen, the alarm notification arriving with sound | 10 s (cut the wait) |
| 4 | **The card** | Unlock, tap the notification | the card: what broke, likely cause, suggested **Reboot**, "~$X/h at risk" | 8 s |
| 5 | **Why** | Tap the card title | the detail: what happened, likely cause, the AI's second opinion, timeline | 10 s |
| 6 | **Fix** | Back, swipe **Reboot**, fingerprint | the swipe, the fingerprint prompt, "Rebooting…" | 8 s |
| 7 | **Back up** | Wait | the "back up" push and the recovery card with downtime and revenue lost | 8 s (cut the wait) |
| 8 | **Outage 2** | Laptop: `./infra/demo.sh release` (wait for "visit 3: 500") | the new card "Requests are failing", `GET /api/price → 500`, suggested **Revert PR** | 8 s |
| 9 | **Paywall** | Swipe **Revert PR**, fingerprint | the paywall naming what's at stake; buy Pro in the Test Store | 12 s |
| 10 | **Proof** | Wait for CI (about 40 s, cut it) | the card changing to "CI is replaying…" then only **Merge PR**; the detail showing `GET /api/price: 500 → 200` | 12 s |
| 11 | **Merge** | Swipe **Merge**, fingerprint | "Merged…", then the "back up: /api/price answers again" push | 10 s |
| 12 | **After** | Activity tab, then Share on the recovery | week stats, the incident report in the share sheet | 8 s |
| 13 | **Settings** | Settings, scroll | Slack/Discord connected, team invite by email, agent access | 8 s |

**Laptop clips** (screen-record the browser; they sell the proof):

- The PR on GitHub: its title, the `.opsswipe/replays/*.json` file, and the **opsswipe-proof** check passing.
- The proof run log: "FIXED GET /api/price was 500, now 200".
- The Slack or Discord message arriving for outage 1.

## Between takes

```bash
./infra/demo.sh reset && ./infra/demo.sh check
```

Rules that keep it smooth:

- **Never run `down` and `release` at the same time.** Start outage 2 only after outage 1 says "back up".
- **Merge only from the app**, and only after `release` printed "visit 3: 500": two pushes to the demo repo a minute
  apart once made GitHub drop the second push event.
- The phone rings about 1-2 minutes after `down` (the health check confirms twice before paging), and about 20 s after
  `release` finishes its visits.
- If something looks wrong, `reset`, `check`, and take the shot again. Nothing carries over between takes.

## For the edit

- The 7-step loop diagram (`docs/diagrams/loop.svg`) and the architecture (`docs/diagrams/architecture.svg`) are
  vector: drop them straight into the motion-graphics tool.
- The brand: dark `#0A0A0A`, green `#10B981`, Geist and Geist Mono (`docs/brand/`).
- The story, in order: production breaks → your phone rings → you see why → one swipe fixes it → a code bug gets a
  revert that **CI proves against the requests that failed** → merge → verified back up.
