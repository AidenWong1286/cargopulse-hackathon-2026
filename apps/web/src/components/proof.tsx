"use client";
import Link from "next/link";
import { useRef, useState } from "react";
import { scaleLinear } from "d3-scale";
import { Dices, Download, Play, Square } from "lucide-react";
import { bestRule, cargopulse, randomSeed, recoverProof } from "@/lib/proof";
import type { RecoverProof } from "@/lib/types";
import { FlapNumber } from "./kit/flap-number";
import { Panel } from "./kit/panel";
import { StatusChip } from "./kit/status-chip";
import { useLocale } from "./locale";
import { ProtectProof } from "./protect-proof";
import { ErrorNotice, PageHeader } from "./ui";

const SIZES = [
  { size: 8, en: "Small: 8 containers, with exact check", zh: "細：8 個貨櫃，附窮舉驗證" },
  { size: 60, en: "Medium: 60 containers", zh: "中：60 個貨櫃" },
  { size: 140, en: "Large: 140 containers", zh: "大：140 個貨櫃" },
] as const;
const TRIALS = [10, 20, 50] as const;

const fmt = (value: number, digits = 1) =>
  value.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: 0 });

/** Runs the optimiser on many random disruptions and checks every answer three ways. */
export function AlgorithmProof() {
  const { t } = useLocale();
  const [size, setSize] = useState<number>(8);
  const [trials, setTrials] = useState<number>(20);
  const [results, setResults] = useState<RecoverProof[]>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<unknown>();
  const stop = useRef<AbortController | null>(null);
  const [area, setArea] = useState<"recover" | "protect">("recover");

  async function run() {
    const controller = new AbortController();
    stop.current = controller;
    setRunning(true);
    setError(undefined);
    setResults([]);
    const seen = new Set<number>();
    try {
      for (let i = 0; i < trials && !controller.signal.aborted; i++) {
        let seed = randomSeed();
        while (seen.has(seed)) seed = randomSeed();
        seen.add(seed);
        const proof = await recoverProof(seed, size, 10, controller.signal);
        setResults((done) => [...done, proof]);
      }
    } catch (e) {
      if (!controller.signal.aborted) setError(e);
    } finally {
      setRunning(false);
      stop.current = null;
    }
  }

  const done = results.length;
  const validated = results.filter((r) =>
    r.policies.every((p) => p.independent_validation === "PASS"),
  ).length;
  const exactRun = results.filter((r) => r.exact.status !== "NOT_RUN");
  const exactMatch = exactRun.filter((r) => r.exact.status === "MATCH").length;
  const exactMismatch = exactRun.filter((r) => r.exact.status === "MISMATCH").length;
  const notWorse = results.filter((r) => r.cargopulse_not_worse).length;
  const better = results.filter((r) => r.cargopulse_strictly_better).length;
  const proven = results.filter(
    (r) => cargopulse(r)?.solver_status === "OPTIMAL" && Number(cargopulse(r)?.optimality_gap ?? 1) === 0,
  ).length;
  const placedOurs = results.reduce((n, r) => n + (cargopulse(r)?.assigned ?? 0), 0);
  const placedRule = results.reduce((n, r) => n + (bestRule(r)?.assigned ?? 0), 0);
  const width = String(Math.max(trials, 99)).length;

  function exportCsv() {
    const header = [
      "seed",
      "size",
      "snapshot_hash",
      "flights",
      "cancelled",
      "eligible",
      "cargopulse_status",
      "cargopulse_gap",
      "cargopulse_assigned",
      "cargopulse_objective",
      "earliest_assigned",
      "earliest_objective",
      "priority_assigned",
      "priority_objective",
      "independent_validation",
      "exact_status",
      "exact_objective",
      "exact_nodes",
    ];
    const rows = results.map((r) => {
      const by = Object.fromEntries(r.policies.map((p) => [p.policy, p]));
      return [
        r.seed,
        r.size,
        r.instance.snapshot_hash,
        r.instance.flights,
        r.instance.cancelled_flights,
        r.instance.eligible_ulds,
        by.CARGOPULSE?.solver_status,
        by.CARGOPULSE?.optimality_gap ?? "",
        by.CARGOPULSE?.assigned,
        by.CARGOPULSE?.objective ?? "",
        by.EARLIEST_FEASIBLE?.assigned,
        by.EARLIEST_FEASIBLE?.objective ?? "",
        by.PRIORITY_FIRST?.assigned,
        by.PRIORITY_FIRST?.objective ?? "",
        r.policies.every((p) => p.independent_validation === "PASS") ? "PASS" : "FAIL",
        r.exact.status,
        r.exact.objective ?? "",
        r.exact.nodes,
      ].join(",");
    });
    const url = URL.createObjectURL(
      new Blob([[header.join(","), ...rows].join("\n") + "\n"], { type: "text/csv" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `cargopulse-recover-proof-${size}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title={t("Algorithm proof", "演算法驗證")}
        description={t(
          "Run CargoPulse on random data it has never seen, and check every answer three ways.",
          "在從未見過的隨機中斷情境上執行 CargoPulse，並以三種方法核對每個答案。",
        )}
      />
      <div className="segmented proof-tabs" role="group" aria-label={t("Module", "模組")}>
        <button type="button" aria-pressed={area === "recover"} onClick={() => setArea("recover")}>
          {t("Recover: re-plan after a disruption", "Recover：中斷後重新規劃")}
        </button>
        <button type="button" aria-pressed={area === "protect"} onClick={() => setArea("protect")}>
          {t("Protect: fewer offloads before cutoff", "Protect：截載前減少甩貨")}
        </button>
      </div>
      {area === "protect" ? (
        <ProtectProof />
      ) : (
      <>
      <div className="proof-checks">
        <article>
          <h2>{t("1. Is the plan safe?", "1. 方案是否安全？")}</h2>
          <p>
            {t(
              "A separate validator re-checks every plan against the dangerous-goods, space, customs, cutoff, cold-chain and handling rules.",
              "另一個獨立驗證程式會按危險品、艙位、海關、截載、冷鏈及地勤規則，重新檢查每個方案。",
            )}
          </p>
        </article>
        <article>
          <h2>{t("2. Is it truly the best?", "2. 是否真正最佳？")}</h2>
          <p>
            {t(
              "On small cases, a second program written separately tries every possible combination and finds the true best plan. CargoPulse must match it exactly.",
              "在小型情境中，另一個獨立編寫的程式會嘗試所有可能組合，找出真正最佳方案。CargoPulse 必須與之完全一致。",
            )}
          </p>
        </article>
        <article>
          <h2>{t("3. Does it beat simple rules?", "3. 能否勝過簡單規則？")}</h2>
          <p>
            {t(
              "On the same data, “earliest flight first” and “priority first” make their own plans. CargoPulse must never do worse.",
              "以相同資料，「最早航班優先」及「優先級優先」各自制定方案。CargoPulse 不可較差。",
            )}
          </p>
        </article>
      </div>

      <section className="proof-controls" aria-label={t("Run settings", "執行設定")}>
        <label>
          {t("Size of each disruption", "每個中斷情境的規模")}
          <select value={size} onChange={(e) => setSize(Number(e.target.value))} disabled={running}>
            {SIZES.map((s) => (
              <option key={s.size} value={s.size}>
                {t(s.en, s.zh)}
              </option>
            ))}
          </select>
        </label>
        <label>
          {t("Random disruptions to run", "要執行的隨機情境數目")}
          <select value={trials} onChange={(e) => setTrials(Number(e.target.value))} disabled={running}>
            {TRIALS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
        {running ? (
          <button type="button" className="button" onClick={() => stop.current?.abort()}>
            <Square size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("Stop", "停止")}
          </button>
        ) : (
          <button type="button" className="button primary" onClick={run}>
            <Play size={16} strokeWidth={1.75} aria-hidden="true" />
            {t("Run the proof", "執行驗證")}
          </button>
        )}
        <p className="proof-progress" role="status">
          {running
            ? t(`Running disruption ${done + 1} of ${trials}…`, `正在執行第 ${done + 1} 個（共 ${trials} 個）……`)
            : done
              ? t(`${done} random disruptions checked.`, `已核對 ${done} 個隨機中斷情境。`)
              : t("Each disruption gets a fresh random seed.", "每個情境都使用新的隨機種子。")}
        </p>
      </section>
      <ErrorNotice error={error} />

      {done ? (
        <>
          <section className="board proof-board" aria-label={t("Proof results", "驗證結果")}>
            <div className="proof-board-grid">
              <div className="board-row">
                <p className="board-label">
                  {t("Passed the safety re-check", "通過安全重新檢查")}
                  <small>{t("all three plans, every disruption", "每個情境的三個方案")}</small>
                </p>
                <FlapNumber value={`${validated}/${done}`} minLength={width * 2 + 1} size="lg" />
              </div>
              {exactRun.length ? (
                <div className="board-row">
                  <p className="board-label">
                    {t("Matched the exact best plan", "與窮舉最佳方案一致")}
                    <small>
                      {exactRun.length - exactMatch - exactMismatch
                        ? t(
                            `${exactRun.length - exactMatch - exactMismatch} too large to finish the search`,
                            `${exactRun.length - exactMatch - exactMismatch} 個規模太大，未能完成搜尋`,
                          )
                        : t("every combination tried", "已嘗試所有組合")}
                    </small>
                  </p>
                  <FlapNumber
                    value={`${exactMatch}/${exactRun.length}`}
                    minLength={width * 2 + 1}
                    size="lg"
                    tone={exactMismatch ? "amber" : "fog"}
                  />
                </div>
              ) : (
                <div className="board-row">
                  <p className="board-label">
                    {t("Proven optimal by the solver", "求解器已證明最佳")}
                    <small>{t("optimality gap 0%", "最優差距 0%")}</small>
                  </p>
                  <FlapNumber value={`${proven}/${done}`} minLength={width * 2 + 1} size="lg" />
                </div>
              )}
              <div className="board-row">
                <p className="board-label">
                  {t("Never worse than a simple rule", "從不遜於簡單規則")}
                  <small>
                    {t(`better than both in ${better}`, `其中 ${better} 個勝過兩者`)}
                  </small>
                </p>
                <FlapNumber
                  value={`${notWorse}/${done}`}
                  minLength={width * 2 + 1}
                  size="lg"
                  tone={notWorse < done ? "amber" : "fog"}
                />
              </div>
              <div className="board-row">
                <p className="board-label">
                  {t("Containers given a flight", "獲安排航班的貨櫃")}
                  <small>
                    {t(`best simple rule: ${placedRule}`, `最佳簡單規則：${placedRule}`)}
                  </small>
                </p>
                <FlapNumber value={placedOurs} minLength={String(placedOurs).length} size="lg" />
              </div>
            </div>
          </section>

          <Panel
            title={t("Cost of each plan: CargoPulse vs the best simple rule", "各方案成本：CargoPulse 對比最佳簡單規則")}
          >
            <ProofScatter results={results} />
          </Panel>

          <Panel
            title={t("Every disruption", "每個中斷情境")}
            aside={
              <button type="button" className="button" onClick={exportCsv} disabled={running}>
                <Download size={16} strokeWidth={1.75} aria-hidden="true" />
                {t("Download results (CSV)", "下載結果（CSV）")}
              </button>
            }
          >
            <div className="table-wrap" tabIndex={0} role="region" aria-label={t("Proof results by seed", "按種子列出的驗證結果")}>
              <table>
                <thead>
                  <tr>
                    <th scope="col">{t("Seed", "種子")}</th>
                    <th scope="col">{t("Network", "航班網絡")}</th>
                    <th scope="col">{t("Given a flight", "獲安排航班")}</th>
                    <th scope="col">{t("Total cost", "總成本")}</th>
                    <th scope="col">{t("Safety re-check", "安全重新檢查")}</th>
                    <th scope="col">{t("Exact check", "窮舉驗證")}</th>
                    <th scope="col">{t("Solve time", "求解時間")}</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const ours = cargopulse(r);
                    const rule = bestRule(r);
                    const by = Object.fromEntries(r.policies.map((p) => [p.policy, p]));
                    const change =
                      ours?.objective && rule?.objective
                        ? (Number(ours.objective) / Number(rule.objective) - 1) * 100
                        : null;
                    const safe = r.policies.every((p) => p.independent_validation === "PASS");
                    return (
                      <tr key={r.seed}>
                        <td>
                          <strong>{r.seed}</strong>
                          {r.size >= 20 ? (
                            <small>
                              <Link className="text-link" href={`/operations?seed=${r.seed}&size=${r.size}`}>
                                {t("Open in Recover", "在 Recover 開啟")}
                              </Link>
                            </small>
                          ) : null}
                        </td>
                        <td>
                          {r.instance.flights} {t("flights", "班航班")}
                          <small>
                            {r.instance.cancelled_flights} {t("cancelled", "班取消")} ·{" "}
                            {r.instance.eligible_ulds}/{r.instance.affected_ulds} {t("can fly", "可運")}
                          </small>
                        </td>
                        <td>
                          <strong>{ours?.assigned}</strong> {t("CargoPulse", "CargoPulse")}
                          <small>
                            {by.EARLIEST_FEASIBLE?.assigned} {t("earliest", "最早")} · {by.PRIORITY_FIRST?.assigned}{" "}
                            {t("priority", "優先級")}
                          </small>
                        </td>
                        <td>
                          <strong>{ours?.objective ? fmt(Number(ours.objective)) : "—"}</strong>
                          <small>
                            {change === null
                              ? "—"
                              : change < -0.05
                                ? t(`${fmt(-change)}% lower than best rule`, `比最佳規則低 ${fmt(-change)}%`)
                                : t("same as best rule", "與最佳規則相同")}
                          </small>
                        </td>
                        <td>
                          <StatusChip status={safe ? "passed" : "blocked"}>
                            {safe ? t("Passed", "通過") : t("Failed", "未通過")}
                          </StatusChip>
                        </td>
                        <td>
                          {r.exact.status === "MATCH" ? (
                            <StatusChip status="passed" title={`${r.exact.nodes} search nodes`}>
                              {t("Exact best", "窮舉最佳")}
                            </StatusChip>
                          ) : r.exact.status === "MISMATCH" ? (
                            <StatusChip status="blocked">{t("Mismatch", "不一致")}</StatusChip>
                          ) : r.exact.status === "SEARCH_LIMIT" ? (
                            <StatusChip status="unknown">{t("Search too large", "搜尋過大")}</StatusChip>
                          ) : (
                            <span className="muted">
                              {ours?.solver_status === "OPTIMAL"
                                ? t("Solver proved optimal", "求解器證明最佳")
                                : t("Not run at this size", "此規模不執行")}
                            </span>
                          )}
                        </td>
                        <td>{ours ? `${fmt(Number(ours.wall_ms) / 1000, 2)} s` : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Panel>
          <p className="fine">
            {t(
              "Cost counts weighted delay, handling and stability, plus a penalty for every container left without a flight; fewer containers left behind always ranks first. All data is made up by a seeded generator and nothing is sent anywhere. Re-running a seed gives the same disruption.",
              "成本計入加權延誤、地勤及穩定性，並為每個沒有航班的貨櫃加上罰分；未獲安排的貨櫃越少者永遠優先。所有資料均由種子產生器虛構，不會傳送至任何地方。重新執行相同種子會得到相同情境。",
            )}
          </p>
        </>
      ) : (
        <div className="empty proof-empty">
          <Dices size={28} strokeWidth={1.5} aria-hidden="true" />
          <p>
            {t(
              "Pick a size and press “Run the proof”. Start with the small size: that is where the exact check runs.",
              "選擇規模後按「執行驗證」。建議先選細規模，因為窮舉驗證只在此規模執行。",
            )}
          </p>
        </div>
      )}
      </>
      )}
    </>
  );
}

/** One dot per disruption. Below the diagonal means CargoPulse's plan costs less. */
function ProofScatter({ results }: { results: RecoverProof[] }) {
  const { t } = useLocale();
  const [hover, setHover] = useState<number | null>(null);
  const points = results
    .map((r) => ({
      seed: r.seed,
      x: Number(bestRule(r)?.objective ?? NaN),
      y: Number(cargopulse(r)?.objective ?? NaN),
      exact: r.exact.status,
    }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (!points.length) return null;
  const W = 640, H = 360, left = 72, right = 20, top = 20, bottom = 52;
  const max = Math.max(...points.flatMap((p) => [p.x, p.y])) * 1.05;
  const min = Math.min(...points.flatMap((p) => [p.x, p.y])) * 0.95;
  const x = scaleLinear().domain([min, max]).range([left, W - right]).nice();
  const y = scaleLinear().domain([min, max]).range([H - bottom, top]).nice();
  const [d0, d1] = x.domain();
  const active = points.find((p) => p.seed === hover);
  return (
    <figure className="proof-scatter">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={t(
          `${points.length} disruptions. ${points.filter((p) => p.y < p.x - 1e-6).length} below the line, where CargoPulse costs less; ${points.filter((p) => Math.abs(p.y - p.x) <= 1e-6).length} on the line, where they are equal.`,
          `${points.length} 個情境，其中 ${points.filter((p) => p.y < p.x - 1e-6).length} 個在線下（CargoPulse 成本較低），${points.filter((p) => Math.abs(p.y - p.x) <= 1e-6).length} 個在線上（成本相同）。`,
        )}
      >
        {x.ticks(5).map((v) => (
          <g key={`x${v}`}>
            <line x1={x(v)} x2={x(v)} y1={top} y2={H - bottom} className="proof-grid" />
            <text x={x(v)} y={H - bottom + 18} textAnchor="middle" className="proof-tick">
              {fmt(v, 0)}
            </text>
          </g>
        ))}
        {y.ticks(5).map((v) => (
          <g key={`y${v}`}>
            <line x1={left} x2={W - right} y1={y(v)} y2={y(v)} className="proof-grid" />
            <text x={left - 8} y={y(v) + 4} textAnchor="end" className="proof-tick">
              {fmt(v, 0)}
            </text>
          </g>
        ))}
        <line x1={x(d0)} y1={y(d0)} x2={x(d1)} y2={y(d1)} className="proof-diagonal" />
        <text x={x(d1) - 6} y={y(d1) + 16} textAnchor="end" className="proof-tick">
          {t("equal cost", "成本相同")}
        </text>
        <text x={(left + W - right) / 2} y={H - 10} textAnchor="middle" className="proof-axis">
          {t("Best simple rule's cost", "最佳簡單規則的成本")}
        </text>
        <text
          x={16}
          y={(top + H - bottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 16 ${(top + H - bottom) / 2})`}
          className="proof-axis"
        >
          {t("CargoPulse's cost", "CargoPulse 的成本")}
        </text>
        {points.map((p) => (
          <circle
            key={p.seed}
            cx={x(p.x)}
            cy={y(p.y)}
            r={p.seed === hover ? 8 : 6}
            className="proof-dot"
            data-exact={p.exact}
            tabIndex={0}
            onMouseEnter={() => setHover(p.seed)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.seed)}
            onBlur={() => setHover(null)}
          >
            <title>
              {t(
                `Seed ${p.seed}: CargoPulse ${fmt(p.y)}, best rule ${fmt(p.x)}`,
                `種子 ${p.seed}：CargoPulse ${fmt(p.y)}，最佳規則 ${fmt(p.x)}`,
              )}
            </title>
          </circle>
        ))}
      </svg>
      <figcaption className="proof-caption">
        {active
          ? t(
              `Seed ${active.seed}: CargoPulse ${fmt(active.y)} vs best simple rule ${fmt(active.x)}${active.x > active.y ? ` (${fmt((1 - active.y / active.x) * 100)}% lower)` : ""}.`,
              `種子 ${active.seed}：CargoPulse ${fmt(active.y)}，最佳簡單規則 ${fmt(active.x)}${active.x > active.y ? `（低 ${fmt((1 - active.y / active.x) * 100)}%）` : ""}。`,
            )
          : t(
              "Dots below the line are disruptions where CargoPulse's plan costs less; dots on the line are equal. A dot above the line would mean a simple rule won.",
              "線下的點代表 CargoPulse 方案成本較低；線上的點代表相同。若有點在線上方，即代表簡單規則勝出。",
            )}
      </figcaption>
    </figure>
  );
}
