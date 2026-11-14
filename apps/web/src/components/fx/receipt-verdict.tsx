"use client";
/**
 * The verdict card at the top of a recovery proposal: the answer first, on a dark
 * jade jewel surface with a thin gold edge and a foil sheen. Every number is taken
 * from the proposal and its same-snapshot reference plans; numbers count up once
 * when they first arrive (instantly under reduced motion, or on any click).
 */
import { useLayoutEffect, useRef } from "react";
import { useFx } from "@/lib/fx";
import type { Plan } from "@/lib/types";
import { useLocale } from "@/components/locale";
import { policyLabel } from "@/components/charts";

/** A real number that counts up from zero once. The true value is always in the DOM. */
export function Counter({
  value,
  decimals = 0,
  signed = false,
  delay = 0,
  duration = 1200,
}: {
  value: number | null | undefined;
  decimals?: number;
  signed?: boolean;
  delay?: number;
  duration?: number;
}) {
  const { motion } = useFx();
  const node = useRef<HTMLSpanElement>(null);
  const played = useRef(false);
  const format = (v: number) => {
    const body = Math.abs(v).toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    });
    const rounded = Number(v.toFixed(decimals));
    if (rounded === 0) return body;
    return (rounded < 0 ? "−" : signed ? "+" : "") + body;
  };
  const known = value !== null && value !== undefined && Number.isFinite(value);
  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    if (!known) {
      el.textContent = "—";
      return;
    }
    const target = value as number;
    if (played.current || motion === "calm") {
      el.textContent = format(target);
      played.current = true;
      return;
    }
    el.textContent = format(0);
    let frame = 0;
    const started = performance.now() + delay;
    const finish = () => {
      cancelAnimationFrame(frame);
      played.current = true;
      el.textContent = format(target);
    };
    const tick = (now: number) => {
      const p = Math.min(1, Math.max(0, (now - started) / duration));
      el.textContent = format(target * (1 - (1 - p) ** 4));
      if (p < 1) frame = requestAnimationFrame(tick);
      else finish();
    };
    frame = requestAnimationFrame(tick);
    window.addEventListener("pointerdown", finish, { once: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointerdown", finish);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, known, motion]);
  return (
    <span className="vd-num">
      <span className="sr-only">{known ? format(value as number) : "—"}</span>
      <span ref={node} aria-hidden="true">
        —
      </span>
    </span>
  );
}

export function Verdict({
  record,
  alternatives,
  loadingAlternatives,
  children,
}: {
  record: Plan;
  alternatives: Plan[];
  loadingAlternatives: boolean;
  children?: React.ReactNode;
}) {
  const { t } = useLocale();
  const plan = record.plan;
  const engine = plan.solver.engine;
  const subject = engine === "HiGHS" ? "CargoPulse" : policyLabel(engine, t);
  const total = plan.assignments.length + plan.unassigned.length;
  const assigned = plan.assignments.length;
  const cost = plan.solver.objective_value === null ? null : Number(plan.solver.objective_value);
  const refs = alternatives.filter((a) => a.id !== record.id && a.plan.solver.engine !== engine);
  // Best simple rule by count (ties: lower cost), and by cost, from real reference plans.
  const byCount = refs.toSorted(
    (a, b) =>
      b.plan.assignments.length - a.plan.assignments.length ||
      Number(a.plan.solver.objective_value ?? Infinity) - Number(b.plan.solver.objective_value ?? Infinity),
  )[0];
  const costed = refs.filter((r) => r.plan.solver.objective_value !== null);
  const byCost = costed.toSorted(
    (a, b) => Number(a.plan.solver.objective_value) - Number(b.plan.solver.objective_value),
  )[0];
  const moreUlds = byCount ? assigned - byCount.plan.assignments.length : null;
  const refCost = byCost ? Number(byCost.plan.solver.objective_value) : null;
  const costDelta = cost !== null && refCost !== null ? cost - refCost : null;
  const costPct = costDelta !== null && refCost ? (costDelta / refCost) * 100 : null;
  const pass = plan.independent_validation.status === "PASS";
  const gates = plan.independent_validation.checked_gates.filter((g) => /^[A-H]$/.test(g)).length;
  const violations = plan.independent_validation.violations.length;

  let line: string;
  if (moreUlds === null)
    line = t(
      `${subject} finds a compliant flight for ${assigned} of ${total} ULDs.`,
      `${subject} 為 ${total} 個 ULD 中的 ${assigned} 個找到合規航班。`,
    );
  else if (moreUlds > 0)
    line = t(
      `${subject} finds a flight for ${assigned} of ${total} ULDs — ${moreUlds} more than the best simple rule.`,
      `${subject} 為 ${total} 個 ULD 中的 ${assigned} 個找到航班——比最佳簡單規則多 ${moreUlds} 個。`,
    );
  else if (moreUlds === 0)
    line = t(
      `${subject} finds a flight for ${assigned} of ${total} ULDs — the same count as the best simple rule.`,
      `${subject} 為 ${total} 個 ULD 中的 ${assigned} 個找到航班——與最佳簡單規則數目相同。`,
    );
  else
    line = t(
      `${subject} finds a flight for ${assigned} of ${total} ULDs — ${-moreUlds} fewer than the best simple rule.`,
      `${subject} 為 ${total} 個 ULD 中的 ${assigned} 個找到航班——比最佳簡單規則少 ${-moreUlds} 個。`,
    );

  return (
    <section className="verdict-card" data-foil aria-label={t("Verdict", "結論")}>
      <span className="verdict-sweep" aria-hidden="true" />
      <div className="verdict-head">
        <p className="verdict-eyebrow">
          <span className="verdict-rule" aria-hidden="true" />
          {t("The verdict", "結論")}
          <span className="verdict-tag">{t("Synthetic data · not connected", "合成數據 · 未連接")}</span>
        </p>
        <h2 className="verdict-line">{line}</h2>
      </div>
      <div className="verdict-tiles">
        <div className="verdict-tile">
          <span>{t("ULDs given a flight vs best simple rule", "獲分配航班的 ULD（對比最佳簡單規則）")}</span>
          <strong>
            {moreUlds === null ? <Counter value={assigned} /> : <Counter value={moreUlds} signed />}
            <small>{moreUlds === null ? ` / ${total}` : " ULDs"}</small>
          </strong>
          <small>
            {byCount
              ? `${assigned} / ${total} ${t("vs", "對比")} ${byCount.plan.assignments.length} · ${policyLabel(byCount.plan.solver.engine, t)}`
              : loadingAlternatives
                ? t("Loading reference rules…", "正在載入參考規則……")
                : t("No reference rule returned", "未回傳參考規則")}
          </small>
        </div>
        <div className="verdict-tile">
          <span>{t("Total delay cost vs best simple rule", "總延誤成本（對比最佳簡單規則）")}</span>
          <strong>
            <Counter value={costDelta} decimals={1} signed delay={120} />
            <small> {t("weighted h", "加權小時")}</small>
          </strong>
          <small>
            {byCost && costPct !== null
              ? `${costPct <= 0 ? t("lower", "較低") : t("higher", "較高")} ${Math.abs(costPct).toLocaleString(undefined, { maximumFractionDigits: 1 })}% · ${policyLabel(byCost.plan.solver.engine, t)}`
              : cost === null
                ? t("Plan cost not reported", "未報告方案成本")
                : loadingAlternatives
                  ? t("Loading reference rules…", "正在載入參考規則……")
                  : t("No costed reference rule", "沒有附成本的參考規則")}
          </small>
        </div>
        <div className={`verdict-tile verdict-check ${pass ? "is-pass" : "is-fail"}`}>
          <span>{t("Independent check", "獨立檢查")}</span>
          <strong>{pass ? "PASS" : "FAIL"}</strong>
          <small>
            {t(`${gates} gates checked · ${violations} violations`, `已檢查 ${gates} 項條件 · ${violations} 項違規`)}
          </small>
        </div>
      </div>
      {children}
    </section>
  );
}
