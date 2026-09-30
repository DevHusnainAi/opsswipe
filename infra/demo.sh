#!/usr/bin/env bash
# shellcheck disable=SC2015 # "cond && ok || bad": ok only prints, so it never falls through to bad
# One command per step of the demo recording (docs/VIDEO.md). Needs: gcloud on the personal account, gh, and
# `npx supabase login` + link (for `check`). The demo repo is expected at ../opsswipe-demo-target.
#   ./infra/demo.sh check     everything the recording needs, each line OK or what to fix
#   ./infra/demo.sh reset     back to a calm start: demo app running, good release live, no open incident
#   ./infra/demo.sh down      outage 1: stop the demo app on the VM (the phone rings in about 1-2 minutes)
#   ./infra/demo.sh release   outage 2: ship the bad release, wait for it to deploy, trigger the reports
set -euo pipefail
cd "$(dirname "$0")/.."
DEMO_REPO="${DEMO_REPO:-../opsswipe-demo-target}"
URL="${DEMO_URL:-http://34.135.145.87}"
VM="${VM:-opsswipe-demo}" ZONE="${ZONE:-us-central1-a}"
ok() { printf '  \033[32mOK\033[0m   %s\n' "$1"; }
bad() { printf '  \033[31mFIX\033[0m  %s\n' "$1"; fails=$((fails + 1)); }
code() { curl -s -o /dev/null -m 8 -w '%{http_code}' "$1"; }
sql() { npx -y supabase db query --linked "$1" 2>/dev/null | python3 -c 'import json,sys; print(json.dumps(json.load(sys.stdin).get("rows", [])))'; }

check() {
  fails=0
  echo "Accounts"
  [ "$(gcloud config get account 2>/dev/null)" = syedhussnaintirmizi@gmail.com ] && ok "gcloud: personal account" ||
    bad "gcloud account: run gcloud config set account syedhussnaintirmizi@gmail.com"
  gh auth status >/dev/null 2>&1 && ok "gh signed in" || bad "gh auth login"
  echo "Demo service"
  [ "$(code "$URL/")" = 200 ] && ok "$URL/ answers 200" || bad "the demo app is down: ./infra/demo.sh reset"
  [ "$(code "$URL/api/price")" = 200 ] && ok "/api/price answers 200 (good release live)" || bad "bad release live: ./infra/demo.sh reset"
  [ -d "$DEMO_REPO/.git" ] && ok "demo repo at $DEMO_REPO" || bad "clone it: gh repo clone DevHusnainAi/opsswipe-demo-target $DEMO_REPO"
  gh api repos/DevHusnainAi/opsswipe-demo-target/contents/.github/workflows/opsswipe-proof.yml >/dev/null 2>&1 &&
    ok "proof workflow on main" || bad "in the app: Services -> the VM -> Add proof to repo, then merge the PR"
  echo "OpsSwipe"
  local s
  s=$(sql "select (select count(*) from services where provider='gcp' and config->>'repo' is not null) vms,
    (select count(*) from push_tokens) phones, (select count(*) from fix_keys) keys,
    (select count(*) from incidents where status in ('active','resolving')) open,
    (select count(*) from cron.job where active) crons, (select count(*) from connections where kind='github') gh") ||
    { bad "Supabase CLI: npx supabase login && npx supabase link --project-ref mwkwhfqcgxossweqwibt"; s='[]'; }
  if [ "$s" != '[]' ]; then
    val() { python3 -c "import json,sys; print(json.loads(sys.argv[1])[0]['$1'])" "$s"; }
    [ "$(val vms)" -ge 1 ] && ok "VM added with its repo linked" || bad "in the app: add opsswipe-demo and link opsswipe-demo-target"
    [ "$(val gh)" -ge 1 ] && ok "GitHub connected" || bad "in the app: Services -> GitHub -> Connect"
    [ "$(val phones)" -ge 1 ] && ok "phone registered for push" || bad "in the app: turn on alerts (Settings)"
    [ "$(val keys)" -ge 1 ] && ok "fingerprint key set up" || bad "in the app: do one fingerprint approval (the practice card)"
    [ "$(val open)" = 0 ] && ok "no open incident" || bad "an incident is open: ./infra/demo.sh reset"
    [ "$(val crons)" -ge 2 ] && ok "health check and weekly schedules active" || bad "schedules missing: npx supabase db push"
  fi
  echo
  [ "$fails" = 0 ] && echo "Ready to record." || { echo "$fails thing(s) to fix first."; exit 1; }
}

reset() {
  echo "Good release on main"
  git -C "$DEMO_REPO" pull -q --rebase
  if grep -q '^const RELEASE_OK = false;' "$DEMO_REPO/server.js"; then ./infra/chaos.sh heal; else echo "  already good"; fi
  echo "Demo app running"
  gcloud compute ssh "$VM" --zone "$ZONE" --command 'sudo systemctl start opsswipe-demo; systemctl is-active opsswipe-demo'
  echo "Waiting for /api/price to answer 200 (a heal deploys in about a minute)"
  for _ in $(seq 36); do [ "$(code "$URL/api/price")" = 200 ] && break; sleep 5; done
  echo "  /api/price: $(code "$URL/api/price")"
  echo "Leftovers from the last take"
  for pr in $(gh pr list -R DevHusnainAi/opsswipe-demo-target --state open --json number,headRefName \
    --jq '.[] | select(.headRefName | startswith("opsswipe/fix-") or startswith("opsswipe/revert-")) | .number'); do
    gh pr close "$pr" -R DevHusnainAi/opsswipe-demo-target --delete-branch >/dev/null && echo "  closed PR #$pr"
  done
  # Open incidents are closed as dismissed (a false alarm in the app's history), so the next take starts clean.
  npx -y supabase db query --linked "update incidents set status = 'resolved', resolved_at = now(), recovered_at = now(),
    context = '{\"dismissed\": true}' where status in ('active', 'resolving')" >/dev/null 2>&1 &&
    echo "  open incidents closed" || echo "  could not reach Supabase (npx supabase login), close them in the app"
  echo "Next: ./infra/demo.sh check"
}

case "${1:-}" in
  check) check ;;
  reset) reset ;;
  down) ./infra/chaos.sh gcp && echo "The phone rings in about 1-2 minutes (the health check confirms it first)." ;;
  release) DEMO_REPO="$DEMO_REPO" ./infra/chaos.sh release ;;
  *) echo "usage: $0 check|reset|down|release" >&2; exit 1 ;;
esac
