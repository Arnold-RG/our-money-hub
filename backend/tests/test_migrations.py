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
