"use client";
/**
 * The demo fly-in: one small gold ULD silhouette per container in the generated
 * input (the real count from the fixture response) flies in from the screen edges
 * on a curved path with a gold trail, and stacks into a neat tower on the
 * departure board, which pulses gold as they land. Purely decorative: it never
 * holds up the real requests, and the caller unmounts it on skip, error or
 * navigation. Mounted only when motion is not "calm".
 */
import { useEffect, useRef } from "react";
import { useFrameLoop, useFx } from "@/lib/fx";
import { playChime, playTick, playWhoosh } from "@/lib/sound";
import { fitCanvas, readPalette, rgba, uldPath, type Palette } from "./swarm-draw";

type Props = {
  /** Real number of containers in the generated input. */
  count: number;
  /** Where to stack when the departure board is not on screen. */
  fallback: () => DOMRect | null;
  /** Called once, when the last container has landed. */
  onLanded: () => void;
};

const TRAIL = 9;

type Box = {
  sx: number;
  sy: number;
  bend: number;
  launch: number;
  dur: number;
  spin: number;
  landed: boolean;
  landT: number;
  x: number;
  y: number;
  hist: Float32Array;
  /** Current curve (end and control point) and progress, for the analytic trail. */
  cu?: number;
  ex?: number;
  ey?: number;
  qx?: number;
  qy?: number;
  hn: number;
};

function edgeStart(w: number, h: number): [number, number] {
  const r = Math.random();
  if (r < 0.42) return [-30, h * (0.12 + Math.random() * 0.82)];
  if (r < 0.67) return [Math.random() * w, h + 30];
  if (r < 0.87) return [Math.random() * w, -30];
  return [w + 30, h * Math.random()];
}

const ease = (u: number) => (u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2);

type Grid = { at: (i: number) => [number, number]; size: number };

/** A bottom-up stack of `count` cells inside the lower part of `r`. */
function stackGrid(r: DOMRect, count: number): Grid {
  const region = { x: r.left + 20, y: r.top + r.height * 0.3, w: Math.max(40, r.width - 40), h: Math.max(30, r.height * 0.7 - 18) };
  let cols = 1;
  for (; cols < 600; cols++) {
    const ch = region.w / cols / 1.15;
    if (Math.ceil(count / cols) * ch <= region.h) break;
  }
  const cw = region.w / cols;
  const ch = Math.min(cw / 1.15, region.h / Math.ceil(count / cols));
  return {
    size: Math.max(2.5, Math.min(cw, ch * 1.15) * 0.74),
    at: (i) => {
      const row = Math.floor(i / cols);
      const col = i % cols;
      return [region.x + (col + 0.5) * cw, region.y + region.h - (row + 0.5) * ch];
    },
  };
}

