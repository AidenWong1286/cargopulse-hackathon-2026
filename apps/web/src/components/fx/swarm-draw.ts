/**
 * Canvas helpers shared by the two "wow" moments (container fly-in and solve swarm):
 * design-token colours resolved for canvas use, pre-rendered glow sprites and the
 * contoured ULD silhouette. Decorative drawing only; no data lives here.
 */

export const CLASS_KEYS = ["GENERAL", "PRIORITY", "PHARMA", "PERISHABLE", "DG"] as const;
export type CargoClass = (typeof CLASS_KEYS)[number];

export const CLASS_TOKEN: Record<CargoClass, string> = {
  GENERAL: "--viz-class-general",
  PRIORITY: "--viz-class-priority",
  PHARMA: "--viz-class-pharma",
  PERISHABLE: "--viz-class-perishable",
  DG: "--viz-class-dg",
};

export const CLASS_LABEL: Record<CargoClass, [string, string]> = {
  GENERAL: ["General", "一般"],
  PRIORITY: ["Priority", "優先"],
  PHARMA: ["Pharma", "醫藥"],
  PERISHABLE: ["Perishable", "易腐"],
  DG: ["Dangerous goods", "危險品"],
};

/** Index of a cargo class in CLASS_KEYS; unknown classes fall back to GENERAL. */
export function classIndex(value: string | undefined | null): number {
  const i = CLASS_KEYS.indexOf((value ?? "") as CargoClass);
  return i < 0 ? 0 : i;
}

export type Rgb = [number, number, number];

let scratch: CanvasRenderingContext2D | null = null;

/** Any CSS colour (hex, rgb(), color(), color-mix()) as an RGB triple. */
function toRgb(color: string, fallback: Rgb): Rgb {
  if (!scratch) {
    const c = document.createElement("canvas");
    c.width = c.height = 1;
    scratch = c.getContext("2d", { willReadFrequently: true });
  }
  if (!scratch) return fallback;
  scratch.clearRect(0, 0, 1, 1);
  scratch.fillStyle = `rgb(${fallback.join(",")})`;
  scratch.fillStyle = color;
  scratch.fillRect(0, 0, 1, 1);
  const d = scratch.getImageData(0, 0, 1, 1).data;
  return [d[0], d[1], d[2]];
}

/** Resolves a CSS custom property (as it applies at `host`) to an RGB triple. */
export function tokenRgb(host: HTMLElement, token: string, fallback: Rgb): Rgb {
  const probe = document.createElement("span");
  probe.style.color = `var(${token})`;
  probe.style.display = "none";
  host.appendChild(probe);
  const value = getComputedStyle(probe).color;
  probe.remove();
  return value ? toRgb(value, fallback) : fallback;
}

export const rgba = ([r, g, b]: Rgb, a: number) => `rgba(${r},${g},${b},${a})`;

/** A soft round glow with a bright centre, drawn once and stamped with drawImage. */
export function glowSprite(color: Rgb, size = 64, core = 0.14): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  if (!g) return c;
  const h = size / 2;
  const grad = g.createRadialGradient(h, h, 0, h, h, h);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(core, rgba(color, 1));
  grad.addColorStop(core * 2.6, rgba(color, 0.42));
  grad.addColorStop(1, rgba(color, 0));
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  return c;
}

export type Palette = {
  classes: Rgb[];
  sprites: HTMLCanvasElement[];
  gold: Rgb;
  goldPale: Rgb;
  goldDeep: Rgb;
  goldSprite: HTMLCanvasElement;
  night: boolean;
};

export function readPalette(host: HTMLElement): Palette {
  const classes = CLASS_KEYS.map((k) => tokenRgb(host, CLASS_TOKEN[k], [42, 120, 214]));
  const gold = tokenRgb(host, "--gold", [227, 201, 133]);
  const goldPale = tokenRgb(host, "--gold-pale", [246, 233, 190]);
  const goldDeep = tokenRgb(host, "--gold-deep", [201, 166, 85]);
  return {
    classes,
    sprites: classes.map((c) => glowSprite(c)),
    gold,
    goldPale,
    goldDeep,
    goldSprite: glowSprite(gold, 96, 0.08),
    night: document.documentElement.dataset.theme === "night",
  };
}

/**
 * Adds a contoured ULD silhouette (an AKE-style container: square body with the
 * lower-left corner cut away) centred on (x, y) to the current path.
 */
export function uldPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number) {
  const h = w * 0.86;
  const l = x - w / 2;
  const t = y - h / 2;
  ctx.moveTo(l, t);
  ctx.lineTo(l + w, t);
  ctx.lineTo(l + w, t + h);
  ctx.lineTo(l + w * 0.3, t + h);
  ctx.lineTo(l, t + h * 0.66);
  ctx.closePath();
}

/** Device-pixel sizing for a canvas; returns the ratio used. */
export function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number, lite: boolean) {
  const dpr = lite ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const W = Math.max(1, Math.round(w * dpr));
  const H = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  return dpr;
}
