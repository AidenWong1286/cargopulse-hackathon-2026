"use client";
/**
 * A headline that reveals letter by letter out of a soft blur, then a glint of
 * gold light runs through it once. The accessible name is the plain text; the
 * letter spans are decorative. Timing lives in fx.css (.shimmer-*).
 */
import { createElement } from "react";

type Props = { text: string; as?: "h1" | "h2" | "p"; className?: string; delay?: number };

export function ShimmerTitle({ text, as = "h1", className, delay = 0 }: Props) {
  const words = text.split(/(\s+)/);
  const total = Array.from(text.replace(/\s+/g, "")).length;
  const step = Math.max(14, Math.min(40, 900 / Math.max(1, total)));
  let index = 0;
  return createElement(
    as,
    {
      className: ["shimmer-title", className].filter(Boolean).join(" "),
      "aria-label": text,
      style: { "--st-step": `${step}ms`, "--st-n": total, "--st-d": `${delay}ms` } as React.CSSProperties,
    },
    <span aria-hidden="true" className="shimmer-letters">
      {words.map((word, w) =>
        /^\s+$/.test(word) ? (
          <span key={w}> </span>
        ) : (
          <span key={w} className="shimmer-word">
            {Array.from(word).map((ch, c) => (
              <span key={c} className="shimmer-ch" style={{ "--i": index++ } as React.CSSProperties}>
                {ch}
              </span>
            ))}
          </span>
        ),
      )}
    </span>,
  );
}
