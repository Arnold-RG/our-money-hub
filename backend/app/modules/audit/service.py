from __future__ import annotations

from sqlalchemy.orm import Session

from app.database.models import AuditLog


def audit(db: Session, *, workspace_id: str | None, user_id: str | None, action: str, entity: str,
          entity_id: str | None = None, detail: dict | None = None) -> None:
    db.add(AuditLog(workspace_id=workspace_id, user_id=user_id, action=action, entity=entity,
                    entity_id=entity_id, detail=detail))
