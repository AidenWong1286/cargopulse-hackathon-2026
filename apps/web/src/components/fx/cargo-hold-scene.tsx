"use client";
/**
 * The 3D lower-deck hold (three.js via react-three-fiber). Loaded lazily with
 * next/dynamic (ssr: false) by cargo-hold.tsx. Everything here is local geometry
 * and locally rendered light (drei Lightformers inside a local Environment); no
 * remote textures, HDRs or fonts, so it works under the strict CSP.
 *
 * Rendering is on demand: a small driver invalidates frames only while the stage is
 * on screen and the tab is visible ("lite" = ~30 fps, lower DPR, no shadows;
 * "calm" = static final state, frames only on change).
 */
import { memo, useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Html, Lightformer, OrbitControls } from "@react-three/drei";
import type { Motion } from "@/lib/fx";
import { playChime, playThud, playTick, playWhoosh } from "@/lib/sound";
import {
  CENTER_Y,
  FLOOR_W,
  HOLD_H,
  RADIUS,
  loadedUnder,
  restingPlace,
  type HoldBox,
  type HoldLayout,
  type Policy,
} from "./cargo-hold-layout";

export type HoldPalette = {
  shell: string;
  metal: string;
  floor: string;
  rail: string;
  gold: string;
  spark: string;
  sweep: string;
  edge: string;
  shadow: string;
  light: string;
  general: string;
  priority: string;
  express: string;
};
export type HoldPhase = "drop" | "offload" | "replan" | "done";

export type CargoHoldSceneProps = {
  layout: HoldLayout;
  policy: Policy;
  replayKey: number;
  skipKey: number;
  motion: Motion;
  active: boolean;
  coarse: boolean;
  palette: HoldPalette;
  labels: { apron: string; hold: string };
  fallback: string;
  onPolicy: (policy: Policy) => void;
  onRunning: (running: boolean) => void;
  onPhase: (phase: HoldPhase) => void;
  onHover: (index: number | null, clientX: number, clientY: number) => void;
};

const OPT: Policy = "CARGOPULSE_LOAD_OPTIMIZER";
const FILL: Policy = "PRIORITY_FILL";
const CEIL_Y = HOLD_H + 0.1;
const T_START = Math.PI - Math.asin((CEIL_Y - CENTER_Y) / RADIUS);
const T_END = 2 * Math.PI + Math.asin(-CENTER_Y / RADIUS);
const BACK_Z = RADIUS * Math.cos(T_START);
const SPARKS = 640;
const GL = { antialias: true, alpha: true, powerPreference: "high-performance", toneMapping: THREE.NeutralToneMapping, toneMappingExposure: 1.02 } as const;
const noRaycast = () => undefined;

type Anim = {
  kind: "drop" | "arc";
  from: THREE.Vector3;
  to: THREE.Vector3;
  start: number;
  dur: number;
  lift: number;
  trail: boolean;
};
type Sim = {
  time: number;
  queues: Anim[][];
  rest: THREE.Vector3[];
  live: THREE.Vector3[];
  visible: boolean[];
  restAt: ("hold" | "apron")[];
  events: { at: number; run: () => void; done: boolean }[];
  sweep: { start: number; dur: number } | null;
  shown: Policy;
  running: boolean;
  ghosts: boolean;
  sway: number;
  dragging: boolean;
  hover: number;
  sparkHead: number;
  sparkAlive: number;
};

export const CargoHoldScene = memo(function CargoHoldScene(props: CargoHoldSceneProps) {
  const { motion, coarse } = props;
  return (
    <Canvas
      className="hold-canvas"
      frameloop="demand"
      dpr={motion === "lite" ? [1, 1.25] : [1, 2]}
      shadows={motion === "full" ? "soft" : false}
      camera={{ fov: 30, near: 0.1, far: 400, position: [0, 9, 26] }}
      gl={GL}
      fallback={<p className="hold-fallback">{props.fallback}</p>}
      style={{ touchAction: coarse ? "pan-y" : "none" }}
    >
      <Driver active={props.active} motion={motion} />
      <World {...props} />
    </Canvas>
  );
});

