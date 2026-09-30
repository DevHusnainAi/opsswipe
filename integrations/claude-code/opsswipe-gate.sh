#!/usr/bin/env bash
# Claude Code PreToolUse hook: shell commands wait for your approval on your phone.
# Claude proposes, your phone buzzes, you swipe + fingerprint (or decline).
#   OPSSWIPE_AGENT_TOKEN  an ops_ token from OpsSwipe: Settings -> Agent access (required)
#   OPSSWIPE_URL          your OpsSwipe server (default: the hosted one)
#   OPSSWIPE_GATE_MODE    allow (default): only read-only commands run unasked; everything else waits.
#                         deny: only commands matching OPSSWIPE_GATE wait (best-effort: a list of dangerous
#                         shell strings can always be dodged, so use it only where convenience wins)
#   OPSSWIPE_ALLOW        extended regex of commands that run unasked in allow mode (default below)
#   OPSSWIPE_GATE         extended regex of commands that wait in deny mode (default below)
# Exit 0 lets the command run; exit 2 blocks it and tells Claude why. Claude Code runs a command on ANY
# other exit code, so every failure here (no jq, no token, bad input, a crash) must end in exit 2.
set -uo pipefail
block() { echo "OpsSwipe gate: $1, so this command was not run." >&2; exit 2; }
trap 'block "the gate hit an error"' ERR

command -v jq >/dev/null || block "jq is not installed"
command -v curl >/dev/null || block "curl is not installed"

URL="${OPSSWIPE_URL:-https://mwkwhfqcgxossweqwibt.supabase.co}/functions/v1/agent"
ALLOW="${OPSSWIPE_ALLOW:-^(ls|pwd|cat|head|tail|wc|grep|rg|echo|which|stat|file|du|df|tree|diff|git (status|diff|log|show|blame|branch --show-current)|npm (test|run (test|lint|typecheck))|npx (tsc|eslint)|deno (task (test|lint|check|eval)|fmt --check|test|check|lint)|node --test)( [^|;&<>\`\$]*)?$}"
GATE="${OPSSWIPE_GATE:-git push.*(--force|-f|\+)|git reset --hard|db (reset|push)|drop (table|database)|terraform (apply|destroy)|kubectl (delete|apply)|rm (-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r -f|-f -r)|DELETE FROM|npm publish|gcloud .* delete|fly (deploy|destroy)|vercel .*--prod|\\\$}"

input=$(cat) || block "no input"
cmd=$(jq -er '.tool_input.command // ""' <<<"$input" 2>/dev/null) || block "unreadable hook input"
[ -n "$cmd" ] || exit 0

# One command per line: split on ; && || | and newlines, collapse whitespace, drop quotes and backslashes
# (so "kubectl  delete", "rm -fr" and "g=push; git $g" can't slip past a pattern).
parts=$(printf '%s\n' "$cmd" | sed -E 's/(\|\||&&|[;|])/\n/g' | tr -d "\"'\\\\" | tr -s ' \t' ' ' |
  sed -E 's/^ //; s/ $//' | grep -v '^$' || true)

needs_ok=false
if [ "${OPSSWIPE_GATE_MODE:-allow}" = deny ]; then
  grep -Eiq -- "$GATE" <<<"$parts" && needs_ok=true
else
  # Every part must be read-only. Command substitution, backgrounding or redirection means approval.
  # shellcheck disable=SC2016 # a literal $( to look for
  if grep -q '[`&<>]\|\$(' <<<"$cmd"; then needs_ok=true
  else
    while IFS= read -r part; do
      grep -Eq -- "$ALLOW" <<<"$part" || { needs_ok=true; break; }
    done <<<"$parts"
  fi
fi
$needs_ok || exit 0

[ -n "${OPSSWIPE_AGENT_TOKEN:-}" ] || block "OPSSWIPE_AGENT_TOKEN is not set (OpsSwipe: Settings -> Agent access)"
auth=(-H "Authorization: Bearer $OPSSWIPE_AGENT_TOKEN")

body=$(jq -n --arg c "$cmd" --arg d "$PWD" '{command: $c, title: "Claude Code wants to run a command", reason: ("In " + $d + ". Approve to let it run.")}')
id=$(curl -fsS "${auth[@]}" -H 'content-type: application/json' -d "$body" "$URL" | jq -er .id) ||
  block "OpsSwipe approval is unavailable"

for _ in $(seq 200); do # ~10 minutes
  status=$(curl -fsS "${auth[@]}" "$URL?id=$id" | jq -r .status 2>/dev/null) || status=pending
  case "$status" in
    approved) exit 0 ;;
    declined) echo "The human declined this command on their phone (OpsSwipe). Don't retry it; ask them what to do instead." >&2; exit 2 ;;
  esac
  sleep 3
done
block "no answer on OpsSwipe within 10 minutes"
