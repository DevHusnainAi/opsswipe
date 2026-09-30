# OpsSwipe gate for Claude Code

Shell commands Claude Code wants to run wait for your approval on your phone, except read-only ones (`ls`, `cat`,
`grep`, `git status/diff/log`, tests, lint…), which run as usual. Default-deny on purpose: a list of "dangerous"
shell strings can always be dodged (`git push origin +main`, `rm -fr`, a variable holding the verb), so the safe
list is the short one.

1. In OpsSwipe: **Settings → Agent access → New agent token**, name it "Claude Code". Copy the `ops_…` token.
2. `export OPSSWIPE_AGENT_TOKEN=ops_…` in your shell profile.
3. Add the hook to `.claude/settings.json` (this project) or `~/.claude/settings.json` (everywhere):

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Bash",
        "hooks": [{ "type": "command", "command": "/path/to/opsswipe-gate.sh", "timeout": 660 }]
      }
    ]
  }
}
```

Needs `curl` and `jq`; without them, or without the token, every gated command is blocked (the hook fails closed).
`OPSSWIPE_ALLOW` changes the read-only list (an extended regex). `OPSSWIPE_GATE_MODE=deny` switches to gating only
commands matching `OPSSWIPE_GATE`: convenient, but best-effort. `gate.test.sh` checks both modes.
Approve with a swipe and your fingerprint and the command runs; decline and Claude is told not to retry.
