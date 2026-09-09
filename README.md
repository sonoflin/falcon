# FFZ Ops Review

Staff tool for **Falcon Field Airport (KFFZ)** to review overnight / off-hours operations using real ADS-B-derived flight tracks. Pick a time window, see potential procedure deviations, open a flight for map + altitude evidence, and export CSV.

## Quick start

```bash
npm install
cp .env.example .env.local   # optional OpenSky credentials
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Environment

| Variable | Required | Description |
| --- | --- | --- |
| `OPENSKY_CLIENT_ID` | No | OpenSky OAuth2 client id (higher rate limits) |
| `OPENSKY_CLIENT_SECRET` | No | OpenSky OAuth2 client secret |

Create an API client at [OpenSky Network](https://opensky-network.org/) → Account → API clients (client credentials flow). Without credentials the app uses anonymous REST access (more rate limiting).

## Data sources & verification

**Primary flight list:** [OpenSky Network](https://opensky-network.org/) REST (`/flights/departure` + `/flights/arrival` for `KFFZ`)

**Primary tracks:** [ADS-B.lol](https://adsb.lol/) globe day traces (high-rate lat/lon/altitude/time), with OpenSky `/tracks` as backup

**Fallback when OpenSky is rate-limited:** ADS-B.lol live aircraft near KFFZ + their day traces (may miss aircraft that are no longer transmitting)

**Geography:** City of Mesa boundary from OpenStreetMap via Nominatim (`src/data/mesa-boundary.json`)

Each flagged flight links to a public globe view and shows timestamps, altitudes (ft MSL), and distances for verification.

### Limitations (important)

- Noise procedures are **voluntary**; this tool surfaces **screening cues**, not citations or enforcement actions.
- OpenSky REST tracks are limited (~last 30 days). Historical Trino access requires a separate research/government application.
- ADS-B coverage gaps, MLAT variance, and barometric altitude errors exist.
- Aircraft category (piston / turbine / helicopter) is **inferred** when type is unknown.
- Long windows are capped (≈72h of fetch) to respect API rate limits; prefer overnight presets.
- Anonymous OpenSky quotas are tight and may rate-limit after heavy use — **configure OAuth credentials for reliable daily staff reports**. Without OpenSky, the app falls back to ADS-B.lol nearby aircraft + day traces (biased toward currently transmitting aircraft).

## Time presets (America/Phoenix, no DST)

- **Staff off** — 6:00 p.m.–5:30 a.m. (airport staff typically not present)
- **Quiet hours** — 10:00 p.m.–5:30 a.m.
- Last 24 hours, yesterday overnight, last 7 nights (fetch capped), custom range

## Screening heuristics (internal)

Encoded from Falcon Field’s published noise abatement guidance (rev 11/04/2024), expressed in operational language in the UI only:

- Below expected pattern altitude near the field
- Slow climb after departure (still below climb target beyond ~1.5 NM)
- Wide pattern (downwind farther than ~1.25 SM)
- Repetitive low circuits / approaches during 10:00 p.m.–5:30 a.m.
- Low altitude over Mesa city limits outside the preferred northeast departure corridor
- Helicopter-specific near-field altitude and west-of-field corridor checks

The UI does **not** name or quote voluntary program branding.

## Deploy

### Vercel

```bash
npx vercel
```

Add `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` in project env. Serverless `maxDuration` should be ≥ 60s for report generation.

### Local production

```bash
npm run build && npm start
```

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · MapLibre GL · Turf.js · OpenSky Network

## License note

OpenSky data usage is subject to [OpenSky terms](https://opensky-network.org/). OSM data © OpenStreetMap contributors.
