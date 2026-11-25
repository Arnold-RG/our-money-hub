"""Our Money Hub v2 API. Created by Arnold Rurangwa / Arnova Group."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import auth, finance, insight, planning, personal
from app.core.config import get_settings
from app.core.money import MoneyError
from app.modules.ledger.service import LedgerError

settings = get_settings()


@asynccontextmanager
async def lifespan(_: FastAPI):
    task = None
    if settings.rates_auto_sync:
        task = asyncio.create_task(_rates_loop())
    yield
    if task:
        task.cancel()


async def _rates_loop():
    """Refresh official NBP/ECB/BNR reference rates every 6 hours (stand-in for the planned Celery beat job)."""
    from app.database.session import SessionLocal
    from app.modules.currencies.service import sync_all

    while True:
        def run():
            db = SessionLocal()
            try:
                sync_all(db)
                db.commit()
            finally:
                db.close()

        try:
            await asyncio.to_thread(run)
        except Exception:  # noqa: BLE001 - keep the loop alive; failures surface as stale-rate signals
            pass
        await asyncio.sleep(6 * 3600)


app = FastAPI(lifespan=lifespan, title="Our Money Hub API", version="2.0.0",
              description="Financial engine of Arnova Group — created by Arnold Rurangwa / Arnova Group.",
              docs_url="/api/docs", openapi_url="/api/openapi.json")
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()],
                   allow_credentials=True,
                   allow_methods=["GET", "POST", "PATCH", "PUT", "DELETE"],
                   allow_headers=["Content-Type", "X-OMH-Client", "X-Workspace-Id"])


def _origin_of(url: str) -> str | None:
    from urllib.parse import urlparse
    p = urlparse(url)
    if p.scheme and p.netloc:
        return f"{p.scheme}://{p.netloc}"
    return None


def _allowed_origins() -> set[str]:
    s = get_settings()
    out = set()
    for raw in [s.public_base_url, *([o.strip() for o in s.cors_origins.split(",") if o.strip()])]:
        origin = _origin_of(raw)
        if origin:
            out.add(origin)
    return out


@app.middleware("http")
async def guard(request: Request, call_next):
    # CSRF: custom header on every non-safe /api/v1 write, including login/register.
    # OAuth callbacks and the HMAC events endpoint are exempt.
    path = request.url.path
    unsafe = request.method in {"POST", "PUT", "PATCH", "DELETE"}
    signed = bool(request.headers.get("x-arnova-key-id"))
    service = path == "/api/v1/events" or path.startswith("/api/v1/budget-reservations") or path.startswith("/api/v1/finance-summary")
    exempt = service or signed or ("/oauth/" in path and path.endswith("/callback"))
    if unsafe and path.startswith("/api/v1/") and not exempt:
        if request.headers.get("x-omh-client") != "web":
            return JSONResponse({"detail": "Missing client header"}, status_code=403)
        origin = request.headers.get("origin")
        if not origin:
            referer = request.headers.get("referer")
            origin = _origin_of(referer) if referer else None
        else:
            origin = _origin_of(origin)
        if not origin or origin not in _allowed_origins():
            return JSONResponse({"detail": "Invalid request origin"}, status_code=403)
    resp = await call_next(request)
    resp.headers["X-Content-Type-Options"] = "nosniff"
    resp.headers["X-Frame-Options"] = "DENY"
    resp.headers["Referrer-Policy"] = "same-origin"
    resp.headers["Cache-Control"] = "no-store"
    return resp


@app.exception_handler(MoneyError)
async def money_error(_: Request, exc: MoneyError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.exception_handler(LedgerError)
async def ledger_error(_: Request, exc: LedgerError):
    return JSONResponse({"detail": str(exc)}, status_code=422)


@app.get("/api/health")
def health():
    return {"status": "ok", "app": "Our Money Hub", "version": "2.0.0",
            "database": "sqlite" if settings.is_sqlite else "postgresql"}


for r in (auth.router, finance.router, planning.router, insight.router, personal.router):
    app.include_router(r, prefix="/api/v1")
