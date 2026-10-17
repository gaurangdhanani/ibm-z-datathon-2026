"""FND-2..FND-4: health, security headers, SPA serving, seed, login, sessions, role guards."""

from __future__ import annotations

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlmodel import Session, select

from medvault.models import AuthSession, Grant, Patient, Record, User, Vault, utcnow
from medvault.seed import DEMO_PASSWORD, PERSONA_DESCRIPTIONS, USERS, reset_and_seed
from tests.conftest import demo_login, make_settings

# ---- FND-2: app skeleton ---------------------------------------------------------------------


def test_health_reports_platform_and_db(client: TestClient) -> None:
    body = client.get("/api/health").json()
    assert body["status"] == "ok" and body["db_ok"] is True
    assert body["platform"]["machine"] and body["platform"]["python"]
    assert body["env"] == "test"


def test_security_headers_on_api_and_spa(client: TestClient) -> None:
    api = client.get("/api/health")
    assert api.headers["x-content-type-options"] == "nosniff"
    assert api.headers["x-frame-options"] == "DENY"
    assert api.headers["cache-control"] == "no-store"
    assert "content-security-policy" not in api.headers
    spa = client.get("/patient/vault")
    assert "default-src 'self'" in spa.headers["content-security-policy"]


def test_spa_not_built_gives_503_and_api_404_stays_json(client: TestClient) -> None:
    assert client.get("/").status_code == 503
    missing = client.get("/api/does-not-exist")
    assert missing.status_code == 404 and missing.json()["detail"] == "Not found"


def test_spa_serves_index_fallback_and_assets(tmp_path) -> None:
    from medvault.main import create_app

    dist = tmp_path / "dist"
    (dist / "assets").mkdir(parents=True)
    (dist / "index.html").write_text("<!doctype html><title>shell</title>")
    (dist / "assets" / "app.js").write_text("console.log(1)")
    (tmp_path / "secret.txt").write_text("nope")
    with TestClient(create_app(make_settings(tmp_path))) as client:
        assert "shell" in client.get("/").text
        assert "shell" in client.get("/patient/anything/deep").text
        asset = client.get("/assets/app.js")
        assert asset.status_code == 200 and "immutable" in asset.headers["cache-control"]
        traversal = client.get("/assets/../../secret.txt")
        assert "nope" not in traversal.text


# ---- FND-3: data model and seed --------------------------------------------------------------


def test_seed_loads_every_persona_with_vaults_and_grants(app, client: TestClient) -> None:
    with Session(app.state.engine) as s:
        users = s.exec(select(User)).all()
        assert {u.demo_persona for u in users} == {key for key, *_ in USERS}
        assert set(PERSONA_DESCRIPTIONS) == {key for key, *_ in USERS}
        patients = s.exec(select(Patient)).all()
        assert len(patients) == 3
        for patient in patients:
            vault = s.exec(select(Vault).where(Vault.patient_id == patient.id)).one()
            grants = s.exec(select(Grant).where(Grant.patient_id == patient.id)).all()
            assert grants and all(g.key_version == vault.key_version for g in grants)
        records = s.exec(select(Record)).all()
        assert len(records) == 9 and all(not r.is_encrypted for r in records)


def test_reseed_is_repeatable(app, client: TestClient) -> None:
    counts = reset_and_seed(app.state.engine)
    assert counts["users"] == len(USERS)
    with Session(app.state.engine) as s:
        assert len(s.exec(select(User)).all()) == len(USERS)
        assert s.exec(select(AuthSession)).first() is None  # reset wipes sessions too


# ---- FND-4: auth -----------------------------------------------------------------------------


def test_personas_listed_in_demo_mode(client: TestClient) -> None:
    personas = client.get("/api/auth/personas").json()
    assert [p["key"] for p in personas][:2] == ["patient", "patient2"]
    doctor = next(p for p in personas if p["key"] == "doctor_a")
    assert doctor["role"] == "staff" and doctor["staff_role"] == "physician"
    assert doctor["hospital_name"] == "Northside General Hospital"


def test_demo_login_sets_cookie_and_me_works(client: TestClient) -> None:
    body = demo_login(client, "patient")
    assert body["user"]["role"] == "patient" and body["user"]["patient_id"] is not None
    assert "medvault_session" in client.cookies
    me = client.get("/api/auth/me")
    assert me.status_code == 200 and me.json()["email"] == "maya.chen@patient.example"


def test_bearer_token_works_without_cookie(client: TestClient) -> None:
    token = demo_login(client, "doctor_a")["token"]
    client.cookies.clear()
    assert client.get("/api/auth/me").status_code == 401
    me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me.status_code == 200 and me.json()["hospital_name"] == "Northside General Hospital"


def test_password_login_and_bad_credentials(client: TestClient) -> None:
    ok = client.post(
        "/api/auth/login",
        json={"email": "Elena.Vasquez@northside.example", "password": DEMO_PASSWORD},
    )
    assert ok.status_code == 200 and ok.json()["user"]["staff_role"] == "physician"
    bad = client.post("/api/auth/login", json={"email": "nobody@x.example", "password": "x"})
    assert bad.status_code == 401
    wrong = client.post(
        "/api/auth/login", json={"email": "elena.vasquez@northside.example", "password": "x"}
    )
    assert wrong.status_code == 401 and wrong.json()["detail"] == bad.json()["detail"]


def test_logout_revokes_session(client: TestClient) -> None:
    demo_login(client, "patient")
    assert client.post("/api/auth/logout").status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_expired_session_is_rejected(app, client: TestClient) -> None:
    demo_login(client, "patient")
    with Session(app.state.engine) as s:
        row = s.exec(select(AuthSession)).one()
        row.expires_at = utcnow() - timedelta(seconds=1)
        s.add(row)
        s.commit()
    assert client.get("/api/auth/me").status_code == 401


def test_demo_login_disabled_outside_demo_mode(tmp_path) -> None:
    from medvault.main import create_app

    with TestClient(create_app(make_settings(tmp_path, demo_mode=False))) as client:
        assert client.get("/api/auth/personas").json() == []
        assert client.post("/api/auth/demo-login", json={"persona": "patient"}).status_code == 404


def test_role_guards(client: TestClient) -> None:
    assert client.get("/api/test/patient-only").status_code == 401

    demo_login(client, "patient")
    assert client.get("/api/test/patient-only").status_code == 200
    assert client.get("/api/test/staff-only").status_code == 403
    assert client.get("/api/test/physicians-only").status_code == 403

    demo_login(client, "billing_a")
    assert client.get("/api/test/staff-only").status_code == 200
    assert client.get("/api/test/physicians-only").status_code == 403  # separation of duties

    demo_login(client, "doctor_a")
    assert client.get("/api/test/physicians-only").status_code == 200
    assert client.get("/api/test/patient-only").status_code == 403
