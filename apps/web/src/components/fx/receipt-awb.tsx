"use client";
/**
 * The immutable decision receipt as a paper air-waybill. It rises out of the desk in
 * perspective, settles flat, its ruled fields ink in, gates A–H are stamped one by
 * one, then an embossed gold-foil seal for the REAL decision slams down with an ink
 * spread, a tiny shake, thud + chime and gold flecks. Any click or key skips to the
 * final state; reduced motion shows the final state at once. All values are real.
 */
import dynamic from "next/dynamic";
import { useEffect, useId, useRef, useState } from "react";
import { Check, Copy, ShieldCheck, Ban, ArrowUpRight } from "lucide-react";
import { useFx, useSkippable } from "@/lib/fx";
import { playChime, playThud, playTick } from "@/lib/sound";
import type { Model } from "@/lib/types";
import { useLocale } from "@/components/locale";
import { Badge, JsonDetails } from "@/components/ui";

const GoldFlecks = dynamic(() => import("./gold-flecks"), { ssr: false });

export type DecisionAction = Model<"DecisionReceipt">["action"];

/** What the receipt shows. Either the receipt the API just returned, or a decided plan
 * (with recorder and time from the audit trail when the viewer may read it). */
export type ReceiptView = {
  action: DecisionAction;
  id: string | null;
  actor: string | null;
  recorded_at: string | null;
  reason_code: string | null;
  plan_id: string;
  plan_hash: string;
  snapshot_hash: string;
  source: "session" | "audit" | "record";
  raw?: unknown;
};

// Timeline (ms). CSS delays in wow-receipt.css use the same numbers.
const GATE_START = 1350;
const GATE_STEP = 110;
const IMPACT = 2650;

const GATES: [string, string, string][] = [
  ["A", "Safety / DG", "安全/危險品"],
  ["B", "ULD contour", "ULD 輪廓"],
  ["C", "Capacity", "運力"],
  ["D", "Customs", "海關"],
  ["E", "Cutoff", "截載"],
  ["F", "Cold chain", "冷鏈"],
  ["G", "Handling", "人手"],
  ["H", "Uniqueness", "不可重複分配"],
];

function short(value: string, head = 10, tail = 6) {
  return value.length > head + tail + 1 ? `${value.slice(0, head)}…${value.slice(-tail)}` : value;
}

function CopyValue({ value, label }: { value: string; label: string }) {
  const { t } = useLocale();
  const [copied, setCopied] = useState(false);
  return (
    <span className="awb-copy">
      <code title={value}>{short(value)}</code>
      <button
        type="button"
        className="awb-copy-btn"
        aria-label={`${t("Copy", "複製")} ${label}`}
        title={t("Copy full value", "複製完整數值")}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1600);
            },
            () => undefined,
          );
        }}
      >
        {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
      </button>
    </span>
  );
}

function stamp(t: (en: string, zh: string) => string, action: DecisionAction) {
  if (action === "APPROVE_IN_APP")
    return {
      tone: "approve",
      word: t("Approved", "已核准"),
      full: t("Approved in CargoPulse", "已在 CargoPulse 核准"),
      Icon: ShieldCheck,
    };
  if (action === "REJECT")
    return { tone: "reject", word: t("Rejected", "已拒絕"), full: t("Rejected in CargoPulse", "已在 CargoPulse 拒絕"), Icon: Ban };
  return {
    tone: "escalate",
    word: t("Escalated", "已升級"),
    full: t("Escalated in CargoPulse", "已在 CargoPulse 升級處理"),
    Icon: ArrowUpRight,
  };
}

function Seal({ view }: { view: ReceiptView }) {
  const { t } = useLocale();
  const s = stamp(t, view.action);
  const raw = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ring = `seal-ring-${raw}`;
  const date = view.recorded_at ? view.recorded_at.slice(0, 10) : t("DATE IN AUDIT TRAIL", "日期見稽核紀錄");
  const ringText = `CARGOPULSE · ${t("IN-APP DECISION", "應用程式內決策")} · ${date} UTC · ${view.plan_hash.slice(0, 8).toUpperCase()} · ${t("NO EXTERNAL WRITE", "無外部寫入")} · `;
  return (
    <div className={`seal seal-${s.tone}`} role="img" aria-label={s.full}>
      <span className="seal-cast" aria-hidden="true" />
      <span className="seal-ink" aria-hidden="true" />
      <span className="seal-body" aria-hidden="true">
        <span className="seal-ring" />
        <span className="seal-ticks" />
        <span className="seal-glint" />
        <span className="seal-disc" />
        <svg viewBox="0 0 200 200" className="seal-svg">
          <defs>
            <path id={ring} d="M100,100 m-73,0 a73,73 0 1,1 146,0 a73,73 0 1,1 -146,0" />
          </defs>
          <circle cx="100" cy="100" r="61" className="seal-hair" />
          <circle cx="100" cy="100" r="85" className="seal-hair" />
          <text className="seal-ring-text">
            <textPath href={`#${ring}`} textLength="455" lengthAdjust="spacing">
              {ringText}
            </textPath>
          </text>
          <text x="100" y="104" textAnchor="middle" className="seal-word">
            {s.word}
          </text>
          <text x="100" y="124" textAnchor="middle" className="seal-sub">
            {t("in CargoPulse", "於 CargoPulse")}
          </text>
        </svg>
        <s.Icon className="seal-icon" size={22} strokeWidth={1.75} />
      </span>
    </div>
  );
}

