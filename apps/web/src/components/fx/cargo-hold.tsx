"use client";
/**
 * Protect hero: the illustrative 3D lower-deck hold with the real booked AWBs, a
 * policy toggle, and two gauges (weight used vs payload, volume used vs hold) for
 * the policy on show. After each real "Plan this flight" result a short sequence
 * plays (skippable with any click or key): AWBs load in priority-fill order, the
 * offloaded ones are left on the apron, then a gold sweep re-packs the hold to the
 * CargoPulse load plan. Placement is illustrative; the plan checks totals only.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { Model } from "@/lib/types";
import { useFx, usePageVisible, useSkippable } from "@/lib/fx";
import { useLocale } from "../locale";
import { Gauge } from "./gauge";
import { buildHoldLayout, loadedUnder, type Policy } from "./cargo-hold-layout";
import type { HoldPalette, HoldPhase } from "./cargo-hold-scene";

const CargoHoldScene = dynamic(() => import("./cargo-hold-scene").then((m) => m.CargoHoldScene), {
  ssr: false,
  loading: () => <div className="hold-stage__skeleton" aria-hidden="true" />,
});

const fmt = (n: number, digits = 0) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

const TOKENS: Record<keyof HoldPalette, [string, string]> = {
  shell: ["--hold-shell", "#fbfcfb"],
  metal: ["--hold-metal", "#c9d2ce"],
  floor: ["--hold-floor", "#dfe5e2"],
  rail: ["--hold-rail", "#aeb9b4"],
  gold: ["--hold-gold", "#e3c985"],
  spark: ["--hold-spark", "#c9a655"],
  sweep: ["--hold-sweep", "#d9b45a"],
  edge: ["--hold-edge", "#ffffff"],
  shadow: ["--hold-shadow", "#0e2b27"],
  light: ["--hold-light", "#fffaf0"],
  general: ["--hold-general", "#2a78d6"],
  priority: ["--hold-priority", "#eb6834"],
  express: ["--hold-express", "#7b55d4"],
};

/** Resolves the colour tokens to rgb() strings three.js understands. */
function readPalette(el: HTMLElement): HoldPalette {
  const probe = document.createElement("span");
  probe.style.display = "none";
  el.appendChild(probe);
  const out = {} as HoldPalette;
  for (const key of Object.keys(TOKENS) as (keyof HoldPalette)[]) {
    const [name, fallback] = TOKENS[key];
    probe.style.color = "";
    probe.style.color = `var(${name}, ${fallback})`;
    const value = getComputedStyle(probe).color;
    out[key] = /^rgba?\(/.test(value) ? value.replace(/^rgba\(([^,]+,[^,]+,[^,]+),[^)]*\)$/, "rgb($1)") : fallback;
  }
  probe.remove();
  return out;
}

type Tip = { i: number; x: number; y: number };