/** Requests frames while on screen: every frame (full), every other frame (lite), none (calm). */
function Driver({ active, motion }: { active: boolean; motion: Motion }) {
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    if (!active) return;
    if (motion === "calm") {
      invalidate();
      return;
    }
    let raf = 0;
    let odd = false;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (motion === "lite") {
        odd = !odd;
        if (odd) return;
      }
      invalidate();
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active, motion, invalidate]);
  return null;
}

function sweepMaterial(top: number) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color("#d9b45a") }, uOpacity: { value: 0 }, uTop: { value: top } },
    vertexShader:
      "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `uniform vec3 uColor; uniform float uOpacity; uniform float uTop; varying vec2 vUv;
      void main(){
        float x = 1.0 - abs(vUv.x * 2.0 - 1.0);
        float core = pow(x, 8.0);
        float halo = pow(x, 2.0) * 0.45;
        float y = smoothstep(0.0, 0.12, vUv.y) * (1.0 - smoothstep(uTop, 1.0, vUv.y));
        gl_FragColor = vec4(uColor * (0.85 + core * 0.6), (core + halo) * uOpacity * y);
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

function useMaterials() {
  const mats = useMemo(
    () => ({
      shell: new THREE.MeshPhysicalMaterial({
        roughness: 0.34,
        metalness: 0,
        clearcoat: 0.7,
        clearcoatRoughness: 0.22,
        side: THREE.DoubleSide,
      }),
      metal: new THREE.MeshStandardMaterial({ roughness: 0.26, metalness: 0.85 }),
      floor: new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.55 }),
      rail: new THREE.MeshStandardMaterial({ roughness: 0.22, metalness: 0.92 }),
      apron: new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.2, transparent: true, opacity: 0.6 }),
      gold: new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 1, emissiveIntensity: 0.12 }),
      cls: {
        GENERAL: new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.06 }),
        PRIORITY: new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.06 }),
        EXPRESS: new THREE.MeshStandardMaterial({ roughness: 0.48, metalness: 0.06 }),
      } as Record<HoldBox["cls"], THREE.MeshStandardMaterial>,
      edge: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }),
      ghost: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.85 }),
      outline: new THREE.LineBasicMaterial({ transparent: true, opacity: 0.6 }),
      hover: new THREE.LineBasicMaterial({}),
      spark: new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false }),
      sweepV: sweepMaterial(0.55),
      sweepF: sweepMaterial(0.88),
    }),
    [],
  );
  useEffect(
    () => () => {
      for (const m of Object.values(mats)) {
        if (m instanceof THREE.Material) m.dispose();
        else for (const c of Object.values(m)) c.dispose();
      }
    },
    [mats],
  );
  return mats;
}
type Mats = ReturnType<typeof useMaterials>;

function useGeometries() {
  const geo = useMemo(() => {
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);
    const spark = new THREE.OctahedronGeometry(1, 0);
    return { box, edges, spark };
  }, []);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  return geo;
}
type Geos = ReturnType<typeof useGeometries>;

const v3 = (p: [number, number, number]) => new THREE.Vector3(p[0], p[1], p[2]);
const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

function place(a: Anim, now: number, out: THREE.Vector3) {
  const p = clamp01((now - a.start) / a.dur);
  if (a.kind === "drop") {
    out.copy(a.to);
    if (p < 0.72) {
      const q = p / 0.72;
      out.y += a.lift * (1 - q * q);
    } else {
      const q = (p - 0.72) / 0.28;
      out.y += 0.12 * Math.sin(q * Math.PI) * (1 - q);
    }
  } else {
    const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;
    out.lerpVectors(a.from, a.to, e);
    out.y += a.lift * Math.sin(Math.PI * e);
  }
}

