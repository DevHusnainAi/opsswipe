# Security Policy

OpsSwipe can restart services, reboot machines and merge code, so security reports are the most welcome issues we
receive.

## Supported versions

| Version | Supported |
| --- | --- |
| Latest `main` | Yes |
| Anything older | No |

## Reporting a vulnerability

Please **do not open a public issue, discussion or pull request** for a security problem.

Report it privately through GitHub: **Security → Report a vulnerability** on this repository
([private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)).
Please include:

- what you found and where (file, endpoint or screen),
- the steps to reproduce it,
- what an attacker could do with it,
- any suggested fix.

## What to expect

| Step | Timeline |
| --- | --- |
| Acknowledgement of your report | within 3 days |
| An assessment and a planned fix | within 7 days |
| A fix released for a confirmed issue | as soon as possible, usually within 30 days |
| Public disclosure | coordinated with you after the fix is released |

We credit reporters in the release notes unless you ask us not to. Please give us a reasonable time to fix an issue
before sharing it, and don't access other people's data or disrupt the hosted service while testing.

## How OpsSwipe is built to be safe

The threat model is in the README under [Security](README.md#security); the reasoning, including an independent
line-by-line audit and how each finding was fixed at its root, is in [docs/DECISIONS.md](docs/DECISIONS.md) (#34, #35).
In short:

- **The server decides what runs.** The phone sends only an incident id and a fix name; allowed fixes come from
  validated configuration.
- **A fix needs the fingerprint, checked by the server.** The phone's fix key lives in its secure hardware and is
  released only after the fingerprint; enrolling a new key needs a fresh sign-in. The session is stored in secure
  storage, and sign-in uses PKCE.
- **Keys stay on the server.** Credentials live in Supabase Vault and are read only by server code. Google Cloud access
  is a custom reset-only role on the VMs you add, re-checked against your own account before every reset and removed
  when you disconnect.
- **Connections finish on the phone that approved them**, for the account that started them (a one-time claim).
- **Row-level security** isolates every account; a SQL test proves client writes are refused even with full grants.
- **Code fixes merge only after a proof OpsSwipe grades itself:** CI replays the real failing requests with the PR's
  code in locked-down containers, the proof is OIDC-signed and bound to the exact commit, and each request must go
  from 5xx to 2xx.
- **No probing inside networks:** service URLs must be public and are re-checked after DNS resolution.
- **AI output is checked by code** before use; prompts treat request data as data, never as instructions.
- **Agents only propose.** The Claude Code hook is default-deny and fails closed.

## Known limitations

- DNS rebinding between the address check and the probe is not yet closed (on the roadmap).
- Phones without a fingerprint sensor can't approve fixes; fix keys can't yet be revoked per phone.
