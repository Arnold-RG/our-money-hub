#!/usr/bin/env bash
# Fetch official rates once (NBP tables A/B, ECB, BNR) into the database in backend/.env.
set -euo pipefail
cd "$(dirname "$0")/../backend"
uv run python - <<'PY'
from app.database.session import SessionLocal
from app.modules.currencies.service import sync_all
with SessionLocal() as db:
    res = sync_all(db)
    db.commit()
    print(f"stored {len(res['stored'])} rates; errors: {res['errors'] or 'none'}")
PY
