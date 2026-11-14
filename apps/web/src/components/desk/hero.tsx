"use client";
import { useEffect, useId, useMemo, useState, type CSSProperties } from "react";
import {
  DELAY_MAX_HOURS,
  DELAY_STEP_HOURS,
  hoursLabel,
  isExpired,
  lostCountAt,
  nextCutoff,
  routeLossHours,
  unitsOf,
} from "@/lib/desk";
import type { Scenario } from "@/lib/types";
import { HubChart, type HubRoute } from "../chart/hub-chart";
import { kmAcrossToFit } from "../chart/geo";
import { ArrivalGlide } from "../chart/arrival";
import { CountUp } from "../kit/count-up";
import { FlapNumber } from "../kit/flap-number";
import { useLocale } from "../locale";
import { Time } from "../ui";
import { useDesk } from "./context";

const CHART_W = 1000;
const CHART_H = 620;
const HUB_AT: [number, number] = [0.5, 0.5];
/** View used before any destination is known. */
const RESTING_KM = 11000;

const rise = (i: number) => ({ "--i": i }) as CSSProperties;

/** Hub chart, departure board and decision-delay slider for the focus scenario. */
export function DeskHero() {
  const { t } = useLocale();
  const { focus, routes, delayHours, urgency, loading } = useDesk();
  const ready = urgency.status === "ready";
  const hubRoutes = useMemo<HubRoute[]>(() => {
    if (!focus) return [];
    return routes.map((route) => {
      const lost = ready && typeof route.lostAt === "number" && route.lostAt <= delayHours;
      return {
        id: `${focus.id}:${route.destination}`,
        origin: route.origin,
        destination: route.destination,
        status: !ready ? "unknown" : lost ? "blocked" : route.needsCheck ? "verify" : "passed",
        faded: lost,
        title: focus.snapshot?.title,
        flights: route.flights,
        ulds: route.uldCodes,
        href: `/operations/${focus.id}`,
      };
    });
  }, [focus, routes, delayHours, ready]);
  const kmAcross = useMemo(() => {
    const codes = routes.flatMap((route) => (route.origin ? [route.origin, route.destination] : [route.destination]));
    return codes.length ? kmAcrossToFit(codes, CHART_W, CHART_H, HUB_AT) : RESTING_KM;
  }, [routes]);
  return (
    <section className="desk-hero" aria-label={t("Hub overview", "樞紐概覽")}>
      <ArrivalGlide className="desk-chart" hub={HUB_AT} kmAcross={kmAcross}>
        <HubChart
          variant="band"
          width={CHART_W}
          height={CHART_H}
          hub={HUB_AT}
          kmAcross={kmAcross}
          routes={hubRoutes}
          focusKey={focus?.id}
          emptyHint={
            loading
              ? undefined
              : t("Start the demo scenario to see its routes here.", "開始示範情境後，航線會顯示於此。")
          }
        />
      </ArrivalGlide>
      <DepartureBoard />
      <DelaySlider />
    </section>
  );
}

