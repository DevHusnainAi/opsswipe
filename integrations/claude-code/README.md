# OpsSwipe gate for Claude Code

Risky commands Claude Code wants to run (force-push, `db reset`, `terraform apply`, …) wait for your
approval on your phone. Everything else runs as usual.

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

Needs `curl` and `jq`. Change which commands need approval with `OPSSWIPE_GATE` (an extended regex).
Approve with a swipe and your fingerprint and the command runs; decline and Claude is told not to retry.
