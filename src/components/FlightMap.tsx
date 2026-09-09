"use client";

import { useEffect, useMemo, useRef } from "react";
import {
  GeoJSONSource,
  LngLatBounds,
  Map,
  Marker,
  NavigationControl,
  Popup,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { FFZ } from "@/lib/constants";
import { mesaFeature } from "@/lib/geography";
import type { Finding, TrackPoint } from "@/lib/types";

type Props = {
  track: TrackPoint[];
  findings?: Finding[];
  className?: string;
};

export function FlightMap({ track, findings = [], className }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<Map | null>(null);

  const line = useMemo(
    () => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "LineString" as const,
        coordinates: track.map((p) => [p.lon, p.lat]),
      },
    }),
    [track]
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
            coordinates: [f.lon!, f.lat!],
          },
        })),
    }),
    [findings]
  );

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
      center: [FFZ.lon, FFZ.lat],
      zoom: 11,
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

      if (track.length) {
        const bounds = new LngLatBounds();
        track.forEach((p) => bounds.extend([p.lon, p.lat]));
        bounds.extend([FFZ.lon, FFZ.lat]);
        map.fitBounds(bounds, { padding: 48, maxZoom: 13 });
      }
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
    const findSrc = map.getSource("findings") as GeoJSONSource | undefined;
    trackSrc?.setData(line);
    findSrc?.setData(highlights);
    if (track.length) {
      const bounds = new LngLatBounds();
      track.forEach((p) => bounds.extend([p.lon, p.lat]));
      bounds.extend([FFZ.lon, FFZ.lat]);
      map.fitBounds(bounds, { padding: 48, maxZoom: 13, duration: 600 });
    }
  }, [line, highlights, track]);

  return (
    <div
      ref={containerRef}
      className={className ?? "h-full w-full min-h-[280px] rounded-sm overflow-hidden"}
      role="img"
      aria-label="Flight track map"
    />
  );
}
