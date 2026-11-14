import { geoAzimuthalEquidistant, geoCircle, geoGraticule, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { GeometryCollection, Topology } from "topojson-specification";
import landTopology from "world-atlas/land-110m.json";
import { airports, HUB } from "@/lib/airports";

const EARTH_KM = 6371;
/** Cruise speed used to label the range rings in flight hours. */
export const CRUISE_KMH = 900;
/** The chart stops this far from the hub; beyond it an azimuthal map smears. */
const HORIZON_DEG = 128;

const hub = airports[HUB].at;
const topology = landTopology as unknown as Topology<{ land: GeometryCollection }>;
const land = feature(topology, topology.objects.land);

const RAD = Math.PI / 180;
const wrap = (value: number, span: number) => ((value % span) + span) % span;

/**
 * Where the sun is directly overhead at the given moment, as [longitude, latitude]
 * in degrees. Low-precision almanac formula (good to a fraction of a degree),
 * which is plenty for shading a chart.
 */
export function subsolarPoint(date: Date): [number, number] {
  // Days since J2000.0 (2000-01-01 12:00 UTC).
  const n = date.getTime() / 86_400_000 - 10_957.5;
  const meanLongitude = wrap(280.46 + 0.9856474 * n, 360);
  const anomaly = wrap(357.528 + 0.9856003 * n, 360) * RAD;
  const ecliptic = (meanLongitude + 1.915 * Math.sin(anomaly) + 0.02 * Math.sin(2 * anomaly)) * RAD;
  const tilt = (23.439 - 0.0000004 * n) * RAD;
  const declination = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
  const rightAscension = Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic));
  const siderealHours = wrap(18.697374558 + 24.06570982441908 * n, 24);
  const longitude = wrap(rightAscension / RAD - siderealHours * 15 + 180, 360) - 180;
  return [longitude, declination / RAD];
}

function projectionAt(scale: number, centre: [number, number]) {
  return geoAzimuthalEquidistant()
    .rotate([-hub[0], -hub[1]])
    .scale(scale)
    .translate(centre)
    .clipAngle(HORIZON_DEG)
    .precision(0.3);
}

export type Frame = {
  width: number;
  height: number;
  /** Where the hub sits, as a fraction of the frame (0–1 across, 0–1 down). */
  hub: [number, number];
  /** Kilometres spanned by the full width of the frame. */
  kmAcross: number;
};

/** All geometry for one chart frame: an azimuthal equidistant map centred on the hub. */
export function buildFrame({ width, height, hub: at, kmAcross }: Frame) {
  const cx = width * at[0];
  const cy = height * at[1];
  const pxPerKm = width / kmAcross;
  const projection = projectionAt(pxPerKm * EARTH_KM, [cx, cy]).clipExtent([
    [-6, -6],
    [width + 6, height + 6],
  ]);
  const path = geoPath(projection).digits(1);
  const reach = Math.max(
    Math.hypot(cx, cy),
    Math.hypot(width - cx, cy),
    Math.hypot(cx, height - cy),
    Math.hypot(width - cx, height - cy),
  );
  const horizonKm = (HORIZON_DEG * Math.PI * EARTH_KM) / 180;
  const rings: { hours: number; r: number }[] = [];
  for (let hours = 2; hours * CRUISE_KMH < horizonKm; hours += 2) {
    const r = hours * CRUISE_KMH * pxPerKm;
    if (r > reach) break;
    rings.push({ hours, r: Math.round(r * 10) / 10 });
  }
  return {
    cx,
    cy,
    rings,
    land: path(land) ?? "",
    graticule: path(geoGraticule().step([15, 15])()) ?? "",
    /**
     * The part of the chart where it is night at `date`. `twilight` shrinks the
     * area to where the sun is at least that many degrees below the horizon, so
     * a few stacked calls give a soft edge.
     */
    night: (date: Date, twilight = 0) => {
      const [lon, lat] = subsolarPoint(date);
      return (
        path(
          geoCircle()
            .center([lon + 180, -lat])
            .radius(90 - twilight)
            .precision(2)(),
        ) ?? ""
      );
    },
    /** Great-circle line between two [lon, lat] points. */
    line: (from: [number, number], to: [number, number]) =>
      path({ type: "LineString", coordinates: [from, to] }) ?? "",
    /** Position of a [lon, lat] point, or null when it is beyond the horizon. */
    point: (lonLat: [number, number]) => {
      const p = projection(lonLat);
      return p && p[0] >= 0 && p[0] <= width && p[1] >= 0 && p[1] <= height
        ? ([Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10] as [number, number])
        : null;
    },
  };
}

/**
 * The widest view (in km across) that still keeps every listed airport inside the
 * frame, so a chart can zoom to the destinations in the data it is given.
 */
export function kmAcrossToFit(
  codes: string[],
  width: number,
  height: number,
  at: [number, number],
  pad = 64,
  nearestKm = 5000,
) {
  const unit = projectionAt(EARTH_KM, [0, 0]);
  let pxPerKm = width / nearestKm;
  for (const code of codes) {
    const airport = airports[code];
    if (!airport || code === HUB) continue;
    const p = unit(airport.at);
    if (!p) continue;
    const roomX = (p[0] > 0 ? width * (1 - at[0]) : width * at[0]) - pad;
    const roomY = (p[1] > 0 ? height * (1 - at[1]) : height * at[1]) - pad;
    if (Math.abs(p[0]) > 1) pxPerKm = Math.min(pxPerKm, roomX / Math.abs(p[0]));
    if (Math.abs(p[1]) > 1) pxPerKm = Math.min(pxPerKm, roomY / Math.abs(p[1]));
  }
  return width / pxPerKm;
}
