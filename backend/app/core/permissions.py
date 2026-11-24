from __future__ import annotations

from fastapi import Depends, Header, HTTPException, Query, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import COOKIE_NAME, load_session
from app.database.models import User, WorkspaceMember
from app.database.session import get_db

ROLE_RANK = {"viewer": 0, "editor": 1, "owner": 2}


def current_user(request: Request, db: Session = Depends(get_db)) -> User:
    token = request.cookies.get(COOKIE_NAME)
    auth = request.headers.get("authorization", "")
    if not token and auth.lower().startswith("bearer "):
        token = auth[7:]
    sess = load_session(db, token)
    user = db.get(User, sess.user_id) if sess else None
    if not user:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Not signed in")
    return user


class WorkspaceAccess:
    def __init__(self, min_role: str = "viewer"):
        self.min_role = min_role

    def __call__(
        self,
        x_workspace_id: str | None = Header(default=None, alias="X-Workspace-Id"),
        ws: str | None = Query(default=None, description="Workspace id for plain links (e.g. CSV download)"),
        user: User = Depends(current_user),
        db: Session = Depends(get_db),
    ) -> WorkspaceContext:
        x_workspace_id = x_workspace_id or ws
        if not x_workspace_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "Choose a workspace")
        m = db.scalar(
            select(WorkspaceMember).where(
                WorkspaceMember.workspace_id == x_workspace_id, WorkspaceMember.user_id == user.id
            )
        )
        # Same 404 for "does not exist" and "not yours" so ids can't be probed.
        if not m:
            raise HTTPException(status.HTTP_404_NOT_FOUND, "Workspace not found")
        if ROLE_RANK[m.role] < ROLE_RANK[self.min_role]:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "Your role cannot make this change")
        return WorkspaceContext(workspace_id=x_workspace_id, user=user, role=m.role)


class WorkspaceContext:
    def __init__(self, workspace_id: str, user: User, role: str):
        self.workspace_id = workspace_id
        self.user = user
        self.role = role


read_ws = WorkspaceAccess("viewer")
write_ws = WorkspaceAccess("editor")
