# Arnova ecosystem integration

The shared contract lives in `ecosystem-contracts/` (outside this repo); copies used by the tests are in `backend/tests/contracts/`.

## Authentication (all service calls)
Headers: `X-Arnova-Key-Id`, `X-Arnova-Timestamp` (Unix seconds, ±300 s) and `X-Arnova-Signature: sha256=hex(HMAC-SHA256(secret, "<timestamp>.<raw body>"))`.
Keys sit in a JSON keyring (`ECOSYSTEM_KEYRING_FILE`, outside the repo). Each key has a `service`, `scopes` and an optional `not_before` / `not_after`, so keys can rotate without downtime.

| Route | Scope | Notes |
|---|---|---|
| `POST /api/v1/budget-reservations` | `budget:reserve` | body = `budget-reservation-request.schema.json` (flat; extra fields → 422); key service must be `ragi` |
| `POST /api/v1/budget-reservations/{id}/settle` | `budget:reserve` | `{actual_cost: Money, provider, model?, input_tokens?, output_tokens?}` |
| `POST /api/v1/budget-reservations/{id}/release` | `budget:reserve` | empty body (sign `b""`) |
| `POST /api/v1/events` | `events:write` | §10 envelope; `source` must equal the key's service; duplicates are acknowledged |
| `GET /api/v1/finance-summary?organization_id=` | `finance:read` | per currency, never summed; sign the empty body |

Responses: 201 with `status: "active"` means granted. 409 `{detail}` means denied (no AI budget, not enough available, or a missing or stale rate). 401 means authentication failed, 403 a scope or source mismatch, and 503 that `OMH_RAGI_WORKSPACE_ID` is not set.

The OMH workspace that RAGI's organization maps to is configured by `OMH_RAGI_WORKSPACE_ID` and `OMH_RAGI_ORGANIZATION_ID`. The general mapping is still an open owner decision.

Outgoing events (`budget.exceeded`, `budget.reservation.*` and others) are written to a transactional outbox with the full §10 envelope. A delivery worker is not built yet.