export default function ContainerFlight({ count, fallback, onLanded }: Props) {
  const { motion, theme } = useFx();
  const lite = motion === "lite";
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const palRef = useRef<Palette | null>(null);
  const state = useRef({
    boxes: [] as Box[],
    t0: -1,
    landed: 0,
    lastTick: 0,
    done: false,
    target: null as HTMLElement | null,
  });
  const landedRef = useRef(onLanded);
  landedRef.current = onLanded;

  useEffect(() => {
    if (canvasRef.current) palRef.current = readPalette(canvasRef.current);
  }, [theme]);

  useEffect(() => {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const stagger = Math.min(1.1, 0.25 + count * 0.004);
    state.current.boxes = Array.from({ length: count }, (_, i) => {
      const [sx, sy] = edgeStart(w, h);
      return {
        sx,
        sy,
        bend: (0.18 + Math.random() * 0.32) * (Math.random() < 0.5 ? -1 : 1),
        launch: (i / Math.max(1, count)) * stagger,
        dur: 0.85 + Math.random() * 0.35,
        spin: (Math.random() - 0.5) * 1.8,
        landed: false,
        landT: 0,
        x: sx,
        y: sy,
        hist: new Float32Array(TRAIL * 2),
        hn: 0,
      };
    });
    state.current.t0 = -1;
    state.current.landed = 0;
    state.current.done = false;
    state.current.target = document.querySelector<HTMLElement>("[data-flight-target]");
    playWhoosh();
    const target = state.current.target;
    return () => {
      if (target) {
        delete target.dataset.landing;
        delete target.dataset.landed;
      }
    };
  }, [count]);

  useFrameLoop((T) => {
    const canvas = canvasRef.current;
    const pal = palRef.current;
    if (!canvas || !pal) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const w = window.innerWidth;
    const h = window.innerHeight;
    const dpr = fitCanvas(canvas, w, h, lite);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const s = state.current;
    if (s.t0 < 0) s.t0 = T;
    const el = s.target;
    let rect = el?.getBoundingClientRect() ?? null;
    const onScreen = rect && rect.width > 60 && rect.height > 60 && rect.bottom > 40 && rect.top < h - 40;
    if (!onScreen) rect = fallback();
    if (!rect) rect = new DOMRect(w * 0.55, h * 0.2, w * 0.35, h * 0.6);
    const grid = stackGrid(rect, s.boxes.length);
    const now = T - s.t0;
    const trails = !lite;
    let landedNow = 0;

    for (let i = 0; i < s.boxes.length; i++) {
      const b = s.boxes[i];
      const [ex, ey] = grid.at(i);
      if (b.landed) {
        b.x = ex;
        b.y = ey;
        if (b.hn > 0) b.hn--;
        continue;
      }
      const u = Math.max(0, Math.min(1, (now - b.launch) / b.dur));
      if (u <= 0) continue;
      const e = ease(u);
      const mx = (b.sx + ex) / 2;
      const my = (b.sy + ey) / 2;
      const dx = ex - b.sx;
      const dy = ey - b.sy;
      const qx = mx - dy * b.bend;
      const qy = my + dx * b.bend;
      const k = 1 - e;
      b.x = k * k * b.sx + 2 * k * e * qx + e * e * ex;
      b.y = k * k * b.sy + 2 * k * e * qy + e * e * ey;
      b.cu = e;
      b.ex = ex;
      b.ey = ey;
      b.qx = qx;
      b.qy = qy;
      if (trails) {
        b.hist.copyWithin(2, 0, (TRAIL - 1) * 2);
        b.hist[0] = b.x;
        b.hist[1] = b.y;
        b.hn = Math.min(TRAIL, b.hn + 1);
      }
      if (u >= 1) {
        b.landed = true;
        b.landT = now;
        s.landed++;
        landedNow++;
      }
    }

    if (trails) {
      // Trails are sampled along each container's real curve (not frame history),
      // so they stay smooth arcs at any frame rate.
      const SEG = TRAIL - 1;
      for (let j = 0; j < SEG; j++) {
        ctx.beginPath();
        let any = false;
        for (const b of s.boxes) {
          if (b.landed || b.cu === undefined || b.cu <= 0) continue;
          const e0 = b.cu - (j / SEG) * 0.16;
          const e1 = b.cu - ((j + 1) / SEG) * 0.16;
          if (e1 <= 0) continue;
          const pt = (e: number): [number, number] => {
            const k = 1 - e;
            return [
              k * k * b.sx + 2 * k * e * b.qx! + e * e * b.ex!,
              k * k * b.sy + 2 * k * e * b.qy! + e * e * b.ey!,
            ];
          };
          const [x0, y0] = pt(e0);
          const [x1, y1] = pt(e1);
          ctx.moveTo(x0, y0);
          ctx.lineTo(x1, y1);
          any = true;
        }
        if (!any) continue;
        const a = 1 - j / SEG;
        ctx.strokeStyle = rgba(pal.gold, 0.5 * a);
        ctx.lineWidth = 0.5 + 2 * a;
        ctx.lineCap = "round";
        ctx.stroke();
      }
    }

    // Landed: one batched path, gold body with a deeper gold edge.
    ctx.beginPath();
    for (const b of s.boxes) if (b.landed) uldPath(ctx, b.x, b.y, grid.size);
    ctx.fillStyle = rgba(pal.goldPale, 0.95);
    ctx.fill();
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = rgba(pal.goldDeep, 0.95);
    ctx.stroke();

    // In flight: larger, tilted, easing down to size as they arrive.
    for (const b of s.boxes) {
      if (b.landed || now < b.launch) continue;
      const u = Math.min(1, (now - b.launch) / b.dur);
      const e = ease(u);
      const size = grid.size * (1 + 1.6 * (1 - e));
      ctx.save();
      ctx.globalAlpha = Math.min(1, u * 5);
      ctx.translate(b.x, b.y);
      ctx.rotate(b.spin * (1 - e));
      if (!lite) ctx.drawImage(pal.goldSprite, -size * 1.6, -size * 1.6, size * 3.2, size * 3.2);
      ctx.beginPath();
      uldPath(ctx, 0, 0, size);
      ctx.fillStyle = rgba(pal.goldPale, 1);
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = rgba(pal.goldDeep, 1);
      ctx.stroke();
      ctx.restore();
    }

    // A small flash where each one lands.
    ctx.lineWidth = 1;
    for (const b of s.boxes) {
      if (!b.landed) continue;
      const age = now - b.landT;
      if (age > 0.4) continue;
      const k = age / 0.4;
      ctx.strokeStyle = rgba(pal.gold, 0.9 * (1 - k));
      ctx.beginPath();
      ctx.arc(b.x, b.y, grid.size * (0.5 + 1.3 * k), 0, Math.PI * 2);
      ctx.stroke();
    }

    if (landedNow) {
      if (el && s.landed === landedNow) el.dataset.landing = "";
      if (now - s.lastTick > 0.05) {
        s.lastTick = now;
        playTick(0.8 + 0.7 * (s.landed / Math.max(1, s.boxes.length)));
      }
    }
    if (!s.done && s.boxes.length && s.landed === s.boxes.length) {
      s.done = true;
      if (el) {
        delete el.dataset.landing;
        el.dataset.landed = "";
      }
      playChime();
      landedRef.current();
    }
  }, true);

  return <canvas ref={canvasRef} className="flight-canvas" aria-hidden="true" />;
}