function World(props: CargoHoldSceneProps) {
  const { layout, policy, replayKey, skipKey, motion, palette, coarse, labels } = props;
  const cb = useRef(props);
  cb.current = props;
  const invalidate = useThree((s) => s.invalidate);
  const mats = useMaterials();
  const geos = useGeometries();
  const shadows = motion === "full";
  const L = layout.length;

  const groups = useRef<(THREE.Group | null)[]>([]);
  const ghosts = useRef<(THREE.LineSegments | null)[]>([]);
  const model = useRef<THREE.Group>(null);
  const sweep = useRef<THREE.Group>(null);
  const sweepLight = useRef<THREE.PointLight>(null);
  const sparks = useRef<THREE.InstancedMesh>(null);
  const hoverLine = useRef<THREE.LineSegments>(null);
  const sparkData = useMemo(
    () => ({ pos: new Float32Array(SPARKS * 3), vel: new Float32Array(SPARKS * 3), life: new Float32Array(SPARKS), max: new Float32Array(SPARKS), size: new Float32Array(SPARKS) }),
    [],
  );
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const sim = useRef<Sim>({
    time: 0,
    queues: [],
    rest: [],
    live: [],
    visible: [],
    restAt: [],
    events: [],
    sweep: null,
    shown: policy,
    running: false,
    ghosts: true,
    sway: 0,
    dragging: false,
    hover: -1,
    sparkHead: 0,
    sparkAlive: 0,
  });

  // Theme colours, read from CSS tokens by the wrapper.
  useEffect(() => {
    const white = new THREE.Color("#ffffff");
    mats.shell.color.set(palette.shell);
    mats.metal.color.set(palette.metal);
    mats.floor.color.set(palette.floor);
    mats.rail.color.set(palette.rail);
    mats.apron.color.set(palette.floor);
    mats.gold.color.set(palette.gold);
    mats.gold.emissive.set(palette.gold);
    mats.cls.GENERAL.color.set(palette.general).lerp(white, 0.1);
    mats.cls.PRIORITY.color.set(palette.priority).lerp(white, 0.1);
    mats.cls.EXPRESS.color.set(palette.express).lerp(white, 0.1);
    mats.edge.color.set(palette.edge);
    mats.ghost.color.set(palette.spark);
    mats.outline.color.set(palette.spark);
    mats.hover.color.set(palette.spark);
    mats.spark.color.set(palette.spark);
    (mats.sweepV.uniforms.uColor.value as THREE.Color).set(palette.sweep);
    (mats.sweepF.uniforms.uColor.value as THREE.Color).set(palette.sweep);
    invalidate();
  }, [palette, mats, invalidate]);

  const ensure = () => {
    const s = sim.current;
    const n = layout.boxes.length;
    s.queues = Array.from({ length: n }, () => []);
    s.rest = Array.from({ length: n }, () => new THREE.Vector3());
    s.live = Array.from({ length: n }, () => new THREE.Vector3());
    s.visible = new Array(n).fill(false);
    s.restAt = new Array(n).fill("hold");
    s.hover = -1;
  };

  const clearSparks = () => {
    sparkData.life.fill(0);
    sim.current.sparkAlive = 1; // one pass to zero the matrices
  };

  const snap = (to: Policy) => {
    const s = sim.current;
    if (s.queues.length !== layout.boxes.length) ensure();
    layout.boxes.forEach((b, i) => {
      s.queues[i] = [];
      s.rest[i].copy(v3(restingPlace(b, to)));
      s.live[i].copy(s.rest[i]);
      s.visible[i] = true;
      s.restAt[i] = loadedUnder(b, to) ? "hold" : "apron";
    });
    s.events = [];
    s.sweep = null;
    s.ghosts = true;
    s.shown = to;
    clearSparks();
  };

  /** Sweep of gold light along the hold, with each changing AWB gliding as it passes. */
  const scheduleSwitch = (to: Policy, at: number, fromLive: boolean) => {
    const s = sim.current;
    s.sweep = { start: at, dur: 1.5 };
    let end = at + 1.5;
    layout.boxes.forEach((b, i) => {
      if (b.fill === b.opt) return;
      const target = v3(restingPlace(b, to));
      const from = fromLive ? s.live[i].clone() : v3(restingPlace(b, to === OPT ? FILL : OPT));
      const x = b.hold ? b.hold[0] : 0;
      const start = at + 0.15 + ((x + L / 2) / L) * 1.1;
      const dur = 1.15;
      if (fromLive) {
        s.queues[i] = [];
        s.rest[i].copy(from);
      }
      s.queues[i].push({ kind: "arc", from, to: target, start, dur, lift: 2.3, trail: true });
      s.restAt[i] = loadedUnder(b, to) ? "hold" : "apron";
      end = Math.max(end, start + dur);
    });
    return end;
  };

  const runCinematic = () => {
    ensure();
    const s = sim.current;
    const t0 = s.time;
    const boxes = layout.boxes;
    const n = boxes.length;
    s.events = [];
    s.sweep = null;
    s.ghosts = false;
    s.running = true;
    s.shown = FILL;
    clearSparks();
    cb.current.onRunning(true);
    cb.current.onPhase("drop");
    cb.current.onPolicy(FILL);
    const stagger = Math.min(0.06, Math.max(0.012, 2 / Math.max(1, n)));
    const byOrder = boxes.map((_, i) => i).sort((a, b) => boxes[a].order - boxes[b].order);
    let dropEnd = t0 + 0.4;
    byOrder.forEach((i, k) => {
      const b = boxes[i];
      const to =
        b.fill && b.hold
          ? v3(b.hold)
          : new THREE.Vector3(b.apron?.[0] ?? 0, HOLD_H + 0.5 + b.h / 2 + b.apronRow * 0.95, FLOOR_W / 2 - b.d / 2 - 0.05);
      const start = t0 + 0.3 + k * stagger;
      const dur = 0.62;
      s.queues[i] = [{ kind: "drop", from: to.clone(), to, start, dur, lift: 4.4 + (k % 3) * 0.4, trail: false }];
      s.rest[i].copy(to);
      s.visible[i] = false;
      s.restAt[i] = b.fill ? "hold" : "apron";
      dropEnd = Math.max(dropEnd, start + dur);
      if (k % 3 === 0) s.events.push({ at: start + dur * 0.72, run: () => playTick(0.85 + (k % 5) * 0.07), done: false });
    });
    s.events.push({ at: dropEnd, run: () => { playThud(); cb.current.onPhase("offload"); }, done: false });
    const off = byOrder.filter((i) => !boxes[i].fill && boxes[i].apron);
    const slideStagger = Math.min(0.05, 1 / Math.max(1, off.length));
    let slideEnd = dropEnd + 0.3;
    off.forEach((i, k) => {
      const b = boxes[i];
      const from = s.rest[i].clone();
      const start = dropEnd + 0.35 + k * slideStagger;
      s.queues[i].push({ kind: "arc", from, to: v3(b.apron!), start, dur: 0.85, lift: 0.5, trail: false });
      slideEnd = Math.max(slideEnd, start + 0.85);
    });
    const sweepAt = slideEnd + 1.1;
    s.events.push({
      at: sweepAt,
      run: () => {
        s.shown = OPT;
        s.ghosts = true;
        cb.current.onPolicy(OPT);
        cb.current.onPhase("replan");
        playWhoosh();
      },
      done: false,
    });
    const end = scheduleSwitch(OPT, sweepAt, false);
    s.events.push({
      at: end + 0.25,
      run: () => {
        s.running = false;
        cb.current.onRunning(false);
        cb.current.onPhase("done");
        playChime();
      },
      done: false,
    });
  };

  const finish = () => {
    const s = sim.current;
    const was = s.running;
    snap(was ? OPT : s.shown);
    if (was) {
      s.running = false;
      cb.current.onPolicy(OPT);
      cb.current.onRunning(false);
      cb.current.onPhase("done");
    }
    invalidate();
  };

  // 1. The user picked a policy: glide the changing AWBs (instant under calm).
  const lastPolicy = useRef(policy);
  useEffect(() => {
    if (lastPolicy.current === policy) return;
    lastPolicy.current = policy;
    const s = sim.current;
    if (policy === s.shown) return;
    if (motion === "calm") snap(policy);
    else {
      s.shown = policy;
      s.ghosts = true;
      if (policy === OPT) playWhoosh();
      scheduleSwitch(policy, s.time + 0.05, true);
    }
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policy]);

  // 2. A new real result (or Replay): run the opening sequence.
  useEffect(() => {
    if (motion === "calm") {
      ensure();
      snap(OPT);
      cb.current.onPolicy(OPT);
      cb.current.onRunning(false);
      cb.current.onPhase("done");
    } else runCinematic();
    invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, replayKey]);

  // 3. Skipped by a click or key press, or motion switched to calm mid-sequence.
  const lastSkip = useRef(skipKey);
  useEffect(() => {
    if (lastSkip.current === skipKey) return;
    lastSkip.current = skipKey;
    finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [skipKey]);
  useEffect(() => {
    if (motion === "calm" && sim.current.running) finish();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [motion]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05);
    const s = sim.current;
    s.time += dt;
    const now = s.time;
    for (const e of s.events) {
      if (!e.done && now >= e.at) {
        e.done = true;
        e.run();
      }
    }
    if (motion !== "calm" && !s.dragging) s.sway += dt;
    if (model.current) model.current.rotation.y = motion === "calm" ? 0 : Math.sin(s.sway * 0.21) * 0.15;

    const boxes = layout.boxes;
    let emitted = false;
    const sd = sparkData;
    for (let i = 0; i < boxes.length; i++) {
      const g = groups.current[i];
      const q = s.queues[i];
      if (!g || !q) continue;
      while (q.length && now >= q[0].start + q[0].dur) {
        s.rest[i].copy(q[0].to);
        s.visible[i] = true;
        q.shift();
      }
      let moving = false;
      if (q.length && now >= q[0].start) {
        place(q[0], now, s.live[i]);
        s.visible[i] = true;
        moving = true;
        if (q[0].trail) {
          const b = boxes[i];
          for (let k = 0; k < 2; k++) {
            const h = s.sparkHead;
            s.sparkHead = (h + 1) % SPARKS;
            sd.pos[h * 3] = s.live[i].x + (Math.random() - 0.5) * b.w * 0.7;
            sd.pos[h * 3 + 1] = s.live[i].y + (Math.random() - 0.5) * b.h * 0.6;
            sd.pos[h * 3 + 2] = s.live[i].z + (Math.random() - 0.5) * b.d * 0.7;
            sd.vel[h * 3] = (Math.random() - 0.5) * 0.25;
            sd.vel[h * 3 + 1] = 0.15 + Math.random() * 0.25;
            sd.vel[h * 3 + 2] = (Math.random() - 0.5) * 0.25;
            sd.max[h] = sd.life[h] = 0.6 + Math.random() * 0.6;
            sd.size[h] = 0.035 + Math.random() * 0.045;
          }
          emitted = true;
        }
      } else s.live[i].copy(s.rest[i]);
      g.visible = s.visible[i];
      g.position.copy(s.live[i]);
      const gh = ghosts.current[i];
      if (gh) {
        const b = boxes[i];
        const other = s.restAt[i] === "hold" ? b.apron : b.hold;
        gh.visible = s.ghosts && !moving && q.length === 0 && !!other;
        if (other) gh.position.set(other[0], other[1], other[2]);
      }
    }

    // Gold dust trails behind gliding AWBs.
    const sp = sparks.current;
    if (sp && (emitted || s.sparkAlive > 0)) {
      let alive = 0;
      for (let k = 0; k < SPARKS; k++) {
        let scale = 0;
        if (sd.life[k] > 0) {
          sd.life[k] -= dt;
          if (sd.life[k] > 0) {
            sd.pos[k * 3] += sd.vel[k * 3] * dt;
            sd.pos[k * 3 + 1] += sd.vel[k * 3 + 1] * dt;
            sd.pos[k * 3 + 2] += sd.vel[k * 3 + 2] * dt;
            const f = sd.life[k] / sd.max[k];
            scale = sd.size[k] * f * (0.6 + 0.4 * f);
            alive++;
          }
        }
        dummy.position.set(sd.pos[k * 3], sd.pos[k * 3 + 1], sd.pos[k * 3 + 2]);
        dummy.rotation.set(k, k * 0.7, 0);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        sp.setMatrixAt(k, dummy.matrix);
      }
      sp.instanceMatrix.needsUpdate = true;
      s.sparkAlive = alive;
    }

    // The gold light sweep.
    const sw = s.sweep;
    if (sweep.current) {
      if (sw && now >= sw.start && now <= sw.start + sw.dur) {
        const p = (now - sw.start) / sw.dur;
        const e = 0.5 - 0.5 * Math.cos(Math.PI * p);
        const o = Math.pow(Math.sin(Math.PI * p), 0.6);
        sweep.current.visible = true;
        sweep.current.position.x = -L / 2 - 1 + (L + 2) * e;
        mats.sweepV.uniforms.uOpacity.value = o;
        mats.sweepF.uniforms.uOpacity.value = o * 0.8;
        if (sweepLight.current) sweepLight.current.intensity = o * 16;
      } else {
        sweep.current.visible = false;
        if (sweepLight.current) sweepLight.current.intensity = 0;
      }
    }

    const hl = hoverLine.current;
    if (hl) {
      const i = s.hover;
      const b = i >= 0 ? boxes[i] : undefined;
      hl.visible = !!b && !!s.visible[i];
      if (b) {
        hl.position.copy(s.live[i]);
        hl.scale.set(b.w + 0.05, b.h + 0.05, b.d + 0.05);
      }
    }
  });

  const shadowSpan = L / 2 + 4;
  const sceneDepth = layout.apronZ + layout.apronDepth;
  return (
    <>
      <CameraRig layout={layout} coarse={coarse} />
      {coarse ? null : (
        <OrbitControls
          makeDefault
          enablePan={false}
          enableZoom={false}
          enableDamping={motion !== "calm"}
          dampingFactor={0.08}
          rotateSpeed={0.55}
          minPolarAngle={0.35}
          maxPolarAngle={1.36}
          minAzimuthAngle={-1.25}
          maxAzimuthAngle={1.25}
          onStart={() => {
            sim.current.dragging = true;
          }}
          onEnd={() => {
            sim.current.dragging = false;
          }}
        />
      )}
      <hemisphereLight args={[palette.light, palette.floor, 1.05]} />
      <directionalLight
        position={[-7, 13, 10]}
        intensity={2.1}
        color={palette.light}
        castShadow={shadows}
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      >
        <orthographicCamera attach="shadow-camera" args={[-shadowSpan, shadowSpan, shadowSpan, -shadowSpan, 1, 60]} />
      </directionalLight>
      <directionalLight position={[10, 6, 7]} intensity={0.7} />
      <Environment resolution={motion === "lite" ? 64 : 256} environmentIntensity={0.9}>
        <Lightformer form="rect" intensity={2.4} position={[0, 10, 2]} scale={[24, 8, 1]} />
        <Lightformer form="rect" intensity={1.4} position={[0, 3, 12]} scale={[18, 2, 1]} />
        <Lightformer form="rect" intensity={1} position={[-12, 4, 2]} scale={[8, 3, 1]} />
        <Lightformer form="rect" intensity={1} position={[12, 4, 2]} scale={[8, 3, 1]} />
        <Lightformer form="ring" color={palette.gold} intensity={1.2} position={[0, 4, -10]} scale={6} />
      </Environment>

      <group
        ref={model}
        onPointerMove={(e) => {
          const i = e.object.userData?.i;
          if (typeof i === "number" && sim.current.visible[i]) {
            e.stopPropagation();
            sim.current.hover = i;
            cb.current.onHover(i, e.nativeEvent.clientX, e.nativeEvent.clientY);
            invalidate();
          }
        }}
        onPointerOut={() => {
          sim.current.hover = -1;
          cb.current.onHover(null, 0, 0);
          invalidate();
        }}
      >
        <Hull layout={layout} mats={mats} shadows={shadows} />
        <Apron layout={layout} mats={mats} />
        {layout.boxes.map((b, i) => (
          <BoxMesh
            key={b.key}
            box={b}
            index={i}
            mats={mats}
            geos={geos}
            shadows={shadows}
            register={(g) => {
              groups.current[i] = g;
            }}
            registerGhost={(l) => {
              ghosts.current[i] = l;
            }}
          />
        ))}
        <instancedMesh
          ref={sparks}
          args={[geos.spark, mats.spark, SPARKS]}
          frustumCulled={false}
          raycast={noRaycast}
          onUpdate={(m) => {
            const zero = new THREE.Matrix4().makeScale(0, 0, 0);
            for (let k = 0; k < SPARKS; k++) m.setMatrixAt(k, zero);
            m.instanceMatrix.needsUpdate = true;
          }}
        />
        <lineSegments ref={hoverLine} geometry={geos.edges} material={mats.hover} visible={false} raycast={noRaycast} />
        <group ref={sweep} visible={false}>
          <mesh position={[0, 1.25, 0]} material={mats.sweepV} raycast={noRaycast}>
            <planeGeometry args={[1.8, 2.8]} />
          </mesh>
          <mesh position={[0, 0.03, 0]} rotation-x={-Math.PI / 2} material={mats.sweepF} raycast={noRaycast}>
            <planeGeometry args={[1.8, FLOOR_W]} />
          </mesh>
          <pointLight ref={sweepLight} color={palette.sweep} intensity={0} distance={7} decay={1.5} position={[0, 1.4, 0.8]} />
        </group>
        <Html position={[-L / 2 + 0.1, CEIL_Y + 0.35, BACK_Z + 0.6]} className="hold-tag" zIndexRange={[4, 0]}>
          {labels.hold}
        </Html>
        <Html
          position={[-L / 2 - 0.2, layout.ground + 0.05, layout.apronZ + layout.apronDepth + 0.5]}
          className="hold-tag hold-tag--apron"
          zIndexRange={[4, 0]}
        >
          {labels.apron}
        </Html>
      </group>
      {shadows ? (
        <ContactShadows
          position={[0, layout.ground + 0.004, (sceneDepth - 4) / 2]}
          scale={[L + 12, sceneDepth + 10]}
          far={6}
          blur={2.4}
          opacity={0.42}
          resolution={1024}
          color={palette.shadow}
        />
      ) : null}
    </>
  );
}

