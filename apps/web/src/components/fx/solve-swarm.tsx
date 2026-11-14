"use client";
/**
 * The solve moment. While a real solve job runs, every affected container of the
 * scenario is one glowing particle (coloured by its real cargo class) circling a
 * soft gold core. When the real plan arrives, each particle springs into the lane
 * of the flight the plan gives it, or into "Needs a person" when the plan leaves
 * it unassigned. Then the stage folds into a compact summary card.
 *
 * Honesty: one particle per real container; lanes, counts and the summary come
 * from the stored plan; the stepper shows only statuses the job API returns.
 * Decorative motion is skippable by a click and absent under reduced motion.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Check } from "lucide-react";
import { fetchPlan } from "@/lib/api";
import { useFrameLoop, useFx, useSkippable } from "@/lib/fx";
import { playChime, playTick, playWhoosh } from "@/lib/sound";
import type { Job, Model, Plan } from "@/lib/types";
import { useLocale } from "../locale";
import { ShimmerTitle } from "./shimmer-title";
import {
  CLASS_KEYS,
  CLASS_LABEL,
  classIndex,
  fitCanvas,
  readPalette,
  rgba,
  uldPath,
  type Palette,
} from "./swarm-draw";
import { buildLanes, layoutLanes } from "./swarm-lanes";

/** The page-level memory of this moment (kept by the page so it survives reloads). */
export type SwarmMoment = "none" | "live" | "landed" | "done";

type Props = {
  units: readonly Model<"CargoUnit">[];
  flights: readonly Model<"FlightCapacity">[];
  job: Job | undefined;
  planId: string | null | undefined;
  moment: SwarmMoment;
  setMoment: (moment: SwarmMoment) => void;
};

const ACTIVE = ["QUEUED", "RUNNING", "VALIDATING"];
const STEPS = [
  ["QUEUED", "Queued", "排隊中"],
  ["RUNNING", "Solving", "求解中"],
  ["VALIDATING", "Independent check", "獨立檢查"],
  ["COMPLETED", "Ready", "已就緒"],
] as const;
const TRAIL = 7;
const MAX_FLIGHT_LANES = 8;
const TAU = Math.PI * 2;

type Particle = {
  id: string;
  cls: number;
  lane: number;
  slot: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  tx: number;
  ty: number;
  r0: number;
  th0: number;
  w: number;
  z: number;
  ph: number;
  depth: number;
  delay: number;
  landed: boolean;
  landT: number;
  hist: Float32Array;
  hn: number;
};

