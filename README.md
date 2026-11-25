# Our Money Hub

**Everything you earn, spend, budget and subscribe to.** The financial engine of the Arnova ecosystem.

Created by Arnold Rurangwa / Arnova Group.

## What it does today

- **Multi-currency ledger** for PLN (default), RWF, EUR, USD and GBP. Money is stored in integer minor units, every entry is double-entry balanced per currency, and posted history is append-only. Corrections are reversals, never edits.
- **Official exchange rates** from NBP (tables A and B, which include RWF), ECB reference rates and the National Bank of Rwanda. Each rate keeps its source, publication date and URL. A stale or missing rate is refused rather than guessed, and the amount is shown as "not converted".
- **Accounts** for banks, cards, cash, MTN MoMo / Airtel Money wallets, ikimina shares, Ejo Heza, savings, investments, PPK, IKE and IKZE.
- **Payments**: income, expenses, cross-currency transfers (the difference posts to FX clearing), pending status, CSV import with preview and duplicate protection, and CSV export with spreadsheet formulas neutralised.
- **Budgets**: available = limit − spent − reserved, alert thresholds and hard limits.
- **AI spend guard**: agents reserve budget before a run and settle with the real cost afterwards. The check and the reservation run in one locked transaction and fail closed when a rate is missing.
- **Subscriptions**: exact monthly and yearly equivalents, renewal radar, possible duplicates, client plans counted as recurring revenue, and payments recorded once per renewal.
- **Reports**: Money Pulse (balance plus a 90-day forecast with renewal markers), Hub Signals, cash flow, categories, an optional 50/30/20 check and the 2026 IKE/IKZE allowance.
- **Personal and Business workspaces**, kept fully separate.
- **Security**: Argon2id passwords, revocable server-side sessions, lockout, TOTP two-step sign-in, an audit log and registration closed by default.

## Run it locally

```bash
cp .env.example backend/.env      # fill OMH_SECRET_KEY; leave DATABASE_URL empty to use SQLite
cd backend && uv sync && uv run alembic upgrade head && uv run uvicorn app.main:app --port 8420
cd frontend && npm ci && npm run dev            # http://127.0.0.1:3420
```

Or run `scripts/dev.sh` to start both. With Docker, run `docker compose up --build` after setting `OMH_DB_PASSWORD` and `OMH_SECRET_KEY` in `.env`.

| Service | Port |
|---|---|
| Web (Next.js) | 3420 |
| API (FastAPI, docs at `/api/docs`) | 8420 |
| PostgreSQL (local dev cluster) | 5433 |

## Tests

```bash
scripts/test.sh                       # ruff + pytest + tsc + vitest
E2E=1 scripts/test.sh                 # plus the Playwright walkthrough (needs web + API running)
TEST_DATABASE_URL=postgresql+psycopg://… scripts/test.sh   # run against PostgreSQL, incl. trigger tests
```

The Playwright walkthrough saves screenshots at 1440×900 and 390×844 into `screenshots/`. Entries it creates are labelled "Test …".

## Stack

Next.js 16, React 19, TypeScript, Tailwind CSS 4, Motion, Recharts · FastAPI, SQLAlchemy 2, Alembic, PostgreSQL · Pytest, Vitest, Playwright.

More: [docs/FINANCIAL_ENGINE.md](docs/FINANCIAL_ENGINE.md) · [docs/ECOSYSTEM.md](docs/ECOSYSTEM.md) · [SECURITY.md](SECURITY.md)
