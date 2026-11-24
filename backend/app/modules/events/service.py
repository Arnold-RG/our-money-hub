from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import EventOutbox


def emit(db: Session, *, workspace_id: str, event_type: str, data: dict, dedupe_key: str | None = None) -> bool:
    """Write a versioned event to the outbox (transactional outbox pattern).

    Returns False if an event with the same dedupe key already exists.
    """
    if dedupe_key and db.scalar(select(EventOutbox.id).where(EventOutbox.dedupe_key == dedupe_key)):
        return False
    db.add(EventOutbox(workspace_id=workspace_id, event_type=event_type,
                       payload={"source": "omh", "organization_id": "arnovagroup", "data": data},
                       dedupe_key=dedupe_key))
    return True
