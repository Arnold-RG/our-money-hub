"""Our Money Hub v2 API. Created by Arnold Rurangwa / Arnova Group."""
from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1 import auth, finance, insight, planning
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
                   allow_credentials=True, allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def guard(request: Request, call_next):
    # CSRF defence in depth: cookie-authenticated writes must come from our own frontend (custom header).
    if request.method in {"POST", "PUT", "PATCH", "DELETE"} and request.url.path.startswith("/api/v1/") \
            and request.url.path != "/api/v1/events" and request.cookies.get("omh_session") \
            and request.headers.get("x-omh-client") != "web":
        return JSONResponse({"detail": "Missing client header"}, status_code=403)
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


for r in (auth.router, finance.router, planning.router, insight.router):
    app.include_router(r, prefix="/api/v1")
