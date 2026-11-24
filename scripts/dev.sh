#!/usr/bin/env bash
# Start the API (8420) and web (3420) locally. Uses backend/.env; SQLite if DATABASE_URL is unset.
set -euo pipefail
cd "$(dirname "$0")/.."
LOGS="${OMH_LOG_DIR:-./.runtime}"; mkdir -p "$LOGS"
(cd backend && uv run alembic upgrade head && uv run uvicorn app.main:app --host 127.0.0.1 --port 8420 >"../$LOGS/api.log" 2>&1) &
(cd frontend && npm run dev >"../$LOGS/web.log" 2>&1) &
echo "API  http://127.0.0.1:8420/api/docs"
echo "Web  http://127.0.0.1:3420"
wait
