"""Protect evidence: exhaustive optimum on small flights, calibrated 100-flight batches, API."""

from fractions import Fraction
from itertools import combinations

import pytest
from cargopulse_protect import make_flight, plan_priority_fill, plan_with_optimizer
from cargopulse_protect.proof import REFERENCE_OFFLOAD_RATE, calibrate, evaluate

from tests.backend.conftest import login
from tests.backend.test_protect import score


def exhaustive_best(flight):
    """Try every subset of shipments; independent of the MILP."""
    ships = flight.shipments
    must = {s.id for s in ships if s.guaranteed}
    best = None
    for k in range(len(ships) + 1):
        for combo in combinations(ships, k):
            ids = {s.id for s in combo}
            if not must <= ids:
                continue
            if sum(s.weight_kg for s in combo) > flight.payload_kg:
                continue
            if sum(s.volume_m3 for s in combo) > flight.volume_m3 + 1e-9:
                continue
            value = score(flight, ids)
            if best is None or value > best:
                best = value
    return best


@pytest.mark.parametrize("seed", range(1, 21))
def test_optimizer_equals_exhaustive_optimum_on_small_flights(seed):
    flight = make_flight(seed, shipments=12, demand=1.2)
    loaded, info = plan_with_optimizer(flight)
    assert info["status"] == "OPTIMAL"
    assert score(flight, loaded) == exhaustive_best(flight)


def test_densities_keep_weight_and_volume_overbooking_consistent():
    weight = volume = 0.0
    for seed in range(1, 101):
        flight = make_flight(seed, 150, 1.1)
        weight += sum(s.weight_kg for s in flight.shipments) / flight.payload_kg
        volume += sum(s.volume_m3 for s in flight.shipments) / flight.volume_m3
    assert 1.05 < volume / 100 < 1.15
    assert abs(weight / 100 - volume / 100) < 0.03


def test_optimizer_never_offloads_more_priority_cargo_than_the_rule():
    for seed in range(1, 41):
        flight = make_flight(seed, 60, 1.3)
        loaded, _ = plan_with_optimizer(flight)
        filled, _ = plan_priority_fill(flight)
        assert score(flight, loaded) >= score(flight, filled)

        def priority_off(ids):
            return sum(1 for s in flight.shipments if s.id not in ids and s.service_class != "GENERAL")

        assert priority_off(loaded) <= priority_off(filled)


def test_calibrated_batch_of_100_flights():
    seeds = range(1, 101)
    demand, offloaded, booked = calibrate(seeds, 60)
    assert abs(Fraction(offloaded, booked) - REFERENCE_OFFLOAD_RATE) < Fraction(5, 1000)
    rows = evaluate(seeds, 60, demand)
    assert all(r.check_fill and r.check_opt for r in rows)
    assert all(r.opt_status == "OPTIMAL" for r in rows)
    booked = sum(r.booked for r in rows)
    rule = Fraction(sum(r.offloaded_fill for r in rows), booked)
    ours = Fraction(sum(r.offloaded_opt for r in rows), booked)
    assert ours < rule
    assert sum(r.chargeable_opt for r in rows) >= sum(r.chargeable_fill for r in rows)
    assert sum(r.priority_offloaded_opt for r in rows) <= sum(r.priority_offloaded_fill for r in rows)


def test_calibrate_and_batch_api(client):
    login(client, "manager")
    calibration = client.get("/api/v1/analysis/protect/calibrate?flights=10&shipments=20")
    assert calibration.status_code == 200, calibration.text
    body = calibration.json()
    assert body["target_offload_rate"] == "0.1128"
    batch = client.get(
        f"/api/v1/analysis/protect/batch?flights=10&shipments=20&demand={body['demand']}"
    )
    assert batch.status_code == 200, batch.text
    rows = batch.json()["rows"]
    assert len(rows) == 10 and all(r["check_opt"] and r["check_fill"] for r in rows)
    assert batch.json()["has_external_write_permission"] is False


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/analysis/protect/calibrate?flights=5",
        "/api/v1/analysis/protect/calibrate?shipments=500",
        "/api/v1/analysis/protect/batch",
        "/api/v1/analysis/protect/batch?demand=3",
        "/api/v1/analysis/protect/batch?demand=1.1&flights=1000",
    ],
)
def test_protect_proof_rejects_bad_inputs(client, path):
    login(client, "manager")
    assert client.get(path).status_code == 422


@pytest.mark.parametrize("identity", ["steward", "auditor"])
def test_protect_proof_requires_planning_role(client, identity):
    login(client, identity)
    assert client.get("/api/v1/analysis/protect/calibrate").status_code == 403
    assert client.get("/api/v1/analysis/protect/batch?demand=1.1").status_code == 403
