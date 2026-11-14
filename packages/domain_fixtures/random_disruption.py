"""Seeded random hub disruptions for testing the Recover optimiser on varied inputs.

Each seed draws a different network and cargo mix: which destinations are served, how
many flights each has, which flights are cancelled, how much space and ground-handling
capacity is left, the cargo classes, sizes and promised times, and which checks fail.
The same seed always produces the same scenario, so every result can be re-run.

These are engineering test distributions, not calibrated airline traffic.
"""

from __future__ import annotations

import random
from datetime import datetime, timedelta, timezone
from uuid import UUID

from cargopulse_contracts import ScenarioSnapshot

from .generator import TENANT_A

GENERATOR_ID = "random-hub-disruption-v1"
MIN_SIZE, MAX_SIZE = 4, 400
DESTINATIONS = [
    ("FRA", "Europe/Berlin", 12),
    ("AMS", "Europe/Amsterdam", 12),
    ("LHR", "Europe/London", 13),
    ("LAX", "America/Los_Angeles", 13),
    ("SYD", "Australia/Sydney", 9),
    ("DXB", "Asia/Dubai", 8),
    ("BOM", "Asia/Kolkata", 6),
    ("SIN", "Asia/Singapore", 4),
]
CLASSES = ["GENERAL", "PRIORITY", "PHARMA", "PERISHABLE", "DG"]