/** Stable 0..1 value from a string, so a remount draws the same galaxy. */
function hash(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

function makeParticle(id: string, serviceClass: string): Particle {
  const r0 = 0.16 + 0.84 * Math.sqrt(hash(id));
  const arm = Math.floor(hash(`${id}:arm`) * 3);
  return {
    id,
    cls: classIndex(serviceClass),
    lane: 0,
    slot: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    tx: 0,
    ty: 0,
    r0,
    th0: (arm * TAU) / 3 + r0 * 3.6 + (hash(`${id}:j`) - 0.5) * 0.9,
    w: 0.42 / (0.35 + r0),
    z: hash(`${id}:z`) - 0.5,
    ph: hash(`${id}:p`) * TAU,
    depth: 0,
    delay: 0,
    landed: false,
    landT: -10,
    hist: new Float32Array(TRAIL * 2),
    hn: 0,
  };
}

export default function SolveSwarm({ units, flights, job, planId, moment, setMoment }: Props) {
  const { t, locale } = useLocale();
  const { motion, theme } = useFx();
  const lite = motion === "lite";
  const calm = motion === "calm";

  // ── Real plan for the current plan id ──
  const [loaded, setLoaded] = useState<{ id: string; data: Plan } | null>(null);
  const [planError, setPlanError] = useState<string | null>(null);
  useEffect(() => {
    if (!planId || loaded?.id === planId) return;
    const controller = new AbortController();
    fetchPlan(planId, controller.signal)
      .then((data) => setLoaded({ id: planId, data }))
      .catch(() => {
        if (!controller.signal.aborted) setPlanError(planId);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planId]);
  const plan = loaded && loaded.id === planId ? loaded.data : undefined;

  // ── Phase, from real job state only ──
  const live = moment === "live" || moment === "landed";
  const status = job?.status;
  const active = !!status && ACTIVE.includes(status);
  const failed =
    !!job &&
    (status === "FAILED" || status === "CANCELLED" || (status === "COMPLETED" && !job.plan_id));
  let phase: "hidden" | "swirl" | "lanes" | "fading" = "hidden";
  if (units.length) {
    if (live && (failed || (!!planId && planError === planId))) phase = "fading";
    else if (active || (live && !plan)) phase = "swirl";
    else if (plan) phase = "lanes";
  }
  const landing = phase === "lanes" && moment === "live";
  const compact = phase === "lanes" && (moment === "done" || moment === "none");
  const skipped = useSkippable(phase === "swirl" || landing);

  const lanePlan = useMemo(
    () => (plan ? buildLanes(units, plan.plan, flights, MAX_FLIGHT_LANES) : null),
    [plan, units, flights],
  );
  const laneCount = lanePlan?.lanes.length ?? 0;
  const bodyH =
    phase === "lanes"
      ? compact
        ? Math.max(96, laneCount * 30 + 16)
        : Math.min(560, Math.max(320, laneCount * 42 + 16))
      : 360;

  // ── Size and colours ──
  const bodyRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    const measure = () => {
      const box = el.getBoundingClientRect();
      setSize((s) =>
        Math.abs(s.w - box.width) < 0.5 && Math.abs(s.h - box.height) < 0.5 ? s : { w: box.width, h: box.height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase === "hidden"]);
  const [palette, setPalette] = useState<Palette | null>(null);
  const palRef = useRef(palette);
  palRef.current = palette;
  useEffect(() => {
    if (phase === "hidden" || !bodyRef.current) return;
    setPalette(readPalette(bodyRef.current));
  }, [theme, phase === "hidden"]);

  const layout = useMemo(
    () => (lanePlan && size.w > 0 && size.h > 0 ? layoutLanes(lanePlan.lanes, size.w, size.h) : null),
    [lanePlan, size.w, size.h],
  );

  // ── Simulation state (mutable, outside React) ──
  const sim = useRef({
    ps: [] as Particle[],
    landStart: -1,
    finished: false,
    counts: [] as number[],
    lastTick: 0,
    lastPush: 0,
    lastLand: -10,
    core: 0,
    fade: 1,
    bloomT: -1,
    idle: false,
  });
  const [shown, setShown] = useState<number[] | null>(null);
  const [idle, setIdle] = useState(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    sim.current.ps = units.map((u) => makeParticle(u.id, u.service_class));
    sim.current.bloomT = -1;
  }, [units]);

  function snapAll() {
    const s = sim.current;
    s.counts = lanePlan ? lanePlan.lanes.map((l) => l.count) : [];
    for (const p of s.ps) {
      p.x = p.tx;
      p.y = p.ty;
      p.vx = p.vy = 0;
      p.landed = true;
      p.hn = 0;
    }
  }
  function finish(withSound: boolean) {
    const s = sim.current;
    if (s.finished) return;
    s.finished = true;
    setShown(null);
    if (withSound) playChime();
    setMoment("landed");
  }

  // A new solve: back to the vortex.
  useEffect(() => {
    if (phase !== "swirl") return;
    const s = sim.current;
    if (s.landStart >= 0 || s.finished) s.bloomT = -1;
    s.landStart = -1;
    s.finished = false;
    for (const p of s.ps) {
      p.landed = false;
      p.hn = 0;
    }
    setShown(null);
  }, [phase]);

  // Lane targets from the real plan, and the start (or skip) of the landing.
  useEffect(() => {
    if (phase !== "lanes" || !layout || !lanePlan) return;
    const s = sim.current;
    for (const p of s.ps) {
      p.lane = lanePlan.unitLane.get(p.id) ?? 0;
      p.slot = lanePlan.unitSlot.get(p.id) ?? 0;
      [p.tx, p.ty] = layout.at(p.lane, p.slot);
    }
    if (moment === "live") {
      if (skipped || calm) {
        snapAll();
        finish(false);
      } else if (s.landStart < 0) {
        s.landStart = performance.now() / 1000;
        s.finished = false;
        s.counts = lanePlan.lanes.map(() => 0);
        const order = s.ps.toSorted((a, b) => a.lane - b.lane || a.slot - b.slot);
        const spread = Math.min(1.9, 0.6 + order.length * 0.006);
        order.forEach((p, i) => {
          p.delay = 0.15 + (i / Math.max(1, order.length - 1)) * spread;
          p.landed = false;
        });
        setShown(s.counts.slice());
        playWhoosh();
      }
    } else if (s.landStart < 0) {
      snapAll();
    }
    s.idle = false;
    setIdle(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, layout, lanePlan, moment, skipped, calm]);

  // Hold the placed lanes briefly, then fold into the compact card.
  useEffect(() => {
    if (moment !== "landed") return;
    const timer = setTimeout(() => setMoment("done"), calm ? 600 : 2600);
    return () => clearTimeout(timer);
  }, [moment, calm, setMoment]);

  // A failed or empty solve fades calmly; the page's error notice explains it.
  useEffect(() => {
    if (phase !== "fading") return;
    const timer = setTimeout(() => setMoment("none"), calm ? 0 : 900);
    return () => clearTimeout(timer);
  }, [phase, calm, setMoment]);

  // ── Drawing ──
  function frame(T: number, dt: number, animate: boolean) {
    const canvas = canvasRef.current;
    const pal = palRef.current;
    const { w, h } = sizeRef.current;
    if (!canvas || !pal || !w || !h) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = fitCanvas(canvas, w, h, lite);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = sim.current;
    const ps = s.ps;
    const ph = phaseRef.current;
    const swirling = ph === "swirl" || ph === "fading";
    const inLanes = ph === "lanes";

    if (s.bloomT < 0) s.bloomT = T;
    const bloomK = animate ? Math.min(1, (T - s.bloomT) / 1.4) : 1;
    const bloom = 1 - Math.pow(1 - bloomK, 3);
    const coreTarget = ph === "swirl" ? 1 : 0;
    s.core = animate ? s.core + (coreTarget - s.core) * Math.min(1, dt * 2.5) : coreTarget;
    s.fade = ph === "fading" ? (animate ? Math.max(0, s.fade - dt * 1.3) : 0) : 1;
    if (s.fade <= 0) return;

    const cx = w / 2;
    const cy = h * 0.5;
    const rx = Math.min(w * 0.44, h * 1.3);
    const ry = Math.min(rx * 0.36, h * 0.42);
    const spin = calm ? 0 : T;
    const drift = 1 + (1 - s.fade) * 0.5;

    ctx.globalAlpha = s.fade;
    // The gold core and its slow orbit rings.
    if (s.core > 0.01) {
      const breathe = animate ? 0.9 + 0.1 * Math.sin(T * 1.6) : 1;
      const k = s.core * breathe;
      const R = rx * 0.42 * Math.max(0.3, bloom);
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R);
      g.addColorStop(0, rgba(pal.goldPale, 0.9 * k));
      g.addColorStop(0.2, rgba(pal.gold, 0.5 * k));
      g.addColorStop(0.6, rgba(pal.goldDeep, 0.12 * k));
      g.addColorStop(1, rgba(pal.goldDeep, 0));
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.ellipse(cx, cy, R, R * 0.62, 0, 0, TAU);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 7]);
      const rings = lite ? [0.66] : [0.38, 0.66, 0.98];
      rings.forEach((rk, i) => {
        ctx.strokeStyle = rgba(pal.goldDeep, 0.38 * s.core * (1.1 - rk * 0.45));
        ctx.lineDashOffset = (i % 2 ? 1 : -1) * spin * 14;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * rk * bloom, ry * rk * bloom, 0, 0, TAU);
        ctx.stroke();
      });
      ctx.setLineDash([]);
      ctx.globalAlpha = s.fade * s.core;
      ctx.drawImage(pal.goldSprite, cx - 34, cy - 34, 68, 68);
      ctx.globalAlpha = s.fade;
    }

    // Motion.
    const elapsed = s.landStart >= 0 ? T - s.landStart : Infinity;
    let landedNow = 0;
    let lastLane = 0;
    let landedTotal = 0;
    let moving = 0;
    const trails = animate && !lite;
    for (const p of ps) {
      const orbiting = swirling || (inLanes && animate && s.landStart >= 0 && !s.finished && elapsed < p.delay);
      const px = p.x;
      const py = p.y;
      if (orbiting) {
        const th = p.th0 + p.w * spin;
        const r = p.r0 * (1 + 0.04 * Math.sin(spin * 0.9 + p.ph)) * bloom * drift;
        const sx = cx + Math.cos(th) * r * rx;
        const sy = cy + Math.sin(th) * r * ry + p.z * ry * 0.22 * (1 - p.r0 * 0.5);
        if (animate && dt > 0) {
          const vx = (sx - p.x) / dt;
          const vy = (sy - p.y) / dt;
          const sp = Math.hypot(vx, vy);
          const cap = sp > 520 ? 520 / sp : 1;
          p.vx = vx * cap;
          p.vy = vy * cap;
        }
        p.x = sx;
        p.y = sy;
        p.depth = Math.sin(th);
      } else if (inLanes) {
        if (!animate) {
          p.x = p.tx;
          p.y = p.ty;
          p.vx = p.vy = 0;
          if (!p.landed) {
            p.landed = true;
            s.counts[p.lane] = (s.counts[p.lane] ?? 0) + 1;
          }
        } else {
          const k = 120;
          const c = 12.5;
          p.vx += (k * (p.tx - p.x) - c * p.vx) * dt;
          p.vy += (k * (p.ty - p.y) - c * p.vy) * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const d2 = (p.tx - p.x) ** 2 + (p.ty - p.y) ** 2;
          const v2 = p.vx * p.vx + p.vy * p.vy;
          if (!p.landed && d2 < 1.2 && v2 < 400) {
            p.landed = true;
            p.landT = T;
            s.lastLand = T;
            s.counts[p.lane] = (s.counts[p.lane] ?? 0) + 1;
            landedNow++;
            lastLane = p.lane;
          }
          if (d2 > 0.02 || v2 > 0.05) moving++;
          else {
            p.x = p.tx;
            p.y = p.ty;
            p.vx = p.vy = 0;
          }
        }
        p.depth = 1;
      }
      if (p.landed) landedTotal++;
      if (trails && !p.landed) {
        const moved = Math.abs(p.x - px) + Math.abs(p.y - py);
        // A jump (slow frame, reset) would draw a long straight chord: restart the trail.
        if (moved > 28) p.hn = 0;
        if (moved > 0.3) {
          p.hist.copyWithin(2, 0, (TRAIL - 1) * 2);
          p.hist[0] = p.x;
          p.hist[1] = p.y;
          p.hn = Math.min(TRAIL, p.hn + 1);
        } else if (p.hn > 0) p.hn--;
      } else p.hn = 0;
    }

    // Faint gold trails, batched by age.
    if (trails) {
      for (let j = 0; j < TRAIL - 1; j++) {
        ctx.beginPath();
        let any = false;
        for (const p of ps) {
          if (p.hn <= j + 1) continue;
          const sx = p.hist[j * 2 + 2] - p.hist[j * 2];
          const sy = p.hist[j * 2 + 3] - p.hist[j * 2 + 1];
          if (sx * sx + sy * sy > 24 * 24) continue;
          ctx.moveTo(p.hist[j * 2], p.hist[j * 2 + 1]);
          ctx.lineTo(p.hist[j * 2 + 2], p.hist[j * 2 + 3]);
          any = true;
        }
        if (!any) continue;
        const a = 1 - j / (TRAIL - 1);
        ctx.strokeStyle = rgba(pal.goldDeep, 0.42 * a);
        ctx.lineWidth = 0.4 + 1.3 * a;
        ctx.stroke();
      }
    }

    // Particles in flight: glow + crisp centre. Landed ones: ULD marks.
    const pitch = layout?.pitch ?? 8;
    ctx.globalCompositeOperation = pal.night ? "lighter" : "source-over";
    for (const p of ps) {
      if (inLanes && p.landed) continue;
      const d = (p.depth + 1) / 2;
      const r = (lite ? 3.2 : 3.6) + 2.8 * d;
      ctx.globalAlpha = s.fade * (0.5 + 0.5 * d);
      ctx.drawImage(pal.sprites[p.cls], p.x - r * 2, p.y - r * 2, r * 4, r * 4);
    }
    ctx.globalCompositeOperation = "source-over";
    ctx.globalAlpha = s.fade;
    for (let c = 0; c < CLASS_KEYS.length; c++) {
      ctx.beginPath();
      let dots = false;
      let marks = false;
      for (const p of ps) {
        if (p.cls !== c) continue;
        if (inLanes && p.landed) continue;
        ctx.moveTo(p.x + 1.4, p.y);
        ctx.arc(p.x, p.y, 1.4, 0, TAU);
        dots = true;
      }
      if (dots) {
        ctx.fillStyle = rgba(pal.classes[c], 1);
        ctx.fill();
      }
      if (!inLanes) continue;
      ctx.beginPath();
      for (const p of ps) {
        if (p.cls !== c || !p.landed) continue;
        uldPath(ctx, p.x, p.y, pitch * 0.78);
        marks = true;
      }
      if (marks) {
        ctx.fillStyle = rgba(pal.classes[c], 1);
        ctx.fill();
      }
    }
    // A small gold ring where each container lands.
    if (inLanes && animate) {
      ctx.lineWidth = 1;
      for (const p of ps) {
        const age = T - p.landT;
        if (age < 0 || age > 0.45) continue;
        const k = age / 0.45;
        ctx.strokeStyle = rgba(pal.gold, 0.85 * (1 - k));
        ctx.beginPath();
        ctx.arc(p.x, p.y, pitch * (0.45 + 1.1 * k), 0, TAU);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    if (!animate || !inLanes) return;
    if (landedNow && T - s.lastTick > 0.045) {
      s.lastTick = T;
      playTick(0.85 + 0.6 * (lastLane / Math.max(1, (lanePlan?.lanes.length ?? 1) - 1)));
    }
    if (s.landStart >= 0 && !s.finished) {
      if (T - s.lastPush > 0.07) {
        s.lastPush = T;
        setShown(s.counts.slice());
      }
      if (landedTotal === ps.length) finish(true);
    }
    if (s.finished && !moving && T - s.lastLand > 0.5 && ps.every((p) => p.hn === 0) && !s.idle) {
      s.idle = true;
      setIdle(true);
    }
  }

  const loopOn = phase !== "hidden" && !calm && !(phase === "lanes" && (idle || sim.current.landStart < 0));
  useFrameLoop((T, dt) => frame(T, dt, true), loopOn);
  useEffect(() => {
    if (phase === "hidden" || loopOn) return;
    frame(performance.now() / 1000, 0, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopOn, phase, layout, palette, lanePlan, size.w, size.h, status]);

  if (phase === "hidden") return null;

  // ── Markup ──
  const total = units.length;
  const classCounts = CLASS_KEYS.map((_, i) => units.filter((u) => classIndex(u.service_class) === i).length);
  const stepIndex = Math.max(
    0,
    STEPS.findIndex(([s]) => s === status),
  );
  const ready = phase === "lanes";
  const showSteps = live || phase === "swirl";
  const settled = phase === "lanes" && moment !== "live";
  const assigned = lanePlan?.assigned ?? 0;
  const people = lanePlan?.unassigned ?? 0;
  const title =
    phase === "swirl"
      ? t(`Finding flights for ${total} containers`, `正在為 ${total} 個貨櫃尋找航班`)
      : phase === "fading"
        ? t("No proposal from this solve", "今次求解未有建議方案")
        : compact
          ? t("Proposal at a glance", "建議方案一覽")
          : t("Where each container goes", "每個貨櫃的去向");

  return (
    <section
      className="swarm glass"
      data-phase={phase}
      data-compact={compact || undefined}
      aria-label={t("Solve overview", "求解概覽")}
    >
      <header className="swarm-head">
        <div className="swarm-titles">
          <p className="swarm-kicker">{t("Proposal engine · synthetic data", "建議方案引擎 · 合成數據")}</p>
          {phase === "swirl" && !calm ? (
            <ShimmerTitle key={title} as="h2" className="swarm-title" text={title} />
          ) : (
            <h2 className="swarm-title">{title}</h2>
          )}
        </div>
        {showSteps ? (
          <ol className="swarm-steps" aria-label={t("Solve job status", "求解工作狀態")}>
            {STEPS.map(([key, en, zh], i) => {
              const state =
                phase === "fading"
                  ? i < stepIndex
                    ? "done"
                    : "pending"
                  : ready || i < stepIndex
                    ? "done"
                    : i === stepIndex
                      ? "current"
                      : "pending";
              return (
                <li key={key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                  <span className="swarm-step-mark" aria-hidden="true">
                    {state === "done" ? <Check size={11} strokeWidth={2.75} /> : null}
                  </span>
                  {t(en, zh)}
                </li>
              );
            })}
          </ol>
        ) : null}
      </header>

      <div className="swarm-body" ref={bodyRef} style={{ height: bodyH }}>
        {phase === "lanes" && layout && lanePlan ? (
          <ol className="swarm-lanes" aria-label={t("Containers by flight", "按航班劃分的貨櫃")}>
            {lanePlan.lanes.map((lane, i) => {
              const count = shown?.[i] ?? lane.count;
              return (
                <li
                  key={lane.key}
                  className="swarm-lane"
                  data-kind={lane.kind}
                  style={
                    {
                      top: layout.pad + i * layout.laneH,
                      height: layout.laneH,
                      "--label-w": `${layout.labelW}px`,
                    } as CSSProperties
                  }
                >
                  <span className="swarm-lane-label">
                    {lane.kind === "flight" ? (
                      <>
                        <strong className="swarm-flight">{lane.flightNumber}</strong>
                        {lane.origin && lane.destination ? (
                          <span className="swarm-route">
                            {lane.origin} → {lane.destination}
                          </span>
                        ) : null}
                      </>
                    ) : lane.kind === "other" ? (
                      <strong>{t(`${lane.flights} other flights`, `其他 ${lane.flights} 班航班`)}</strong>
                    ) : lane.kind === "person" ? (
                      <strong>{t("Needs a person", "需要人手處理")}</strong>
                    ) : (
                      <strong>{t("Not in this plan", "不在此方案內")}</strong>
                    )}
                    <span className="swarm-count" aria-hidden="true">
                      {count}
                    </span>
                    <span className="sr-only">
                      {t(`${lane.count} containers`, `${lane.count} 個貨櫃`)}
                      {lane.onward ? t(`, ${lane.onward} connect onward`, `，其中 ${lane.onward} 個轉駁`) : ""}
                    </span>
                  </span>
                  {lane.onward && !compact ? (
                    <span className="swarm-onward" aria-hidden="true">
                      {t(`${lane.onward} connect onward`, `${lane.onward} 個轉駁`)}
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ol>
        ) : null}
        <canvas ref={canvasRef} className="swarm-canvas" aria-hidden="true" />
        {(phase === "swirl" || landing) && !calm ? (
          <p className="swarm-skip">{t("Click anywhere to skip the animation", "按任何位置略過動畫")}</p>
        ) : null}
      </div>

      <footer className="swarm-foot">
        <ul className="swarm-legend" aria-label={t("Cargo classes", "貨物類別")}>
          {CLASS_KEYS.map((key, i) =>
            classCounts[i] ? (
              <li key={key} style={{ "--swatch": `var(--viz-class-${key.toLowerCase()})` } as CSSProperties}>
                <span className="swarm-swatch" aria-hidden="true" />
                {t(CLASS_LABEL[key][0], CLASS_LABEL[key][1])} <b>{classCounts[i]}</b>
              </li>
            ) : null,
          )}
        </ul>
        {settled && lanePlan ? (
          <p className="swarm-summary" role="status">
            {locale === "en" ? (
              <>
                <b>{assigned}</b> of {total} containers get a flight
              </>
            ) : (
              <>
                {total} 個貨櫃中，<b>{assigned}</b> 個獲分配航班
              </>
            )}
            {people ? (
              <span className="swarm-summary-people">
                {t(` · ${people} need a person`, ` · ${people} 個需要人手處理`)}
              </span>
            ) : null}
          </p>
        ) : null}
      </footer>
    </section>
  );
}