/** The one dark surface: split-flap counts for the focus scenario. */
function DepartureBoard() {
  const { t } = useLocale();
  const { scenarios, loading, focus, urgency, delayHours, now } = useDesk();
  const units = unitsOf(focus);
  const lost = urgency.model ? lostCountAt(urgency.model, delayHours, units) : null;
  const width = Math.max(3, String(units.length).length);
  const expired = isExpired(focus, now);
  return (
    <section
      className="board rise"
      style={rise(1)}
      aria-label={t("Departure board", "航班看板")}
      data-foil
      data-flight-target=""
    >
      <header className="board-head">
        <p className="board-kicker">{t("Showing", "目前顯示")}</p>
        <p className="board-scenario" title={focus ? `${t("Scenario", "情境")} ${focus.id}` : undefined}>
          {focus?.snapshot?.title ??
            (loading ? t("Loading scenarios…", "正在載入情境……") : t("No scenario loaded yet", "尚未載入情境"))}
        </p>
      </header>
      <div className="board-rows">
        <div className="board-row" title={t("Scenarios loaded on this page", "本頁已載入的情境數目")}>
          <p className="board-label">{t("Incidents", "事件")}</p>
          <FlapNumber value={loading ? null : (scenarios?.length ?? null)} minLength={width} size="lg" />
        </div>
        <div
          className="board-row"
          title={t("Unit load devices (ULDs) in this scenario", "此情境中的集裝器（ULD）")}
        >
          <p className="board-label">{t("Affected containers", "受影響貨櫃")}</p>
          <FlapNumber value={focus ? units.length : null} minLength={width} size="lg" />
        </div>
        <div
          className="board-row"
          title={t(
            "R-VaR: containers with no compliant path at this decision time",
            "R-VaR：在此決策時間已無合規路徑的貨櫃",
          )}
        >
          <p className="board-label">
            {t("Out of flights", "已無航班可用")}
            <small>
              {urgency.status === "loading"
                ? t("working it out…", "計算中……")
                : urgency.status === "ready"
                  ? delayHours === 0
                    ? expired
                      ? t("at the data time", "於資料時間")
                      : t("if we decide now", "若現在決定")
                    : t(`if we decide in +${hoursLabel(delayHours)} h`, `若於 +${hoursLabel(delayHours)} 小時後決定`)
                  : focus
                    ? t("not available", "暫無資料")
                    : ""}
            </small>
          </p>
          <FlapNumber value={lost} minLength={width} size="lg" tone={lost ? "amber" : "fog"} />
        </div>
        <Countdown scenario={focus} loading={loading} />
      </div>
    </section>
  );
}

const two = (n: number) => String(n).padStart(2, "0");

/** Live time to the next scheduled cutoff. Ticks once a second and re-renders only itself. */
function Countdown({ scenario, loading }: { scenario: Scenario | undefined; loading: boolean }) {
  const { t } = useLocale();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const next = scenario && now !== null ? nextCutoff(scenario, now) : null;
  const seconds = next && now !== null ? Math.max(0, Math.floor((next.at - now) / 1000)) : null;
  const waiting = loading || now === null;
  const clock =
    seconds === null
      ? null
      : `${two(Math.floor(seconds / 3600))}:${two(Math.floor((seconds % 3600) / 60))}:${two(seconds % 60)}`;
  return (
    <div
      className="board-row"
      title={t(
        "Time until the next scheduled flight in this scenario stops accepting cargo",
        "距離此情境下一班定期航班截止收貨的時間",
      )}
    >
      <p className="board-label">
        {t("Next cutoff in", "距離下一個截止時間")}
        <small>
          {waiting
            ? ""
            : next
              ? `${next.flight} · ${next.origin} → ${next.destination}`
              : scenario
                ? t("No upcoming cutoff in this data", "此資料中沒有即將到來的截止時間")
                : ""}
        </small>
      </p>
      <FlapNumber
        value={waiting ? null : (clock ?? "—")}
        minLength={waiting ? 8 : 1}
        size="md"
        label={
          seconds === null
            ? t("No upcoming cutoff", "沒有即將到來的截止時間")
            : t(
                `${Math.floor(seconds / 3600)} hours ${Math.floor((seconds % 3600) / 60)} minutes`,
                `${Math.floor(seconds / 3600)} 小時 ${Math.floor((seconds % 3600) / 60)} 分鐘`,
              )
        }
      />
    </div>
  );
}

const TICKS = [0, 2, 4, 6, 8, 10, 12];

