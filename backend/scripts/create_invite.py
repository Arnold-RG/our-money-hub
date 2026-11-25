#!/usr/bin/env python3
"""Create a one-time Our Money Hub invite and write the link to a 0600 file (never email)."""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def main() -> int:
    p = argparse.ArgumentParser(description="Create a 72-hour, single-use OMH invite.")
    p.add_argument("--email", required=True)
    p.add_argument("--role", default="viewer", choices=["viewer", "editor"])
    p.add_argument("--workspace-id", required=True)
    p.add_argument("--created-by", default=None)
    p.add_argument("--out", required=True, help="Path to write the invite link (mode 0600)")
    args = p.parse_args()

    from app.core import invites
    from app.core.config import get_settings
    from app.database.session import SessionLocal

    out = Path(args.out)
    db = SessionLocal()
    try:
        raw = invites.issue(db, email=args.email, role=args.role,
                            workspace_id=args.workspace_id, created_by=args.created_by)
        db.commit()
    finally:
        db.close()
    base = get_settings().public_base_url.rstrip("/")
    url = f"{base}/invite#{raw}"
    out.parent.mkdir(parents=True, exist_ok=True)
    fd = os.open(out, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as f:
        f.write(url + "\n")
    os.chmod(out, 0o600)
    print(f"Invite written to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
