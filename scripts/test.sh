#!/usr/bin/env bash
# All tests. Set TEST_DATABASE_URL (and OMH_MIGRATION_TEST_URL) to run against PostgreSQL.
set -euo pipefail
cd "$(dirname "$0")/.."
(cd backend && uv run ruff check app tests && uv run pytest -o addopts="")
(cd frontend && npm run lint && npm test)
if [[ "${E2E:-0}" == "1" ]]; then (cd frontend && npx playwright test); fi