/** "If we decide in: now … +12 h". Drives the chart, the board and the list together. */
function DelaySlider() {
  const { t, locale } = useLocale();
  const { focus, urgency, routes, delayHours, setDelayHours, now } = useDesk();
  const id = useId();
  // The thumb follows the pointer at once; the rest of the desk follows in a transition.
  const [raw, setRaw] = useState(delayHours);
  const units = unitsOf(focus);
  const total = units.length;
  const ready = urgency.status === "ready" && !!urgency.model;
  const lost = urgency.model ? lostCountAt(urgency.model, delayHours, units) : null;
  const expired = isExpired(focus, now);
  const marks = useMemo(() => (ready ? routeLossHours(routes) : []), [ready, routes]);
  const start = expired ? t("data time", "資料時間") : t("now", "現在");
  const when = raw === 0 ? start : `+${hoursLabel(raw)} ${t("h", "小時")}`;
  const message = !focus
    ? t("Start the demo scenario to try this slider.", "開始示範情境後即可使用此滑桿。")
    : urgency.status === "loading"
      ? t(
          "Working out the cost of waiting (about 20 seconds the first time)…",
          "正在計算等待的代價（首次約需 20 秒）……",
        )
      : urgency.status === "error"
        ? t(
            "The cost of waiting could not be worked out for this scenario. The other counts still come from its data.",
            "未能計算此情境的等待代價。其他數字仍來自其資料。",
          )
        : urgency.status === "empty" || urgency.status === "idle"
          ? t("This scenario has no cost-of-waiting data yet.", "此情境尚未有等待代價資料。")
          : null;
  return (
    <div className="delay rise" style={rise(2)} data-ready={ready || undefined}>
      <div className="delay-head">
        <label className="delay-label" htmlFor={id}>
          {t("If we decide in:", "如果我們在此時決定：")}
        </label>
        <strong className="delay-when">{when}</strong>
        <p className="delay-readout" role="status">
          {message ??
            (locale === "en" ? (
              <>
                <CountUp value={lost} /> of {total} containers have no flight left
              </>
            ) : (
              <>
                {total} 個貨櫃中有 <CountUp value={lost} /> 個已無航班可用
              </>
            ))}
        </p>
      </div>
      <div className="delay-track">
        <input
          id={id}
          type="range"
          min={0}
          max={DELAY_MAX_HOURS}
          step={DELAY_STEP_HOURS}
          value={raw}
          disabled={!ready}
          style={{ "--fill": `${(raw / DELAY_MAX_HOURS) * 100}%` } as CSSProperties}
          aria-valuetext={
            raw === 0
              ? t(`${start}: ${lost ?? 0} of ${total} containers have no flight left`, `${start}：${total} 個貨櫃中有 ${lost ?? 0} 個已無航班可用`)
              : t(
                  `${hoursLabel(raw)} hours after the data time: ${lost ?? 0} of ${total} containers have no flight left`,
                  `資料時間後 ${hoursLabel(raw)} 小時：${total} 個貨櫃中有 ${lost ?? 0} 個已無航班可用`,
                )
          }
          onChange={(event) => {
            const hours = Number(event.target.value);
            setRaw(hours);
            setDelayHours(hours);
          }}
        />
        <div className="delay-marks" aria-hidden="true">
          {marks.map((mark) => (
            <span
              key={mark.at}
              className="delay-mark"
              data-passed={mark.at <= raw || undefined}
              style={{ "--p": mark.at / DELAY_MAX_HOURS } as CSSProperties}
              title={t(
                `+${hoursLabel(mark.at)} h: ${mark.destinations.join(", ")} loses its last flight`,
                `+${hoursLabel(mark.at)} 小時：${mark.destinations.join("、")} 失去最後一班航班`,
              )}
            />
          ))}
        </div>
        <div className="delay-scale" aria-hidden="true">
          {TICKS.map((tick) => (
            <span key={tick} style={{ "--p": tick / DELAY_MAX_HOURS } as CSSProperties}>
              {tick === 0 ? start : `+${tick} ${t("h", "小時")}`}
            </span>
          ))}
        </div>
      </div>
      {focus ? (
        <p className="delay-note">
          {expired
            ? t(
                "This data has expired, so hours are counted from the data time:",
                "此資料已過期，因此時數由資料時間起計：",
              )
            : t("Hours are counted from the data time:", "時數由資料時間起計：")}{" "}
          <Time value={focus.snapshot?.as_of} />
          {marks.length
            ? ` · ${t("Amber marks: a route loses its last flight.", "琥珀色標記：有航線失去最後一班航班。")}`
            : null}
        </p>
      ) : null}
    </div>
  );
}
