"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  Marker,
  NavigationControl,
  Popup,
  setWorkerUrl,
} from "maplibre-gl";
import { FFZ, MAP_VIEW } from "@/lib/constants";
import { mesaFeature } from "@/lib/geography";
import type { Finding, TrackPoint } from "@/lib/types";

// Turbopack hashes MapLibre worker assets without rewriting the worker's
// relative `./maplibre-gl-shared.mjs` import. Serve both files from /public.
if (typeof window !== "undefined") {
  setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");
}

type Props = {
  /** Primary / selected track (emphasized). */
  track: TrackPoint[];
  findings?: Finding[];
  /** Additional tracks drawn muted for spatial overview (results page). */
  contextTracks?: TrackPoint[][];
  className?: string;
};

function eastValleyBounds() {
  const [west, south, east, north] = MAP_VIEW.maxBounds;
  return new LngLatBounds([west, south], [east, north]);
}

function inMapRegion(lat: number, lon: number) {
  const [west, south, east, north] = MAP_VIEW.maxBounds;
  return lon >= west && lon <= east && lat >= south && lat <= north;
}

function fitToTracksOrRegion(map: Map, tracks: TrackPoint[][]) {
  const focus = tracks.flat().filter((p) => inMapRegion(p.lat, p.lon));
  if (focus.length >= 2) {
    const bounds = new LngLatBounds();
    focus.forEach((p) => bounds.extend([p.lon, p.lat]));
    bounds.extend([FFZ.lon, FFZ.lat]);
    map.fitBounds(bounds, {
      padding: 48,
      maxZoom: 13,
      duration: 600,
    });
    return;
  }
  map.fitBounds(eastValleyBounds(), {
    padding: 24,
    maxZoom: MAP_VIEW.zoom,
    duration: 400,
  });
}

function toLineFeature(points: TrackPoint[]) {
  const local = points.filter((p) => inMapRegion(p.lat, p.lon));
  return {
    type: "Feature" as const,
    properties: {},
    geometry: {
      type: "LineString" as const,
      coordinates:
        local.length >= 2
          ? local.map((p) => [p.lon, p.lat] as [number, number])
          : ([] as [number, number][]),
    },
  };
}

export function FlightMap({
  track,
  findings = [],
  contextTracks = [],
  className,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  const displayTrack = useMemo(() => {
    const local = track.filter((p) => inMapRegion(p.lat, p.lon));
    return local;
  }, [track]);

  const line = useMemo(() => toLineFeature(track), [track]);

  const contextCollection = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: contextTracks
        .map((t) => toLineFeature(t))
        .filter((f) => f.geometry.coordinates.length >= 2),
    }),
    [contextTracks]
  );

  const highlights = useMemo(
    () => ({
      type: "FeatureCollection" as const,
      features: findings
        .filter((f) => f.lat != null && f.lon != null)
        .map((f) => ({
          type: "Feature" as const,
          properties: { severity: f.severity, summary: f.summary },
          geometry: {
            type: "Point" as const,
            coordinates: [f.lon!, f.lat!] as [number, number],
          },
        })),
    }),
    [findings]
  );

  const fitTracks = useMemo(() => {
    const all = [track, ...contextTracks];
    return all;
  }, [track, contextTracks]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new Map({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png"],
            tileSize: 256,
            attribution: "© OpenStreetMap",
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
          },
        ],
      },
      center: MAP_VIEW.center,
      zoom: MAP_VIEW.zoom,
      minZoom: MAP_VIEW.minZoom,
      maxZoom: MAP_VIEW.maxZoom,
      maxBounds: MAP_VIEW.maxBounds,
      attributionControl: {},
    });

    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    map.on("load", () => {
      map.addSource("mesa", {
        type: "geojson",
        data: mesaFeature,
      });
      map.addLayer({
        id: "mesa-fill",
        type: "fill",
        source: "mesa",
        paint: {
          "fill-color": "#b45309",
          "fill-opacity": 0.08,
        },
      });
      map.addLayer({
        id: "mesa-line",
        type: "line",
        source: "mesa",
        paint: {
          "line-color": "#92400e",
          "line-width": 1.5,
          "line-opacity": 0.7,
        },
      });

      map.addSource("context-tracks", {
        type: "geojson",
        data: contextCollection,
      });
      map.addLayer({
        id: "context-track-line",
        type: "line",
        source: "context-tracks",
        paint: {
          "line-color": "#78716c",
          "line-width": 1.5,
          "line-opacity": 0.45,
        },
      });

      map.addSource("track", { type: "geojson", data: line });
      map.addLayer({
        id: "track-line",
        type: "line",
        source: "track",
        paint: {
          "line-color": "#0f766e",
          "line-width": 3,
          "line-opacity": 0.9,
        },
      });

      map.addSource("findings", { type: "geojson", data: highlights });
      map.addLayer({
        id: "findings-circle",
        type: "circle",
        source: "findings",
        paint: {
          "circle-radius": 7,
          "circle-color": [
            "match",
            ["get", "severity"],
            "high",
            "#b91c1c",
            "medium",
            "#c2410c",
            "#a16207",
          ],
          "circle-stroke-width": 2,
          "circle-stroke-color": "#fff7ed",
        },
      });

      new Marker({ color: "#0f172a" })
        .setLngLat([FFZ.lon, FFZ.lat])
        .setPopup(new Popup().setText("KFFZ Falcon Field"))
        .addTo(map);

      fitToTracksOrRegion(map, fitTracks);
    });

    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !map.isStyleLoaded()) return;
    const trackSrc = map.getSource("track") as GeoJSONSource | undefined;
    const contextSrc = map.getSource("context-tracks") as
      | GeoJSONSource
      | undefined;
    const findSrc = map.getSource("findings") as GeoJSONSource | undefined;
    trackSrc?.setData(line);
    contextSrc?.setData(contextCollection);
    findSrc?.setData(highlights);
    fitToTracksOrRegion(map, fitTracks);
  }, [line, contextCollection, highlights, fitTracks]);

  return (
    <div className={`relative ${className ?? "h-full w-full min-h-[280px]"}`}>
      <div
        ref={containerRef}
        className="h-full w-full min-h-[280px] rounded-sm overflow-hidden"
        role="img"
        aria-label="Flight track map"
      />
      {displayTrack.length < 2 && contextCollection.features.length === 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-stone-950/70 px-3 py-2 text-xs text-amber-50">
          {track.length >= 2
            ? "Track exists but is outside the East Valley map focus — no local path to draw."
            : "No track points for this operation — map focused on Falcon Field / East Valley."}
        </div>
      )}
    </div>
  );
}
