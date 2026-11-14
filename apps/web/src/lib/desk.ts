/**
 * Recovery desk: pure helpers that turn loaded scenarios and R-VaR (urgency)
 * points into what the hero band, departure board, delay slider and scenario
 * list show. Everything here is derived from API data; nothing is invented.
 */
import type { Model, Scenario } from "./types";

export type UrgencyPoint = Model<"UrgencyPoint">;
export type CargoUnit = Model<"CargoUnit">;
export type Flight = Model<"FlightCapacity">;

/** The decision-delay slider runs from the data time to this many hours later. */
export const DELAY_MAX_HOURS = 12;
export const DELAY_STEP_HOURS = 0.5;
const HOUR_MS = 3_600_000;

const time = (value: string | null | undefined) => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
};

/** Tolerant accessors: a missing field gives an empty list, never a crash. */
export const unitsOf = (s: Scenario | undefined): CargoUnit[] => s?.snapshot?.cargo_units ?? [];
export const flightsOf = (s: Scenario | undefined): Flight[] => s?.snapshot?.flights ?? [];

/** The scenario's data time (`as_of`) in ms, or null when it is missing. */
export const dataTime = (s: Scenario | undefined) => time(s?.snapshot?.as_of);

/** True when the scenario's data is past its `valid_until`. */
export function isExpired(s: Scenario | undefined, now: number) {
  const until = time(s?.snapshot?.valid_until);
  return until !== null && until < now;
}

/** The scenario the hero describes by default: the newest current one that has cargo. */
export function pickFocus(scenarios: Scenario[] | undefined): Scenario | undefined {
  if (!scenarios?.length) return undefined;
  const newest = (list: Scenario[]) =>
    list.toSorted((a, b) => (time(b.created_at) ?? 0) - (time(a.created_at) ?? 0))[0];
  const withCargo = scenarios.filter((s) => unitsOf(s).length);
  return newest(withCargo.filter((s) => s.current)) ?? newest(withCargo) ?? scenarios[0];
}

/** What the R-VaR points say about waiting, relative to the scenario's data time. */
export type DelayModel = {
  /** ms epoch the slider's zero stands for (the scenario's `as_of`). */
  base: number;
  /** Units that have R-VaR points. */
  known: Set<string>;
  /** Hours after `base` at which a unit first has no compliant path. Absent: it keeps one. */
  lostAt: Map<string, number>;
  /** Hours after `base` covered by the points. */
  horizon: number;
};

export function buildDelayModel(points: UrgencyPoint[] | undefined, asOf: string | undefined): DelayModel | null {
  const base = time(asOf);
  if (base === null || !Array.isArray(points) || !points.length) return null;
  const known = new Set<string>();
  const lostAt = new Map<string, number>();
  let horizon = 0;
  for (const point of points) {
    const at = time(point.decision_at);
    if (at === null || !point.cargo_unit_id) continue;
    const hours = Math.max(0, (at - base) / HOUR_MS);
    known.add(point.cargo_unit_id);
    horizon = Math.max(horizon, hours);
    if (point.status === "NO_COMPLIANT_PATH" || point.delta_weighted_hours === null) {
      const earlier = lostAt.get(point.cargo_unit_id);
      if (earlier === undefined || hours < earlier) lostAt.set(point.cargo_unit_id, hours);
    }
  }
  return known.size ? { base, known, lostAt, horizon } : null;
}

/** Units with no compliant path left if the decision is taken `hours` after the data time. */
export function lostCountAt(model: DelayModel, hours: number, units?: CargoUnit[]) {
  let count = 0;
  if (units) {
    for (const unit of units) {
      const at = model.lostAt.get(unit.id);
      if (at !== undefined && at <= hours) count += 1;
    }
    return count;
  }
  for (const at of model.lostAt.values()) if (at <= hours) count += 1;
  return count;
}

/** One destination in a scenario, with the cargo and flights that go there. */
export type DeskRoute = {
  origin: string | undefined;
  destination: string;
  units: CargoUnit[];
  uldCodes: string[];
  /** Scheduled flight numbers from the cargo's origin to this destination. */
  flights: string[];
  /** A serviceability or security check on some unit is not a pass. */
  needsCheck: boolean;
  /**
   * Hours after the data time at which every unit on the route is out of
   * flights. null: at least one unit keeps a path. undefined: R-VaR not loaded.
   */
  lostAt: number | null | undefined;
};