/** Frames the whole hold and apron for the stage's aspect ratio (narrow screens look more end-on). */
function CameraRig({ layout, coarse }: { layout: HoldLayout; coarse: boolean }) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const size = useThree((s) => s.size);
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    const aspect = size.width / Math.max(1, size.height);
    const front = layout.apronZ + layout.apronDepth + 0.8;
    const center = new THREE.Vector3(0, 0.45, (front - 3.2) / 2);
    const halfX = layout.length / 2 + 0.8;
    const halfZ = (front + 3.2) / 2;
    const halfY = 2.3;
    const az = aspect > 1.7 ? 0.3 : aspect > 1.15 ? 0.52 : 0.78;
    const el = coarse ? 0.62 : 0.52;
    const vf = (camera.fov * Math.PI) / 180;
    const hf = 2 * Math.atan(Math.tan(vf / 2) * aspect);
    const horiz = halfX * Math.cos(az) + halfZ * Math.sin(az);
    const depth = halfX * Math.sin(az) + halfZ * Math.cos(az);
    const vert = halfY * Math.cos(el) + depth * Math.sin(el);
    const dist = Math.max(horiz / Math.tan(hf / 2), vert / Math.tan(vf / 2)) * 0.98 + depth * 0.45;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.near = Math.max(0.1, dist / 50);
    camera.far = dist * 4;
    camera.updateProjectionMatrix();
    camera.lookAt(center);
    if (controls) {
      controls.target.copy(center);
      controls.update();
    }
    invalidate();
  }, [layout, size.width, size.height, camera, controls, coarse, invalidate]);
  return null;
}

