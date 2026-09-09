# FFZ Ops Review

Staff tool for **Falcon Field Airport (KFFZ)** to review overnight / off-hours operations using real ADS-B-derived flight tracks. Pick a time window, see **screening flags / review candidates** against voluntary Fly Friendly / noise-abatement guidance, open a flight for map + altitude evidence, and export CSV.

Procedures are **voluntary**. This app does **not** determine violations or issue citations.

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

- Noise procedures are **voluntary**; this tool surfaces **screening flags / review candidates**, not citations, “violators,” or enforcement actions.
- OpenSky REST tracks are limited (~last 30 days). Historical Trino access requires a separate research/government application.
- ADS-B coverage gaps, MLAT variance, and barometric altitude errors exist.
- Aircraft category prefers ADS-B.lol ICAO type designator when available; otherwise inferred.
- Long windows are capped (≈72h of fetch) to respect API rate limits; prefer overnight presets.
- Anonymous OpenSky quotas are tight and may rate-limit after heavy use — **configure OAuth credentials for reliable daily staff reports**. Without OpenSky, the app falls back to ADS-B.lol nearby aircraft + day traces (biased toward currently transmitting aircraft).

### Explicit non-goals (not detectable from ADS-B)

- Power / RPM / blade slap
- Vy specifically
- PAPI / visual glidepath
- Hover time
- ATC clearances or wind justifying runway / turnout

## Time presets (America/Phoenix, no DST)

- **Staff off** — 6:00 p.m.–5:30 a.m. (airport staff typically not present)
- **Quiet hours** — 10:00 p.m.–5:30 a.m. (Chart Supp 0500–1230Z)
- Last 24 hours, yesterday overnight, last 7 nights (fetch capped), custom range

## Screening heuristics (internal)

Encoded from Falcon Field’s published noise abatement guidance (rev 11/04/2024), Chart Supplement quiet-hours language, and helicopter guidance **PDF 49031** (not 49055 Task Force docs). See `docs/encoded-criteria.md`.

- Below expected pattern altitude on **downwind/abeam** (final/base excluded)
- Slow climb after departure (still below climb target beyond ~1.5 NM)
- Wide pattern (lateral offset from runway centerline ≳ ~1.1 SM; Chart ~¾ mi from runway end)
- `NIGHT_REPETITIVE` — ≥2 quiet-hour circuit/approach cycles; `QUIET_HOUR_ACTIVITY` for non-repetitive quiet-hour presence
- Low altitude over Mesa city limits outside the preferred northeast departure corridor
- Soft `NON_PREFERRED_DEPARTURE` for SW (22) / early residential turnout when calm-wind preference would apply (wind/ATC disclaimer)
- Helicopter near-field altitude, canal-adjacent west-of-field, and soft published-route checks

UI copy prefers operational language and screening framing; program branding is not quoted as regulation.

## Deploy

**Recommended host:** [Vercel](https://vercel.com) (native Next.js App Router support). Cloudflare Pages/Workers can work but needs more adapter/config work for this app.

### GitHub Actions secrets vs hosting secrets

Putting `OPENSKY_*` in **GitHub Actions secrets alone does not put the app on the web.** Those secrets are only available to CI workflows.

This repo has **no** `.github/workflows` deploy pipeline. To run a public demo you need:

1. A host that builds and serves the Next.js app (Vercel is simplest).
2. **`OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` set on that host** as **server-side** env vars (not `NEXT_PUBLIC_*`). The app reads them only in API routes / server code (`src/lib/opensky.ts`).

GitHub Actions secrets **are** useful later if you add a workflow that deploys (e.g. `vercel deploy` or Cloudflare) and injects those values at deploy time — they still end up on the host, not “in GitHub” for runtime.

**Never commit** `credentials.json`, `.env.local`, or real client secrets. Keep OpenSky files in Downloads / password manager only.

### Checklist: public demo URL

1. Push this repo to GitHub (already: `sonoflin/falcon`).
2. Import the project on [Vercel](https://vercel.com/new) → Framework: Next.js → Deploy.
3. **Project → Settings → Environment Variables** (Production + Preview):
   - `OPENSKY_CLIENT_ID` = your OpenSky API client id
   - `OPENSKY_CLIENT_SECRET` = your OpenSky API client secret  
   No other env vars are required. (`DEMO_MODE` in `.env.example` is unused.)
4. Redeploy after saving env vars so the new secrets apply.
5. Open the `*.vercel.app` URL and run **Staff off** or **Quiet hours** (short overnight windows). Avoid “last 7 nights” for a live walkthrough — longer windows hit rate limits and approach the 60s serverless timeout.

Report/export routes set `maxDuration = 60`. On Vercel Hobby the effective limit may be lower; if reports time out, use a Pro plan or a shorter preset.

### Demo reliability tips

- **With OAuth credentials** on the host: much more reliable than anonymous OpenSky quotas.
- **Without credentials:** anonymous OpenSky is easy to rate-limit; the app falls back to ADS-B.lol nearby aircraft + day traces (may miss planes no longer transmitting).
- Prefer overnight presets over multi-day custom ranges for colleagues.
- First load after idle can be slow (cold start + API fetches); wait for the report, then drill into individual flights.
- Credentials stay server-side; colleagues only need the URL (consider Vercel Deployment Protection / password if the demo should stay private).

### Local production

```bash
npm run build && npm start
```

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · MapLibre GL · Turf.js · OpenSky Network

## License note

OpenSky data usage is subject to [OpenSky terms](https://opensky-network.org/). OSM data © OpenStreetMap contributors.
