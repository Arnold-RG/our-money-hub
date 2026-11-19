# Our Money Hub

**Household budgeting and shared-finance web application** · [GitHub repository](https://github.com/Arnold-RG/our-money-hub)

## What this project does

Shared budgeting and household finance browser application. Its React frontend is built with Vite; private financial information and access control deserve a higher security bar than a simple marketing website.

**Primary stack:** React 19, Vite, JavaScript, React Router.

> **Project verification:** This README describes observed source structure and release expectations. Not every feature, dependency or target device has been certified. Consult actual CI results and source before making public claims.

## Repository architecture

| File or directory | Purpose |
| --- | --- |
| `client/` | Web application and Vite configuration |
| `assets/` | Repository assets |
| `package.json` | Node scripts and dependencies |
| `package-lock.json` | Reproducible dependency tree |

## Local development

Install Git and the required language runtime. Use a clean environment and review configuration files for secrets before starting network services.

```sh
npm ci
npm run dev
# Open the local address shown by Vite
npm run build
```

**Environment note:** npm run dev starts the local Vite frontend. Do not assume there is secure user login or production persistence until those features are audited.

## User experience and core requirements

- Keep separate member views, accurate balances and explainable transactions.
- Handle empty states, editing, validation and multi-device expectations explicitly.
- Never confuse browser-local state with securely synchronized shared data.

Build for real customer journeys: clear navigation, accessible controls, responsive layouts, truthful claims, human-readable errors and meaningful loading/empty states.

## Security, data and privacy

- Require genuine server-side authorization before storing or sharing private household data.
- Avoid placing bank credentials, financial records or API keys in repository or client bundles.
- Design audit logs, backup/restore and data deletion/retention policies before real shared use.

Review secrets, trust boundaries, external services and permission handling. Use scoped credentials, a private disclosure channel (see `SECURITY.md` if present), and secure dependency updates.

## Quality and operations

| Area | Release acceptance criterion |
| --- | --- |
| Implementation | Maintainable code, clear ownership, documented configuration |
| Testing | Actual unit/integration checks or a documented repeatable smoke test |
| Security | Input and dependency checks, least privilege and no exposed credentials |
| Accessibility | Keyboard, contrast, touch and responsive testing for user-facing screens |
| CI/CD | Reproducible builds, protected release jobs, owner-approved publication |
| Reliability | Error monitoring; backups/recovery for persisted data; rollback plan |

**These are intended gates, not an assertion of passing tests.** Kubernetes is unnecessary for purely static pages; reassess it only where multi-service infrastructure warrants the complexity.

## Contributions and release policy

Use reviewable branches and pull requests. Don't add unlicensed visual assets, mock client testimonials, private customer data or unverified integrations. Owners approve public releases; note remaining limitations in the release report.
