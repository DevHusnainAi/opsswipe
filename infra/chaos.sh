#!/usr/bin/env bash
# Break a demo target on purpose so OpsSwipe opens an incident. gcloud must be on your personal account.
#   ./infra/chaos.sh gcp       stops the demo app on the GCP VM (a reset brings it back on boot)
#   ./infra/chaos.sh release   pushes a bad release of the demo repo (it breaks /api/price, which the tests
#                              don't cover); CI deploys it in ~1 min, then a few visits make it report its 500s
#                              (revert or AI fix PR, proven in CI, then merge). DEMO_URL defaults to the demo VM.
#   ./infra/chaos.sh heal      pushes a good release again, to reset between rehearsals
#   ./infra/chaos.sh noise     fires 50 Alertmanager alerts at your alert inbox (INBOX_URL from Settings):
#                              the ones about the demo VM fold into one card, the rest stay quiet
#   ./infra/chaos.sh render    wedges a Render deploy of the demo (a restart brings it back)
set -euo pipefail
release() {
  : "${DEMO_REPO:?set DEMO_REPO to your local clone of opsswipe-demo-target}"
  git -C "$DEMO_REPO" pull -q --rebase # a merged revert or fix PR may have moved main
  sed -i.bak "s/^const RELEASE_OK = $1;/const RELEASE_OK = $2;/" "$DEMO_REPO/server.js" && rm -f "$DEMO_REPO/server.js.bak" # GNU and BSD sed
  if git -C "$DEMO_REPO" diff --quiet; then echo "main already has RELEASE_OK = $2" && exit 0; fi
  git -C "$DEMO_REPO" commit -qam "$3" && git -C "$DEMO_REPO" push -q
}
case "${1:-}" in
  gcp)
    # shellcheck disable=SC2016 # $(hostname) runs on the VM, not here
    gcloud compute ssh "${VM:-opsswipe-demo}" --zone "${ZONE:-us-central1-a}" \
      --command 'sudo systemctl stop opsswipe-demo && echo "demo app stopped on $(hostname)"' ;;
  release)
    release true false "Ship new pricing"
    url="${DEMO_URL:-http://34.135.145.87}/api/price"
    echo "bad release pushed; waiting for CI to deploy it…"
    for _ in $(seq 36); do
      [ "$(curl -s -o /dev/null -w '%{http_code}' "$url")" = 500 ] && break
      sleep 5
    done
    # Two reported failures within a minute page the phone; a third in case one report is lost.
    for i in 1 2 3; do echo "visit $i: $(curl -s -o /dev/null -w '%{http_code}' "$url")"; sleep 20; done ;;
  heal)
    release false true "Restore homepage"
    echo "good release pushed" ;;
  noise)
    : "${INBOX_URL:?set INBOX_URL to the webhook URL from Settings -> Alerts from your other tools}"
    for i in $(seq 50); do
      if [ $((i % 5)) -eq 0 ]; then target=cache-7; name=HighMemory; else target="${VM_HOST:-34.135.145.87}:9100"; name=HighErrorRate; fi
      curl -fsS -o /dev/null -H 'content-type: application/json' -d "{\"status\":\"firing\",\"alerts\":[{\"status\":\"firing\",\"labels\":{\"alertname\":\"$name\",\"instance\":\"$target\"},\"annotations\":{\"summary\":\"5xx rate above 5% for 5 minutes\"}}]}" "$INBOX_URL"
    done
    echo "50 alerts sent: 40 about the demo VM (one card), 10 about cache-7 (quiet)" ;;
  render)
    : "${RENDER_URL:?set RENDER_URL, e.g. https://opsswipe-demo-web.onrender.com}"
    : "${CHAOS_KEY:?set CHAOS_KEY (Render dashboard -> Environment)}"
    curl -fsS -X POST -H "X-Chaos-Key: $CHAOS_KEY" "$RENDER_URL/chaos" ;;
  *) echo "usage: $0 gcp|release|heal|noise|render" >&2; exit 1 ;;
esac
