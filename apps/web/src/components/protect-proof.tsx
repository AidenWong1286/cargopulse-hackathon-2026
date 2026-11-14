"use client";
import { useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { Dices, Download, Play, Square } from "lucide-react";
import {
  pooled,
  protectBatch,
  protectCalibrate,
  randomSeed,
  type ProtectRow,
} from "@/lib/proof";
import type { ProtectBatch, ProtectCalibration } from "@/lib/types";
import { FlapNumber } from "./kit/flap-number";
import { Panel } from "./kit/panel";
import { useLocale } from "./locale";
import { ErrorNotice, Fold } from "./ui";

const FLIGHTS = [100, 150, 200] as const;
const AWBS = [60, 150] as const;
/** Lower overbooking levels to sweep, as booked ÷ capacity. */
const SWEEP = [1.0, 1.02, 1.04, 1.06, 1.08] as const;

const pct = (value: number, digits = 1) =>
  Number.isFinite(value) ? `${(value * 100).toFixed(digits)}%` : "—";
const overbooking = (demand: number) => `${((demand - 1) * 100).toFixed(1)}%`;

type Point = { demand: number; batch: ProtectBatch };

/**
 * Protect evidence on 100+ seeded flights. The overbooking level is set first so the
 * simple rule offloads 11.28% (the observed reference rate); CargoPulse then runs on
 * exactly the same flights, and every plan is re-checked independently.
 */
export function ProtectProof() {
  const { t } = useLocale();
  const [flights, setFlights] = useState<number>(100);
  const [awbs, setAwbs] = useState<number>(150);
  const [seedStart, setSeedStart] = useState(1);
  const [calibration, setCalibration] = useState<ProtectCalibration>();
  const [main, setMain] = useState<ProtectBatch>();
  const [sweep, setSweep] = useState<Point[]>([]);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<unknown>();
  const stop = useRef<AbortController | null>(null);
  const running = stage !== "";

  async function run() {
    const controller = new AbortController();
    stop.current = controller;
    setError(undefined);
    setCalibration(undefined);
    setMain(undefined);
    setSweep([]);
    try {
      setStage(t("Setting the overbooking so the simple rule offloads 11.28%…", "正在設定超額訂艙，使簡單規則的甩貨率為 11.28%……"));
      const cal = await protectCalibrate(flights, awbs, seedStart, controller.signal);
      setCalibration(cal);
      setStage(t(`Planning ${flights} flights with both methods…`, `正在以兩種方法規劃 ${flights} 班航班……`));
      const batch = await protectBatch(cal.demand, flights, awbs, seedStart, controller.signal);
      setMain(batch);
      for (const demand of SWEEP) {
        if (controller.signal.aborted || demand >= cal.demand - 0.004) continue;
        setStage(
          t(
            `Trying lower overbooking: ${overbooking(demand)}…`,
            `正在嘗試較低的超額訂艙：${overbooking(demand)}……`,
          ),
        );
        const point = await protectBatch(demand, flights, awbs, seedStart, controller.signal);
        setSweep((done) => [...done, { demand, batch: point }]);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      setStage("");
      stop.current = null;
    }
  }

  const result = main ? pooled(main.rows) : null;
  // Reference billable weight: what the simple rule carries at the calibrated level.
  const reference = result?.chargeableFill ?? 0;
  const points = [
    ...(main ? [{ demand: main.demand, batch: main }] : []),
    ...sweep,
  ].toSorted((a, b) => a.demand - b.demand);
  // Highest overbooking where CargoPulse is under 5% and carries at least the rule's weight.
  const under5 = points
    .map((p) => ({ demand: p.demand, ...pooled(p.batch.rows) }))
    .filter((p) => p.offOpt * 20 < p.booked && p.chargeableOpt >= reference)
    .toSorted((a, b) => b.demand - a.demand)[0];

  function exportCsv() {
    if (!main) return;
    const header = Object.keys(main.rows[0] ?? {}).join(",");
    const lines = points.flatMap((p) =>
      p.batch.rows.map((r) => [p.demand, ...Object.values(r)].join(",")),
    );
    const url = URL.createObjectURL(
      new Blob([`demand,${header}\n${lines.join("\n")}\n`], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cargopulse-protect-proof-${flights}x${awbs}-seed${seedStart}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="proof-checks">
        <article>
          <h2>{t("1. Fair starting point", "1. 公平的起點")}</h2>
          <p>
            {t(
              "Overbooking is set so the simple rule (load by priority) offloads 11.28% of booked AWBs, the observed rate. CargoPulse plays no part in that choice.",
              "先設定超額訂艙，使簡單規則（按優先級裝載）的甩貨率等於觀察所得的 11.28%。CargoPulse 不參與這個設定。",
            )}
          </p>
        </article>
        <article>
          <h2>{t("2. Same flights, both methods", "2. 相同航班，兩種方法")}</h2>
          <p>
            {t(
              "Every flight is planned by the simple rule and by CargoPulse. A separate check confirms no plan exceeds weight or space or drops a guaranteed booking.",
              "每班航班都由簡單規則及 CargoPulse 分別規劃。另一個獨立檢查確認沒有方案超重、超出艙容或甩下保證貨件。",
            )}
          </p>
        </article>
        <article>
          <h2>{t("3. Truly the best load", "3. 真正最佳的組板")}</h2>
          <p>
            {t(
              "On small flights the automated tests try every possible load and confirm CargoPulse finds the best one. Here the solver also proves optimality on every flight.",
              "在小型航班上，自動測試會嘗試所有可能組板，確認 CargoPulse 找到最佳方案。這裡求解器亦會為每班航班證明最優。",
            )}
          </p>
        </article>
      </div>

      <section className="proof-controls" aria-label={t("Run settings", "執行設定")}>
        <label>
          {t("Flights", "航班數目")}
          <select value={flights} onChange={(e) => setFlights(Number(e.target.value))} disabled={running}>
            {FLIGHTS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Booked AWBs per flight", "每班已訂 AWB")}
          <select value={awbs} onChange={(e) => setAwbs(Number(e.target.value))} disabled={running}>
            {AWBS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("First seed", "首個種子")}
          <input
            type="number"
            min={1}
            max={1_000_000}
            value={seedStart}
            onChange={(e) => setSeedStart(Math.max(1, Math.min(1_000_000, Number(e.target.value) || 1)))}
            disabled={running}
          />
        </label>
        <button type="button" className="button" onClick={() => setSeedStart(randomSeed())} disabled={running}>
          <Dices size={16} strokeWidth={1.75} aria-hidden="true" />
          {t("New random flights", "新的隨機航班")}
        </button>
        {running ? (
          <button type="button" className="button" onClick={() => stop.current?.abort()}>
            <Square size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("Stop", "停止")}
          </button>
        ) : (
          <button type="button" className="button primary" onClick={run}>
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("Run the Protect proof", "執行 Protect 驗證")}
          </button>
        )}
        <p className="proof-progress" role="status">
          {running
            ? stage
            : t(
                `Flights use seeds ${seedStart} to ${seedStart + flights - 1}, so anyone can repeat the run.`,
                `航班使用種子 ${seedStart} 至 ${seedStart + flights - 1}，任何人都可以重複執行。`,
              )}
        </p>
      </section>
      <ErrorNotice error={error} />

      {result && calibration ? (
        <>
          <p className="proof-headline">
            {t(
              `On ${result.flights} random flights, with overbooking set so loading by priority offloads ${pct(result.rateFill, 2)} of AWBs, CargoPulse offloads ${pct(result.rateOpt, 2)} and carries ${pct(result.chargeableOpt / result.chargeableFill - 1, 1)} more billable weight.`,
              `在 ${result.flights} 班隨機航班上，當超額訂艙令按優先級裝載的甩貨率為 ${pct(result.rateFill, 2)}，CargoPulse 的甩貨率為 ${pct(result.rateOpt, 2)}，並多運 ${pct(result.chargeableOpt / result.chargeableFill - 1, 1)} 計費重量。`,
            )}
            {under5
              ? t(
                  ` Trimming overbooking to ${overbooking(under5.demand)} takes CargoPulse to ${pct(under5.rateOpt, 2)}, still carrying more billable weight than the simple rule does today.`,
                  ` 若把超額訂艙收緊至 ${overbooking(under5.demand)}，CargoPulse 的甩貨率降至 ${pct(under5.rateOpt, 2)}，而所運計費重量仍多於現時簡單規則。`,
                )
              : ""}
          </p>
          <section className="board proof-board" aria-label={t("Protect proof results", "Protect 驗證結果")}>
            <div className="proof-board-grid">
              <div className="board-row">
                <p className="board-label">
                  {t("Simple rule offload rate", "簡單規則甩貨率")}
                  <small>
                    {t(`calibrated · overbooked ${overbooking(calibration.demand)}`, `已校準 · 超額訂艙 ${overbooking(calibration.demand)}`)}
                  </small>
                </p>
                <FlapNumber value={pct(result.rateFill, 2)} minLength={6} size="lg" />
              </div>
              <div className="board-row">
                <p className="board-label">
                  {t("CargoPulse offload rate", "CargoPulse 甩貨率")}
                  <small>{t("same flights, same bookings", "相同航班、相同訂艙")}</small>
                </p>
                <FlapNumber value={pct(result.rateOpt, 2)} minLength={6} size="lg" />
              </div>
              <div className="board-row">
                <p className="board-label">
                  {t("Billable weight carried", "所運計費重量")}
                  <small>
                    {t(
                      `priority/express offloaded: ${result.priorityFill} → ${result.priorityOpt}`,
                      `被甩優先/特快貨件：${result.priorityFill} → ${result.priorityOpt}`,
                    )}
                  </small>
                </p>
                <FlapNumber
                  value={`${result.chargeableOpt >= result.chargeableFill ? "+" : "−"}${pct(Math.abs(result.chargeableOpt / result.chargeableFill - 1), 1)}`}
                  minLength={6}
                  size="lg"
                />
              </div>
              <div className="board-row">
                <p className="board-label">
                  {t("Checked and proven optimal", "已檢查並證明最優")}
                  <small>
                    {t(`${result.checked}/${result.flights} passed the independent check`, `${result.checked}/${result.flights} 通過獨立檢查`)}
                  </small>
                </p>
                <FlapNumber
                  value={`${result.optimal}/${result.flights}`}
                  minLength={7}
                  size="lg"
                  tone={result.checked < result.flights ? "amber" : "fog"}
                />
              </div>
            </div>
          </section>

          <Panel title={t("Offload rate against billable weight carried", "甩貨率對比所運計費重量")}>
            <TradeoffChart points={points} reference={reference} calibrated={main?.demand ?? 1} />
          </Panel>

          <Fold
            title={t("Every flight at the calibrated overbooking", "校準超額訂艙下的每班航班")}
            count={result.flights}
          >
            <div className="proof-fold-actions">
              <button type="button" className="button" onClick={exportCsv} disabled={running}>
                <Download size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("Download all runs (CSV)", "下載全部結果（CSV）")}
              </button>
            </div>
            <FlightTable rows={main?.rows ?? []} />
          </Fold>
          <p className="fine">
            {t(
              "Synthetic flights from a seeded generator: 20,000 kg payload and 120 m³ hold, cargo densities centred on the aircraft's own ratio, so overbooking means the same for weight and space. Only total weight and volume are checked, not hold positions, balance or dangerous-goods separation. The model has no booking no-shows, so the lower-overbooking result shows the method, not a booking policy. Rates are pooled: total offloaded AWBs ÷ total booked AWBs.",
              "合成航班由種子產生器生成：業載 20,000 公斤、艙容 120 立方米，貨物密度以飛機本身比例為中心，因此超額訂艙對重量及體積的意義相同。只檢查總重量及總體積，不包括艙位、平衡或危險品隔離。模型沒有訂艙缺席，因此較低超額訂艙的結果只示範方法，並非訂艙政策。比率為合計：被甩 AWB 總數 ÷ 已訂 AWB 總數。",
            )}
          </p>
        </>
      ) : !running ? (
        <div className="empty proof-empty">
          <Dices size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>
            {t(
              "Press “Run the Protect proof”. 100 flights take about a minute and a half, including the lower-overbooking runs.",
              "按「執行 Protect 驗證」。100 班航班連同較低超額訂艙的測試約需一分半鐘。",
            )}
          </p>
        </div>
      ) : null}
    </>
  );
}

function TradeoffChart({
  points,
  reference,
  calibrated,
}: {
  points: Point[];
  reference: number;
  calibrated: number;
}) {
  const { t } = useLocale();
  const [hover, setHover] = useState<string | null>(null);
  if (!points.length || !reference) return null;
  const series = points.map((p) => {
    const r = pooled(p.batch.rows);
    return {
      demand: p.demand,
      fill: { x: (r.chargeableFill / reference) * 100, y: r.rateFill * 100 },
      opt: { x: (r.chargeableOpt / reference) * 100, y: r.rateOpt * 100 },
    };
  });
  const xs = series.flatMap((s) => [s.fill.x, s.opt.x]);
  const ys = series.flatMap((s) => [s.fill.y, s.opt.y]);
  const W = 680, H = 380, left = 64, right = 24, top = 20, bottom = 56;
  const x = scaleLinear().domain([Math.min(...xs) - 0.5, Math.max(...xs) + 0.5]).range([left, W - right]).nice();
  const y = scaleLinear().domain([0, Math.max(12, ...ys) + 1]).range([H - bottom, top]).nice();
  const path = (key: "fill" | "opt") =>
    series.map((s, i) => `${i ? "L" : "M"}${x(s[key].x)},${y(s[key].y)}`).join(" ");
  const active = series.find((s) => `${s.demand}` === hover);
  return (
    <figure className="proof-scatter">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t(
          "Offload rate against billable weight for both methods at each overbooking level; details in the table below.",
          "兩種方法在各超額訂艙水平下的甩貨率對比計費重量；詳情見下表。",
        )}
      >
        {x.ticks(6).map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={top} y2={H - bottom} className="proof-grid" />
            <text x={x(v)} y={H - bottom + 18} textAnchor="middle" className="proof-tick">
              {v}
            </text>
          </g>
        ))}
        {y.ticks(6).map((v) => (
          <g key={`y${v}`}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="proof-grid" />
            <text x={left - 8} y={y(v) + 4} textAnchor="end" className="proof-tick">
              {v}%
            </text>
          </g>
        ))}
        <line x1={left} x2={W - right} y1={y(5)} y2={y(5)} className="proof-target" />
        <text x={W - right - 4} y={y(5) - 6} textAnchor="end" className="proof-tick">
          {t("5% target", "5% 目標")}
        </text>
        <line x1={x(100)} x2={x(100)} y1={top} y2={H - bottom} className="proof-diagonal" />
        <path d={path("fill")} className="proof-line fill" />
        <path d={path("opt")} className="proof-line opt" />
        {series.map((s) =>
          (["fill", "opt"] as const).map((key) => (
            <circle
              key={`${key}${s.demand}`}
              cx={x(s[key].x)}
              cy={y(s[key].y)}
              r={`${s.demand}` === hover ? 8 : s.demand === calibrated ? 7 : 5}
              className={`proof-dot ${key}`}
              tabIndex={0}
              onMouseEnter={() => setHover(`${s.demand}`)}
              onMouseLeave={() => setHover(null)}
              onFocus={() => setHover(`${s.demand}`)}
              onBlur={() => setHover(null)}
            >
              <title>
                {`${key === "opt" ? "CargoPulse" : t("Load by priority", "按優先級裝載")} · ${t("overbooked", "超額訂艙")} ${overbooking(s.demand)}: ${s[key].y.toFixed(2)}% · ${s[key].x.toFixed(1)}`}
              </title>
            </circle>
          )),
        )}
        <text x={(left + W - right) / 2} y={H - 12} textAnchor="middle" className="proof-axis">
          {t("Billable weight carried (simple rule at calibrated overbooking = 100)", "所運計費重量（校準超額訂艙下的簡單規則 = 100）")}
        </text>
        <text
          x={16}
          y={(top + H - bottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${(top + H - bottom) / 2})`}
          className="proof-axis"
        >
          {t("Offloaded AWBs (% of booked)", "被甩 AWB（佔已訂 %）")}
        </text>
      </svg>
      <div className="proof-legend">
        <span className="proof-key fill">{t("Load by priority (simple rule)", "按優先級裝載（簡單規則）")}</span>
        <span className="proof-key opt">CargoPulse</span>
      </div>
      <figcaption className="proof-caption">
        {active
          ? t(
              `Overbooked ${overbooking(active.demand)}: simple rule ${active.fill.y.toFixed(2)}% offloaded, index ${active.fill.x.toFixed(1)}; CargoPulse ${active.opt.y.toFixed(2)}%, index ${active.opt.x.toFixed(1)}.`,
              `超額訂艙 ${overbooking(active.demand)}：簡單規則甩貨 ${active.fill.y.toFixed(2)}%，指數 ${active.fill.x.toFixed(1)}；CargoPulse ${active.opt.y.toFixed(2)}%，指數 ${active.opt.x.toFixed(1)}。`,
            )
          : t(
              "Each pair of dots is one overbooking level on the same flights; the large dots are the calibrated level. Lower and further right is better: fewer offloads and more billable weight.",
              "每對點代表相同航班上的一個超額訂艙水平；大點為校準水平。越低、越右越好：甩貨更少、計費重量更多。",
            )}
      </figcaption>
    </figure>
  );
}

function FlightTable({ rows }: { rows: readonly ProtectRow[] }) {
  const { t } = useLocale();
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Per-flight results", "每班航班結果")}>
      <table>
        <thead>
          <tr>
            <th scope="col">{t("Seed", "種子")}</th>
            <th scope="col">{t("Booked (weight / space)", "已訂（重量 / 體積）")}</th>
            <th scope="col">{t("Offloaded: rule → CargoPulse", "被甩：規則 → CargoPulse")}</th>
            <th scope="col">{t("Billable kg: rule → CargoPulse", "計費公斤：規則 → CargoPulse")}</th>
            <th scope="col">{t("Priority offloaded", "被甩優先貨件")}</th>
            <th scope="col">{t("Check", "檢查")}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.seed}>
              <td>
                <strong>{r.seed}</strong>
              </td>
              <td>
                {pct(r.booked_weight_ratio, 0)} / {pct(r.booked_volume_ratio, 0)}
                <small>
                  {r.booked} AWBs
                </small>
              </td>
              <td>
                {r.offloaded_fill} → <strong>{r.offloaded_opt}</strong>
                <small>
                  {pct(r.offloaded_fill / r.booked)} → {pct(r.offloaded_opt / r.booked)}
                </small>
              </td>
              <td>
                {r.chargeable_fill.toLocaleString()} → <strong>{r.chargeable_opt.toLocaleString()}</strong>
              </td>
              <td>
                {r.priority_offloaded_fill} → {r.priority_offloaded_opt}
              </td>
              <td>{r.check_fill && r.check_opt && r.opt_status === "OPTIMAL" ? t("Passed, optimal", "通過，最優") : t("See CSV", "見 CSV")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
