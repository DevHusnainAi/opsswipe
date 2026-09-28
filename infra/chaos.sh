#!/usr/bin/env bash
# Break a demo target on purpose so OpsSwipe opens an incident. gcloud must be on your personal account.
#   ./infra/chaos.sh gcp       stops the demo app on the GCP VM (a reset brings it back on boot)
#   ./infra/chaos.sh release   pushes a bad release of the demo repo; the VM deploys it within ~30s
#                              and reports its 500s (revert or AI fix PR, proven in CI, then merge)
#   ./infra/chaos.sh heal      pushes a good release again, to reset between rehearsals
#   ./infra/chaos.sh render    wedges a Render deploy of the demo (a restart brings it back)
set -euo pipefail
release() {
  : "${DEMO_REPO:?set DEMO_REPO to your local clone of opsswipe-demo-target}"
  git -C "$DEMO_REPO" pull -q --rebase # a merged revert or fix PR may have moved main
  sed -i "s/^const RELEASE_OK = $1;/const RELEASE_OK = $2;/" "$DEMO_REPO/server.js"
  if git -C "$DEMO_REPO" diff --quiet; then echo "main already has RELEASE_OK = $2" && exit 0; fi
  git -C "$DEMO_REPO" commit -qam "$3" && git -C "$DEMO_REPO" push -q
}
case "${1:-}" in
  gcp)
    gcloud compute ssh "${VM:-opsswipe-demo}" --zone "${ZONE:-us-central1-a}" \
      --command 'sudo systemctl stop opsswipe-demo && echo "demo app stopped on $(hostname)"' ;;
  release)
    release true false "Ship new homepage"
    echo "bad release pushed; the VM deploys it within ~30s" ;;
  heal)
    release false true "Restore homepage"
    echo "good release pushed" ;;
  render)
    : "${RENDER_URL:?set RENDER_URL, e.g. https://opsswipe-demo-web.onrender.com}"
    : "${CHAOS_KEY:?set CHAOS_KEY (Render dashboard -> Environment)}"
    curl -fsS -X POST -H "X-Chaos-Key: $CHAOS_KEY" "$RENDER_URL/chaos" ;;
  *) echo "usage: $0 gcp|release|heal|render" >&2; exit 1 ;;
esac
