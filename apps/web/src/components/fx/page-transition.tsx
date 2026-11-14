"use client";
/**
 * Cinematic page change: a band of gold light sweeps across the workspace while
 * the new page rises out of a soft blur, block by block. Click to skip.
 * Uses one-shot Web Animations (not CSS rules), so blocks that re-render while
 * the page loads are never caught invisible mid-animation.
 */
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useFx } from "@/lib/fx";
import { playWhoosh } from "@/lib/sound";

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { motion } = useFx();
  const [sweep, setSweep] = useState(0);
  const first = useRef(true);
  const host = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (motion === "calm") return;
    setSweep((n) => n + 1);
    playWhoosh();
    const element = host.current;
    if (!element) return;
    const animations: Animation[] = [];
    // Wait one frame so the new page's blocks are in the DOM.
    const raf = requestAnimationFrame(() => {
      const blocks = Array.from(element.children).filter((c) => !c.classList.contains("pt-sweep")) as HTMLElement[];
      blocks.slice(0, 8).forEach((block, index) => {
        const lite = motion === "lite";
        animations.push(
          block.animate(
            lite
              ? [{ opacity: 0.2, transform: "translateY(10px)" }, { opacity: 1, transform: "none" }]
              : [
                  { opacity: 0, transform: "translateY(22px) scale(0.985)", filter: "blur(6px)" },
                  { opacity: 1, transform: "none", filter: "blur(0)" },
                ],
            { duration: lite ? 450 : 850, delay: Math.min(index, 4) * 80, easing: "cubic-bezier(0.16, 1, 0.3, 1)", fill: "backwards" },
          ),
        );
      });
    });
    const skip = () => {
      animations.forEach((a) => a.finish());
      setSweep(0);
    };
    window.addEventListener("pointerdown", skip, { once: true });
    const timer = window.setTimeout(() => {
      window.removeEventListener("pointerdown", skip);
      setSweep(0);
    }, 1300);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(timer);
      window.removeEventListener("pointerdown", skip);
      animations.forEach((a) => a.finish());
    };
  }, [pathname, motion]);

  return (
    <div ref={host} className="pt-host">
      {sweep ? <div className="pt-sweep" key={sweep} aria-hidden="true" /> : null}
      {children}
    </div>
  );
}