function Hull({ layout, mats, shadows }: { layout: HoldLayout; mats: Mats; shadows: boolean }) {
  const L = layout.length;
  const geo = useMemo(() => {
    const shell = new THREE.CylinderGeometry(RADIUS, RADIUS, L, 120, 1, true, T_START, T_END - T_START);
    shell.rotateZ(Math.PI / 2);
    shell.translate(0, CENTER_Y, 0);
    const arc = (r: number) => {
      const pts: THREE.Vector3[] = [];
      for (let k = 0; k <= 40; k++) {
        const th = T_START + ((T_END - T_START) * k) / 40;
        pts.push(new THREE.Vector3(0, CENTER_Y + r * Math.sin(th), r * Math.cos(th)));
      }
      return new THREE.CatmullRomCurve3(pts);
    };
    const rib = new THREE.TubeGeometry(arc(RADIUS - 0.04), 64, 0.028, 6, false);
    const ring = new THREE.TorusGeometry(RADIUS, 0.014, 8, 180);
    const rod = new THREE.CylinderGeometry(0.016, 0.016, L, 8);
    rod.rotateZ(Math.PI / 2);
    const rail = new THREE.BoxGeometry(L, 0.026, 0.06);
    const floor = new THREE.BoxGeometry(L, 0.05, FLOOR_W);
    const ceiling = new THREE.BoxGeometry(L, 0.07, -BACK_Z - 1.55);
    return { shell, rib, ring, rod, rail, floor, ceiling };
  }, [L]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  const ribs = useMemo(() => {
    const xs: number[] = [];
    for (let x = -L / 2 + 0.5; x <= L / 2 - 0.4; x += 1.2) xs.push(x);
    return xs;
  }, [L]);
  return (
    <group>
      <mesh geometry={geo.shell} material={mats.shell} receiveShadow={shadows} raycast={noRaycast} />
      {ribs.map((x) => (
        <mesh key={x} geometry={geo.rib} material={mats.metal} position={[x, 0, 0]} raycast={noRaycast} />
      ))}
      <mesh geometry={geo.floor} material={mats.floor} position={[0, -0.025, 0]} receiveShadow={shadows} raycast={noRaycast} />
      {[-1.8, -0.9, 0, 0.9, 1.8].map((z) => (
        <mesh key={z} geometry={geo.rail} material={mats.rail} position={[0, 0.013, z]} receiveShadow={shadows} raycast={noRaycast} />
      ))}
      <mesh
        geometry={geo.ceiling}
        material={mats.shell}
        position={[0, CEIL_Y + 0.035, (BACK_Z - 1.55) / 2]}
        castShadow={shadows}
        receiveShadow={shadows}
        raycast={noRaycast}
      />
      {[-L / 2, L / 2].map((x) => (
        <mesh key={x} geometry={geo.ring} material={mats.gold} position={[x, CENTER_Y, 0]} rotation-y={Math.PI / 2} raycast={noRaycast} />
      ))}
      <mesh geometry={geo.rod} material={mats.gold} position={[0, CEIL_Y, BACK_Z]} raycast={noRaycast} />
      <mesh geometry={geo.rod} material={mats.gold} position={[0, CEIL_Y + 0.07, -1.55]} raycast={noRaycast} />
      <mesh geometry={geo.rod} material={mats.gold} position={[0, 0.005, FLOOR_W / 2 + 0.01]} raycast={noRaycast} />
    </group>
  );
}

function Apron({ layout, mats }: { layout: HoldLayout; mats: Mats }) {
  const { length: L, apronZ, apronDepth, ground } = layout;
  const geo = useMemo(() => {
    const plate = new THREE.BoxGeometry(L + 0.6, 0.02, apronDepth + 0.7);
    const x0 = -L / 2 - 0.3, x1 = L / 2 + 0.3, z0 = apronZ - 0.35, z1 = apronZ + apronDepth + 0.35, y = ground + 0.03;
    const outline = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x0, y, z0),
      new THREE.Vector3(x1, y, z0),
      new THREE.Vector3(x1, y, z1),
      new THREE.Vector3(x0, y, z1),
    ]);
    return { plate, outline };
  }, [L, apronZ, apronDepth, ground]);
  useEffect(() => () => Object.values(geo).forEach((g) => g.dispose()), [geo]);
  return (
    <group>
      <mesh geometry={geo.plate} material={mats.apron} position={[0, ground + 0.01, apronZ + apronDepth / 2]} raycast={noRaycast} />
      <lineLoop geometry={geo.outline} material={mats.outline} raycast={noRaycast} />
    </group>
  );
}

