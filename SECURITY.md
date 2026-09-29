# Security

OpsSwipe can restart services, reboot machines and merge code, so security reports are the most welcome issues we get.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead: **Security → Report a vulnerability** on
this repository. Include what you found, how to reproduce it and what an attacker could do. You'll get an answer within
three days.

## How OpsSwipe is built to be safe

The full model is in the README under [Security model](README.md#security-model). In short:

- The phone sends only an incident id and a fix name; the server decides what may run, from validated config.
- Every fix needs the phone's fingerprint or screen lock; nothing reaches production without a person approving it.
- Cloud keys and tokens live in Supabase Vault, are read only by server code and never reach the phone.
- Row-level security keeps each account's data to itself; teammates see incidents, never services or keys.
- Each Google Cloud VM gets a custom role that can only read its status and reset it.
- AI output is checked by code before use; prompts treat request data as data, never instructions.
- Code fixes merge only after CI replays the real failing requests. The PR's own code runs in Docker and can't reach the
  token that signs the proof, which is bound to the exact commit OpsSwipe opened.
- Failing requests are scrubbed and replayed only in CI, never against production.

## Supported versions

Only the latest `main` is supported.
