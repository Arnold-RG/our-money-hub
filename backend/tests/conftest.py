import os
import tempfile

_tmp = tempfile.mkdtemp(prefix="omh-test-")
os.environ.setdefault("DATABASE_URL", os.environ.get("TEST_DATABASE_URL", f"sqlite:///{_tmp}/test.sqlite3"))
os.environ.setdefault("OMH_SECRET_KEY", "test-only-secret-not-used-anywhere-else")
os.environ["APP_ENV"] = "test"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from app.database import models  # noqa: E402,F401
from app.database.session import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402


@pytest.fixture(autouse=True)
def fresh_db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    from app.api.v1 import auth

    auth._attempts.clear()
    yield


@pytest.fixture
def db():
    s = SessionLocal()
    yield s
    s.close()


class Api:
    def __init__(self, client: TestClient, ws: str | None = None):
        self.c, self.ws = client, ws

    def _h(self):
        h = {"X-OMH-Client": "web"}
        if self.ws:
            h["X-Workspace-Id"] = self.ws
        return h

    def get(self, url, **kw):
        return self.c.get("/api/v1" + url, headers=self._h(), **kw)

    def post(self, url, json=None, **kw):
        return self.c.post("/api/v1" + url, json=json, headers=self._h(), **kw)

    def patch(self, url, json=None):
        return self.c.patch("/api/v1" + url, json=json, headers=self._h())

    def delete(self, url):
        return self.c.delete("/api/v1" + url, headers=self._h())


def register(email="owner@example.com", name="Owner") -> tuple[Api, dict]:
    c = TestClient(app)
    r = c.post("/api/v1/auth/register", json={"email": email, "password": "correct-horse-battery", "display_name": name},
               headers={"X-OMH-Client": "web"})
    assert r.status_code == 200, r.text
    me = r.json()
    personal = next(w for w in me["workspaces"] if w["kind"] == "personal")
    return Api(c, personal["id"]), me


@pytest.fixture
def api():
    a, _ = register()
    return a


def cat_id(api: Api, name: str, direction: str = "expense") -> str:
    return next(c["id"] for c in api.get("/categories").json() if c["name"] == name and c["direction"] == direction)


def add_rate(api: Api, base, quote, rate, on="2026-11-01"):
    r = api.post("/exchange-rates", {"base": base, "quote": quote, "rate": rate, "effective_date": on})
    assert r.status_code == 201, r.text
