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
| `OPENSKY_CLIENT_ID` | No* | OpenSky OAuth2 client id (higher rate limits) |
| `OPENSKY_CLIENT_SECRET` | No* | OpenSky OAuth2 client secret |
| `OPENSKY_EGRESS_PROXY_*` | No* | Server-side HTTP CONNECT egress when the host cannot reach OpenSky |
| `OPENSKY_PROXY_URL` | No* | Optional dedicated Falcon proxy base URL (secret-gated) |
| `OPENSKY_PROXY_SECRET` | No* | Shared secret for the dedicated Falcon proxy |

\*Prefer client credentials on the host. On Vercel, if `auth.opensky-network.org` is blocked, set `OPENSKY_EGRESS_PROXY_HOST` / `USER` / `PASS` (and optional `PORT`) so server-side fetches use CONNECT egress. Alternatively deploy a dedicated Falcon proxy and set `OPENSKY_PROXY_URL` + `OPENSKY_PROXY_SECRET`. Never use `NEXT_PUBLIC_*` for secrets.

Create an API client at [OpenSky Network](https://opensky-network.org/) → Account → API clients (client credentials flow). Without credentials the app uses anonymous REST access (more rate limiting).

## Data sources & verification

**Primary flight list:** [OpenSky Network](https://opensky-network.org/) REST (`/flights/departure` + `/flights/arrival` for `KFFZ`)

**Primary tracks:** [ADS-B.lol](https://adsb.lol/) globe day traces (high-rate lat/lon/altitude/time), with OpenSky `/tracks` as backup

**Fallback when OpenSky is rate-limited:** ADS-B.lol live aircraft near KFFZ + their day traces (may miss aircraft that are no longer transmitting)

**Airport identity:** Lists are KFFZ-only. OpenSky queries `airport=KFFZ`; tracks must approach Falcon Field (≤ ~4 NM) and are dropped when activity is centered on Mesa Gateway (KIWA / IWA, ~10 NM south). ADS-B.lol nearby search uses an 8 NM radius so Gateway ARP traffic is not discovered as Falcon Field ops.

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

Presets resolve concrete AZ date bounds (shown on chips and in the results header). Before tonight’s window starts, overnight presets mean the **completed prior night** — never an empty future “tonight.”

- **Staff off** — most recent 6:00 p.m.–5:30 a.m. (or tonight-so-far after 6:00 p.m.)
- **Quiet hours** — most recent 10:00 p.m.–5:30 a.m. (Chart Supp 0500–1230Z); after 10:00 p.m. = tonight so far
- Last 24 hours, yesterday overnight, last 7 nights (fetch capped to 36h), custom range

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
   - If Vercel cannot reach `auth.opensky-network.org` (connect timeout), also set server-only CONNECT egress:
     - `OPENSKY_EGRESS_PROXY_HOST` / `OPENSKY_EGRESS_PROXY_PORT` / `OPENSKY_EGRESS_PROXY_USER` / `OPENSKY_EGRESS_PROXY_PASS`
     - (or a single `OPENSKY_EGRESS_PROXY_URL`)
   - Do **not** publish the app or the OpenSky proxy with an unprotected `cloudflared tunnel --url` Quick Tunnel
4. Redeploy after changing env vars (Vercel does not always hot-reload secrets into existing lambdas).

### OpenSky cloud egress

OpenSky’s auth host is often **unreachable from Vercel and Cloudflare Workers** (connect timeout / 522). Credentials alone on Vercel are not enough.

**Production path:** set server-side CONNECT egress on Vercel so Falcon reaches OpenSky without a public application proxy:

| Variable | Notes |
| --- | --- |
| `OPENSKY_CLIENT_ID` / `OPENSKY_CLIENT_SECRET` | OpenSky OAuth client (server-only) |
| `OPENSKY_EGRESS_PROXY_HOST` / `PORT` / `USER` / `PASS` | HTTP CONNECT proxy that can reach OpenSky (server-only; never `NEXT_PUBLIC_*`) |

Do **not** put the OpenSky proxy behind a Quick Tunnel. On October 2, 2026 Cloudflare added email one-time PIN protection for Quick Tunnels (`--allowed-mail` in cloudflared 2026.9.3 and newer). That check only works in an interactive browser, so Vercel’s server-side calls cannot complete it. A public `*.trycloudflare.com` hostname is still a poor place for the proxy: it changes every launch, has no uptime guarantee, and anyone who has the URL can reach the process.

**Optional dedicated proxy:** `scripts/opensky-local-proxy.mjs` / `workers/opensky-proxy` implement a secret-gated, path-allowlisted Falcon proxy (`OPENSKY_PROXY_URL` + `OPENSKY_PROXY_SECRET`). Use only on a host that can reach OpenSky (or that itself uses CONNECT egress). See `deploy/opensky-proxy/`. Cloudflare Workers currently cannot reach OpenSky (522); prefer Vercel + `OPENSKY_EGRESS_PROXY_*`.

Without working egress, Falcon falls back to ADS-B.lol nearby discovery (`authMode: oauth_unreachable` when OAuth is configured but blocked).

No other env vars are required for the hosted app. (`DEMO_MODE` in `.env.example` is unused.)

### Local UI preview (protected Quick Tunnel)

Production stays on Vercel. To show the Next.js UI running on this machine to a specific person, use a protected Quick Tunnel. `npm run tunnel` always passes `--allowed-mail` and only forwards the UI (default `http://127.0.0.1:3000`). It refuses the OpenSky proxy ports (8787 and 8791).

```bash
# cloudflared 2026.9.3 or newer
# https://developers.cloudflare.com/tunnel/downloads/
export TUNNEL_ALLOWED_MAIL='colleague@example.com'   # or '*@example.com'
npm run dev      # terminal A
npm run tunnel   # terminal B — prints the trycloudflare.com URL
```

Repeat addresses as a comma-separated list. Quote domain rules so the shell does not expand `*`. Visitors do not need a Cloudflare account. Access ends when `cloudflared` stops. Quick Tunnels still have no uptime guarantee, a new hostname on every start, a cap of 200 in-flight requests, and no Server-Sent Events.

Use `npm run tunnel` rather than `wrangler tunnel quick-start`. Wrangler’s tunnel commands are experimental and do not apply this allowlist or the proxy-port refusal.

cloudflared 2026.10.4 has not fixed [cloudflare/cloudflared#1752](https://github.com/cloudflare/cloudflared/issues/1752): the PIN session can expire after a few seconds, and later document, style, and script requests redirect to `login.trycloudflare.com`. This app’s content security policy (`script-src 'self'`, `style-src 'self'`) then blocks those responses. Leave the policy unchanged and use the Vercel URL if the preview bounces back to the PIN page. Do not add `login.trycloudflare.com` to the content security policy.

On January 25, 2027, new cloudflared releases turn URL normalization on by default for ingress rules that require Cloudflare Access. This preview is a single catch-all origin with no Access ingress rules, so that default does not retarget requests. The path Next.js receives stays the original path. Named-tunnel ingress that checks Access should be tested with `--disable-path-normalization=false` before that date. This repo does not ship that kind of ingress.

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
