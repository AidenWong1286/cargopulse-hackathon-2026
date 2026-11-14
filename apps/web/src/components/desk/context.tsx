"use client";
import {
  createContext,
  startTransition,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { api } from "@/lib/api";
import type { Scenario } from "@/lib/types";
import {
  buildDelayModel,
  DELAY_MAX_HOURS,
  pickFocus,
  routeSummaries,
  unitsOf,
  type DelayModel,
  type DeskRoute,
  type UrgencyPoint,
} from "@/lib/desk";

/** R-VaR for the focus scenario: "idle" = nothing to ask for, "empty" = the service returned no points. */
export type UrgencyState = {
  status: "idle" | "loading" | "ready" | "empty" | "error";
  model: DelayModel | null;
};

type Desk = {
  scenarios: Scenario[] | undefined;
  loading: boolean;
  /** The scenario the hero band describes. */
  focus: Scenario | undefined;
  setFocusId: (id: string) => void;
  /** Decision delay in hours after the focus scenario's data time (0–12). */
  delayHours: number;
  setDelayHours: (hours: number) => void;
  urgency: UrgencyState;
  /** One entry per destination of the focus scenario. */
  routes: DeskRoute[];
  /** Device clock in ms, refreshed twice a minute (for "expired" flags). */
  now: number;
};

const DeskContext = createContext<Desk | null>(null);

export function useDesk() {
  const desk = useContext(DeskContext);
  if (!desk) throw new Error("useDesk must be used inside <DeskProvider>");
  return desk;
}

/** The what-if R-VaR points for one scenario. Slow the first time, so never awaited by the page. */
function useUrgency(focus: Scenario | undefined): UrgencyState {
  const id = focus && unitsOf(focus).length ? focus.id : null;
  const asOf = focus?.snapshot?.as_of;
  const cache = useRef(new Map<string, UrgencyPoint[]>());
  const [result, setResult] = useState<{ id: string; points?: UrgencyPoint[] } | null>(null);
  useEffect(() => {
    if (!id) return;
    const cached = cache.current.get(id);
    if (cached) {
      setResult({ id, points: cached });
      return;
    }
    const controller = new AbortController();
    api<UrgencyPoint[]>(`/scenarios/${id}/urgency?evidence=hold`, { signal: controller.signal })
      .then((points) => {
        if (!Array.isArray(points)) throw new Error("Unexpected urgency response");
        cache.current.set(id, points);
        setResult({ id, points });
      })
      .catch(() => {
        if (!controller.signal.aborted) setResult({ id });
      });
    return () => controller.abort();
  }, [id]);
  return useMemo<UrgencyState>(() => {
    if (!id) return { status: "idle", model: null };
    if (result?.id !== id) return { status: "loading", model: null };
    if (!result.points) return { status: "error", model: null };
    const model = buildDelayModel(result.points, asOf);
    return model ? { status: "ready", model } : { status: "empty", model: null };
  }, [id, result, asOf]);
}

export function DeskProvider({
  scenarios,
  loading,
  children,
}: {
  scenarios: Scenario[] | undefined;
  loading: boolean;
  children: React.ReactNode;
}) {
  const [focusId, setFocusId] = useState<string | null>(null);
  const [delayHours, setDelay] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const focus = useMemo(
    () => scenarios?.find((s) => s.id === focusId) ?? pickFocus(scenarios),
    [scenarios, focusId],
  );
  const urgency = useUrgency(focus);
  const routes = useMemo(() => routeSummaries(focus, urgency.model), [focus, urgency.model]);
  // The slider keeps its own thumb position; everything that follows it
  // (chart, board, list) updates in a transition so dragging stays smooth.
  const setDelayHours = useCallback((hours: number) => {
    const clamped = Math.min(DELAY_MAX_HOURS, Math.max(0, hours));
    startTransition(() => setDelay(clamped));
  }, []);
  const value = useMemo<Desk>(
    () => ({ scenarios, loading, focus, setFocusId, delayHours, setDelayHours, urgency, routes, now }),
    [scenarios, loading, focus, delayHours, setDelayHours, urgency, routes, now],
  );
  return <DeskContext.Provider value={value}>{children}</DeskContext.Provider>;
}