def make_random_snapshot(
    seed: int,
    size: int = 140,
    as_of: datetime | None = None,
    tenant_id: UUID = TENANT_A,
) -> ScenarioSnapshot:
    if not MIN_SIZE <= size <= MAX_SIZE:
        raise ValueError(f"size must be from {MIN_SIZE} to {MAX_SIZE}")
    # A namespaced seed keeps these draws independent of the legacy fixed generator.
    rng = random.Random(f"{GENERATOR_ID}:{seed}:{size}")  # noqa: S311 - reproducible test data
    t = (as_of or datetime.now(timezone.utc)).replace(microsecond=0)

    def iso(x):
        return x.isoformat().replace("+00:00", "Z")

    def proof(state="PASS"):
        return dict(
            state=state,
            source_record_id=f"{GENERATOR_ID}-{seed}",
            observed_at=iso(t),
            valid_until=iso(t + timedelta(hours=72)),
            rule_revision="synthetic-v1",
        )

    # Network: a random subset of destinations (more for bigger events), each with a few
    # departures over the next ~2 days.
    max_dest = min(len(DESTINATIONS), max(2, size // 5))
    served = rng.sample(DESTINATIONS, rng.randint(2, max_dest))
    served.sort(key=lambda d: d[0])
    # How much space is left relative to demand. Below 1 means not everything can fly.
    capacity_ratio = rng.uniform(0.45, 1.25)
    cancel_rate = rng.uniform(0.0, 0.25)
    flight_specs = []
    for dest, zone, hours in served:
        departure = t + timedelta(hours=rng.uniform(1.5, 6))
        for k in range(rng.randint(2, 3 if size < 20 else 5)):
            flight_specs.append((dest, zone, hours, k, departure))
            departure += timedelta(hours=rng.uniform(4, 14))
    base_slots = max(1.0, size * capacity_ratio / len(flight_specs))

    flights, windows = [], []
    for n, (dest, zone, hours, k, departure) in enumerate(flight_specs):
        fid = f"F-{dest}-{k + 1}"
        cutoff = departure - timedelta(minutes=45)
        slots = max(1, round(base_slots * rng.uniform(0.5, 1.5)))
        # Mass and volume can bind before the slot count does.
        mass = round(slots * rng.uniform(1500, 2300))
        volume = round(slots * rng.uniform(7, 11))
        cancelled = rng.random() < cancel_rate
        flights.append(
            dict(
                id=fid,
                flight_number=f"RND{n + 1:02}",
                origin="HKG",
                destination=dest,
                departure_at=iso(departure),
                arrival_at=iso(departure + timedelta(hours=hours)),
                cutoff_at=iso(cutoff),
                origin_timezone="Asia/Hong_Kong",
                destination_timezone=zone,
                aircraft_variant="SYNTHETIC-ENVELOPE",
                is_freighter=rng.random() < 0.4,
                status="CANCELLED" if cancelled else "SCHEDULED",
                free_mass_kg=str(mass),
                free_volume_m3=str(volume),
                positions=[
                    dict(
                        id="POOL",
                        free_mass_kg=str(mass),
                        free_volume_m3=str(volume),
                        slot_count=slots,
                        max_unit_mass_kg="2500",
                        max_unit_volume_m3="12",
                        allowed_uld_types=["AKE", "PMC", "RKN"],
                        allowed_contours=["SYN-A"],
                        envelope_verification=proof(),
                    )
                ],
                capacity_verification=proof(),
            )
        )
        windows.append(
            dict(
                id=f"H-{fid}",
                airport="HKG",
                start_at=iso(cutoff - timedelta(hours=2)),
                end_at=iso(cutoff),
                # Ground handling can also be the bottleneck.
                capacity_units=max(1, slots + rng.randint(-1, 1)),
                equipment_verification=proof(),
            )
        )

    # Cargo: a random class mix, sizes and promised times.
    class_weights = [rng.uniform(0.2, 1.0) for _ in CLASSES]
    dest_weights = [rng.uniform(0.5, 1.5) for _ in served]
    customs_fail = rng.uniform(0.0, 0.08)
    units, permissions = [], []
    for i in range(size):
        uid = f"U-{i + 1:04}"
        service = rng.choices(CLASSES, weights=class_weights)[0]
        dest = rng.choices([d[0] for d in served], weights=dest_weights)[0]
        mass = rng.randint(400, 2000)
        volume = rng.randint(2, 9)
        ready = t + timedelta(minutes=rng.choice([0, 0, 0, 30, 60, 120]))
        units.append(
            dict(
                id=uid,
                uld_code=f"RND-{i + 1:04}",
                uld_type="RKN" if service == "PHARMA" else "AKE",
                contour="SYN-A",
                origin="HKG",
                destination=dest,
                actual_mass_kg=str(mass),
                actual_volume_m3=str(volume),
                tare_mass_kg="50",
                pieces=[
                    dict(
                        piece_id=f"P-{i + 1:04}",
                        awb_id=f"AWB-R{i + 1:04}",
                        mass_kg=str(mass - 50),
                        volume_m3=str(volume),
                    )
                ],
                service_class=service,
                service_weight="2.5" if service in ("PRIORITY", "PHARMA") else "1",
                ready_at=iso(ready),
                commitment_at=iso(t + timedelta(hours=rng.randint(6, 36))),
                requires_cold_chain=service in ("PHARMA", "PERISHABLE"),
                dg_class="FREIGHTER_ONLY" if service == "DG" else "NONE",
                serviceability=proof(),
                security=proof(),
            )
        )
        blocked_customs = rng.random() < customs_fail
        for f in flights:
            if f["destination"] != dest:
                continue
            cold_unknown = service == "PHARMA" and rng.random() < 0.2
            permissions.append(
                dict(
                    cargo_unit_id=uid,
                    flight_id=f["id"],
                    dg=proof(),
                    customs=proof("FAIL" if blocked_customs else "PASS"),
                    cold_chain=proof("UNKNOWN" if cold_unknown else "PASS"),
                    load_control=proof(),
                )
            )
    return ScenarioSnapshot.model_validate(
        dict(
            tenant_id=str(tenant_id),
            event_id=f"random-recover-{seed}-{size}-{t.strftime('%Y%m%dT%H%M%S')}",
            source_version=1,
            title=f"Random hub disruption / {size} ULDs / seed {seed}",
            as_of=iso(t),
            valid_until=iso(t + timedelta(hours=1)),
            provenance=dict(
                source_id=GENERATOR_ID,
                source_record_ids=[f"seed-{seed}", f"size-{size}"],
                observed_at=iso(t),
                effective_at=iso(t),
                ingested_at=iso(t),
                evidence_tier="TEAM_SYNTHETIC_UNVERIFIED",
            ),
            policy=dict(
                id="synthetic-recover-v1",
                version="1.0.0",
                state="PUBLISHED",
                authored_by="synthetic-policy-author",
                approved_by="synthetic-policy-reviewer",
                published_at=iso(t),
                handling_seconds=900,
                max_legs=3,
                max_paths_per_unit=20,
                unassigned_penalty_weighted_hours="96",
                handling_penalty_weighted_hours="0.1",
                stability_penalty_weighted_hours="2",
                source_max_age_seconds=3600,
                model_scope="SYNTHETIC_CONSERVATIVE_ENVELOPE",
            ),
            cargo_units=units,
            flights=flights,
            handling_windows=windows,
            route_permissions=permissions,
            connections=[],
        )
    )
