"""Phase 4: live feed (S1), dashboard reports (S2, S4), tamper test (S3), benchmark (FND-7)."""

from __future__ import annotations

from fastapi.testclient import TestClient

from medvault import bench
from tests.conftest import demo_login


def _bearer(session: dict) -> dict:
    return {"Authorization": f"Bearer {session['token']}"}


# ---- S1 --------------------------------------------------------------------------------------


def test_live_feed_is_admin_only_and_follows_the_scenarios(client: TestClient) -> None:
    demo_login(client, "patient")
    assert client.get("/api/admin/feed").status_code == 403
    assert client.get("/api/admin/events").status_code == 403
    demo_login(client, "admin")
    feed = client.get("/api/admin/feed").json()
    assert [e["actor"]["name"] for e in feed] == ["Sam Lee"]  # the seeded off-hours list view
    assert feed[0]["patient"] == "Maya Chen" and feed[0]["risk_level"] == "medium"
    assert feed[0]["actor"]["hospital"] == "Northside General Hospital"
    everything = client.get("/api/admin/feed?filter=all&limit=5").json()
    assert len(everything) == 5 and all(e["patient"] for e in everything)

    client.post("/api/admin/scenarios/clerk_sensitive")
    feed = client.get("/api/admin/feed").json()
    assert feed[0]["actor"]["name"] == "Jordan Price" and feed[0]["outcome"] == "frozen"
    assert feed[0]["patient"] == "Maya Chen" and feed[0]["deny_reason"]
    assert [r["kind"] for r in feed[0]["reasons"]] == ["role_mismatch", "sensitive_record"]


# ---- S3 --------------------------------------------------------------------------------------


def test_tamper_breaks_the_chain_and_repair_restores_it(client: TestClient) -> None:
    maya = demo_login(client, "patient")
    admin = demo_login(client, "admin")
    state = client.get("/api/admin/tamper").json()
    assert state["verify"]["valid"] is True and state["changes"] == []

    tampered = client.post("/api/admin/tamper").json()
    assert tampered["verify"]["valid"] is False
    [change] = tampered["changes"]
    assert tampered["verify"]["first_broken_entry"] == change["entry_id"]
    assert change["patient"] == "Maya Chen"
    assert change["before"] == "Opened Knee MRI report · allowed · low"
    assert change["after"] == "Viewed record list · allowed · low"
    # Maya's History badge reads the same check
    assert client.get("/api/audit/verify", headers=_bearer(maya)).json()["valid"] is False

    repaired = client.post("/api/admin/tamper/repair").json()
    assert repaired["verify"]["valid"] is True and repaired["changes"] == []
    assert client.get("/api/audit/verify", headers=_bearer(maya)).json()["valid"] is True

    # a reset forgets any tampering too
    assert client.post("/api/admin/tamper").json()["verify"]["valid"] is False
    assert client.post("/api/admin/reset", headers=_bearer(admin)).json()["ok"] is True
    state = client.get("/api/admin/tamper").json()
    assert state["verify"]["valid"] is True and state["changes"] == []


# ---- S2 / S4 / FND-7 -------------------------------------------------------------------------


def test_reports_endpoint_serves_eval_and_benchmarks(client: TestClient) -> None:
    demo_login(client, "doctor_a")
    assert client.get("/api/admin/reports").status_code == 403
    demo_login(client, "admin")
    body = client.get("/api/admin/reports").json()
    assert body["this_machine"] and body["eval"]["records"] == 120
    assert body["eval"]["sensitive_records"]["recall"] >= 0.95
    for report in body["benchmarks"]:  # whatever bench-*.json files are committed
        assert set(report["results"]) == set(bench.METRICS) and report["label"]


def test_benchmark_quick_run_reports_every_metric() -> None:
    report = bench.run(quick=True)
    assert report["machine"] and report["quick"] is True and report["label"]
    assert set(report["results"]) == set(bench.METRICS)
    for r in report["results"].values():
        assert r["value"] > 0 and r["p95_ms"] >= r["p50_ms"] > 0
        assert r["better"] in ("higher", "lower") and r["unit"] in ("MB/s", "ms")
    assert report["results"]["key_swap"]["records"] == 5 + 8  # Maya's seed + benchmark records
    assert report["results"]["audit_verify"]["entries"] >= 100
