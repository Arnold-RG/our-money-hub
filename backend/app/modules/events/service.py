from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import EventOutbox, now, uid


def emit(db: Session, *, workspace_id: str, event_type: str, data: dict, dedupe_key: str | None = None) -> bool:
    """Write a versioned event to the outbox (transactional outbox pattern).

    Returns False if an event with the same dedupe key already exists.
    """
    if dedupe_key and db.scalar(select(EventOutbox.id).where(EventOutbox.dedupe_key == dedupe_key)):
        return False
    ev = EventOutbox(id=uid(), workspace_id=workspace_id, event_type=event_type, dedupe_key=dedupe_key,
                     occurred_at=now(), payload={})
    # Full master-spec §10 envelope stored as the payload that will be signed and delivered.
    ev.payload = {"schema_version": "1.0", "event_id": ev.id, "event_type": event_type, "source": "omh",
                  "organization_id": "arnovagroup", "project_id": data.get("project_id"),
                  "occurred_at": ev.occurred_at.isoformat().replace("+00:00", "Z"), "data": data}
    db.add(ev)
    return True
