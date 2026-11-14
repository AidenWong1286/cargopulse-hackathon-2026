"""Exhaustive search for the true optimum of a small Recover instance.

This is an independent check on the MILP, written without the optimiser's model
builder: it re-reads capacities from the snapshot, re-computes what each candidate
path consumes, and enumerates every combination of "this ULD takes path p" or "this
ULD stays unassigned" with branch-and-bound pruning. The objective is the declared
lexicographic one: first the fewest unassigned ULDs, then the lowest total cost
(path delay + handling + stability cost, plus the unassigned penalty).

It is exact but exponential, so it is only run on small instances, and it reports
when its node limit stopped it before finishing instead of claiming an optimum.
"""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field
from decimal import ROUND_CEILING, Decimal

from cargopulse_contracts import CandidateSet, ScenarioSnapshot

MICRO = Decimal("0.000001")
DEFAULT_NODE_LIMIT = 2_000_000


@dataclass
class ExactResult:
    complete: bool
    unassigned: int | None
    cost: Decimal | None
    selection: dict[str, str] = field(default_factory=dict)  # unit id -> path id
    nodes: int = 0


def _limits(snapshot: ScenarioSnapshot) -> dict[tuple, Decimal]:
    limits: dict[tuple, Decimal] = {}
    for f in snapshot.flights:
        if f.free_mass_kg is not None:
            limits[("F", f.id, "kg")] = Decimal(f.free_mass_kg)
        if f.free_volume_m3 is not None:
            limits[("F", f.id, "m3")] = Decimal(f.free_volume_m3)
        for p in f.positions:
            if p.free_mass_kg is not None:
                limits[("P", f.id, p.id, "kg")] = Decimal(p.free_mass_kg)
            if p.free_volume_m3 is not None:
                limits[("P", f.id, p.id, "m3")] = Decimal(p.free_volume_m3)
            if p.slot_count is not None:
                limits[("P", f.id, p.id, "slots")] = Decimal(p.slot_count)
    for w in snapshot.handling_windows:
        limits[("H", w.id)] = Decimal(w.capacity_units)
    return limits


def _usage(unit, path) -> dict[tuple, Decimal]:
    use: dict[tuple, Decimal] = defaultdict(Decimal)
    kg, m3 = Decimal(unit.actual_mass_kg), Decimal(unit.actual_volume_m3)
    for leg in path.legs:
        use[("F", leg.flight_id, "kg")] += kg
        use[("F", leg.flight_id, "m3")] += m3
        use[("P", leg.flight_id, leg.position_id, "kg")] += kg
        use[("P", leg.flight_id, leg.position_id, "m3")] += m3
        use[("P", leg.flight_id, leg.position_id, "slots")] += 1
        use[("H", leg.handling_window_id)] += 1
    return dict(use)


def exhaustive_optimum(
    snapshot: ScenarioSnapshot,
    candidates: CandidateSet,
    node_limit: int = DEFAULT_NODE_LIMIT,
) -> ExactResult:
    limits = _limits(snapshot)
    units = {u.id: u for u in snapshot.cargo_units}
    by_unit: dict[str, list] = defaultdict(list)
    for p in candidates.paths:
        by_unit[p.cargo_unit_id].append(p)

    items = []  # (unit id, mandatory, unassigned cost, [(cost, path id, usage)])
    for u in snapshot.cargo_units:
        penalty = (
            Decimal(snapshot.policy.unassigned_penalty_weighted_hours) * Decimal(u.service_weight)
        ).quantize(MICRO, rounding=ROUND_CEILING)
        options = []
        for p in by_unit[u.id]:
            usage = _usage(units[u.id], p)
            if any(key not in limits for key in usage):
                continue  # Unknown capacity can never be consumed.
            cost = (
                Decimal(p.weighted_delay_hours)
                + Decimal(p.handling_cost)
                + Decimal(p.stability_cost)
            )
            options.append((cost, p.id, usage))
        options.sort(key=lambda o: (o[0], o[1]))
        mandatory = bool(u.frozen_path_id or u.contractual_latest_arrival)
        items.append((u.id, mandatory, penalty, options))
    # Most constrained first keeps the search small.
    items.sort(key=lambda it: (len(it[3]), it[0]))

    # Suffix lower bounds: unassigned count and cost if every later ULD got its best option.
    n = len(items)
    lb_unassigned = [0] * (n + 1)
    lb_cost = [Decimal(0)] * (n + 1)
    for i in range(n - 1, -1, -1):
        _, _, penalty, options = items[i]
        lb_unassigned[i] = lb_unassigned[i + 1] + (0 if options else 1)
        lb_cost[i] = lb_cost[i + 1] + (options[0][0] if options else penalty)

    used: dict[tuple, Decimal] = defaultdict(Decimal)
    choice: list[str | None] = [None] * n
    best: dict = {"u": None, "c": None, "sel": None}
    nodes = 0
    stopped = False

    def better(u: int, c: Decimal) -> bool:
        return best["u"] is None or (u, c) < (best["u"], best["c"])

    def dominated(i: int, u: int, c: Decimal) -> bool:
        if best["u"] is None:
            return False
        bound_u = u + lb_unassigned[i]
        if bound_u > best["u"]:
            return True
        return bound_u == best["u"] and c + lb_cost[i] >= best["c"]

    def search(i: int, u: int, c: Decimal) -> None:
        nonlocal nodes, stopped
        if stopped:
            return
        nodes += 1
        if nodes > node_limit:
            stopped = True
            return
        if i == n:
            if better(u, c):
                best.update(u=u, c=c, sel=list(choice))
            return
        if dominated(i, u, c):
            return
        _, mandatory, penalty, options = items[i]
        for cost, pid, usage in options:
            if all(used[k] + v <= limits[k] for k, v in usage.items()):
                for k, v in usage.items():
                    used[k] += v
                choice[i] = pid
                search(i + 1, u, c + cost)
                for k, v in usage.items():
                    used[k] -= v
                choice[i] = None
                if stopped:
                    return
        if not mandatory:
            search(i + 1, u + 1, c + penalty)

    search(0, 0, Decimal(0))
    if stopped:
        return ExactResult(False, None, None, {}, nodes)
    if best["u"] is None:
        # Mandatory ULDs that cannot all be placed: no feasible plan exists.
        return ExactResult(True, None, None, {}, nodes)
    selection = {items[i][0]: pid for i, pid in enumerate(best["sel"]) if pid is not None}
    return ExactResult(True, best["u"], best["c"], selection, nodes)
