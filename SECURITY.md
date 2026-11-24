# Security

Our Money Hub holds private financial records. These controls are in the code today:

- **Accounts:** Argon2id password hashing, with a dummy hash so timing does not reveal which emails exist. Lockout after 5 failed attempts for 15 minutes.
- **Two-step sign-in:** optional TOTP. Secrets are encrypted at rest (Fernet), attempts are limited and a code cannot be replayed.
- **Sessions:** opaque, server-side and revocable (only a SHA-256 of the token is stored), delivered as an HttpOnly SameSite cookie. Sign-out revokes the session.
- **CSRF:** state-changing browser requests must carry the `X-OMH-Client` header, which other sites cannot set cross-origin.
- **Registration:** closed by default (`ALLOW_REGISTRATION=false`). The owner account can be created once, on a database with no real users, and only with the one-time `OMH_OWNER_SETUP_TOKEN` from the environment. With no token set, nobody can register.
- **Demo login:** off by default and honoured only in development. Each visitor gets a private, empty workspace.
- **Isolation:** every query is scoped to a workspace the user belongs to, and non-members get 404. Manual exchange rates apply to one workspace only.
- **Ledger integrity:** in PostgreSQL, a deferred trigger checks that every journal entry balances, and append-only triggers protect journal lines and the audit log. Posted transactions cannot be deleted.
- **Service-to-service calls:** per-service rotating HMAC keys with scopes, a ±300 s timestamp window and constant-time comparison (see `docs/ECOSYSTEM.md`). Keys live in a keyring file outside the repository.
- **Headers:** CSP, `X-Frame-Options: DENY`, `nosniff`, a strict referrer policy and a permissions policy.
- **CSV:** cells that would start a spreadsheet formula are neutralised on export.
- **Config:** outside development, the API refuses to start without `OMH_SECRET_KEY` or without PostgreSQL.

Known limits: SQLite (local fallback) cannot row-lock, so concurrent reservation safety needs PostgreSQL. There is no OIDC yet.

To report a problem, contact Arnold Rurangwa / Arnova Group privately rather than opening a public issue.
