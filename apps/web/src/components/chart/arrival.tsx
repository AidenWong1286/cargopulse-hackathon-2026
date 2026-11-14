"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";
import { HubChart } from "./hub-chart";

/** Reference places on the sign-in chart. Positions only; no routes are implied. */
export const LOGIN_WAYPOINTS = ["NRT", "SIN", "DEL", "SYD", "DXB", "ANC", "HNL"];
/** How the sign-in page frames the chart; the arrival glide starts from this view. */
export const LOGIN_FRAME = {
  width: 1600,
  height: 1000,
  hub: [0.46, 0.5] as [number, number],
  kmAcross: 18500,
};

const KEY = "cp_arrival";
/** A sign-in older than this is no longer "just arrived". */
const FRESH_MS = 20_000;
/** Matches the gold iris in wow-login.css (.arrival-iris). */
const GLIDE_MS = 1050;

/** Call right after a successful sign-in, just before the workspace loads. */
export function markArrival() {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    // Storage can be unavailable (private mode); the glide is simply skipped.
  }
}

function arrivalIsFresh() {
  try {
    const at = Number(sessionStorage.getItem(KEY));
    return at > 0 && Date.now() - at < FRESH_MS;
  } catch {
    return false;
  }
}

function clearArrival() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}

const useBrowserLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

function LoginChart() {
  return (
    <HubChart
      variant="backdrop"
      hub={LOGIN_FRAME.hub}
      kmAcross={LOGIN_FRAME.kmAcross}
      waypoints={LOGIN_WAYPOINTS}
      intro={false}
    />
  );
}

/**
 * The sign-in chart, kept on screen while the session is verified, so the map
 * never blinks between sign-in and the workspace. Decorative.
 *
 * By default it appears only for a fresh sign-in (it is added after hydration).
 * With `always` it is part of the server-rendered page, which avoids any gap.
 */
export function ArrivalBackdrop({ always = false }: { always?: boolean }) {
  const [fresh, setFresh] = useState(false);
  useBrowserLayoutEffect(() => {
    setFresh(arrivalIsFresh());
  }, [always]);
  if (!always && !fresh) return null;
  return (
    <div className="arrival-backdrop" aria-hidden="true">
      <LoginChart />
      {/* Right after sign-in: hold the gold light the sign-in dive ended on. */}
      {fresh ? <div className="arrival-light" /> : null}
    </div>
  );
}

/** Where the gold iris opens: the hub's resting place in the band, in viewport pixels. */
type Iris = { x: number; y: number; r: number };

/**
 * Wraps the Operations chart band. Right after sign-in the band starts zoomed in
 * on Hong Kong and glides into place, once, while the gold light of the sign-in
 * dive opens like an iris around the hub onto the desk chart. Any click or key
 * skips it. Under reduced motion nothing moves.
 */
export function ArrivalGlide({
  hub = [0.5, 0.5],
  kmAcross,
  children,
  className,
}: {
  /** Where the hub sits in the band chart, as a fraction of its frame. */
  hub?: [number, number];
  /** Kilometres spanned by the band chart's width. */
  kmAcross: number;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [gliding, setGliding] = useState(false);
  const [iris, setIris] = useState<Iris | null>(null);
  const [hubX, hubY] = hub;
  // Read once: the glide runs with the frame the band had when it mounted.
  const start = useRef({ hubX, hubY, kmAcross });

  useBrowserLayoutEffect(() => {
    const element = ref.current;
    if (!element || !arrivalIsFresh()) return;
    const rect = element.getBoundingClientRect();
    if (
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !rect.width ||
      !rect.height ||
      typeof element.animate !== "function"
    ) {
      clearArrival();
      return;
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const from = start.current;
    // The sign-in chart covers the viewport ("slice"), so its scale is the larger fit.
    const loginPxPerKm =
      (LOGIN_FRAME.width * Math.max(vw / LOGIN_FRAME.width, vh / LOGIN_FRAME.height)) / LOGIN_FRAME.kmAcross;
    const bandPxPerKm = rect.width / from.kmAcross;
    const scale = loginPxPerKm / bandPxPerKm;
    const tx = LOGIN_FRAME.hub[0] * vw - rect.left - scale * from.hubX * rect.width;
    const ty = LOGIN_FRAME.hub[1] * vh - rect.top - scale * from.hubY * rect.height;

    const rootElement = document.documentElement;
    rootElement.dataset.arriving = "";
    const irisX = rect.left + from.hubX * rect.width;
    const irisY = rect.top + from.hubY * rect.height;
    setIris({
      x: irisX,
      y: irisY,
      r: Math.hypot(Math.max(irisX, vw - irisX), Math.max(irisY, vh - irisY)),
    });
    setGliding(true);
    const glide = element.animate(
      [{ transform: `translate(${tx}px, ${ty}px) scale(${scale})` }, { transform: "none" }],
      { duration: GLIDE_MS, easing: "cubic-bezier(0.2, 0, 0, 1)", fill: "backwards" },
    );
    let stopped = false;
    // `seen` is false only when React tears the effect down before the glide was shown.
    const stop = (seen: boolean) => {
      if (stopped) return;
      stopped = true;
      if (seen) clearArrival();
      glide.cancel();
      setGliding(false);
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
    const skip = () => stop(true);
    glide.finished.then(skip, () => undefined);
    window.addEventListener("pointerdown", skip);
    window.addEventListener("keydown", skip);
    const settle = window.setTimeout(() => delete rootElement.dataset.arriving, 1200);
    return () => {
      stop(false);
      window.clearTimeout(settle);
      delete rootElement.dataset.arriving;
    };
  }, []);

  return (
    <div ref={ref} className={cn("arrival-glide", className)} data-gliding={gliding || undefined}>
      {children}
      {/* Outside the moving band: a fixed layer inside a transformed parent would move with it. */}
      {gliding && iris
        ? createPortal(
            <div
              className="arrival-iris-host"
              aria-hidden="true"
              style={
                {
                  "--iris-x": `${iris.x}px`,
                  "--iris-y": `${iris.y}px`,
                  "--iris-r": `${iris.r}px`,
                } as React.CSSProperties
              }
            >
              <div className="arrival-iris" />
              <div className="arrival-iris-ring" />
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
