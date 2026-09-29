#!/usr/bin/env bash
# shellcheck disable=SC2016 # the commands below are data for the gate, not for this shell
# Checks the gate fails closed and can't be dodged. A fake curl stands in for OpsSwipe and declines.
# Run: bash integrations/claude-code/gate.test.sh
set -u
here=$(cd "$(dirname "$0")" && pwd)
gate="$here/opsswipe-gate.sh"
fake=$(mktemp -d)
trap 'rm -rf "$fake"' EXIT
printf '#!/bin/sh\ncase "$*" in *id=*) echo "{\\"status\\":\\"declined\\"}";; *) echo "{\\"id\\":\\"x\\"}";; esac\n' >"$fake/curl"
chmod +x "$fake/curl"
fails=0

run() { # expected-exit, description, command, [env...]
  local want=$1 what=$2 cmd=$3; shift 3
  local json; json=$(jq -n --arg c "$cmd" '{tool_input: {command: $c}}')
  env PATH="$fake:$PATH" OPSSWIPE_AGENT_TOKEN=ops_test "$@" bash "$gate" <<<"$json" >/dev/null 2>&1
  local got=$?
  if [ "$got" != "$want" ]; then echo "FAIL ($got, wanted $want): $what"; fails=$((fails + 1)); else echo "ok: $what"; fi
}

run 0 'read-only command runs' 'git status'
run 0 'read-only pipeline runs' 'git log --oneline | head -5'
run 2 'anything else waits (declined here)' 'npm install left-pad'
run 2 'force push with +refspec' 'git push origin +main'
run 2 'reversed rm flags' 'rm -fr /etc'
run 2 'double space' 'kubectl  delete pod x'
run 2 'newline split' $'ls\nrm -rf x'
run 2 'variable indirection' 'g=push; git $g --force'
run 2 'command substitution' 'ls $(rm -rf x)'
run 2 'redirect writes a file' 'echo x > ~/.bashrc'
run 2 'deny mode still catches +refspec' 'git push origin +main' OPSSWIPE_GATE_MODE=deny
run 0 'deny mode lets ordinary commands run' 'npm install left-pad' OPSSWIPE_GATE_MODE=deny
run 2 'no token blocks' 'npm install x' OPSSWIPE_AGENT_TOKEN=
json=$(jq -n '{tool_input: {command: "npm install x"}}')
env PATH="/usr/bin/nonexistent" /bin/bash "$gate" <<<"$json" >/dev/null 2>&1
if [ $? = 2 ]; then echo 'ok: no jq/curl blocks'; else echo 'FAIL: no jq/curl blocks'; fails=$((fails + 1)); fi
env PATH="$fake:$PATH" OPSSWIPE_AGENT_TOKEN=x bash "$gate" <<<'not json' >/dev/null 2>&1
if [ $? = 2 ]; then echo 'ok: bad input blocks'; else echo 'FAIL: bad input blocks'; fails=$((fails + 1)); fi

[ "$fails" = 0 ] || exit 1