export function CargoHoldHero({ plan, busy }: { plan: Model<"ProtectPlan">; busy: boolean }) {
  const { t } = useLocale();
  const { motion } = useFx();
  const pageVisible = usePageVisible();
  const headingId = useId();
  const layout = useMemo(() => buildHoldLayout(plan), [plan]);
  const results = Array.isArray(plan.results) ? plan.results : [];
  const fill = results.find((r) => r.policy === "PRIORITY_FILL");
  const opt = results.find((r) => r.policy === "CARGOPULSE_LOAD_OPTIMIZER");

  const [policy, setPolicy] = useState<Policy>("CARGOPULSE_LOAD_OPTIMIZER");
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState<HoldPhase>("done");
  const [replayKey, setReplayKey] = useState(0);
  const [skipKey, setSkipKey] = useState(0);
  const [tip, setTip] = useState<Tip | null>(null);
  const [palette, setPalette] = useState<HoldPalette | null>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [seen, setSeen] = useState(false);
  const [coarse, setCoarse] = useState(false);
  const stage = useRef<HTMLDivElement>(null);

  // Any click or key press while the opening sequence runs jumps to the final plan.
  const skipped = useSkippable(running);
  const wasSkipped = useRef(skipped);
  useEffect(() => {
    if (skipped && !wasSkipped.current && running) setSkipKey((k) => k + 1);
    wasSkipped.current = skipped;
  }, [skipped, running]);

  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    setCoarse(window.matchMedia("(pointer: coarse)").matches);
    const read = () => setPalette(readPalette(el));
    read();
    let raf = 0;
    const themeWatch = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(read);
    });
    themeWatch.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const io = new IntersectionObserver(
      ([entry]) => {
        setOnScreen(entry.isIntersecting);
        if (entry.isIntersecting) setSeen(true);
      },
      { rootMargin: "160px" },
    );
    io.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      io.disconnect();
    };
  }, []);

  const labels = useMemo(() => ({ apron: t("Left behind", "留低"), hold: t("Lower deck hold", "下層貨艙") }), [t]);
  const onHover = useCallback((i: number | null, x: number, y: number) => {
    setTip(i === null ? null : { i, x, y });
  }, []);

  if (!fill || !opt) return null;
  const shown = policy === "PRIORITY_FILL" ? fill : opt;
  const label = (p: Policy) =>
    p === "PRIORITY_FILL" ? t("Priority fill", "按優先級組板") : t("CargoPulse load plan", "CargoPulse 組板");
  const phaseText: Record<HoldPhase, string> = {
    drop: t("Priority fill loads by priority, then booking order", "按優先級組板：先按優先級，再按訂艙次序裝載"),
    offload: t("Out of room: these AWBs are left behind", "空間不足：這些 AWB 被留低"),
    replan: t("CargoPulse re-plans the same flight", "CargoPulse 為同一航班重新組板"),
    done: "",
  };
  const box = tip ? layout.boxes[tip.i] : undefined;
  const rect = stage.current?.getBoundingClientRect();
  const tipStyle =
    tip && rect
      ? {
          left: Math.min(rect.width - 220, Math.max(8, tip.x - rect.left + 14)),
          top: Math.max(8, tip.y - rect.top + 14),
        }
      : undefined;
  const changed = layout.boxes.filter((b) => b.fill !== b.opt).length;

  return (
    <section className={`hold-hero${busy ? " is-busy" : ""}`} aria-labelledby={headingId}>
      <header className="hold-hero__head">
        <div>
          <p className="hold-hero__eyebrow">
            {plan.flight_number} · <span className="hold-hero__synthetic">{t("SYNTHETIC / NOT CONNECTED", "合成數據 / 未連接")}</span>
          </p>
          <h2 id={headingId} className="hold-hero__title">
            {t("Inside the hold", "貨艙內")}
          </h2>
        </div>
        <div className="hold-hero__actions">
          <div
            className="hold-seg"
            role="group"
            aria-label={t("Show the load for", "顯示以下方案的裝載")}
            data-active={policy === "PRIORITY_FILL" ? "0" : "1"}
          >
            <span className="hold-seg__thumb" aria-hidden="true" />
            {(["PRIORITY_FILL", "CARGOPULSE_LOAD_OPTIMIZER"] as Policy[]).map((p) => (
              <button key={p} type="button" aria-pressed={policy === p} onClick={() => setPolicy(p)}>
                {label(p)}
              </button>
            ))}
          </div>
          {motion !== "calm" ? (
            <button
              type="button"
              className="hold-replay"
              onClick={() => setReplayKey((k) => k + 1)}
              aria-label={t("Replay the loading sequence", "重播裝載過程")}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{t("Replay", "重播")}</span>
            </button>
          ) : null}
        </div>
      </header>

      <div className="hold-hero__grid">
        <div
          className="hold-stage"
          ref={stage}
          role="img"
          aria-label={t(
            `Illustrative 3D hold: ${plan.shipments.length} booked AWBs. ${label(policy)} loads ${shown.loaded_count} and leaves ${shown.offloaded_count} behind. ${changed} AWBs differ between the two plans.`,
            `示意 3D 貨艙：${plan.shipments.length} 張已訂艙 AWB。${label(policy)}裝載 ${shown.loaded_count} 張，留低 ${shown.offloaded_count} 張。兩個方案有 ${changed} 張 AWB 不同。`,
          )}
        >
          {seen && palette ? (
            <CargoHoldScene
              layout={layout}
              policy={policy}
              replayKey={replayKey}
              skipKey={skipKey}
              motion={motion}
              active={onScreen && pageVisible}
              coarse={coarse}
              palette={palette}
              labels={labels}
              fallback={t(
                "The 3D view needs WebGL. The tables below show every decision.",
                "3D 視圖需要 WebGL。下方表格列出所有決定。",
              )}
              onPolicy={setPolicy}
              onRunning={setRunning}
              onPhase={setPhase}
              onHover={onHover}
            />
          ) : (
            <div className="hold-stage__skeleton" aria-hidden="true" />
          )}
          <div className="hold-stage__chips">
            <span className="hold-chip">
              <i className="hold-dot hold-dot--in" aria-hidden="true" />
              {t("In the hold", "艙內")} <strong>{fmt(shown.loaded_count)}</strong> AWB
            </span>
            <span className="hold-chip">
              <i className="hold-dot hold-dot--out" aria-hidden="true" />
              {t("Left behind", "留低")} <strong>{fmt(shown.offloaded_count)}</strong>
            </span>
          </div>
          {running && phase !== "done" ? (
            <p className="hold-stage__phase" key={phase}>
              {phaseText[phase]}
            </p>
          ) : null}
          {running && motion !== "calm" ? (
            <p className="hold-stage__skip">{t("Click anywhere to skip", "按任意處略過")}</p>
          ) : null}
          {box && tipStyle ? (
            <div className="hold-tip" style={tipStyle} role="status">
              <strong>{box.id}</strong>
              <span>
                {box.cls.toLowerCase()}
                {box.guaranteed ? ` · ${t("must fly", "必須上機")}` : ""}
              </span>
              <span>
                {fmt(box.kg)} kg · {fmt(box.m3, 2)} m³
              </span>
              <em>
                {label(policy)}:{" "}
                {loadedUnder(box, policy) ? t("✓ loaded", "✓ 上機") : t("— offloaded", "— 甩貨")}
              </em>
            </div>
          ) : null}
        </div>

        <div className="hold-gauges">
          <Gauge
            label={t("Weight used vs payload", "已用重量 / 業載")}
            value={shown.weight_utilization}
            detail={`${fmt(shown.weight_used_kg)} / ${fmt(plan.payload_kg)} kg`}
          />
          <Gauge
            label={t("Volume used vs hold", "已用容積 / 艙容")}
            value={shown.volume_utilization}
            detail={`${fmt(shown.volume_used_m3, 1)} / ${fmt(plan.volume_m3)} m³`}
          />
          <p className="hold-gauges__policy">
            {t("Showing", "顯示")} <strong>{label(policy)}</strong>
          </p>
        </div>
      </div>

      <ul className="hold-legend" aria-label={t("Legend", "圖例")}>
        <li>
          <i className="hold-swatch hold-swatch--express" aria-hidden="true" />
          {t("Express", "特快")}
        </li>
        <li>
          <i className="hold-swatch hold-swatch--priority" aria-hidden="true" />
          {t("Priority", "優先")}
        </li>
        <li>
          <i className="hold-swatch hold-swatch--general" aria-hidden="true" />
          {t("General", "一般")}
        </li>
        <li>
          <i className="hold-swatch hold-swatch--strap" aria-hidden="true" />
          {t("Gold strap: must fly", "金色帶：必須上機")}
        </li>
        <li>
          <i className="hold-swatch hold-swatch--ghost" aria-hidden="true" />
          {t("Gold outline: where an AWB goes under the other plan", "金色框：另一方案中該 AWB 的位置")}
        </li>
      </ul>
      <p className="hold-caption">
        {t(
          "Each box is one booked shipment, sized by its volume. Placement is illustrative; the plan checks total weight and volume only.",
          "每個箱代表一張已訂艙貨件，大小按其容積。擺位僅作示意；方案只核對總重量及總容積。",
        )}{" "}
        {coarse ? null : t("Drag to look around; point at a box for its AWB.", "拖動可轉換視角；指向貨箱可查看其 AWB。")}
      </p>
    </section>
  );
}
