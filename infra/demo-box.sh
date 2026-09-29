#!/usr/bin/env bash
# GCP startup script for the demo VM (runs as root on every boot, so a reset redeploys).
# The VM runs infra/demo-web from the repo in the `demo-repo` metadata. Deploys come from the repo's
# GitHub Actions (.github/workflows/deploy.yml): tests pass on main, then CI connects over SSH as `deploy`,
# whose key can only run /usr/local/bin/opsswipe-deploy (a forced command: no shell, no forwarding).
# Instance metadata (all optional except demo-repo):
#   demo-repo            https URL of the public demo repo (e.g. https://github.com/you/opsswipe-demo-target)
#   deploy-key           the public half of the CI deploy key (its private half is a GitHub secret)
#   opsswipe-report-url  OPSSWIPE_REPORT_URL shown by the app when you add this VM
#   report-secret        REPORT_SECRET shown with it
set -euo pipefail
meta() { curl -fsS -H 'Metadata-Flavor: Google' "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1" 2>/dev/null || true; }
REPO=$(meta demo-repo)
: "${REPO:?set the demo-repo metadata to the demo repo URL}"

if ! command -v node >/dev/null || ! command -v git >/dev/null; then apt-get update -y && apt-get install -y nodejs git; fi
systemctl disable --now nginx 2>/dev/null || true # the first version of this VM served a static page

[ -d /opt/demo/.git ] || git clone -q "$REPO" /opt/demo
git -C /opt/demo fetch -q origin main && git -C /opt/demo reset -q --hard origin/main

cat > /etc/opsswipe-demo.env <<ENV
PORT=80
OPSSWIPE_REPORT_URL=$(meta opsswipe-report-url)
REPORT_SECRET=$(meta report-secret)
ENV

# Security patches install themselves every night (Debian's unattended-upgrades; on by default on GCE).
dpkg -s unattended-upgrades >/dev/null 2>&1 || apt-get install -y unattended-upgrades
systemctl enable --now unattended-upgrades

# GIT_SHA is the deployed commit: reports carry it as `release`, so a revert targets the right one.
# The app never runs as root: a throwaway user (DynamicUser) that may only bind port 80, can't gain
# privileges, and sees the filesystem read-only. A hole in the app can't take over the VM.
cat > /etc/systemd/system/opsswipe-demo.service <<'UNIT'
[Unit]
Description=OpsSwipe demo web
After=network-online.target
[Service]
EnvironmentFile=/etc/opsswipe-demo.env
ExecStart=/bin/sh -c 'GIT_SHA=$(git -c safe.directory=/opt/demo -C /opt/demo rev-parse HEAD) exec node /opt/demo/server.js'
Restart=on-failure
DynamicUser=yes
AmbientCapabilities=CAP_NET_BIND_SERVICE
CapabilityBoundingSet=CAP_NET_BIND_SERVICE
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictSUIDSGID=yes
LockPersonality=yes
[Install]
WantedBy=multi-user.target
UNIT

# Deploy: only when main moved. A service stopped on purpose (chaos) stays stopped until a reset.
cat > /usr/local/bin/opsswipe-deploy <<'SH'
#!/bin/sh
cd /opt/demo && git fetch -q origin main || exit 1
if [ "$(git rev-parse HEAD)" = "$(git rev-parse origin/main)" ]; then echo "already at $(git rev-parse --short HEAD)"; exit 0; fi
git reset -q --hard origin/main && systemctl restart opsswipe-demo && echo "deployed $(git rev-parse --short HEAD)"
SH
chmod 755 /usr/local/bin/opsswipe-deploy
systemctl disable --now opsswipe-deploy.timer 2>/dev/null || true # the first version pulled every 30 s
rm -f /etc/systemd/system/opsswipe-deploy.timer /etc/systemd/system/opsswipe-deploy.service

# CI's way in: a user who can only run the deploy script. Two locks, so neither alone is trusted:
# sshd forces the command for this user whatever authorized_keys says, and the key from metadata
# must be exactly one public key line (a newline in metadata can't smuggle in a second, unrestricted key).
KEY=$(meta deploy-key | head -n 1)
if ! [[ "$KEY" =~ ^(ssh-ed25519|ecdsa-sha2-nistp256|ssh-rsa)\ [A-Za-z0-9+/=]+(\ [^[:space:]]+)?$ ]]; then
  [ -n "$KEY" ] && echo "demo-box: deploy-key metadata is not a single public key; ignoring it" >&2
  KEY=""
fi
id deploy >/dev/null 2>&1 || useradd --create-home --shell /bin/bash deploy
echo 'deploy ALL=(root) NOPASSWD: /usr/local/bin/opsswipe-deploy' > /etc/sudoers.d/opsswipe-deploy
chmod 440 /etc/sudoers.d/opsswipe-deploy
cat > /etc/ssh/sshd_config.d/opsswipe-deploy.conf <<'SSHD'
Match User deploy
  ForceCommand sudo /usr/local/bin/opsswipe-deploy
  AllowTcpForwarding no
  AllowAgentForwarding no
  X11Forwarding no
  PermitTTY no
SSHD
systemctl reload ssh 2>/dev/null || systemctl reload sshd 2>/dev/null || true
install -d -m 700 -o deploy -g deploy /home/deploy/.ssh
if [ -n "$KEY" ]; then
  echo "command=\"sudo /usr/local/bin/opsswipe-deploy\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty $KEY" \
    > /home/deploy/.ssh/authorized_keys
fi
chown deploy:deploy /home/deploy/.ssh/authorized_keys 2>/dev/null || true
chmod 600 /home/deploy/.ssh/authorized_keys 2>/dev/null || true

systemctl daemon-reload
systemctl enable --now opsswipe-demo
systemctl restart opsswipe-demo
