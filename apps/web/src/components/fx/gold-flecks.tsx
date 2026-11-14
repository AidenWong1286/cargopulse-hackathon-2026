"use client";
/**
 * Gold-leaf flecks that puff out of a stamp on impact and drift upward, flipping
 * like foil in light. Pure decoration (aria-hidden). Canvas only, colours read from
 * the gold design tokens. Runs through useFrameLoop, so it pauses when the tab is
 * hidden and halves its rate in "lite"; it never mounts under "calm".
 */
import { useEffect, useRef } from "react";
import { useFrameLoop, useFx } from "@/lib/fx";

type Fleck = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  spin: number;
  spinSpeed: number;
  phase: number;
  age: number;
  life: number;
  tone: number;
};

const WIDTH = 380;
const HEIGHT = 480;
/** Seal centre inside the canvas (matches .gold-flecks positioning in wow-receipt.css). */
const ORIGIN_X = WIDTH / 2;
const ORIGIN_Y = HEIGHT * 0.78;

export default function GoldFlecks({ radius = 80, onDone }: { radius?: number; onDone?: () => void }) {
  const { motion } = useFx();
  const canvas = useRef<HTMLCanvasElement>(null);
  const flecks = useRef<Fleck[]>([]);
  const palette = useRef<string[]>([]);
  const trickle = useRef(0);
  const finished = useRef(false);
  const lite = motion === "lite";

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    el.width = WIDTH * dpr;
    el.height = HEIGHT * dpr;
    el.getContext("2d")?.setTransform(dpr, 0, 0, dpr, 0, 0);
    const css = getComputedStyle(el);
    palette.current = ["--gold-pale", "--gold", "--gold-deep", "--gold-pale"].map(
      (name) => css.getPropertyValue(name).trim() || "currentColor",
    );
    // The impact burst: flecks leave the seal ring outward, then float up.
    const burst = lite ? 28 : 96;
    flecks.current = Array.from({ length: burst }, () => spawn(true));
    trickle.current = lite ? 8 : 42;
    finished.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function spawn(burst: boolean): Fleck {
    const angle = burst ? Math.random() * Math.PI * 2 : -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const r = radius * (0.82 + Math.random() * 0.22);
    const speed = burst ? 70 + Math.random() * 150 : 10 + Math.random() * 30;
    return {
      x: ORIGIN_X + Math.cos(angle) * r,
      y: ORIGIN_Y + Math.sin(angle) * r * 0.92,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - (burst ? 40 : 30),
      size: 1.2 + Math.random() * (burst ? 3.2 : 2.4),
      spin: Math.random() * Math.PI * 2,
      spinSpeed: (Math.random() < 0.5 ? -1 : 1) * (3 + Math.random() * 7),
      phase: Math.random() * Math.PI * 2,
      age: 0,
      life: 1.8 + Math.random() * 2,
      tone: Math.floor(Math.random() * 4),
    };
  }

  useFrameLoop((t, dt) => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx || finished.current) return;
    if (trickle.current > 0 && Math.random() < (lite ? 0.25 : 0.55)) {
      trickle.current -= 1;
      flecks.current.push(spawn(false));
    }
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const next: Fleck[] = [];
    for (const f of flecks.current) {
      f.age += dt;
      if (f.age >= f.life) continue;
      // Air drag on the burst, a gentle buoyant lift and a sideways sway.
      const drag = Math.exp(-2.6 * dt);
      f.vx = f.vx * drag + Math.sin(t * 1.7 + f.phase) * 9 * dt;
      f.vy = f.vy * drag - 22 * dt;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.spin += f.spinSpeed * dt;
      const k = f.age / f.life;
      const fade = Math.min(1, f.age / 0.12) * (1 - k * k);
      const flip = Math.cos(f.spin);
      ctx.save();
      ctx.translate(f.x, f.y);
      ctx.rotate(f.phase + f.spin * 0.35);
      ctx.globalAlpha = Math.max(0, fade * (0.55 + 0.45 * Math.abs(flip)));
      // A flake facing the light reads pale; turned away it reads deep gold.
      ctx.fillStyle = palette.current[flip > 0.35 ? 0 : flip < -0.35 ? 2 : f.tone] || "currentColor";
      const w = Math.max(0.35, f.size * Math.abs(flip));
      ctx.beginPath();
      ctx.moveTo(0, -f.size);
      ctx.lineTo(w, 0);
      ctx.lineTo(0, f.size);
      ctx.lineTo(-w, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      next.push(f);
    }
    flecks.current = next;
    if (!next.length && trickle.current <= 0) {
      finished.current = true;
      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      onDone?.();
    }
  }, true);

  return <canvas ref={canvas} className="gold-flecks" aria-hidden="true" />;
}
