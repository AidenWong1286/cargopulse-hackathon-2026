"use client";
/**
 * The sign-in hero: a frosted jade-glass globe with fine gold graticule and
 * coastlines, a glowing gold Hong Kong pin and one faint orbiting light.
 * Purely decorative: no routes, no aircraft, no data (nobody is signed in yet).
 *
 * Load with next/dynamic (ssr: false). It pauses with the tab, runs at ~30 fps
 * in "lite" mode and renders one still frame under "calm". Drag to spin (with
 * inertia and a limited tilt); it settles back to face Hong Kong. With `dive`
 * it turns to Hong Kong and zooms in for the sign-in moment.
 */
import { Component, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { useFx, useFrameLoop, usePageVisible, type Motion, type Theme } from "@/lib/fx";
import { airports, HUB } from "@/lib/airports";
import { coastPositions, drawGlow, drawLandMask, graticulePositions, lonLatToVec3 } from "./globe-geometry";

export type GlobeProps = {
  /** Sign-in pressed: turn to Hong Kong and zoom in. */
  dive: boolean;
  /** The intro was skipped (or calm): jump to the settled pose. */
  skipIntro: boolean;
};

const RAD = Math.PI / 180;
const TAU = Math.PI * 2;
const [HUB_LON, HUB_LAT] = airports[HUB].at;
/** Rotation that puts the hub dead centre, facing the camera. */
const HOME_YAW = -HUB_LON * RAD;
const HOME_TILT = HUB_LAT * RAD;
/** At rest the hub sits a little right of centre, clear of the headline. */
const REST_YAW = HOME_YAW + 0.32;
const REST_TILT = HOME_TILT + 0.08;
const INTRO_SPIN = 1.4;
const ORBIT_R = 1.48;
const DIVE_S = 1.1;

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (p: number) => 1 - Math.pow(1 - p, 3);
const easeIn = (p: number) => p * p * p;

/* ───────────────────────────── Shaders ───────────────────────────── */

const CORE_VERT = /* glsl */ `
varying vec3 vN; varying vec3 vV; varying vec3 vObj;
void main(){
  vObj = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vN = normalize(normalMatrix * normal);
  vV = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;

const CORE_FRAG = /* glsl */ `
uniform vec3 uCore; uniform vec3 uDeep; uniform vec3 uRim; uniform vec3 uLandCol; uniform vec3 uSpec;
uniform sampler2D uLand; uniform vec3 uKey; uniform vec3 uOrbit;
uniform float uFade; uniform float uNight; uniform float uGlint;
varying vec3 vN; varying vec3 vV; varying vec3 vObj;
void main(){
  vec3 n = normalize(vN); vec3 v = normalize(vV);
  float ndv = clamp(dot(n, v), 0.0, 1.0);
  float fres = pow(1.0 - ndv, 2.4);
  vec3 o = normalize(vObj);
  vec2 uv = vec2(atan(o.x, o.z) / 6.2831853 + 0.5, asin(clamp(o.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  float landM = texture2D(uLand, uv).r;
  // Light passing through jade: brighter toward the key light, deeper away from it.
  float grad = clamp(0.5 + 0.5 * dot(n, normalize(vec3(-0.45, 0.6, 0.65))), 0.0, 1.0);
  vec3 col = mix(uDeep, uCore, grad);
  col = mix(col, uLandCol, landM * 0.5);
  col = mix(col, uRim, fres * 0.85);
  // Studio softbox and a small hot spot.
  float nh = max(dot(n, normalize(uKey + v)), 0.0);
  float spec = pow(nh, 90.0) * 0.9 + pow(nh, 14.0) * 0.12;
  // The orbiting light leaves a moving glint on the glass.
  float glint = pow(max(dot(n, normalize(uOrbit + v)), 0.0), 160.0) * 0.75 * uGlint;
  // Refracted light gathering on the far side, opposite the key.
  float caustic = pow(max(dot(n, normalize(vec3(0.5, -0.55, 0.65))), 0.0), 6.0) * 0.2;
  col += uSpec * (spec + glint) + uCore * caustic;
  float alpha = mix(0.34 + 0.24 * uNight, 0.94, fres) + landM * 0.16 + spec + glint;
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uFade);
  #include <colorspace_fragment>
}`;

const LINE_VERT = /* glsl */ `
varying float vF;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec3 c = (modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vF = dot(normalize(mv.xyz - c), normalize(-mv.xyz));
  gl_Position = projectionMatrix * mv;
}`;

const LINE_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uBack; uniform float uFade;
varying float vF;
void main(){
  float front = smoothstep(-0.08, 0.3, vF);
  float limb = 1.0 - abs(vF);
  float a = mix(uBack, 1.0, front) * (1.0 + limb * 0.5);
  gl_FragColor = vec4(uColor, a * uAlpha * uFade);
  #include <colorspace_fragment>
}`;

/** A soft band on the sphere at angular distance uTheta from the hub (+Z locally). */
const RING_VERT = /* glsl */ `
uniform float uTheta; uniform float uWidth;
varying float vSide;
void main(){
  float phi = position.x; vSide = position.y;
  float th = max(0.0, uTheta + position.y * uWidth);
  vec3 p = vec3(sin(th) * cos(phi), sin(th) * sin(phi), cos(th)) * 1.006;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}`;

const RING_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uFade;
varying float vSide;
void main(){
  float a = pow(1.0 - abs(vSide), 2.0);
  gl_FragColor = vec4(uColor, a * uAlpha * uFade);
  #include <colorspace_fragment>
}`;

const ORBIT_VERT = /* glsl */ `
uniform float uHead; uniform float uRadius; uniform float uR;
varying float vTrail; varying float vOcc;
void main(){
  float phi = position.x;
  vec3 p = vec3(cos(phi) * uR, 0.0, sin(phi) * uR);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 c = (viewMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float behind = step(mv.z, c.z);
  float d = length(mv.xy * (c.z / mv.z) - c.xy);
  vOcc = 1.0 - behind * (1.0 - smoothstep(uRadius * 0.92, uRadius * 1.04, d)) * 0.8;
  float lag = mod(uHead - phi, 6.2831853);
  vTrail = pow(1.0 - lag / 6.2831853, 10.0);
  gl_Position = projectionMatrix * mv;
}`;

const ORBIT_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uBase; uniform float uFade;
varying float vTrail; varying float vOcc;
void main(){
  gl_FragColor = vec4(uColor, (uBase + vTrail * 0.85) * vOcc * uFade);
  #include <colorspace_fragment>
}`;

const HALO_VERT = CORE_VERT;
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uFade;
varying vec3 vN; varying vec3 vV;
void main(){
  float k = -dot(normalize(vN), normalize(vV));
  float inner = 0.5;
  float a = pow(clamp(k / inner, 0.0, 1.0), 2.4) * (1.0 - smoothstep(inner, inner + 0.3, k) * 0.85);
  gl_FragColor = vec4(uColor, a * uAlpha * uFade);
  #include <colorspace_fragment>
}`;

const DUST_VERT = /* glsl */ `
attribute float aSeed;
uniform float uTime; uniform float uSize; uniform float uPx;
varying float vA;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * uPx * (0.5 + aSeed) / -mv.z;
  vA = 0.3 + 0.7 * (0.5 + 0.5 * sin(uTime * (0.5 + aSeed * 1.3) + aSeed * 40.0));
  gl_Position = projectionMatrix * mv;
}`;

const DUST_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uAlpha; uniform float uFade;
varying float vA;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d);
  gl_FragColor = vec4(uColor, a * a * vA * uAlpha * uFade);
  #include <colorspace_fragment>
}`;

/* ───────────────────────────── Palette ───────────────────────────── */

type Palette = {
  night: boolean;
  core: THREE.Color;
  deep: THREE.Color;
  rim: THREE.Color;
  land: THREE.Color;
  line: THREE.Color;
  coast: THREE.Color;
  glow: THREE.Color;
  pin: THREE.Color;
  halo: THREE.Color;
  spec: THREE.Color;
};

/** Colours come from CSS tokens (wow-login.css), so day and night follow the theme. */
function readPalette(): Palette {
  const css = getComputedStyle(document.documentElement);
  const color = (name: string) => {
    const value = css.getPropertyValue(name).trim();
    const c = new THREE.Color();
    if (/^#|^rgb/.test(value)) c.setStyle(value, THREE.SRGBColorSpace);
    return c;
  };
  return {
    night: document.documentElement.dataset.theme === "night",
    core: color("--globe-core"),
    deep: color("--globe-deep"),
    rim: color("--globe-rim"),
    land: color("--globe-land"),
    line: color("--globe-line"),
    coast: color("--globe-coast"),
    glow: color("--globe-glow"),
    pin: color("--globe-pin"),
    halo: color("--globe-halo"),
    spec: color("--globe-spec"),
  };
}

/* ───────────────────────────── Build ───────────────────────────── */

function shader(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite: false,
    side,
  });
}

function phiGeometry(count: number, loop = true) {
  const positions = new Float32Array((count + (loop ? 1 : 0)) * 3);
  for (let i = 0; i <= count - (loop ? 0 : 1); i++) positions[i * 3] = (i / count) * TAU;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  return g;
}

function ringStrip(count = 160) {
  const positions = new Float32Array((count + 1) * 2 * 3);
  const index: number[] = [];
  for (let i = 0; i <= count; i++) {
    const phi = (i / count) * TAU;
    positions.set([phi, -1, 0, phi, 1, 0], i * 6);
    if (i < count) {
      const a = i * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  return g;
}

function buildGlobe(lite: boolean) {
  const fade = { value: 0 };
  const disposables: { dispose: () => void }[] = [];
  const keep = <T extends { dispose: () => void }>(item: T) => {
    disposables.push(item);
    return item;
  };

  const glowTex = keep(new THREE.CanvasTexture(drawGlow()));
  const landTex = keep(new THREE.CanvasTexture(drawLandMask(lite ? 1024 : 2048)));
  landTex.colorSpace = THREE.NoColorSpace;
  landTex.generateMipmaps = false;
  landTex.minFilter = THREE.LinearFilter;
  landTex.wrapS = THREE.RepeatWrapping;

  const rig = new THREE.Group();
  const spin = new THREE.Group();
  rig.add(spin);

  // Atmosphere: a soft rim of light just outside the glass.
  const haloMat = keep(shader(HALO_VERT, HALO_FRAG, { uColor: { value: new THREE.Color() }, uAlpha: { value: 0.6 }, uFade: fade }, THREE.BackSide));
  const halo = new THREE.Mesh(keep(new THREE.SphereGeometry(1.2, 64, 48)), haloMat);
  halo.renderOrder = 0;
  rig.add(halo);

  // Bloom-like light behind the globe; it also carries the "emerging out of light" intro.
  const bloomMat = keep(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false, opacity: 0 }));
  const bloom = new THREE.Sprite(bloomMat);
  bloom.renderOrder = 1;
  rig.add(bloom);

  // The glass body.
  const coreMat = keep(
    shader(CORE_VERT, CORE_FRAG, {
      uCore: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color() },
      uRim: { value: new THREE.Color() },
      uLandCol: { value: new THREE.Color() },
      uSpec: { value: new THREE.Color() },
      uLand: { value: landTex },
      uKey: { value: new THREE.Vector3(-0.55, 0.65, 0.55).normalize() },
      uOrbit: { value: new THREE.Vector3(0, 0, 1) },
      uFade: fade,
      uNight: { value: 0 },
      uGlint: { value: 0 },
    }),
  );
  const core = new THREE.Mesh(keep(new THREE.SphereGeometry(1, lite ? 72 : 112, lite ? 48 : 80)), coreMat);
  core.renderOrder = 2;
  spin.add(core);

  // Graticule and coastlines: fine gold, dimmed where seen through the glass.
  const lineMat = (alpha: number, back: number) =>
    keep(shader(LINE_VERT, LINE_FRAG, { uColor: { value: new THREE.Color() }, uAlpha: { value: alpha }, uBack: { value: back }, uFade: fade }));
  const gratGeom = keep(new THREE.BufferGeometry());
  gratGeom.setAttribute("position", new THREE.BufferAttribute(graticulePositions(), 3));
  const gratMat = lineMat(0.32, 0.18);
  const graticule = new THREE.LineSegments(gratGeom, gratMat);
  graticule.renderOrder = 3;
  spin.add(graticule);
  const coastGeom = keep(new THREE.BufferGeometry());
  coastGeom.setAttribute("position", new THREE.BufferAttribute(coastPositions(), 3));
  const coastMat = lineMat(0.9, 0.16);
  const coast = new THREE.LineSegments(coastGeom, coastMat);
  coast.renderOrder = 4;
  spin.add(coast);

  // The hub: everything below sits in a frame where Hong Kong is +Z.
  const hubDir = new THREE.Vector3(...lonLatToVec3(HUB_LON, HUB_LAT, 1));
  const hubFrame = new THREE.Group();
  hubFrame.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), hubDir);
  spin.add(hubFrame);

  // Range rings that ripple out from the hub (intro and sign-in only).
  const ringGeom = keep(ringStrip());
  const rings = [0, 1, 2].map(() => {
    const mat = keep(
      shader(RING_VERT, RING_FRAG, {
        uTheta: { value: 0 },
        uWidth: { value: 0.012 },
        uColor: { value: new THREE.Color() },
        uAlpha: { value: 0 },
        uFade: fade,
      }, THREE.DoubleSide),
    );
    const mesh = new THREE.Mesh(ringGeom, mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    hubFrame.add(mesh);
    return mat;
  });

  const pinDotMat = keep(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  const pinDot = new THREE.Mesh(keep(new THREE.SphereGeometry(0.014, 16, 12)), pinDotMat);
  pinDot.position.set(0, 0, 1.004);
  pinDot.renderOrder = 7;
  hubFrame.add(pinDot);
  const pinGlowMat = keep(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }));
  const pinGlow = new THREE.Sprite(pinGlowMat);
  pinGlow.position.set(0, 0, 1.02);
  pinGlow.renderOrder = 8;
  hubFrame.add(pinGlow);
  const pulseMat = keep(new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  const pulse = new THREE.Mesh(keep(new THREE.RingGeometry(0.03, 0.036, 64)), pulseMat);
  pulse.position.set(0, 0, 1.006);
  pulse.renderOrder = 7;
  hubFrame.add(pulse);

  // One faint orbiting light on an inclined path, with a fading tail.
  const orbit = new THREE.Group();
  orbit.rotation.set(1.12, 0, 0.36);
  rig.add(orbit);
  const orbitMat = keep(
    shader(ORBIT_VERT, ORBIT_FRAG, {
      uHead: { value: 0 },
      uRadius: { value: 1 },
      uR: { value: ORBIT_R },
      uColor: { value: new THREE.Color() },
      uBase: { value: 0.07 },
      uFade: fade,
    }),
  );
  const orbitLine = new THREE.LineLoop(keep(phiGeometry(256)), orbitMat);
  orbitLine.frustumCulled = false;
  orbitLine.renderOrder = 6;
  orbit.add(orbitLine);
  const headMat = keep(new THREE.SpriteMaterial({ map: glowTex, transparent: true, depthWrite: false }));
  const head = new THREE.Sprite(headMat);
  head.scale.setScalar(0.22);
  head.renderOrder = 8;
  orbit.add(head);

  // Fine gold dust around the globe.
  const count = lite ? 70 : 240;
  const dustPos = new Float32Array(count * 3);
  const seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * TAU;
    const r = 1.55 + Math.pow(Math.random(), 0.7) * 2.2;
    const s = Math.sqrt(1 - u * u);
    dustPos.set([r * s * Math.cos(a), r * u * 0.7, r * s * Math.sin(a)], i * 3);
    seeds[i] = Math.random();
  }
  const dustGeom = keep(new THREE.BufferGeometry());
  dustGeom.setAttribute("position", new THREE.BufferAttribute(dustPos, 3));
  dustGeom.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
  const dustMat = keep(
    shader(DUST_VERT, DUST_FRAG, {
      uTime: { value: 0 },
      uSize: { value: 0.028 },
      uPx: { value: 800 },
      uColor: { value: new THREE.Color() },
      uAlpha: { value: 0.8 },
      uFade: fade,
    }),
  );
  const dust = new THREE.Points(dustGeom, dustMat);
  dust.renderOrder = 9;

  const sprites = [bloomMat, pinGlowMat, headMat];
  const additiveShaders = [gratMat, coastMat, orbitMat, dustMat, haloMat, ...rings];

  function applyPalette(p: Palette) {
    coreMat.uniforms.uCore.value.copy(p.core);
    coreMat.uniforms.uDeep.value.copy(p.deep);
    coreMat.uniforms.uRim.value.copy(p.rim);
    coreMat.uniforms.uLandCol.value.copy(p.land);
    coreMat.uniforms.uSpec.value.copy(p.spec);
    coreMat.uniforms.uNight.value = p.night ? 1 : 0;
    gratMat.uniforms.uColor.value.copy(p.line);
    coastMat.uniforms.uColor.value.copy(p.coast);
    orbitMat.uniforms.uColor.value.copy(p.glow);
    dustMat.uniforms.uColor.value.copy(p.glow);
    haloMat.uniforms.uColor.value.copy(p.halo);
    haloMat.uniforms.uAlpha.value = p.night ? 0.75 : 0.55;
    for (const ring of rings) ring.uniforms.uColor.value.copy(p.pin);
    bloomMat.color.copy(p.night ? p.halo : p.glow);
    pinGlowMat.color.copy(p.glow);
    headMat.color.copy(p.glow);
    pinDotMat.color.copy(p.pin);
    pulseMat.color.copy(p.pin);
    // Light adds up on the night sky; on porcelain it is laid on normally.
    const blending = p.night ? THREE.AdditiveBlending : THREE.NormalBlending;
    for (const m of [...sprites, ...additiveShaders, pulseMat]) m.blending = blending;
  }

  return {
    fade,
    rig,
    spin,
    dust,
    bloom,
    bloomMat,
    coreMat,
    rings,
    pinGlow,
    pinGlowMat,
    pinDotMat,
    pulse,
    pulseMat,
    orbit,
    orbitMat,
    head,
    headMat,
    dustMat,
    hubFrame,
    applyPalette,
    dispose: () => disposables.forEach((d) => d.dispose()),
  };
}

