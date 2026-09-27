#!/usr/bin/env bash
# GCP startup script for the demo VM (runs as root on every boot).
# nginx is enabled on boot, so a reset is a real fix for a stopped or wedged nginx.
set -euo pipefail
command -v nginx >/dev/null || { apt-get update -y && apt-get install -y nginx; }
cat > /var/www/html/index.html <<HTML
<!doctype html><meta name=viewport content="width=device-width"><title>opsswipe-demo</title>
<body style="background:#0A0A0A;color:#10B981;font:22px monospace;display:grid;place-items:center;height:100vh;margin:0">
<div>&#9679; opsswipe-demo VM is up<br><small style="color:#A1A1AA">booted $(date -u +%H:%M:%SZ)</small></div>
HTML
systemctl enable --now nginx
