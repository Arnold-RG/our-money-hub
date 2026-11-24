from __future__ import annotations

import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.database.models import FinancialWorkspace, LedgerAccount, TransactionCategory, User, WorkspaceMember

# Structure only (no amounts): sensible starter categories the owner can rename.
# Third item = optional 50/30/20 bucket (needs / wants / savings), editable by the owner.
DEFAULT_CATEGORIES: dict[str, list[tuple[str, str, str | None]]] = {
    "income": [("Salary", "briefcase", None), ("Client work", "handshake", None),
               ("Subscriptions revenue", "repeat", None), ("Family benefit (800+)", "baby", None),
               ("Other income", "plus", None)],
    "expense": [("Housing & utilities", "home", "needs"), ("Food & groceries", "shopping-basket", "needs"),
                ("Transport", "bus", "needs"), ("Health", "heart-pulse", "needs"), ("Education", "graduation-cap", "needs"),
                ("Fees & taxes", "landmark", "needs"), ("AI & APIs", "sparkles", "wants"),
                ("Hosting & domains", "server", "wants"), ("Software", "app-window", "wants"),
                ("Media & streaming", "tv", "wants"), ("Eating out", "utensils", "wants"),
                ("Family & gifts", "gift", "wants"), ("Savings & ikimina", "piggy-bank", "savings"),
                ("Other expenses", "circle", None)],
}


def create_category(db: Session, ws_id: str, name: str, direction: str, icon: str | None = None,
                    bucket: str | None = None) -> TransactionCategory:
    la = LedgerAccount(workspace_id=ws_id, code=f"{direction}:{uuid.uuid4().hex[:12]}", name=name,
                       type="income" if direction == "income" else "expense")
    db.add(la)
    db.flush()
    cat = TransactionCategory(workspace_id=ws_id, name=name, direction=direction, icon=icon, bucket=bucket,
                              ledger_account_id=la.id)
    db.add(cat)
    db.flush()
    return cat


def create_workspace(db: Session, user: User, name: str, kind: str, base_currency: str = "PLN") -> FinancialWorkspace:
    ws = FinancialWorkspace(name=name, kind=kind, base_currency=base_currency)
    db.add(ws)
    db.flush()
    db.add(WorkspaceMember(workspace_id=ws.id, user_id=user.id, role="owner"))
    for direction, items in DEFAULT_CATEGORIES.items():
        for nm, icon, bucket in items:
            create_category(db, ws.id, nm, direction, icon, bucket)
    return ws


def bootstrap_user_workspaces(db: Session, user: User) -> None:
    create_workspace(db, user, "Personal", "personal", "PLN")
    create_workspace(db, user, "Business", "business", "PLN")


def user_workspaces(db: Session, user_id: str) -> list[tuple[FinancialWorkspace, str]]:
    rows = db.execute(select(FinancialWorkspace, WorkspaceMember.role)
                      .join(WorkspaceMember, WorkspaceMember.workspace_id == FinancialWorkspace.id)
                      .where(WorkspaceMember.user_id == user_id)
                      .order_by(FinancialWorkspace.created_at)).all()
    return [(w, r) for w, r in rows]
