/**
 * Pure layout for the illustrative 3D cargo hold (no React, no three.js).
 *
 * Every box is one real booked AWB from the Protect sandbox response. Its size comes
 * from its real volume (width × height × depth = volume_m3), its colour from its real
 * service class, and whether it sits in the hold or on the "Left behind" apron comes
 * from the real policy result. WHERE it sits is illustrative only: the sandbox models
 * total weight and volume, not hold positions, balance or DG segregation.
 */
import type { Model } from "@/lib/types";

export type Policy = "PRIORITY_FILL" | "CARGOPULSE_LOAD_OPTIMIZER";
export type ServiceClass = Model<"ProtectShipment">["service_class"];
export type Vec3 = [number, number, number];

export type HoldBox = {
  key: string;
  id: string;
  cls: ServiceClass;
  guaranteed: boolean;
  kg: number;
  m3: number;
  /** Size in metres: along the fuselage, height, across the floor. */
  w: number;
  h: number;
  d: number;
  /** Resting place in the hold, when loaded under at least one policy. */
  hold: Vec3 | null;
  /** Resting place on the apron, when offloaded under at least one policy. */
  apron: Vec3 | null;
  /** Apron row index, used to queue the box above the hold during the opening. */
  apronRow: number;
  fill: boolean;
  opt: boolean;
  /** Position in the priority-fill loading order (guaranteed, class, booking order). */
  order: number;
};

export type HoldLayout = {
  key: string;
  boxes: HoldBox[];
  /** Hold length along the fuselage (x), floor width (z), usable height (y). */
  length: number;
  floorWidth: number;
  height: number;
  radius: number;
  centerY: number;
  ground: number;
  apronZ: number;
  apronDepth: number;
};

export const FLOOR_W = 4.2;
export const HOLD_H = 1.62;
export const RADIUS = 3;
export const CENTER_Y = Math.sqrt(RADIUS * RADIUS - (FLOOR_W / 2) ** 2);
export const GROUND = CENTER_Y - RADIUS;
const GAP = 0.06;
const RANK: Record<ServiceClass, number> = { EXPRESS: 0, PRIORITY: 1, GENERAL: 2 };

export const loadedUnder = (box: HoldBox, policy: Policy) =>
  policy === "PRIORITY_FILL" ? box.fill : box.opt;
export const restingPlace = (box: HoldBox, policy: Policy): Vec3 =>
  (loadedUnder(box, policy) ? box.hold : box.apron) ?? box.hold ?? box.apron ?? [0, 0, 0];

/** Box dimensions whose product is exactly the AWB volume; long side along the fuselage. */
function dims(volume: number) {
  const v = Math.max(0.005, Number.isFinite(volume) ? volume : 0.005);
  const edge = Math.cbrt(v);
  const h = Math.min(1.5, Math.max(0.24, edge * 1.05));
  const area = v / h;
  let w = Math.sqrt(area * 1.25);
  let d = area / w;
  if (d > FLOOR_W - 0.2) {
    d = FLOOR_W - 0.2;
    w = area / d;
  }
  return { w, h, d };
}

type Item = { i: number; w: number; h: number; d: number };
type Placed = { i: number; u: number; v: number; y: number; row: number };

/**
 * Shelf packing: rows advance along one axis, stacks fill the other axis (span),
 * and smaller boxes stack on top while they fit under maxH.
 * u = centre across the span, v = centre along the advance axis.
 */
