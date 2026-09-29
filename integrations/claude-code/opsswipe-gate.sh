#!/usr/bin/env bash
# Claude Code PreToolUse hook: risky shell commands wait for your approval on your phone.
# Claude proposes, your phone buzzes, you swipe + fingerprint (or decline). Nothing else is slowed down.
#   OPSSWIPE_AGENT_TOKEN  an ops_ token from OpsSwipe: Settings -> Agent access (required)
#   OPSSWIPE_URL          your OpsSwipe server (default: the hosted one)
#   OPSSWIPE_GATE         extended regex of commands that need approval (default below)
# Exit 0 lets the command run; exit 2 blocks it and tells Claude why.
set -euo pipefail
URL="${OPSSWIPE_URL:-https://mwkwhfqcgxossweqwibt.supabase.co}/functions/v1/agent"
GATE="${OPSSWIPE_GATE:-git push.*(--force|-f\b)|git reset --hard|db (reset|push)|drop (table|database)|terraform (apply|destroy)|kubectl (delete|apply)|rm -rf /|DELETE FROM|npm publish|gcloud .* delete|fly (deploy|destroy)|vercel .*--prod}"

cmd=$(jq -r '.tool_input.command // empty')
[ -n "$cmd" ] && echo "$cmd" | grep -Eiq "$GATE" || exit 0
: "${OPSSWIPE_AGENT_TOKEN:?set OPSSWIPE_AGENT_TOKEN (OpsSwipe: Settings -> Agent access)}"
auth=(-H "Authorization: Bearer $OPSSWIPE_AGENT_TOKEN")

body=$(jq -n --arg c "$cmd" --arg d "$PWD" '{command: $c, title: "Claude Code wants to run a command", reason: ("In " + $d + ". Approve to let it run.")}')
id=$(curl -fsS "${auth[@]}" -H 'content-type: application/json' -d "$body" "$URL" | jq -r .id) || {
  echo "OpsSwipe approval unavailable, so this command was not run." >&2; exit 2; }

for _ in $(seq 200); do # ~10 minutes
  status=$(curl -fsS "${auth[@]}" "$URL?id=$id" | jq -r .status || echo pending)
  case "$status" in
    approved) exit 0 ;;
    declined) echo "The human declined this command on their phone (OpsSwipe). Don't retry it; ask them what to do instead." >&2; exit 2 ;;
  esac
  sleep 3
done
echo "No answer on OpsSwipe within 10 minutes, so this command was not run." >&2
exit 2
