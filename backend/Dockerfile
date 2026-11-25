# Our Money Hub API. Created by Arnold Rurangwa / Arnova Group.
FROM python:3.12-slim AS base
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
WORKDIR /app
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY alembic.ini ./
COPY migrations ./migrations
COPY app ./app
RUN useradd --system --uid 10001 omh && chown -R omh /app
USER omh
ENV PATH="/app/.venv/bin:$PATH"
EXPOSE 8420
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import os,urllib.request,sys;p=os.environ.get('PORT','8420');sys.exit(0 if urllib.request.urlopen(f'http://127.0.0.1:{p}/api/health').status==200 else 1)"
# Render sets PORT and terminates TLS. Trust the platform proxy hop only.
CMD ["sh", "-c", "DATABASE_URL=\"${MIGRATE_DATABASE_URL:-$DATABASE_URL}\" alembic upgrade head && exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8420} --proxy-headers --forwarded-allow-ips='*'"]
