/**
 * Geometry for the sign-in globe: coastlines and graticule as 3D line segments,
 * and an equirectangular land mask drawn to a canvas (frosted land on the glass).
 * Everything comes from the bundled world-atlas topology; nothing is fetched.
 */
import { geoEquirectangular, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopology from "world-atlas/land-110m.json";

const RAD = Math.PI / 180;
const topology = landTopology as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topology, topology.objects.land);

/** [lon, lat] in degrees to a point on a sphere. lon 0 / lat 0 faces +Z. */
export function lonLatToVec3(lon: number, lat: number, r = 1): [number, number, number] {
  const phi = lat * RAD;
  const lambda = lon * RAD;
  return [r * Math.cos(phi) * Math.sin(lambda), r * Math.sin(phi), r * Math.cos(phi) * Math.cos(lambda)];
}

function landRings(): number[][][] {
  const rings: number[][][] = [];
  for (const f of land.features) {
    const g = f.geometry;
    if (!g) continue;
    if (g.type === "Polygon") rings.push(...(g.coordinates as number[][][]));
    else if (g.type === "MultiPolygon") for (const poly of g.coordinates as number[][][][]) rings.push(...poly);
  }
  return rings;
}

/** Coastlines as pairs of points (for THREE.LineSegments). */
export function coastPositions(r = 1.002): Float32Array {
  const out: number[] = [];
  for (const ring of landRings()) {
    for (let i = 1; i < ring.length; i++) {
      const [a0, a1] = ring[i - 1];
      const [b0, b1] = ring[i];
      // Skip the seam segments some rings carry along the antimeridian.
      if (Math.abs(a0 - b0) > 180) continue;
      out.push(...lonLatToVec3(a0, a1, r), ...lonLatToVec3(b0, b1, r));
    }
  }
  return new Float32Array(out);
}

/** Meridians and parallels every 15 degrees, as segment pairs. */
export function graticulePositions(r = 1.003, step = 15): Float32Array {
  const out: number[] = [];
  const push = (a: [number, number], b: [number, number]) =>
    out.push(...lonLatToVec3(a[0], a[1], r), ...lonLatToVec3(b[0], b[1], r));
  for (let lon = -180; lon < 180; lon += step)
    for (let lat = -80; lat < 80; lat += 2) push([lon, lat], [lon, lat + 2]);
  for (let lat = -75; lat <= 75; lat += step)
    for (let lon = -180; lon < 180; lon += 2) push([lon, lat], [lon + 2, lat]);
  return new Float32Array(out);
}

/** An equirectangular land mask (white land, transparent sea), slightly softened. */
export function drawLandMask(width = 2048): HTMLCanvasElement {
  const height = width / 2;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const projection = geoEquirectangular()
    .scale(width / (2 * Math.PI))
    .translate([width / 2, height / 2])
    .precision(0.5);
  const path = geoPath(projection, ctx);
  ctx.filter = "blur(1.2px)";
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  path(land);
  ctx.fill();
  return canvas;
}

/** A soft round light (white core to transparent), tinted by the material colour. */
export function drawGlow(size = 128): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.18, "rgba(255,255,255,0.55)");
  g.addColorStop(0.45, "rgba(255,255,255,0.16)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
