"""Batch evidence for Protect on many seeded synthetic flights.

Method (the same one the team deck describes): first choose one overbooking level for the
whole batch so that the simple reference rule (priority fill) offloads the observed
reference rate of booked AWBs (11.28%). Only then run CargoPulse on exactly the same
flights and report what it achieves. The optimiser plays no part in the calibration, so
the setting cannot be tuned to flatter it.

Every plan of both policies is re-checked by the independent load check.
"""

from __future__ import annotations

from dataclasses import dataclass
from fractions import Fraction

from cargopulse_validation.protect import check_protect_load

from .planner import make_flight, plan_priority_fill, plan_with_optimizer

REFERENCE_OFFLOAD_RATE = Fraction(1128, 10000)
DEMAND_MIN, DEMAND_MAX = 1.0, 1.6


def _rows(flight):
    return [
        {"id": s.id, "weight_kg": s.weight_kg, "volume_m3": s.volume_m3, "guaranteed": s.guaranteed}
        for s in flight.shipments
    ]


@dataclass(frozen=True)
class FlightOutcome:
    seed: int
    booked: int
    booked_weight_ratio: float
    booked_volume_ratio: float
    offloaded_fill: int
    offloaded_opt: int
    priority_offloaded_fill: int
    priority_offloaded_opt: int
    chargeable_fill: int
    chargeable_opt: int
    opt_status: str
    check_fill: bool
    check_opt: bool


def _fill_offloads(flight) -> int:
    loaded, _ = plan_priority_fill(flight)
    return len(flight.shipments) - len(loaded)


def calibrate(
    seeds: range, shipments: int, target: Fraction = REFERENCE_OFFLOAD_RATE, iterations: int = 30
) -> tuple[float, int, int]:
    """Overbooking level where the reference rule's pooled offload rate is closest to target.

    Uses only the reference rule. Returns (demand, offloaded, booked) at that level.
    """
    def pooled(demand: float) -> tuple[int, int]:
        off = booked = 0
        for seed in seeds:
            flight = make_flight(seed, shipments, demand)
            off += _fill_offloads(flight)
            booked += len(flight.shipments)
        return off, booked

    low, high = DEMAND_MIN, DEMAND_MAX
    best = None
    for _ in range(iterations):
        mid = (low + high) / 2
        off, booked = pooled(mid)
        gap = abs(Fraction(off, booked) - target)
        if best is None or gap < best[0]:
            best = (gap, mid, off, booked)
        if Fraction(off, booked) < target:
            low = mid
        else:
            high = mid
    _, demand, off, booked = best
    return round(demand, 6), off, booked


def evaluate(seeds: range, shipments: int, demand: float) -> list[FlightOutcome]:
    outcomes = []
    for seed in seeds:
        flight = make_flight(seed, shipments, demand)
        rows = _rows(flight)
        filled, _ = plan_priority_fill(flight)
        optimized, info = plan_with_optimizer(flight)

        def priority_off(loaded):
            return sum(
                1 for s in flight.shipments if s.id not in loaded and s.service_class != "GENERAL"
            )

        def chargeable(loaded):
            return sum(s.chargeable_kg for s in flight.shipments if s.id in loaded)

        outcomes.append(
            FlightOutcome(
                seed=seed,
                booked=len(flight.shipments),
                booked_weight_ratio=round(
                    sum(s.weight_kg for s in flight.shipments) / flight.payload_kg, 4
                ),
                booked_volume_ratio=round(
                    sum(s.volume_m3 for s in flight.shipments) / flight.volume_m3, 4
                ),
                offloaded_fill=len(flight.shipments) - len(filled),
                offloaded_opt=len(flight.shipments) - len(optimized),
                priority_offloaded_fill=priority_off(filled),
                priority_offloaded_opt=priority_off(optimized),
                chargeable_fill=chargeable(filled),
                chargeable_opt=chargeable(optimized),
                opt_status=info["status"],
                check_fill=not check_protect_load(rows, filled, flight.payload_kg, flight.volume_m3),
                check_opt=not check_protect_load(
                    rows, optimized, flight.payload_kg, flight.volume_m3
                ),
            )
        )
    return outcomes