/* ───────────────────────────── Scene ───────────────────────────── */

function readLayout(el: HTMLElement, width: number, height: number) {
  const css = getComputedStyle(el);
  const num = (name: string, fallback: number) => {
    const v = parseFloat(css.getPropertyValue(name));
    return Number.isFinite(v) ? v : fallback;
  };
  const cx = num("--globe-cx", 0.45);
  const cy = num("--globe-cy", 0.5);
  const diameter = Math.max(120, Math.min(height * num("--globe-fill-h", 0.66), width * num("--globe-fill-w", 0.42)));
  const dist = height / (diameter * Math.tan(15 * RAD));
  return { cx, cy, diameter, dist };
}

function Scene({ dive, skipIntro, motion, theme }: GlobeProps & { motion: Motion; theme: Theme }) {
  const { camera, size, gl, invalidate, viewport } = useThree();
  const calm = motion === "calm";
  const g = useMemo(() => buildGlobe(motion === "lite"), [motion]);
  useEffect(() => () => g.dispose(), [g]);

  const layout = useRef({ cx: 0.45, cy: 0.5, diameter: 500, dist: 6 });
  const st = useRef({
    t: calm ? 100 : 0,
    yaw: calm ? REST_YAW : REST_YAW + INTRO_SPIN,
    tilt: calm ? REST_TILT : REST_TILT - 0.35,
    vy: 0,
    vt: 0,
    drag: false,
    px: 0,
    py: 0,
    pt: 0,
    lastInput: -10,
    introDone: calm,
    diving: false,
    dv: 0,
    head: 2.2,
    rings: [0.85, 1.2, 1.55],
    ringLife: 1.9,
  });

  // Lite: about 30 fps by asking for frames on the shared throttled loop.
  useFrameLoop(() => invalidate(), motion === "lite");

  // Frame the globe where the page layout wants it (CSS tokens on the stage).
  useEffect(() => {
    const l = readLayout(gl.domElement, size.width, size.height);
    layout.current = l;
    const cam = camera as THREE.PerspectiveCamera;
    cam.fov = 30;
    cam.setViewOffset(size.width, size.height, (0.5 - l.cx) * size.width, (0.5 - l.cy) * size.height, size.width, size.height);
    g.dustMat.uniforms.uPx.value = (size.height * viewport.dpr) / (2 * Math.tan(15 * RAD));
    invalidate();
  }, [camera, gl, size.width, size.height, viewport.dpr, g, invalidate]);

  // Theme colours (read after the provider has switched data-theme).
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      g.applyPalette(readPalette());
      invalidate();
    });
    return () => cancelAnimationFrame(id);
  }, [theme, g, invalidate]);

  // Pointer drag: spin with inertia, limited tilt.
  useEffect(() => {
    const el = gl.domElement;
    const s = st.current;
    let lastMove = 0;
    const down = (e: PointerEvent) => {
      if (e.button !== 0 || s.diving) return;
      s.drag = true;
      s.px = e.clientX;
      s.py = e.clientY;
      s.pt = e.timeStamp;
      s.vy = s.vt = 0;
      el.setPointerCapture?.(e.pointerId);
      el.dataset.dragging = "";
    };
    const move = (e: PointerEvent) => {
      if (!s.drag) return;
      const k = Math.PI / layout.current.diameter;
      const dx = e.clientX - s.px;
      const dy = e.clientY - s.py;
      const dts = Math.max(4, e.timeStamp - s.pt) / 1000;
      s.yaw += dx * k;
      s.tilt = Math.min(HOME_TILT + 0.6, Math.max(HOME_TILT - 0.75, s.tilt + dy * k * 0.7));
      s.vy = s.vy * 0.4 + ((dx * k) / dts) * 0.6;
      s.vt = s.vt * 0.4 + ((dy * k * 0.7) / dts) * 0.6;
      s.vy = Math.max(-6, Math.min(6, s.vy));
      s.vt = Math.max(-3, Math.min(3, s.vt));
      s.px = e.clientX;
      s.py = e.clientY;
      s.pt = e.timeStamp;
      s.lastInput = s.t;
      lastMove = performance.now();
      invalidate();
    };
    const up = (e: PointerEvent) => {
      if (!s.drag) return;
      s.drag = false;
      s.lastInput = s.t;
      if (performance.now() - lastMove > 90 || calm) s.vy = s.vt = 0;
      el.releasePointerCapture?.(e.pointerId);
      delete el.dataset.dragging;
      invalidate();
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
    };
  }, [gl, invalidate, calm]);

  useEffect(() => invalidate(), [dive, skipIntro, invalidate]);

  const tmp = useMemo(
    () => ({ a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3() }),
    [],
  );

  useFrame((_, rawDt) => {
    const dt = calm ? 0 : Math.min(rawDt, 0.1);
    const s = st.current;
    const l = layout.current;
    s.t += dt;
    const t = s.t;

    // Intro: skipped (click / calm) means settle now.
    if (!s.introDone && skipIntro) {
      s.introDone = true;
      s.rings = [-99, -99, -99];
      if (!s.drag) {
        s.yaw = REST_YAW;
        s.tilt = REST_TILT;
      }
    }
    const emerge = skipIntro ? 1 : clamp01(t / 1.7);
    const intro = skipIntro ? 1 : clamp01(t / 2.6);
    if (intro >= 1) s.introDone = true;

    // Sign-in dive.
    if (dive && !s.diving && !calm) {
      s.diving = true;
      s.drag = false;
      s.rings = [t + 0.05, t + 0.22, t + 0.39];
      s.ringLife = 1.05;
    } else if (!dive && s.diving) {
      s.diving = false;
      s.lastInput = t;
    }
    s.dv = clamp01(s.dv + (s.diving ? dt / DIVE_S : -dt / 0.8));
    const zoom = easeIn(s.dv);

    // Pose.
    const sway = calm ? 0 : 0.18 * Math.sin(t * 0.1);
    let tYaw = REST_YAW + sway;
    let tTilt = REST_TILT;
    if (s.diving) {
      tYaw = HOME_YAW;
      tTilt = HOME_TILT;
    }
    const near = (target: number) => target + TAU * Math.round((s.yaw - target) / TAU);
    if (s.drag) {
      // Pointer events move the globe directly.
    } else if (!s.introDone && !s.diving) {
      const p = easeOut(intro);
      s.yaw = tYaw + INTRO_SPIN * (1 - p);
      s.tilt = tTilt - 0.35 * (1 - p);
    } else if (!calm) {
      s.yaw += s.vy * dt;
      s.tilt = Math.min(HOME_TILT + 0.6, Math.max(HOME_TILT - 0.75, s.tilt + s.vt * dt));
      const damp = Math.exp(-dt * (s.diving ? 12 : 2.2));
      s.vy *= damp;
      s.vt *= damp;
      const k = s.diving ? 7 : t - s.lastInput > 1.4 ? 1.1 : 0;
      if (k) {
        const f = 1 - Math.exp(-dt * k);
        s.yaw += (near(tYaw) - s.yaw) * f;
        s.tilt += (tTilt - s.tilt) * f;
      }
    }
    g.spin.rotation.set(s.tilt, s.yaw, 0);

    // Emerging out of soft light.
    g.fade.value = easeOut(emerge);
    g.rig.scale.setScalar(0.84 + 0.16 * easeOut(emerge));
    const flash = (1 - easeOut(emerge)) * clamp01(t / 0.3);
    g.bloomMat.opacity = 0.28 + flash * 0.9 + zoom * 0.6;
    g.bloom.scale.setScalar(3.5 + flash * 2.2 + zoom * 2);

    // Camera: framed by the layout, pulled toward the hub on sign-in.
    camera.position.set(0, 0, l.dist * (1 - 0.74 * zoom));
    camera.lookAt(0, 0, 0);
    camera.updateMatrixWorld();

    // Range rings.
    g.rings.forEach((ring, i) => {
      const p = (t - s.rings[i]) / s.ringLife;
      if (p <= 0 || p >= 1) {
        ring.uniforms.uAlpha.value = 0;
        return;
      }
      ring.uniforms.uTheta.value = 0.03 + 0.95 * easeOut(p);
      ring.uniforms.uAlpha.value = Math.pow(1 - p, 1.6) * Math.min(1, p * 10) * 0.95;
    });

    // Hub pin: dimmed when it turns away behind the glass.
    tmp.a.set(0, 0, 1).applyQuaternion(g.hubFrame.quaternion).applyEuler(g.spin.rotation);
    tmp.b.copy(camera.position).sub(tmp.a).normalize();
    const facing = tmp.a.dot(tmp.b);
    const vis = 0.22 + 0.78 * Math.min(1, Math.max(0, (facing + 0.1) / 0.4));
    const breathe = calm ? 1 : 1 + 0.08 * Math.sin(t * 1.6);
    g.pinGlow.scale.setScalar(0.24 * breathe * (1 + zoom * 7));
    g.pinGlowMat.opacity = Math.min(1, (0.85 + zoom * 0.4) * vis) * g.fade.value;
    g.pinDotMat.opacity = vis * g.fade.value;
    const pp = calm ? 0.35 : (t % 3.2) / 3.2;
    g.pulse.scale.setScalar(1 + 3 * pp);
    g.pulseMat.opacity = 0.55 * Math.pow(1 - pp, 2) * vis * g.fade.value * (1 - zoom);

    // Orbiting light and its glint on the glass.
    s.head += dt * 0.24;
    const head = s.head % TAU;
    g.orbitMat.uniforms.uHead.value = head;
    g.orbitMat.uniforms.uRadius.value = g.rig.scale.x;
    g.head.position.set(Math.cos(head) * ORBIT_R, 0, Math.sin(head) * ORBIT_R);
    g.orbit.updateMatrixWorld();
    g.head.getWorldPosition(tmp.a);
    tmp.c.copy(tmp.a).applyMatrix4(camera.matrixWorldInverse);
    tmp.b.set(0, 0, 0).applyMatrix4(camera.matrixWorldInverse);
    const behind = tmp.c.z < tmp.b.z;
    const ratio = tmp.b.z / tmp.c.z;
    const hidden = behind && Math.hypot(tmp.c.x * ratio - tmp.b.x, tmp.c.y * ratio - tmp.b.y) < g.rig.scale.x;
    g.headMat.opacity = (hidden ? 0.18 : 0.9) * g.fade.value * (1 - zoom);
    g.coreMat.uniforms.uOrbit.value.copy(tmp.c.sub(tmp.b).normalize());
    g.coreMat.uniforms.uGlint.value = behind ? 0.15 : 1;

    // Dust.
    g.dustMat.uniforms.uTime.value = t;
    g.dust.rotation.y = t * 0.012;

    // Calm: keep drawing only while a drag is settling.
    if (calm && s.drag) invalidate();
  });

  return (
    <>
      <primitive object={g.rig} />
      <primitive object={g.dust} />
    </>
  );
}

/* ───────────────────────────── Canvas ───────────────────────────── */

class GlobeBoundary extends Component<{ children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    // Without WebGL the page keeps the still, CSS-drawn globe.
    return this.state.failed ? <div className="globe-placeholder" /> : this.props.children;
  }
}

export function Globe({ dive, skipIntro }: GlobeProps) {
  const { motion, theme } = useFx();
  const visible = usePageVisible();
  const frameloop = motion === "full" ? (visible ? "always" : "never") : "demand";
  return (
    <GlobeBoundary>
      <Canvas
        className="globe-canvas"
        frameloop={frameloop}
        dpr={motion === "lite" ? 1 : [1, 1.75]}
        flat
        gl={{ alpha: true, antialias: true, powerPreference: "high-performance" }}
        camera={{ fov: 30, near: 0.05, far: 60, position: [0, 0, 6] }}
        onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      >
        <Scene dive={dive} skipIntro={skipIntro} motion={motion} theme={theme} />
      </Canvas>
    </GlobeBoundary>
  );
}

export default Globe;
