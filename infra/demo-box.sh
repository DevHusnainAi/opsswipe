#!/usr/bin/env bash
# GCP startup script for the demo VM (runs as root on every boot, so a reset redeploys).
# The VM behaves like a small PaaS: it runs infra/demo-web from the repo in the `demo-repo` metadata
# and redeploys within ~30s whenever `main` moves (a merged revert or fix PR goes live on its own).
# Instance metadata (all optional except demo-repo):
#   demo-repo            https URL of the public demo repo (e.g. https://github.com/you/opsswipe-demo-target)
#   opsswipe-report-url  OPSSWIPE_REPORT_URL shown by the app when you add this VM
#   report-secret        REPORT_SECRET shown with it
set -euo pipefail
meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true; }
REPO=$(meta demo-repo)
: "${REPO:?set the demo-repo metadata to the demo repo URL}"

command -v node >/dev/null && command -v git >/dev/null || { apt-get update -y && apt-get install -y nodejs git; }
systemctl disable --now nginx 2>/dev/null || true # the first version of this VM served a static page

[ -d /opt/demo/.git ] || git clone -q "$REPO" /opt/demo
git -C /opt/demo fetch -q origin main && git -C /opt/demo reset -q --hard origin/main

cat > /etc/opsswipe-demo.env <<ENV
PORT=80
OPSSWIPE_REPORT_URL=$(meta opsswipe-report-url)
REPORT_SECRET=$(meta report-secret)
ENV

# GIT_SHA is the deployed commit: reports carry it as `release`, so a revert targets the right one.
cat > /etc/systemd/system/opsswipe-demo.service <<'UNIT'
[Unit]
Description=OpsSwipe demo web
After=network-online.target
[Service]
EnvironmentFile=/etc/opsswipe-demo.env
ExecStart=/bin/sh -c 'GIT_SHA=$(git -C /opt/demo rev-parse HEAD) exec node /opt/demo/server.js'
Restart=on-failure
[Install]
WantedBy=multi-user.target
UNIT

# Auto-deploy: only when main moved. A service stopped on purpose (chaos) stays stopped until a reset.
cat > /usr/local/bin/opsswipe-deploy <<'SH'
#!/bin/sh
cd /opt/demo && git fetch -q origin main || exit 0
[ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ] && exit 0
git reset -q --hard origin/main && systemctl restart opsswipe-demo
SH
chmod +x /usr/local/bin/opsswipe-deploy
cat > /etc/systemd/system/opsswipe-deploy.service <<'UNIT'
[Service]
Type=oneshot
ExecStart=/usr/local/bin/opsswipe-deploy
UNIT
cat > /etc/systemd/system/opsswipe-deploy.timer <<'UNIT'
[Timer]
OnBootSec=30
OnUnitActiveSec=30
[Install]
WantedBy=timers.target
UNIT

systemctl daemon-reload
systemctl enable --now opsswipe-demo opsswipe-deploy.timer
systemctl restart opsswipe-demo
