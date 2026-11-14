"use client";
/**
 * Visual-effects preferences shared by every page: day/night theme, effect level
 * (full or light, for weaker laptops) and optional interface sounds (off by default).
 * Preferences live in small cookies so the server renders the right theme first time.
 * "Calm" is forced when the operating system asks for reduced motion.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

export type Theme = "day" | "night";
export type FxLevel = "full" | "lite";
export type FxPrefs = { theme: Theme; level: FxLevel; sound: boolean };
/** full = every effect; lite = reduced effects; calm = reduced-motion users (no decorative motion). */
export type Motion = "full" | "lite" | "calm";

type FxContext = FxPrefs & {
  motion: Motion;
  setTheme: (theme: Theme, origin?: { x: number; y: number }) => void;
  setLevel: (level: FxLevel) => void;
  setSound: (on: boolean) => void;
};

const Ctx = createContext<FxContext | null>(null);

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; Path=/; Max-Age=31536000; SameSite=Lax`;
}

export function FxProvider({ initial, children }: { initial: FxPrefs; children: React.ReactNode }) {
  const [prefs, setPrefs] = useState<FxPrefs>(initial);
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  const motion: Motion = reduced ? "calm" : prefs.level;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = prefs.theme;
    root.dataset.fx = motion;
    root.dataset.sound = prefs.sound ? "on" : "off";
  }, [prefs.theme, prefs.sound, motion]);

  // Holographic foil: any element with [data-foil] gets the pointer position as CSS
  // variables, so its sheen follows the cursor like a premium card.
  useEffect(() => {
    if (motion === "calm") return;
    let last: HTMLElement | null = null;
    const onMove = (event: PointerEvent) => {
      const card = (event.target as Element | null)?.closest?.("[data-foil]") as HTMLElement | null;
      if (last && last !== card) last.style.removeProperty("--foil-on");
      last = card;
      if (!card) return;
      const box = card.getBoundingClientRect();
      const x = (event.clientX - box.left) / box.width;
      const y = (event.clientY - box.top) / box.height;
      card.style.setProperty("--mx", `${(x * 100).toFixed(1)}%`);
      card.style.setProperty("--my", `${(y * 100).toFixed(1)}%`);
      card.style.setProperty("--tilt-x", `${((0.5 - y) * 4).toFixed(2)}deg`);
      card.style.setProperty("--tilt-y", `${((x - 0.5) * 5).toFixed(2)}deg`);
      card.style.setProperty("--foil-on", "1");
    };
    const onLeave = () => {
      last?.style.removeProperty("--foil-on");
      last = null;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", onLeave);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerleave", onLeave);
    };
  }, [motion]);

  const setTheme = useCallback(
    (theme: Theme, origin?: { x: number; y: number }) => {
      writeCookie("cp_theme", theme);
      const apply = () => setPrefs((p) => ({ ...p, theme }));
      const root = document.documentElement;
      type Doc = Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
      const doc = document as Doc;
      if (motion === "calm" || !doc.startViewTransition) {
        root.dataset.theme = theme;
        apply();
        return;
      }
      // Sunset / sunrise sweep: the new theme opens as a circle from the toggle,
      // edged by a band of evening light (see fx.css ::view-transition rules).
      const x = origin?.x ?? window.innerWidth - 80;
      const y = origin?.y ?? 32;
      root.style.setProperty("--sweep-x", `${x}px`);
      root.style.setProperty("--sweep-y", `${y}px`);
      root.dataset.sweep = theme === "night" ? "sunset" : "sunrise";
      const transition = doc.startViewTransition(() => {
        root.dataset.theme = theme;
        apply();
      });
      transition.finished.finally(() => {
        delete root.dataset.sweep;
      });
    },
    [motion],
  );
  const setLevel = useCallback((level: FxLevel) => {
    writeCookie("cp_fx", level);
    setPrefs((p) => ({ ...p, level }));
  }, []);
  const setSound = useCallback((sound: boolean) => {
    writeCookie("cp_sound", sound ? "on" : "off");
    setPrefs((p) => ({ ...p, sound }));
  }, []);

  const value = useMemo(
    () => ({ ...prefs, motion, setTheme, setLevel, setSound }),
    [prefs, motion, setTheme, setLevel, setSound],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Effect preferences. Safe outside the provider (falls back to calm defaults). */
export function useFx(): FxContext {
  const value = useContext(Ctx);
  if (value) return value;
  return {
    theme: "day",
    level: "full",
    sound: false,
    motion: "calm",
    setTheme: () => undefined,
    setLevel: () => undefined,
    setSound: () => undefined,
  };
}

/** True while the browser tab is visible; heavy loops pause when it is hidden. */
export function usePageVisible() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  return visible;
}

/**
 * Runs `frame(timeSeconds, deltaSeconds)` every animation frame while `active`
 * and the tab is visible. In "lite" mode it runs at about 30 fps.
 */
export function useFrameLoop(frame: (t: number, dt: number) => void, active: boolean) {
  const { motion } = useFx();
  const visible = usePageVisible();
  const ref = useRef(frame);
  ref.current = frame;
  useEffect(() => {
    if (!active || !visible || motion === "calm") return;
    let raf = 0;
    let last = performance.now();
    let skip = false;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (motion === "lite") {
        skip = !skip;
        if (skip) return;
      }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      ref.current(now / 1000, dt);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, visible, motion]);
}

/**
 * Makes a decorative animation skippable: returns `skipped`, which turns true on the
 * first click / key press anywhere after `armed` becomes true (or immediately under calm).
 */
export function useSkippable(armed: boolean) {
  const { motion } = useFx();
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    if (!armed) return;
    if (motion === "calm") {
      setSkipped(true);
      return;
    }
    setSkipped(false);
    const skip = () => setSkipped(true);
    window.addEventListener("pointerdown", skip, { once: true });
    window.addEventListener("keydown", skip, { once: true });
    return () => {
      window.removeEventListener("pointerdown", skip);
      window.removeEventListener("keydown", skip);
    };
  }, [armed, motion]);
  return skipped || motion === "calm";
}
