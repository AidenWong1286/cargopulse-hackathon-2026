"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { buildFrame } from "./geo";

// WebGL light field, loaded after first paint and never on the server.
const LivingSky = dynamic(() => import("@/components/fx/living-sky").then((m) => m.LivingSky), {
  ssr: false,
});

const WIDTH = 1600;
const HEIGHT = 1000;
/** Degrees the sun is below the horizon for each layer of the night veil. */
const TWILIGHT = [0, 6, 12];
/** Furthest the layer drifts from rest, in px (pointer and scroll combined stay under ~14). */
const DRIFT_X = 9;
const DRIFT_Y = 5;
const SCROLL_DRIFT = 9;

const frame = buildFrame({ width: WIDTH, height: HEIGHT, hub: [0.62, 0.5], kmAcross: 15000 });

/**
 * Page background: a very faint chart centred on HKG (coastlines, grid, three
 * range rings) with the real day/night line for the current time. It drifts a
 * few pixels with the pointer and with scrolling, and is still under
 * "reduce motion". Decorative, so hidden from assistive technology.
 */
export function LivingBackdrop() {
  const layer = useRef<SVGSVGElement>(null);
  // The night veil depends on the clock, so it is drawn only after mount.
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = window.setInterval(() => setNow(new Date()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const night = useMemo(() => (now ? TWILIGHT.map((depth) => frame.night(now, depth)) : null), [now]);

  useEffect(() => {
    const element = layer.current;
    if (!element || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const target = { x: 0, y: 0, scroll: 0 };
    const at = { x: 0, y: 0 };
    let raf = 0;
    const tick = () => {
      const goalX = target.x;
      const goalY = target.y - target.scroll;
      at.x += (goalX - at.x) * 0.06;
      at.y += (goalY - at.y) * 0.06;
      element.style.transform = `translate3d(${at.x.toFixed(2)}px, ${at.y.toFixed(2)}px, 0)`;
      // Stop the loop once the layer has settled; the next input starts it again.
      raf = Math.abs(goalX - at.x) + Math.abs(goalY - at.y) > 0.05 ? requestAnimationFrame(tick) : 0;
    };
    const wake = () => {
      if (!raf) raf = requestAnimationFrame(tick);
    };
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType === "touch") return;
      target.x = -(event.clientX / window.innerWidth - 0.5) * 2 * DRIFT_X;
      target.y = -(event.clientY / window.innerHeight - 0.5) * 2 * DRIFT_Y;
      wake();
    };
    const onScroll = () => {
      target.scroll = Math.min(SCROLL_DRIFT, window.scrollY * 0.015);
      wake();
    };
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("scroll", onScroll);
    };
  }, []);

  return (
    <div className="living-backdrop" aria-hidden="true">
      <LivingSky />
      <svg
        ref={layer}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="xMidYMid slice"
        focusable="false"
      >
        <g
          className="living-turn"
          style={{ transformOrigin: `${frame.cx}px ${frame.cy}px` }}
        >
          <path className="living-graticule" d={frame.graticule} />
          {frame.rings.slice(3, 6).map(({ hours, r }) => (
            <circle key={hours} className="living-ring living-ring-far" cx={frame.cx} cy={frame.cy} r={r} />
          ))}
        </g>
        <path className="living-land" d={frame.land} />
        {night ? (
          <g className="living-night-veil">
            {night.map((d, index) => (
              <path key={TWILIGHT[index]} className="living-night" d={d} />
            ))}
          </g>
        ) : null}
        {frame.rings.slice(0, 3).map(({ hours, r }) => (
          <circle key={hours} className="living-ring" cx={frame.cx} cy={frame.cy} r={r} />
        ))}
        <circle className="living-hub" cx={frame.cx} cy={frame.cy} r="3" />
      </svg>
    </div>
  );
}
