"use client";
/**
 * Count-up numbers and the circular gold-ring gauges of the Protect page.
 * Values only animate when real data arrives or changes; a click or key press jumps
 * straight to the final value, and "calm" motion shows it at once.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useFx } from "@/lib/fx";

const format = (n: number, digits: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits });

/** Animates from the last shown value (0 on first show) to `target`. */
export function useCountUp(target: number, duration = 1200) {
  const { motion } = useFx();
  const safe = Number.isFinite(target) ? target : 0;
  const [value, setValue] = useState(() => (motion === "calm" ? safe : 0));
  const shown = useRef(value);
  useEffect(() => {
    if (motion === "calm") {
      shown.current = safe;
      setValue(safe);
      return;
    }
    const from = shown.current;
    if (from === safe) return;
    const t0 = performance.now();
    let raf = 0;
    function stop() {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    }
    function skip() {
      cancelAnimationFrame(raf);
      shown.current = safe;
      setValue(safe);
      stop();
    }
    function step(now: number) {
      const p = Math.min(1, (now - t0) / duration);
      const e = 1 - Math.pow(1 - p, 4);
      const v = from + (safe - from) * e;
      shown.current = v;
      setValue(v);
      if (p < 1) raf = requestAnimationFrame(step);
      else stop();
    }
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      stop();
    };
  }, [safe, duration, motion]);
  return value;
}

/** A real number that counts up when it first appears or changes. */
export function CountUp({ value, digits = 0, duration = 1200 }: { value: number; digits?: number; duration?: number }) {
  const v = useCountUp(value, duration);
  return <span className="count-up">{format(v, digits)}</span>;
}

const TICKS = Array.from({ length: 60 }, (_, i) => i);

/**
 * A watch-dial gauge: gold rings and ticks, a jade arc filled to the real share,
 * the percentage in the middle and the real figures underneath.
 */
export function Gauge({ label, value, detail }: { label: string; value: number; detail: string }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  const pct = useCountUp(Math.max(0, Number.isFinite(value) ? value : 0) * 100, 1500);
  const frac = Math.min(1, pct / 100);
  const R = 70;
  const C = 2 * Math.PI * R;
  const final = Math.max(0, Number.isFinite(value) ? value : 0) * 100;
  return (
    <figure className="gauge" aria-label={`${label}: ${format(final, 1)}% · ${detail}`}>
      <div className="gauge__dial">
        <svg viewBox="0 0 200 200" aria-hidden="true">
          <defs>
            <linearGradient id={`gold-${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--gold-pale)" }} />
              <stop offset="35%" style={{ stopColor: "var(--gold)" }} />
              <stop offset="65%" style={{ stopColor: "var(--gold-deep)" }} />
              <stop offset="100%" style={{ stopColor: "var(--gold-pale)" }} />
            </linearGradient>
            <linearGradient id={`jade-${id}`} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" style={{ stopColor: "var(--gauge-jade-a)" }} />
              <stop offset="100%" style={{ stopColor: "var(--gauge-jade-b)" }} />
            </linearGradient>
            <radialGradient id={`face-${id}`} cx="50%" cy="40%" r="65%">
              <stop offset="0%" style={{ stopColor: "var(--gauge-face-a)" }} />
              <stop offset="100%" style={{ stopColor: "var(--gauge-face-b)" }} />
            </radialGradient>
          </defs>
          <circle cx="100" cy="100" r="97" fill={`url(#face-${id})`} />
          <circle cx="100" cy="100" r="97" fill="none" stroke={`url(#gold-${id})`} strokeWidth="1.8" />
          <circle cx="100" cy="100" r="91.5" fill="none" stroke={`url(#gold-${id})`} strokeWidth="0.6" opacity="0.75" />
          {TICKS.map((i) => {
            const major = i % 5 === 0;
            const a = (i / 60) * Math.PI * 2;
            const r0 = major ? 81 : 84.5;
            return (
              <line
                key={i}
                x1={100 + Math.sin(a) * r0}
                y1={100 - Math.cos(a) * r0}
                x2={100 + Math.sin(a) * 88}
                y2={100 - Math.cos(a) * 88}
                className={i / 60 <= frac ? "gauge__tick is-lit" : "gauge__tick"}
                strokeWidth={major ? 1.4 : 0.7}
              />
            );
          })}
          <circle cx="100" cy="100" r={R} fill="none" className="gauge__track" strokeWidth="11" />
          <circle
            cx="100"
            cy="100"
            r={R}
            fill="none"
            stroke={`url(#jade-${id})`}
            strokeWidth="11"
            strokeLinecap="round"
            strokeDasharray={C}
            strokeDashoffset={C * (1 - frac)}
            transform="rotate(-90 100 100)"
          />
          <circle cx="100" cy="100" r="58.5" fill="none" stroke={`url(#gold-${id})`} strokeWidth="0.8" />
          <g transform={`rotate(${frac * 360} 100 100)`}>
            <circle cx="100" cy="30" r="6" fill={`url(#gold-${id})`} className="gauge__marker" strokeWidth="1.5" />
          </g>
        </svg>
        <div className="gauge__read" aria-hidden="true">
          <strong>
            {format(pct, 1)}
            <small>%</small>
          </strong>
          <span>{detail}</span>
        </div>
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );
}
