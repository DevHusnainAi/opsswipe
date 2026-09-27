#!/usr/bin/env bash
# Break a demo target on purpose so the health check opens an incident.
#   ./infra/chaos.sh gcp       stops nginx on the GCP VM (a reset brings it back)
#   ./infra/chaos.sh render    wedges the Render service (a restart brings it back)
#   ./infra/chaos.sh release   pushes a bad release of the demo service (rollback / revert PR fix it)
set -euo pipefail
case "${1:-}" in
  gcp)
    gcloud compute ssh "${VM:-opsswipe-demo}" --zone "${ZONE:-us-central1-a}" \
      --command 'sudo systemctl stop nginx && echo "nginx stopped on $(hostname)"' ;;
  render)
    : "${RENDER_URL:?set RENDER_URL, e.g. https://opsswipe-demo-web.onrender.com}"
    : "${CHAOS_KEY:?set CHAOS_KEY (Render dashboard -> Environment)}"
    curl -fsS -X POST -H "X-Chaos-Key: $CHAOS_KEY" "$RENDER_URL/chaos" ;;
  release)
    : "${DEMO_REPO:?set DEMO_REPO to your local clone of the demo service repo}"
    sed -i 's/^const RELEASE_OK = true;/const RELEASE_OK = false;/' "$DEMO_REPO/server.js"
    git -C "$DEMO_REPO" commit -qam "Ship new homepage" && git -C "$DEMO_REPO" push -q
    echo "bad release pushed; Render deploys it in ~1 min" ;;
  *) echo "usage: $0 gcp|render|release" >&2; exit 1 ;;
esac
