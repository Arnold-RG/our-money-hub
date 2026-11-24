import os
import subprocess
import sys
import tempfile
from pathlib import Path


def test_alembic_upgrade_on_fresh_sqlite():
    d = tempfile.mkdtemp()
    env = {**os.environ, "DATABASE_URL": f"sqlite:///{d}/m.sqlite3"}
    root = Path(__file__).resolve().parents[1]
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, env=env, capture_output=True,
                       text=True)
    assert r.returncode == 0, r.stderr
    r = subprocess.run([sys.executable, "-m", "alembic", "check"], cwd=root, env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stdout + r.stderr  # models and migrations agree


import pytest  # noqa: E402

PG_URL = os.environ.get("OMH_MIGRATION_TEST_URL")  # e.g. postgresql+psycopg://omh@127.0.0.1:5433/omh_migr


@pytest.mark.skipif(not PG_URL, reason="set OMH_MIGRATION_TEST_URL to an empty Postgres database")
def test_postgres_triggers_enforce_balance_and_append_only():
    from sqlalchemy import create_engine, text

    root = Path(__file__).resolve().parents[1]
    env = {**os.environ, "DATABASE_URL": PG_URL}
    eng = create_engine(PG_URL)
    with eng.begin() as c:
        c.execute(text("DROP SCHEMA public CASCADE; CREATE SCHEMA public;"))
    r = subprocess.run([sys.executable, "-m", "alembic", "upgrade", "head"], cwd=root, env=env, capture_output=True,
                       text=True)
    assert r.returncode == 0, r.stderr
    seed = """
      INSERT INTO financial_workspaces (id, name, kind, base_currency, created_at) VALUES ('w','W','personal','PLN', now());
      INSERT INTO ledger_accounts (id, workspace_id, code, name, type) VALUES ('a','w','a','A','asset'),('b','w','b','B','equity');
      INSERT INTO journal_entries (id, workspace_id, entry_date, memo, status, created_at)
        VALUES ('e','w','2026-11-24','m','confirmed', now());
    """
    with pytest.raises(Exception, match="does not balance"):
        with eng.begin() as c:
            c.execute(text(seed))
            c.execute(text("INSERT INTO journal_entry_lines (id, entry_id, ledger_account_id, currency, debit_minor, "
                           "credit_minor) VALUES ('l1','e','a','PLN',100,0),('l2','e','b','PLN',0,99)"))
    with eng.begin() as c:
        c.execute(text(seed))
        c.execute(text("INSERT INTO journal_entry_lines (id, entry_id, ledger_account_id, currency, debit_minor, "
                       "credit_minor) VALUES ('l1','e','a','PLN',100,0),('l2','e','b','PLN',0,100)"))
    with pytest.raises(Exception, match="append-only"):
        with eng.begin() as c:
            c.execute(text("UPDATE journal_entry_lines SET debit_minor = 5 WHERE id = 'l1'"))
    with pytest.raises(Exception, match="append-only"):
        with eng.begin() as c:
            c.execute(text("DELETE FROM journal_entries WHERE id = 'e'"))
    eng.dispose()
