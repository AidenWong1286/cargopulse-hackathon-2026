/**
 * Turns a real solver plan into the lanes of the solve swarm: one lane per
 * departing flight a container is assigned to (its first leg), one for the
 * remaining smaller flights when there are too many to list, and "Needs a person"
 * for unassigned containers. Every count is derived from the plan; nothing is
 * estimated. Pure functions, no DOM.
 */
import type { Model } from "@/lib/types";
import { classIndex } from "./swarm-draw";

type Unit = Pick<Model<"CargoUnit">, "id" | "service_class">;
type Flight = Pick<Model<"FlightCapacity">, "id" | "flight_number" | "origin" | "destination">;
type SolutionPlan = Partial<Pick<Model<"SolutionPlan">, "assignments" | "unassigned">>;

export type LaneKind = "flight" | "other" | "person" | "missing";

export type Lane = {
  key: string;
  kind: LaneKind;
  flightNumber?: string;
  origin?: string;
  destination?: string;
  /** For the "other" lane: how many flights it groups. */
  flights?: number;
  /** Containers whose path continues on a further leg after this flight. */
  onward: number;
  count: number;
};

export type LanePlan = {
  lanes: Lane[];
  /** Lane index for every unit id. */
  unitLane: Map<string, number>;
  /** Slot (position within its lane) for every unit id, ordered by cargo class. */
  unitSlot: Map<string, number>;
  assigned: number;
  unassigned: number;
  total: number;
};

export function buildLanes(
  units: readonly Unit[],
  plan: SolutionPlan | undefined,
  flights: readonly Flight[],
  maxFlightLanes: number,
): LanePlan {
  const flightById = new Map(flights.map((f) => [f.id, f]));
  const firstLeg = new Map<string, string>();
  const onward = new Set<string>();
  for (const a of plan?.assignments ?? []) {
    const id = a?.legs?.[0]?.flight_id;
    if (!id) continue;
    firstLeg.set(a.cargo_unit_id, id);
    if ((a.legs?.length ?? 0) > 1) onward.add(a.cargo_unit_id);
  }
  const unassignedIds = new Set((plan?.unassigned ?? []).map((u) => u.cargo_unit_id));

  const perFlight = new Map<string, number>();
  for (const u of units) {
    const f = firstLeg.get(u.id);
    if (f) perFlight.set(f, (perFlight.get(f) ?? 0) + 1);
  }
  const name = (id: string) => flightById.get(id)?.flight_number ?? id;
  const ranked = [...perFlight].sort((a, b) => b[1] - a[1] || name(a[0]).localeCompare(name(b[0])));
  const listed = ranked.length > maxFlightLanes ? ranked.slice(0, Math.max(1, maxFlightLanes - 1)) : ranked;
  const listedIds = new Set(listed.map(([id]) => id));
  const grouped = ranked.length - listed.length;

  const lanes: Lane[] = listed.map(([id]) => {
    const f = flightById.get(id);
    return {
      key: `f:${id}`,
      kind: "flight",
      flightNumber: f?.flight_number ?? id,
      origin: f?.origin,
      destination: f?.destination,
      onward: 0,
      count: 0,
    };
  });
  const laneOfFlight = new Map(listed.map(([id], i) => [id, i]));
  let otherLane = -1;
  if (grouped > 0) {
    otherLane = lanes.length;
    lanes.push({ key: "other", kind: "other", flights: grouped, onward: 0, count: 0 });
  }
  const personLane = lanes.length;
  lanes.push({ key: "person", kind: "person", onward: 0, count: 0 });
  let missingLane = -1;

  const unitLane = new Map<string, number>();
  for (const u of units) {
    const f = firstLeg.get(u.id);
    let lane: number;
    if (f) lane = listedIds.has(f) ? (laneOfFlight.get(f) as number) : otherLane;
    else if (unassignedIds.has(u.id)) lane = personLane;
    else {
      if (missingLane < 0) {
        missingLane = lanes.length;
        lanes.push({ key: "missing", kind: "missing", onward: 0, count: 0 });
      }
      lane = missingLane;
    }
    unitLane.set(u.id, lane);
    lanes[lane].count += 1;
    if (onward.has(u.id)) lanes[lane].onward += 1;
  }

  // Within each lane, group by cargo class so the colours read as neat bands.
  const unitSlot = new Map<string, number>();
  const byLane = lanes.map(() => [] as Unit[]);
  for (const u of units) byLane[unitLane.get(u.id) as number].push(u);
  for (const list of byLane) {
    list
      .toSorted((a, b) => classIndex(a.service_class) - classIndex(b.service_class) || a.id.localeCompare(b.id))
      .forEach((u, i) => unitSlot.set(u.id, i));
  }

  const assigned = units.filter((u) => firstLeg.has(u.id)).length;
  return {
    lanes,
    unitLane,
    unitSlot,
    assigned,
    unassigned: lanes[personLane].count,
    total: units.length,
  };
}

export type LaneLayout = {
  width: number;
  height: number;
  pad: number;
  labelW: number;
  laneH: number;
  pitch: number;
  /** Centre of slot `slot` in lane `lane`. */
  at: (lane: number, slot: number) => [number, number];
};

/** Places lanes in a w × h box: labels on the left, container marks in rows. */
export function layoutLanes(lanes: readonly Lane[], w: number, h: number): LaneLayout {
  const pad = 8;
  const labelW = Math.round(Math.min(280, Math.max(128, w * 0.27)));
  const n = Math.max(1, lanes.length);
  const laneH = Math.max(18, (h - pad * 2) / n);
  const x0 = labelW + 14;
  const aw = Math.max(40, w - x0 - 16);
  const maxCount = Math.max(1, ...lanes.map((l) => l.count));
  // One pitch for all lanes, the largest that lets the fullest lane fit.
  let pitch = 13;
  while (pitch > 2.5) {
    const perRow = Math.max(1, Math.floor(aw / pitch));
    const rows = Math.ceil(maxCount / perRow);
    if (rows * pitch <= laneH * 0.78) break;
    pitch -= 0.5;
  }
  const perRow = Math.max(1, Math.floor(aw / pitch));
  const at = (lane: number, slot: number): [number, number] => {
    const count = lanes[lane]?.count ?? 1;
    const rows = Math.max(1, Math.ceil(count / perRow));
    const row = Math.floor(slot / perRow);
    const col = slot % perRow;
    const cy = pad + lane * laneH + laneH / 2;
    return [x0 + pitch / 2 + col * pitch, cy - ((rows - 1) * pitch) / 2 + row * pitch];
  };
  return { width: w, height: h, pad, labelW, laneH, pitch, at };
}
