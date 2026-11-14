"""Random Recover data and the algorithm-proof endpoint, through the real API."""

import pytest

from tests.backend.conftest import login, post


def test_seeded_fixture_is_random_reproducible_and_importable(client):
    login(client, "manager")
    first = client.get("/api/v1/fixtures/recover?seed=4242&size=60")
    assert first.status_code == 200, first.text
    body = first.json()
    assert body["title"] == "Random hub disruption / 60 ULDs / seed 4242"
    assert len(body["cargo_units"]) == 60
    again = client.get("/api/v1/fixtures/recover?seed=4242&size=60").json()
    assert [u["actual_mass_kg"] for u in again["cargo_units"]] == [
        u["actual_mass_kg"] for u in body["cargo_units"]
    ]
    other = client.get("/api/v1/fixtures/recover?seed=4243&size=60").json()
    assert other["cargo_units"] != body["cargo_units"]
    # The fixed reference fixture is unchanged when no seed is given.
    assert client.get("/api/v1/fixtures/recover").json()["title"].endswith("seed 101")
    result = post(client, "/imports/validate", {"snapshot": body})
    assert result.status_code == 202, result.text
    assert result.json()["status"] == "READY"


@pytest.mark.parametrize("query", ["seed=0", "seed=1&size=5", "seed=1&size=401"])
def test_seeded_fixture_rejects_out_of_range_inputs(client, query):
    login(client, "manager")
    assert client.get(f"/api/v1/fixtures/recover?{query}").status_code == 422


def test_proof_endpoint_matches_exhaustive_search_on_small_instance(client):
    login(client, "controller")
    response = client.get("/api/v1/analysis/recover/proof?seed=3&size=8")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["synthetic"] is True and body["has_external_write_permission"] is False
    policies = {p["policy"]: p for p in body["policies"]}
    assert set(policies) == {"CARGOPULSE", "EARLIEST_FEASIBLE", "PRIORITY_FIRST"}
    assert all(p["independent_validation"] == "PASS" for p in policies.values())
    assert body["exact"]["status"] == "MATCH"
    assert body["exact"]["objective"] == policies["CARGOPULSE"]["objective"]
    assert body["cargopulse_not_worse"] is True
    assert body["instance"]["affected_ulds"] == 8


def test_proof_endpoint_skips_exhaustive_search_on_large_instance(client):
    login(client, "manager")
    body = client.get("/api/v1/analysis/recover/proof?seed=1&size=60&max_wall_seconds=10").json()
    assert body["exact"]["status"] == "NOT_RUN"
    assert {p["independent_validation"] for p in body["policies"]} == {"PASS"}


@pytest.mark.parametrize("identity", ["steward", "auditor"])
def test_proof_endpoint_requires_planning_role(client, identity):
    login(client, identity)
    assert client.get("/api/v1/analysis/recover/proof?seed=1").status_code == 403


@pytest.mark.parametrize("query", ["", "seed=0", "seed=1&size=3", "seed=1&max_wall_seconds=99"])
def test_proof_endpoint_rejects_bad_inputs(client, query):
    login(client, "manager")
    assert client.get(f"/api/v1/analysis/recover/proof?{query}").status_code == 422


def test_proof_endpoint_requires_session(client):
    assert client.get("/api/v1/analysis/recover/proof?seed=1").status_code == 401
