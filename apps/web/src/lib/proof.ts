import { api } from "./api";
import type { ProtectBatch, ProtectCalibration, RecoverProof, Snapshot } from "./types";

/** Sizes the random-disruption generator accepts through the fixture endpoint. */
export const FIXTURE_SIZES = [60, 140, 300] as const;

/** A fresh seed for a random disruption. The seed is shown so any run can be repeated. */
export function randomSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return (values[0] % 999_999) + 1;
}

/** Without a seed: the fixed reference disruption. With a seed: a random, repeatable one. */
export function loadFixture(seed?: number, size?: number): Promise<Snapshot> {
  if (seed === undefined) return api<Snapshot>("/fixtures/recover");
  const query = new URLSearchParams({ seed: String(seed), size: String(size ?? 140) });
  return api<Snapshot>(`/fixtures/recover?${query}`);
}

/** Runs CargoPulse, both simple rules and (small sizes) the exhaustive search on one seed. */
export function recoverProof(
  seed: number,
  size: number,
  maxWallSeconds: number,
  signal?: AbortSignal,
): Promise<RecoverProof> {
  const query = new URLSearchParams({
    seed: String(seed),
    size: String(size),
    max_wall_seconds: String(maxWallSeconds),
  });
  return api<RecoverProof>(`/analysis/recover/proof?${query}`, { signal });
}

/** Lexicographic objective: fewer unassigned first, then lower cost. */
export function bestRule(proof: RecoverProof) {
  const rules = proof.policies.filter((p) => p.policy !== "CARGOPULSE");
  return rules.toSorted(
    (a, b) =>
      a.unassigned - b.unassigned || Number(a.objective ?? Infinity) - Number(b.objective ?? Infinity),
  )[0];
}

export function cargopulse(proof: RecoverProof) {
  return proof.policies.find((p) => p.policy === "CARGOPULSE");
}

// ── Protect: calibrated batches of synthetic flights ──

export type ProtectRow = ProtectBatch["rows"][number];

/** Overbooking at which the simple rule offloads 11.28% of booked AWBs (rule only). */
export function protectCalibrate(flights: number, shipments: number, seedStart: number, signal?: AbortSignal) {
  const query = new URLSearchParams({
    flights: String(flights),
    shipments: String(shipments),
    seed_start: String(seedStart),
  });
  return api<ProtectCalibration>(`/analysis/protect/calibrate?${query}`, { signal });
}

/** Both policies on the same seeded flights at one overbooking level. */
export function protectBatch(
  demand: number,
  flights: number,
  shipments: number,
  seedStart: number,
  signal?: AbortSignal,
) {
  const query = new URLSearchParams({
    demand: String(demand),
    flights: String(flights),
    shipments: String(shipments),
    seed_start: String(seedStart),
  });
  return api<ProtectBatch>(`/analysis/protect/batch?${query}`, { signal });
}

/** Pooled totals across a batch: exact counts, rates derived from them. */
export function pooled(rows: readonly ProtectRow[]) {
  const sum = (pick: (r: ProtectRow) => number) => rows.reduce((n, r) => n + pick(r), 0);
  const booked = sum((r) => r.booked);
  const offFill = sum((r) => r.offloaded_fill);
  const offOpt = sum((r) => r.offloaded_opt);
  return {
    flights: rows.length,
    booked,
    offFill,
    offOpt,
    rateFill: booked ? offFill / booked : NaN,
    rateOpt: booked ? offOpt / booked : NaN,
    chargeableFill: sum((r) => r.chargeable_fill),
    chargeableOpt: sum((r) => r.chargeable_opt),
    priorityFill: sum((r) => r.priority_offloaded_fill),
    priorityOpt: sum((r) => r.priority_offloaded_opt),
    checked: rows.filter((r) => r.check_fill && r.check_opt).length,
    optimal: rows.filter((r) => r.opt_status === "OPTIMAL").length,
    /** Flights where CargoPulse is strictly under 5%, by integer arithmetic. */
    under5: rows.filter((r) => r.offloaded_opt * 20 < r.booked).length,
  };
}