/** Bars generated from the receipt id: a visual of the real identifier, not a scannable code. */
function IdBars({ id }: { id: string }) {
  const digits = id.replace(/[^0-9a-f]/gi, "").slice(0, 28);
  let x = 0;
  const bars = Array.from(digits).map((ch, i) => {
    const n = parseInt(ch, 16);
    const w = 1 + (n % 3);
    const gap = 1 + ((n >> 2) % 3);
    const bar = <rect key={i} x={x} y={0} width={w} height={34} />;
    x += w + gap;
    return bar;
  });
  return (
    <svg className="awb-bars" viewBox={`0 0 ${Math.max(1, x)} 34`} preserveAspectRatio="none" aria-hidden="true">
      {bars}
    </svg>
  );
}

export function DecisionAwb({
  view,
  validation,
}: {
  view: ReceiptView;
  validation: Model<"ValidationResult">;
}) {
  const { t, locale } = useLocale();
  const { motion } = useFx();
  const skipped = useSkippable(true);
  const [flecks, setFlecks] = useState(false);
  const stage = useRef<HTMLElement>(null);
  const s = stamp(t, view.action);

  // A freshly recorded decision brings the receipt into view.
  useEffect(() => {
    if (view.source !== "session") return;
    stage.current?.scrollIntoView({ behavior: motion === "calm" ? "auto" : "smooth", block: "start" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sound and particles follow the CSS timeline; a skip cancels what has not happened.
  useEffect(() => {
    if (skipped) {
      setFlecks(false);
      return;
    }
    const timers = GATES.map((_, i) =>
      window.setTimeout(() => playTick(0.85 + i * 0.06), GATE_START + i * GATE_STEP + 180),
    );
    timers.push(
      window.setTimeout(() => {
        playThud();
        setFlecks(true);
      }, IMPACT),
      window.setTimeout(playChime, IMPACT + 240),
    );
    return () => timers.forEach(clearTimeout);
  }, [skipped]);

  const when = (zone?: string) =>
    view.recorded_at
      ? new Intl.DateTimeFormat(locale, {
          timeZone: zone,
          year: "numeric",
          month: "short",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
          hourCycle: "h23",
          timeZoneName: "short",
        }).format(new Date(view.recorded_at))
      : null;
  const missing = t("See audit trail", "見稽核紀錄");
  const gateResult = (letter: string) =>
    validation.violations.some((v) => v.gate === letter)
      ? "fail"
      : validation.checked_gates.includes(letter)
        ? "pass"
        : "open";
  let field = 0;
  const f = () => ({ "--i": field++ }) as React.CSSProperties;

  return (
    <section
      ref={stage}
      className={`receipt-stage tone-${s.tone} ${skipped ? "is-final" : "is-playing"}`}
      aria-labelledby="receipt-title"
    >
      <span className="awb-shadow" aria-hidden="true" />
      <div className="awb-lift">
        <article className="awb" data-foil role="status">
          <span className="awb-grain" aria-hidden="true" />
          <span className="awb-tear" aria-hidden="true" />
          <header className="awb-band">
            <span>{t("Air waybill · decision copy", "空運提單 · 決策副本")}</span>
            <span className="awb-band-tag">{t("SYNTHETIC DATA · NOT CONNECTED", "合成數據 · 未連接")}</span>
          </header>
          <div className="awb-top">
            <div className="awb-title">
              <p className="awb-kicker">{t("CargoPulse · in-app record", "CargoPulse · 應用程式內紀錄")}</p>
              <h3 id="receipt-title">{t("Immutable decision receipt", "不可變更的決策收據")}</h3>
              <p className="awb-lede">
                {t(
                  "Bound to the exact snapshot and plan hashes below. Kept inside CargoPulse only.",
                  "與下方完整快照及方案雜湊值綁定。只保留於 CargoPulse 內。",
                )}
              </p>
            </div>
            <div className="seal-spot">
              <span className="seal-spot-ring" aria-hidden="true" />
              <span className="seal-spot-label" aria-hidden="true">
                {t("Official stamp", "正式印章")}
              </span>
              <Seal view={view} />
              {flecks && !skipped && motion !== "calm" ? (
                <GoldFlecks radius={78} onDone={() => setFlecks(false)} />
              ) : null}
            </div>
          </div>
          <dl className="awb-grid">
            <div className="awb-field" style={f()}>
              <dt>{t("Decision", "決策")}</dt>
              <dd>
                <Badge value={view.action} />
              </dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Reason code", "原因代碼")}</dt>
              <dd className="awb-mono">{view.reason_code ?? missing}</dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Receipt no.", "收據編號")}</dt>
              <dd>{view.id ? <CopyValue value={view.id} label={t("receipt id", "收據編號")} /> : missing}</dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{view.action === "APPROVE_IN_APP" ? t("Approver", "核准人") : t("Recorded by", "記錄人")}</dt>
              <dd className="awb-mono">{view.actor ?? missing}</dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Recorded (local time)", "記錄時間（本地）")}</dt>
              <dd className="awb-mono">
                {view.recorded_at ? <time dateTime={view.recorded_at}>{when()}</time> : missing}
              </dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Recorded (UTC)", "記錄時間（UTC）")}</dt>
              <dd className="awb-mono">
                {view.recorded_at ? <time dateTime={view.recorded_at}>{when("UTC")}</time> : missing}
              </dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Plan SHA-256", "方案 SHA-256")}</dt>
              <dd>
                <CopyValue value={view.plan_hash} label={t("plan hash", "方案雜湊值")} />
              </dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Snapshot SHA-256", "快照 SHA-256")}</dt>
              <dd>
                <CopyValue value={view.snapshot_hash} label={t("snapshot hash", "快照雜湊值")} />
              </dd>
            </div>
            <div className="awb-field" style={f()}>
              <dt>{t("Plan ID", "方案 ID")}</dt>
              <dd>
                <CopyValue value={view.plan_id} label={t("plan id", "方案 ID")} />
              </dd>
            </div>
          </dl>
          <div className="awb-gates" style={f()}>
            <p className="awb-gates-title">
              {t("Independent gates A–H (proposal validation)", "獨立關卡 A–H（建議方案驗證）")}
            </p>
            <ol>
              {GATES.map(([letter, en, zh], i) => {
                const result = gateResult(letter);
                return (
                  <li
                    key={letter}
                    className={`awb-gate is-${result}`}
                    style={{ "--g": i, "--r": `${((i * 37) % 9) - 4}deg` } as React.CSSProperties}
                  >
                    <span className="awb-gate-letter">{letter}</span>
                    <span className="awb-gate-mark" aria-hidden="true">
                      {result === "pass" ? "✓" : result === "fail" ? "✕" : "–"}
                    </span>
                    <span className="awb-gate-name">{t(en, zh)}</span>
                    <span className="sr-only">
                      {result === "pass"
                        ? t("passed", "通過")
                        : result === "fail"
                          ? t("failed", "未通過")
                          : t("not checked", "未檢查")}
                    </span>
                  </li>
                );
              })}
            </ol>
          </div>
          <div className="awb-perf" aria-hidden="true" />
          <footer className="awb-stub" style={f()}>
            <div className="awb-stub-main">
              <p className="awb-external">{t("External write performed: NO", "已執行外部寫入：否")}</p>
              <p className="awb-fine">
                {t(
                  "No cargo is dispatched and no airline system is updated by this decision.",
                  "此決策不會調度貨物，亦不會更新任何航空公司系統。",
                )}
                {view.source === "audit"
                  ? ` ${t("Recorder and time read from the audit trail.", "記錄人及時間取自稽核紀錄。")}`
                  : view.source === "record"
                    ? ` ${t("Recorded earlier; open the audit trail for recorder and time.", "較早前已記錄；請開啟稽核紀錄查看記錄人及時間。")}`
                    : ""}
              </p>
              {view.raw ? <JsonDetails value={view.raw} label={t("Full receipt", "完整收據")} /> : null}
            </div>
            {view.id ? (
              <div className="awb-stub-code">
                <IdBars id={view.id} />
                <code>{view.id}</code>
              </div>
            ) : null}
          </footer>
        </article>
      </div>
    </section>
  );
}
