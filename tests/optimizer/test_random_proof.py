"""The Recover MILP is checked against an exhaustive search on random instances.

Every seeded random disruption is a different network and cargo mix. On small ones,
an exhaustive search written without the optimiser's model builder finds the true
lexicographic optimum, and the MILP must equal it exactly. On every instance the
independent validator must accept the plan and the MILP must never be beaten by the
two reference rules on the same objective.
"""

from datetime import datetime, timezone
from decimal import Decimal

import pytest
from cargopulse_contracts import canonical_hash
from cargopulse_optimizer import (
    build_feasible_paths,
    run_baseline_earliest,
    run_baseline_priority,
    run_solver,
)
from cargopulse_validation.exact import exhaustive_optimum

from packages.domain_fixtures.random_disruption import make_random_snapshot

AT = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)


def key(plan):
    return (len(plan.unassigned), plan.solver.objective_value)


def test_random_generator_is_reproducible_and_varied():
    a = make_random_snapshot(7, 40, as_of=AT)
    assert canonical_hash(a) == canonical_hash(make_random_snapshot(7, 40, as_of=AT))
    hashes = {canonical_hash(make_random_snapshot(s, 40, as_of=AT)) for s in range(1, 21)}
    assert len(hashes) == 20
    shapes = {
        (len(s.flights), sum(f.status != "SCHEDULED" for f in s.flights))
        for s in (make_random_snapshot(seed, 40, as_of=AT) for seed in range(1, 21))
    }
    assert len(shapes) > 5  # different networks, not just different cargo
    with pytest.raises(ValueError):
        make_random_snapshot(1, 3, as_of=AT)


@pytest.mark.parametrize("seed", range(1, 41))
def test_milp_equals_exhaustive_optimum_on_small_random_instances(seed):
    snapshot = make_random_snapshot(seed, 8, as_of=AT)
    candidates = build_feasible_paths(snapshot)
    plan = run_solver(snapshot, 10)
    assert plan.solver.status.value == "OPTIMAL"
    assert plan.independent_validation.status == "PASS"
    exact = exhaustive_optimum(snapshot, candidates)
    assert exact.complete
    assert (exact.unassigned, exact.cost) == key(plan)
    for baseline in (run_baseline_earliest(snapshot), run_baseline_priority(snapshot)):
        assert baseline.independent_validation.status == "PASS"
        assert key(plan) <= key(baseline)


def test_small_random_instances_are_not_trivial():
    """Guard against a vacuous proof: capacity must bind and the rules must lose often."""
    binding = beaten = 0
    for seed in range(1, 41):
        snapshot = make_random_snapshot(seed, 8, as_of=AT)
        candidates = build_feasible_paths(snapshot)
        eligible = len({p.cargo_unit_id for p in candidates.paths})
        plan = run_solver(snapshot, 10)
        binding += len(plan.unassigned) > len(snapshot.cargo_units) - eligible
        baselines = [run_baseline_earliest(snapshot), run_baseline_priority(snapshot)]
        beaten += all(key(plan) < key(b) for b in baselines)
    assert binding >= 20
    assert beaten >= 10


def test_exhaustive_search_reports_its_limit_instead_of_guessing():
    snapshot = make_random_snapshot(16, 12, as_of=AT)
    result = exhaustive_optimum(snapshot, build_feasible_paths(snapshot), node_limit=50)
    assert not result.complete and result.unassigned is None and result.cost is None


@pytest.mark.parametrize("seed", [1, 2, 3])
def test_larger_random_instances_are_valid_and_never_beaten(seed):
    snapshot = make_random_snapshot(seed, 140, as_of=AT)
    plan = run_solver(snapshot, 30)
    assert plan.independent_validation.status == "PASS"
    assert plan.solver.status.value == "OPTIMAL"
    assert plan.solver.optimality_gap == Decimal("0")
    for baseline in (run_baseline_earliest(snapshot), run_baseline_priority(snapshot)):
        assert key(plan) <= key(baseline)
