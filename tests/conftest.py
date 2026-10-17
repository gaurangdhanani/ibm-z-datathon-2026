from __future__ import annotations

from collections.abc import Iterator

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from medvault.auth import require_patient, require_staff, require_staff_roles
from medvault.config import Settings
from medvault.main import create_app
from medvault.models import StaffRole, User


def make_settings(tmp_path, **overrides) -> Settings:
    base = dict(
        env="test",
        database_url="sqlite://",
        static_dir=tmp_path / "dist",
        secret_key="test-secret",
        log_level="warning",
    )
    base.update(overrides)
    return Settings(_env_file=None, **base)


def add_guarded_routes(app: FastAPI) -> None:
    """Routes that exist only to prove the role guards work."""

    @app.get("/api/test/patient-only")
    def patient_only(user: User = Depends(require_patient)) -> dict:
        return {"ok": True, "user": user.email}

    @app.get("/api/test/staff-only")
    def staff_only(user: User = Depends(require_staff)) -> dict:
        return {"ok": True, "user": user.email}

    @app.get("/api/test/physicians-only")
    def physicians_only(user: User = Depends(require_staff_roles(StaffRole.PHYSICIAN))) -> dict:
        return {"ok": True, "user": user.email}

    # The SPA catch-all was registered by create_app; keep it last so /api/test/* resolves.
    routes = app.router.routes
    spa = next(r for r in routes if getattr(r, "path", "") == "/{path:path}")
    routes.remove(spa)
    routes.append(spa)


@pytest.fixture
def settings(tmp_path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def app(settings) -> FastAPI:
    application = create_app(settings)
    add_guarded_routes(application)
    return application


@pytest.fixture
def client(app) -> Iterator[TestClient]:
    with TestClient(app) as test_client:  # context manager runs lifespan (init + seed)
        yield test_client


def demo_login(client: TestClient, persona: str) -> dict:
    response = client.post("/api/auth/demo-login", json={"persona": persona})
    assert response.status_code == 200, response.text
    return response.json()
