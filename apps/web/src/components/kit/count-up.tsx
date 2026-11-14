"use client";
import { useLayoutEffect, useRef } from "react";
import { cn } from "@/lib/utils";

const DURATION_MS = 500;
const format = (value: number) => Math.round(value).toLocaleString("en-US");

/**
 * A number that counts from the value it showed before to the new real value.
 * The first real value counts up from zero. The true value is always in the
 * DOM for assistive technology; the moving digits are decorative. Under
 * reduced motion the number changes at once.
 */
export function CountUp({
  value,
  className,
}: {
  value: number | null | undefined;
  className?: string;
}) {
  const node = useRef<HTMLSpanElement>(null);
  const shown = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = node.current;
    if (!el) return;
    if (value === null || value === undefined || !Number.isFinite(value)) {
      shown.current = null;
      el.textContent = "—";
      return;
    }
    const from = shown.current ?? 0;
    const still =
      from === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) {
      shown.current = value;
      el.textContent = format(value);
      return;
    }
    el.textContent = format(from);
    const started = performance.now();
    let frame = requestAnimationFrame(function tick(now) {
      const progress = Math.min(1, (now - started) / DURATION_MS);
      const current = from + (value - from) * (1 - (1 - progress) ** 3);
      shown.current = current;
      el.textContent = format(current);
      if (progress < 1) frame = requestAnimationFrame(tick);
      else shown.current = value;
    });
    return () => cancelAnimationFrame(frame);
  }, [value]);
  return (
    <span className={cn("count-up", className)}>
      <span className="sr-only">{value ?? "—"}</span>
      {/* Text is written by the effect above, so React never resets it mid-count. */}
      <span ref={node} aria-hidden="true" />
    </span>
  );
}
