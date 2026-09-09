import { NextRequest, NextResponse } from "next/server";
import { analyzeFlight } from "@/lib/analysis";
import { fetchDayTrace, filterTrackToWindow } from "@/lib/adsblol";
import { RADII_NM } from "@/lib/constants";
import { distFromFfzNm } from "@/lib/geography";
import { fetchTrack } from "@/lib/opensky";
import { nowUnix } from "@/lib/time";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params;
    const dash = id.indexOf("-");
    if (dash < 0) {
      return NextResponse.json({ error: "Invalid flight id" }, { status: 400 });
    }
    const icao24 = id.slice(0, dash).toLowerCase();
    const firstSeen = Number(id.slice(dash + 1));
    if (!icao24 || !Number.isFinite(firstSeen)) {
      return NextResponse.json({ error: "Invalid flight id" }, { status: 400 });
    }

    const callsign = req.nextUrl.searchParams.get("callsign");
    const end = nowUnix();
    // Keep the ops window around the observed FFZ activity, not the whole day cruise.
    const begin = Math.max(firstSeen - 45 * 60, end - 36 * 3600);
    const trackEnd = Math.min(end + 600, firstSeen + 3 * 3600);

    const day = await fetchDayTrace(icao24);
    let track = filterTrackToWindow(day.track, begin, trackEnd).filter(
      (p) => distFromFfzNm(p.lat, p.lon) <= RADII_NM.mesaFocusNm
    );
    let source = "ADS-B.lol day trace";
    const registration = day.registration;
    const aircraftType = day.aircraftType;

    if (track.length < 3) {
      const timeParam = req.nextUrl.searchParams.get("time");
      const time = timeParam ? Number(timeParam) : firstSeen + 60;
      try {
        const openskyTrack = await fetchTrack(icao24, time);
        const local = openskyTrack.filter(
          (p) => distFromFfzNm(p.lat, p.lon) <= RADII_NM.mesaFocusNm
        );
        if (local.length >= 3) {
          track = local;
          source = "OpenSky Network track";
        } else if (openskyTrack.length >= 3) {
          track = openskyTrack;
          source = "OpenSky Network track";
        }
      } catch {
        // Keep ADS-B.lol result (possibly empty) and report honestly below.
      }
    }

    if (!track.length) {
      return NextResponse.json(
        {
          error:
            "No track points for this operation (ADS-B coverage gap or track age limit).",
        },
        { status: 404 }
      );
    }

    const lastSeen = track[track.length - 1]?.time ?? firstSeen;
    const analyzed = analyzeFlight(
      {
        icao24,
        firstSeen,
        lastSeen,
        callsign: callsign || null,
        estDepartureAirport: "KFFZ",
        estArrivalAirport: null,
        estDepartureAirportHorizDistance: null,
        estArrivalAirportHorizDistance: null,
      },
      track,
      { aircraftType }
    );

    return NextResponse.json({
      ...analyzed,
      registration: analyzed.registration || registration,
      aircraftType: analyzed.aircraftType || aircraftType,
      source,
      verifyUrl: `https://globe.adsb.lol/?icao=${icao24}`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Flight lookup failed";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
