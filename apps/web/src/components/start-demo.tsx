"use client";
import { useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Dices } from "lucide-react";
import { api } from "@/lib/api";
import { useFx, useSkippable } from "@/lib/fx";
import { FIXTURE_SIZES, loadFixture, randomSeed } from "@/lib/proof";
import type { Model, Principal } from "@/lib/types";
import { useLocale } from "./locale";
import { ErrorNotice } from "./ui";

/** Decorative fly-in, loaded only when a demo starts. */
const ContainerFlight = dynamic(() => import("./fx/container-flight"), { ssr: false });

/** Longest the page waits after success for the last containers to land. */
const LANDING_GRACE_MS = 600;

const STEPS = [
  ["Loading", "載入"],
  ["Checking", "檢查"],
  ["Saving", "儲存"],
  ["Opening", "開啟"],
] as const;

/**
 * One click from an empty desk to an open scenario: loads a made-up disruption
 * (a random one from a shown seed, or the fixed reference one), checks it, saves it
 * and creates the scenario. Each step shown is the real request that is running.
 */
export function StartDemo({ me }: { me: Principal | undefined }) {
  const { t } = useLocale();
  const router = useRouter();
  /** Index of the request in flight, or -1 when idle. */
  const [step, setStep] = useState(-1);
  const [error, setError] = useState<unknown>();
  const roles = me?.roles ?? [];
  const allowed =
    roles.includes("manager") || (roles.includes("data_steward") && roles.includes("controller"));
  const running = step >= 0;
  const [mode, setMode] = useState<"random" | "reference">("random");
  const [seed, setSeed] = useState(0);
  const [size, setSize] = useState<number>(140);
  // Seeds are drawn in the browser after load (never during server render), and a
  // link such as /operations?seed=42&size=60 reopens an exact earlier disruption.
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const fromUrl = Number(query.get("seed"));
    const sizeFromUrl = Number(query.get("size"));
    setSeed(Number.isInteger(fromUrl) && fromUrl >= 1 && fromUrl <= 1_000_000 ? fromUrl : randomSeed());
    if ((FIXTURE_SIZES as readonly number[]).includes(sizeFromUrl)) setSize(sizeFromUrl);
  }, []);
  const seedValid = Number.isInteger(seed) && seed >= 1 && seed <= 1_000_000;

  // ── Fly-in: one silhouette per real container, once the fixture says how many ──
  const { motion } = useFx();
  const cardRef = useRef<HTMLElement>(null);
  /** Containers in the generated input; null until the fixture response arrives. */
  const [count, setCount] = useState<number | null>(null);
  const skipped = useSkippable(running);
  const flight = useRef<{ landed: boolean; wake?: () => void }>({ landed: false });
  const skippedRef = useRef(skipped);
  skippedRef.current = skipped;
  const flying = running && count !== null && count > 0 && motion !== "calm" && !skipped;
  const flyingRef = useRef(flying);
  flyingRef.current = flying;
  useEffect(() => {
    if (skipped) flight.current.wake?.();
  }, [skipped]);
  /** Lets the last containers land, never longer than the grace period, never after a skip. */
  function settleFlight() {
    if (!flyingRef.current || skippedRef.current || flight.current.landed) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, LANDING_GRACE_MS);
      flight.current.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  async function start() {
    setError(undefined);
    setCount(null);
    flight.current = { landed: false };
    try {
      setStep(0);
      const snapshot = await (mode === "random" ? loadFixture(seed, size) : loadFixture());
      const units = (snapshot as Partial<typeof snapshot> | undefined)?.cargo_units;
      setCount(Array.isArray(units) ? units.length : null);
      setStep(1);
      const checked = await api<Model<"ImportRecord">>("/imports/validate", {
        method: "POST",
        body: { snapshot } satisfies Model<"ImportRequest">,
      });
      if (checked.status !== "READY")
        throw new Error(
          t(
            "The demo data did not pass its checks, so nothing was saved. Use the manual steps below to see the findings.",
            "示範資料未能通過檢查，因此沒有儲存。請使用下方的手動步驟查看檢查結果。",
          ),
        );
      setStep(2);
      const receipt = await api<Model<"SnapshotReceipt">>(`/imports/${checked.id}/commit`, {
        method: "POST",
      });
      setStep(3);
      const scenario = await api<Model<"ScenarioRecord">>("/scenarios", {
        method: "POST",
        body: {
          source_snapshot_id: receipt.snapshot_id,
          title: null,
          allow_external_write: false,
        } satisfies Model<"CreateScenario">,
      });
      setStep(4);
      await settleFlight();
      router.push(`/operations/${scenario.id}`);
    } catch (e) {
      setError(e);
      setStep(-1);
      setCount(null);
    }
  }

  return (
    <section
      ref={cardRef}
      className="start-card rise rise-1"
      data-wow={running ? (step >= STEPS.length ? "ready" : "running") : undefined}
      aria-labelledby="start-demo-title"
    >
      <div className="start-card-main">
        <div>
          <h2 id="start-demo-title">{t("Run a hub disruption", "模擬樞紐中斷")}</h2>
          <p>
            {mode === "random"
              ? t(
                  "Draws a new made-up disruption at Hong Kong: different flights, cancellations, space and cargo every seed. The same seed always gives the same disruption.",
                  "產生一個新的虛構香港樞紐中斷：每個種子的航班、取消、艙位及貨物都不同。相同種子必定產生相同情境。",
                )
              : t(
                  "Loads the fixed reference disruption (140 containers, seed 101) used in the tests.",
                  "載入測試所用的固定參考中斷情境（140 個貨櫃，種子 101）。",
                )}
          </p>
          <div className="start-options" role="group" aria-label={t("Demo data", "示範資料")}>
            <div className="segmented">
              <button
                type="button"
                aria-pressed={mode === "random"}
                onClick={() => setMode("random")}
                disabled={running}
              >
                {t("Random disruption", "隨機中斷")}
              </button>
              <button
                type="button"
                aria-pressed={mode === "reference"}
                onClick={() => setMode("reference")}
                disabled={running}
              >
                {t("Reference disruption", "參考中斷")}
              </button>
            </div>
            {mode === "random" ? (
              <>
                <label className="inline-label">
                  {t("Seed", "種子")}
                  <input
                    type="number"
                    min={1}
                    max={1_000_000}
                    value={seed || ""}
                    onChange={(e) => setSeed(Number(e.target.value))}
                    disabled={running}
                  />
                </label>
                <button
                  type="button"
                  className="button"
                  onClick={() => setSeed(randomSeed())}
                  disabled={running}
                >
                  <Dices size={16} strokeWidth={1.75} aria-hidden="true" />
                  {t("New seed", "新種子")}
                </button>
                <label className="inline-label">
                  {t("Containers", "貨櫃數量")}
                  <select
                    value={size}
                    onChange={(e) => setSize(Number(e.target.value))}
                    disabled={running}
                  >
                    {FIXTURE_SIZES.map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </label>
              </>
            ) : null}
          </div>
        </div>
        <button
          type="button"
          className="button primary large"
          onClick={start}
          disabled={!allowed || running || (mode === "random" && !seedValid)}
        >
          {t("Start demo scenario", "開始示範情境")}
          <ArrowRight size={18} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      {running ? (
        <div className="wow-steps-row">
          <ol className="start-steps wow-steps" role="status" aria-label={t("Progress", "進度")}>
            {STEPS.map(([en, zh], index) => {
              const state = index < step ? "done" : index === step ? "current" : "pending";
              return (
                <li key={en} data-state={state} aria-current={state === "current" ? "step" : undefined}>
                  <span className="start-step-mark" aria-hidden="true">
                    {state === "done" ? <Check size={13} strokeWidth={2.5} /> : null}
                  </span>
                  {t(en, zh)}
                  {state === "done" ? <span className="sr-only"> ({t("done", "完成")})</span> : null}
                </li>
              );
            })}
          </ol>
          {count !== null ? (
            <p className="wow-count">
              <b>{count}</b> {t("containers in this disruption", "個貨櫃受此中斷影響")}
            </p>
          ) : null}
          {flying ? (
            <p className="wow-skip" aria-hidden="true">
              {t("Click anywhere to skip", "按任何位置略過")}
            </p>
          ) : null}
        </div>
      ) : null}
      {flying ? (
        <ContainerFlight
          count={count as number}
          fallback={() => cardRef.current?.getBoundingClientRect() ?? null}
          onLanded={() => {
            flight.current.landed = true;
            flight.current.wake?.();
          }}
        />
      ) : null}
      {me && !allowed ? (
        <p className="start-hint">
          {t(
            "Sign in as Manager to start the demo: it needs both the data steward and controller roles.",
            "請以 Manager 身分登入以開始示範：此操作同時需要 Data steward 及 Controller 角色。",
          )}
        </p>
      ) : null}
      <ErrorNotice error={error} />
    </section>
  );
}