const passes = (state: unknown) => /^PASS/i.test(String(state ?? ""));

export function routeSummaries(s: Scenario | undefined, model: DelayModel | null): DeskRoute[] {
  const byDestination = new Map<string, CargoUnit[]>();
  for (const unit of unitsOf(s)) {
    if (!unit.destination) continue;
    byDestination.set(unit.destination, [...(byDestination.get(unit.destination) ?? []), unit]);
  }
  const flights = flightsOf(s);
  return [...byDestination.entries()]
    .map(([destination, units]): DeskRoute => {
      const origins = new Set(units.map((unit) => unit.origin).filter(Boolean));
      let lostAt: DeskRoute["lostAt"];
      if (model) {
        const hours = units.map((unit) => (model.known.has(unit.id) ? model.lostAt.get(unit.id) : undefined));
        lostAt = hours.every((h) => h !== undefined) ? Math.max(...(hours as number[])) : null;
      }
      return {
        origin: units[0]?.origin || undefined,
        destination,
        units,
        uldCodes: units.map((unit) => unit.uld_code).filter(Boolean),
        flights: [
          ...new Set(
            flights
              .filter((f) => f.status === "SCHEDULED" && f.destination === destination && origins.has(f.origin))
              .map((f) => f.flight_number),
          ),
        ],
        needsCheck: units.some((unit) => !passes(unit.serviceability?.state) || !passes(unit.security?.state)),
        lostAt,
      };
    })
    .toSorted((a, b) => b.units.length - a.units.length || a.destination.localeCompare(b.destination));
}

/** Hours (within the slider range) at which some route loses its last connection. */
export function routeLossHours(routes: DeskRoute[]) {
  const hours = new Map<number, string[]>();
  for (const route of routes) {
    if (typeof route.lostAt !== "number" || route.lostAt <= 0 || route.lostAt > DELAY_MAX_HOURS) continue;
    hours.set(route.lostAt, [...(hours.get(route.lostAt) ?? []), route.destination]);
  }
  return [...hours.entries()].map(([at, destinations]) => ({ at, destinations })).toSorted((a, b) => a.at - b.at);
}

export type Cutoff = { at: number; flight: string; origin: string; destination: string };

/** Scheduled flight cutoffs after `after` (ms), soonest first. */
export function upcomingCutoffs(s: Scenario | undefined, after: number, limit = 3): Cutoff[] {
  const list: Cutoff[] = [];
  for (const f of flightsOf(s)) {
    const at = time(f.cutoff_at);
    if (f.status !== "SCHEDULED" || at === null || at <= after) continue;
    list.push({ at, flight: f.flight_number, origin: f.origin, destination: f.destination });
  }
  return list.toSorted((a, b) => a.at - b.at).slice(0, limit);
}

export const nextCutoff = (s: Scenario | undefined, after: number): Cutoff | null =>
  upcomingCutoffs(s, after, 1)[0] ?? null;

/** How many of a scenario's scheduled flight cutoffs have passed `hours` after its data time. */
export function cutoffShare(s: Scenario | undefined, hours: number) {
  const base = dataTime(s);
  let passed = 0;
  let total = 0;
  for (const f of flightsOf(s)) {
    const at = time(f.cutoff_at);
    if (f.status !== "SCHEDULED" || at === null) continue;
    total += 1;
    if (base !== null && at <= base + hours * HOUR_MS) passed += 1;
  }
  return { passed, total, share: total ? passed / total : 0 };
}

/** The decision time the slider stands for, in ms, or null without a data time. */
export function decisionTime(s: Scenario | undefined, hours: number) {
  const base = dataTime(s);
  return base === null ? null : base + hours * HOUR_MS;
}

/** "3" or "3.5": slider hours without a trailing ".0". */
export const hoursLabel = (hours: number) => (Number.isInteger(hours) ? String(hours) : hours.toFixed(1));
