"use client";
import Link from "next/link";
import { useState, type CSSProperties } from "react";
import { ChevronRight } from "lucide-react";
import { airports } from "@/lib/airports";
import {
  cutoffShare,
  decisionTime,
  flightsOf,
  isExpired,
  lostCountAt,
  unitsOf,
  upcomingCutoffs,
} from "@/lib/desk";
import type { Scenario } from "@/lib/types";
import { CountUp } from "../kit/count-up";
import { useLocale } from "../locale";
import { Badge, Empty, Time } from "../ui";
import { useDesk } from "./context";

/** Rows that take part in the load stagger; later rows simply appear. */
const STAGGERED_ROWS = 8;
const SHOWN_CANCELLED = 6;

/**
 * The scenario queue. A row lifts on hover; clicking it opens a short preview
 * and points the hero band at that scenario. The amber bar follows the
 * decision-delay slider.
 */
export function ScenarioList({ items }: { items: Scenario[] }) {
  const { t } = useLocale();
  const { loading, setFocusId } = useDesk();
  const [openId, setOpenId] = useState<string | null>(null);
  if (!items.length)
    return loading ? null : (
      <Empty>
        {t(
          "No matching scenarios. Start the demo scenario to begin.",
          "沒有符合條件的情境。請開始示範情境。",
        )}
      </Empty>
    );
  const caption = t("Recovery scenarios", "復原情境");
  return (
    <div className="table-wrap desk-list" tabIndex={0} role="region" aria-label={caption}>
      <table>
        <caption>{caption}</caption>
        <thead>
          <tr>
            <th scope="col">{t("Scenario", "情境")}</th>
            <th scope="col">{t("Status", "狀態")}</th>
            <th scope="col">{t("Cargo", "貨物")}</th>
            <th scope="col">{t("Data from", "資料時間")}</th>
            <th scope="col">{t("Open", "開啟")}</th>
          </tr>
        </thead>
        <tbody>
          {items.map((scenario, index) => (
            <ScenarioRow
              key={scenario.id}
              scenario={scenario}
              index={index}
              open={openId === scenario.id}
              onToggle={() => {
                const opening = openId !== scenario.id;
                setOpenId(opening ? scenario.id : null);
                if (opening) setFocusId(scenario.id);
              }}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ScenarioRow({
  scenario: s,
  index,
  open,
  onToggle,
}: {
  scenario: Scenario;
  index: number;
  open: boolean;
  onToggle: () => void;
}) {
  const { t } = useLocale();
  const { focus, urgency, delayHours, now } = useDesk();
  const units = unitsOf(s);
  const cutoffs = cutoffShare(s, delayHours);
  const focused = focus?.id === s.id;
  const lost = focused && urgency.model ? lostCountAt(urgency.model, delayHours, units) : null;
  const expired = isExpired(s, now);
  const title = s.snapshot?.title || t("Untitled scenario", "未命名情境");
  const scenarioHref = `/operations/${s.id}`;
  const consoleHref = s.latest_plan_id ? `/plans/${s.latest_plan_id}/console` : null;
  const previewId = `scenario-preview-${s.id}`;
  return (
    <>
      <tr
        className={index < STAGGERED_ROWS ? "desk-row rise" : "desk-row"}
        style={index < STAGGERED_ROWS ? ({ "--i": index + 3 } as CSSProperties) : undefined}
        data-open={open || undefined}
        data-focus={focused || undefined}
        onClick={(event) => {
          // Links and buttons inside the row keep their own behaviour.
          if ((event.target as HTMLElement).closest("a, button")) return;
          onToggle();
        }}
      >
        <td>
          <button
            type="button"
            className="desk-row-toggle"
            aria-expanded={open}
            aria-controls={previewId}
            onClick={onToggle}
            title={`${t("Scenario", "情境")} ${s.id} · ${t("event", "事件")} ${s.snapshot?.event_id ?? "—"} · v${s.version}`}
          >
            <ChevronRight size={16} strokeWidth={1.75} aria-hidden="true" />
            <span>{title}</span>
          </button>
          <small>
            {t("Created", "建立於")} <Time value={s.created_at} />
          </small>
        </td>
        <td>
          <Badge value={s.state} />
          {!s.current ? <small>{t("Superseded", "已被新版本取代")}</small> : null}
        </td>
        <td>
          <span className="desk-cargo" title={t("Unit load devices (ULDs)", "集裝器（ULD）")}>
            <CountUp value={units.length} /> {t("containers", "個貨櫃")}
          </span>
          {cutoffs.total ? (
            <>
              <span
                className="urgency-bar"
                role="img"
                aria-label={t(
                  `${cutoffs.passed} of ${cutoffs.total} flight cutoffs passed`,
                  `${cutoffs.total} 個航班截止時間中已過 ${cutoffs.passed} 個`,
                )}
              >
                <span style={{ transform: `scaleX(${cutoffs.share})` }} />
              </span>
              <small aria-hidden="true">
                {t(
                  `${cutoffs.passed} of ${cutoffs.total} flight cutoffs passed`,
                  `${cutoffs.total} 個航班截止時間中已過 ${cutoffs.passed} 個`,
                )}
              </small>
            </>
          ) : (
            <small>{t("No scheduled flights in this data", "此資料中沒有定期航班")}</small>
          )}
          {lost !== null ? (
            <small
              className="urgency-lost"
              data-some={lost > 0 || undefined}
              title={t("R-VaR: no compliant path at this decision time", "R-VaR：在此決策時間已無合規路徑")}
            >
              {t(`${lost} containers out of flights`, `${lost} 個貨櫃已無航班可用`)}
            </small>
          ) : null}
        </td>
        <td>
          <Time value={s.snapshot?.as_of} />
          {expired ? <small>{t("Expired, kept for review", "已過期，保留作檢視")}</small> : null}
        </td>
        <td>
          <Link className="text-link" href={consoleHref ?? scenarioHref}>
            {consoleHref ? t("Recovery console", "復原主控台") : t("Open scenario", "開啟情境")} →
          </Link>
        </td>
      </tr>
      {open ? (
        <tr className="desk-preview" id={previewId}>
          <td colSpan={5}>
            <div className="desk-preview-wrap">
              <div className="desk-preview-body">
                <ScenarioPreview scenario={s} scenarioHref={scenarioHref} consoleHref={consoleHref} />
              </div>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  );
}

function ScenarioPreview({
  scenario: s,
  scenarioHref,
  consoleHref,
}: {
  scenario: Scenario;
  scenarioHref: string;
  consoleHref: string | null;
}) {
  const { t, locale } = useLocale();
  const { delayHours } = useDesk();
  const destinations = new Map<string, number>();
  for (const unit of unitsOf(s))
    if (unit.destination) destinations.set(unit.destination, (destinations.get(unit.destination) ?? 0) + 1);
  const ranked = [...destinations.entries()].toSorted((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const cancelled = [
    ...new Map(
      flightsOf(s)
        .filter((f) => f.status === "CANCELLED")
        .map((f) => [f.flight_number, f] as const),
    ).values(),
  ];
  const decision = decisionTime(s, delayHours);
  const next = decision === null ? [] : upcomingCutoffs(s, decision, 3);
  const blocking = (s.quality_issues ?? []).filter((issue) => issue.blocking).length;
  const place = (code: string) =>
    airports[code] ? (locale === "en" ? airports[code].name : airports[code].zh) : code;
  return (
    <div className="desk-preview-grid">
      <div>
        <h3>{t("Where the cargo is going", "貨物目的地")}</h3>
        {ranked.length ? (
          <ul className="desk-dests">
            {ranked.map(([code, count]) => (
              <li key={code} title={place(code)}>
                <strong>{code}</strong>
                <span>{count}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("No cargo in this scenario.", "此情境沒有貨物。")}</p>
        )}
      </div>
      <div>
        <h3>{t("Cancelled flights", "已取消航班")}</h3>
        {cancelled.length ? (
          <ul className="desk-lines">
            {cancelled.slice(0, SHOWN_CANCELLED).map((f) => (
              <li key={f.id}>
                <strong>{f.flight_number}</strong> {f.origin} → {f.destination}
              </li>
            ))}
            {cancelled.length > SHOWN_CANCELLED ? (
              <li>
                +{cancelled.length - SHOWN_CANCELLED} {t("more", "班")}
              </li>
            ) : null}
          </ul>
        ) : (
          <p>{t("None in this data.", "此資料中沒有。")}</p>
        )}
      </div>
      <div>
        <h3>
          {delayHours === 0
            ? t("Next cutoffs after the data time", "資料時間後的下一批截止時間")
            : t("Next cutoffs after the chosen decision time", "所選決策時間後的下一批截止時間")}
        </h3>
        {next.length ? (
          <ul className="desk-lines">
            {next.map((cutoff) => (
              <li key={`${cutoff.flight}-${cutoff.at}`}>
                <strong>{cutoff.flight}</strong> {cutoff.origin} → {cutoff.destination}
                <small>
                  <Time value={new Date(cutoff.at).toISOString()} />
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>{t("No scheduled cutoff left in this data.", "此資料中已沒有定期航班截止時間。")}</p>
        )}
      </div>
      <div className="desk-preview-actions">
        <p>
          {blocking
            ? t(`${blocking} data problems must be fixed before solving.`, `求解前須先處理 ${blocking} 項資料問題。`)
            : t("No blocking data problems.", "沒有阻擋性的資料問題。")}
        </p>
        <div className="actions">
          <Link className="button primary" href={scenarioHref}>
            {t("Open scenario", "開啟情境")} →
          </Link>
          {consoleHref ? (
            <Link className="button" href={consoleHref}>
              {t("Recovery console", "復原主控台")}
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