function pack(items: Item[], span: number, maxH: number, along: "w" | "d") {
  const across = along === "w" ? "d" : "w";
  const sorted = [...items].sort((a, b) => b.w * b.d - a.w * a.d || b.h - a.h);
  type Stack = { u0: number; su: number; sv: number; top: number };
  type Row = { v0: number; len: number; used: number; stacks: Stack[] };
  const rows: Row[] = [];
  const placed: Placed[] = [];
  for (const item of sorted) {
    const lenV = item[along];
    const lenU = item[across];
    let done = false;
    // 1. Stack on an existing stack.
    for (let r = 0; r < rows.length && !done && maxH > 0; r++) {
      for (const s of rows[r].stacks) {
        if (lenV <= s.sv + 1e-6 && lenU <= s.su + 1e-6 && s.top + item.h <= maxH) {
          placed.push({ i: item.i, u: s.u0 + s.su / 2, v: rows[r].v0 + s.sv / 2, y: s.top + item.h / 2, row: r });
          s.top += item.h + 0.015;
          done = true;
          break;
        }
      }
    }
    // 2. New stack in an open row.
    for (let r = 0; r < rows.length && !done; r++) {
      const row = rows[r];
      if (lenV <= row.len + 1e-6 && row.used + lenU <= span + 1e-6) {
        const s = { u0: row.used, su: lenU, sv: lenV, top: item.h + 0.015 };
        row.stacks.push(s);
        row.used += lenU + GAP;
        placed.push({ i: item.i, u: s.u0 + lenU / 2, v: row.v0 + lenV / 2, y: item.h / 2, row: r });
        done = true;
      }
    }
    // 3. New row.
    if (!done) {
      const last = rows[rows.length - 1];
      const row: Row = { v0: last ? last.v0 + last.len + GAP * 2 : 0, len: lenV, used: 0, stacks: [] };
      rows.push(row);
      const s = { u0: 0, su: lenU, sv: lenV, top: item.h + 0.015 };
      row.stacks.push(s);
      row.used = lenU + GAP;
      placed.push({ i: item.i, u: lenU / 2, v: row.v0 + lenV / 2, y: item.h / 2, row: rows.length - 1 });
    }
  }
  const last = rows[rows.length - 1];
  return { placed, extent: last ? last.v0 + last.len : 0 };
}

export function buildHoldLayout(plan: Model<"ProtectPlan">): HoldLayout {
  const shipments = Array.isArray(plan.shipments) ? plan.shipments : [];
  const base = shipments.map((s, index) => ({ s, index, ...dims(s.volume_m3) }));

  // Priority-fill loading order: guaranteed first, then service class, then booking order.
  const order = [...base]
    .sort(
      (a, b) =>
        Number(b.s.guaranteed) - Number(a.s.guaranteed) ||
        (RANK[a.s.service_class] ?? 3) - (RANK[b.s.service_class] ?? 3) ||
        a.index - b.index,
    )
    .map((x) => x.index);
  const orderOf = new Map(order.map((index, k) => [index, k]));

  // Hold: every AWB loaded under either policy gets one fixed slot, so switching
  // policy moves only the AWBs whose decision differs.
  const inHold = base.filter((x) => x.s.loaded_priority_fill || x.s.loaded_optimized);
  const hold = pack(
    inHold.map((x) => ({ i: x.index, w: x.w, h: x.h, d: x.d })),
    FLOOR_W - 0.12,
    HOLD_H,
    "w",
  );
  const length = Math.max(8, hold.extent + 0.8);

  // Apron: every AWB offloaded under either policy, single tier, rows across the length.
  const onApron = base.filter((x) => !x.s.loaded_priority_fill || !x.s.loaded_optimized);
  const apron = pack(
    onApron.map((x) => ({ i: x.index, w: x.w, h: x.h, d: x.d })),
    length,
    0,
    "d",
  );
  const apronZ = 3.1;

  const holdAt = new Map(hold.placed.map((p) => [p.i, p]));
  const apronAt = new Map(apron.placed.map((p) => [p.i, p]));
  const boxes: HoldBox[] = base.map((x) => {
    const h = holdAt.get(x.index);
    const a = apronAt.get(x.index);
    return {
      key: `${plan.seed}-${x.index}-${x.s.id}`,
      id: x.s.id,
      cls: x.s.service_class,
      guaranteed: !!x.s.guaranteed,
      kg: x.s.weight_kg,
      m3: x.s.volume_m3,
      w: x.w,
      h: x.h,
      d: x.d,
      hold: h ? [h.v - hold.extent / 2, h.y, h.u - (FLOOR_W - 0.12) / 2] : null,
      apron: a ? [a.u - length / 2, GROUND + x.h / 2, apronZ + a.v] : null,
      apronRow: a?.row ?? 0,
      fill: !!x.s.loaded_priority_fill,
      opt: !!x.s.loaded_optimized,
      order: orderOf.get(x.index) ?? x.index,
    };
  });

  return {
    key: `${plan.seed}-${plan.flight_number}-${shipments.length}-${plan.payload_kg}`,
    boxes,
    length,
    floorWidth: FLOOR_W,
    height: HOLD_H,
    radius: RADIUS,
    centerY: CENTER_Y,
    ground: GROUND,
    apronZ,
    apronDepth: Math.max(1.5, apron.extent),
  };
}