function BoxMesh({
  box,
  index,
  mats,
  geos,
  shadows,
  register,
  registerGhost,
}: {
  box: HoldBox;
  index: number;
  mats: Mats;
  geos: Geos;
  shadows: boolean;
  register: (g: THREE.Group | null) => void;
  registerGhost: (l: THREE.LineSegments | null) => void;
}) {
  const changer = box.fill !== box.opt;
  const material = mats.cls[box.cls] ?? mats.cls.GENERAL;
  return (
    <>
      <group ref={register}>
        <mesh
          geometry={geos.box}
          material={material}
          scale={[box.w, box.h, box.d]}
          castShadow={shadows}
          receiveShadow={shadows}
          userData={{ i: index }}
        />
        <lineSegments geometry={geos.edges} material={mats.edge} scale={[box.w * 1.002, box.h * 1.002, box.d * 1.002]} raycast={noRaycast} />
        {box.guaranteed ? (
          <mesh geometry={geos.box} material={mats.gold} scale={[0.08, box.h + 0.014, box.d + 0.014]} raycast={noRaycast} />
        ) : null}
      </group>
      {changer ? (
        <lineSegments ref={registerGhost} geometry={geos.edges} material={mats.ghost} scale={[box.w, box.h, box.d]} raycast={noRaycast} />
      ) : null}
    </>
  );
}
