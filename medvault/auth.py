"""Auth: demo login, password login, server-side session tokens and role guards.

Sessions are rows in ``auth_sessions``; the browser gets an HttpOnly SameSite=Lax cookie and API
clients may send the same token as ``Authorization: Bearer``. SameSite=Lax is the CSRF defence:
cross-site POSTs never carry the cookie.
"""

from __future__ import annotations

from collections.abc import Callable, Iterator
from datetime import datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel
from sqlmodel import Session, select

from medvault.config import Settings
from medvault.models import AuthSession, Hospital, Patient, Role, StaffRole, User, utcnow
from medvault.security import hash_password, hash_token, new_session_token, verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
_DUMMY_HASH = hash_password("not-a-real-password")  # keeps bad-email and bad-password timing alike


# ---- dependencies ----------------------------------------------------------------------------


def get_settings_dep(request: Request) -> Settings:
    return request.app.state.settings


def get_session(request: Request) -> Iterator[Session]:
    with Session(request.app.state.engine) as session:
        yield session


def _token_from(request: Request, cookie_name: str) -> str | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        return header[7:].strip() or None
    return request.cookies.get(cookie_name)


def get_optional_user(
    request: Request,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> User | None:
    token = _token_from(request, settings.session_cookie_name)
    if not token:
        return None
    token_hash = hash_token(token, settings.secret_key)
    row = session.exec(select(AuthSession).where(AuthSession.token_hash == token_hash)).first()
    if row is None or row.revoked_at is not None or row.expires_at <= utcnow():
        return None
    user = session.get(User, row.user_id)
    if user is None or not user.is_active:
        return None
    request.state.auth_session = row
    return user


def get_current_user(user: User | None = Depends(get_optional_user)) -> User:
    if user is None:
        raise HTTPException(401, "Not signed in", headers={"WWW-Authenticate": "Bearer"})
    return user


def require_roles(*roles: Role) -> Callable[..., User]:
    """Server-side role guard. Usage: ``user: User = Depends(require_roles(Role.PATIENT))``."""

    def guard(user: User = Depends(get_current_user)) -> User:
        if user.role not in roles:
            raise HTTPException(403, f"Requires role: {', '.join(r.value for r in roles)}")
        return user

    return guard


def require_staff_roles(*staff_roles: StaffRole) -> Callable[..., User]:
    """Separation of duties: only these job titles, e.g. physicians but not billing clerks."""

    def guard(user: User = Depends(require_roles(Role.STAFF))) -> User:
        if user.staff_role not in staff_roles:
            allowed = ", ".join(r.value for r in staff_roles)
            raise HTTPException(403, f"Requires staff role: {allowed}")
        return user

    return guard


require_patient = require_roles(Role.PATIENT)
require_staff = require_roles(Role.STAFF)
require_admin = require_roles(Role.ADMIN)


def current_patient(
    user: User = Depends(require_patient), session: Session = Depends(get_session)
) -> Patient:
    patient = session.exec(select(Patient).where(Patient.user_id == user.id)).first()
    if patient is None:
        raise HTTPException(403, "No patient profile for this account")
    return patient


# ---- schemas ---------------------------------------------------------------------------------


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: Role
    staff_role: StaffRole | None
    hospital_id: int | None
    hospital_name: str | None
    patient_id: int | None
    demo_persona: str | None


class LoginIn(BaseModel):
    email: str
    password: str


class DemoLoginIn(BaseModel):
    persona: str


class SessionOut(BaseModel):
    user: UserOut
    token: str
    expires_at: datetime


class PersonaOut(BaseModel):
    key: str
    full_name: str
    email: str
    role: Role
    staff_role: StaffRole | None
    hospital_name: str | None
    description: str


def user_out(session: Session, user: User) -> UserOut:
    hospital = session.get(Hospital, user.hospital_id) if user.hospital_id else None
    patient = session.exec(select(Patient).where(Patient.user_id == user.id)).first()
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        staff_role=user.staff_role,
        hospital_id=user.hospital_id,
        hospital_name=hospital.name if hospital else None,
        patient_id=patient.id if patient else None,
        demo_persona=user.demo_persona,
    )


def _start_session(
    request: Request, response: Response, session: Session, settings: Settings, user: User
) -> SessionOut:
    now = utcnow()
    expires = now + timedelta(minutes=settings.session_ttl_minutes)
    token = new_session_token()
    session.add(
        AuthSession(
            token_hash=hash_token(token, settings.secret_key),
            user_id=user.id,
            created_at=now,
            expires_at=expires,
            last_seen_at=now,
            user_agent=request.headers.get("user-agent", "")[:200],
        )
    )
    # Opportunistic cleanup so the table never grows without bound.
    for stale in session.exec(select(AuthSession).where(AuthSession.expires_at < now)).all():
        session.delete(stale)
    session.commit()
    response.set_cookie(
        settings.session_cookie_name,
        token,
        max_age=settings.session_ttl_minutes * 60,
        httponly=True,
        samesite="lax",
        secure=settings.cookie_secure,
        path="/",
    )
    return SessionOut(user=user_out(session, user), token=token, expires_at=expires)


# ---- routes ----------------------------------------------------------------------------------


@router.get("/personas", response_model=list[PersonaOut])
def personas(
    session: Session = Depends(get_session), settings: Settings = Depends(get_settings_dep)
) -> list[PersonaOut]:
    """Demo accounts for the one-click login page (empty when demo mode is off)."""
    from medvault.seed import PERSONA_DESCRIPTIONS

    if not settings.demo_mode:
        return []
    users = session.exec(
        select(User).where(User.demo_persona.is_not(None)).order_by(User.id)  # type: ignore[union-attr]
    ).all()
    out = []
    for user in users:
        hospital = session.get(Hospital, user.hospital_id) if user.hospital_id else None
        out.append(
            PersonaOut(
                key=user.demo_persona or "",
                full_name=user.full_name,
                email=user.email,
                role=user.role,
                staff_role=user.staff_role,
                hospital_name=hospital.name if hospital else None,
                description=PERSONA_DESCRIPTIONS.get(user.demo_persona or "", ""),
            )
        )
    return out


@router.post("/login", response_model=SessionOut)
def login(
    payload: LoginIn,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> SessionOut:
    email = payload.email.strip().lower()
    user = session.exec(select(User).where(User.email == email)).first()
    ok = verify_password(payload.password, user.password_hash if user else _DUMMY_HASH)
    if user is None or not ok or not user.is_active:
        raise HTTPException(401, "Invalid email or password")
    return _start_session(request, response, session, settings, user)


@router.post("/demo-login", response_model=SessionOut)
def demo_login(
    payload: DemoLoginIn,
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
) -> SessionOut:
    if not settings.demo_mode:
        raise HTTPException(404, "Demo login is disabled")
    user = session.exec(select(User).where(User.demo_persona == payload.persona)).first()
    if user is None or not user.is_active:
        raise HTTPException(404, "Unknown demo persona")
    return _start_session(request, response, session, settings, user)


@router.post("/logout", status_code=204)
def logout(
    request: Request,
    response: Response,
    session: Session = Depends(get_session),
    settings: Settings = Depends(get_settings_dep),
    _user: User = Depends(get_current_user),
) -> None:
    row: AuthSession = request.state.auth_session
    row.revoked_at = utcnow()
    session.add(row)
    session.commit()
    response.delete_cookie(settings.session_cookie_name, path="/")


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user), session: Session = Depends(get_session)) -> UserOut:
    return user_out(session, user)
