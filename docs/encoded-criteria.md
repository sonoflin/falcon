# Encoded screening criteria (internal notes)

Derived from Falcon Field Airport public noise abatement / Fly Friendly guidance (rev 11/04/2024), Chart Supplement quiet-hours language, and helicopter-only guidance **PDF 49031**. Document **49055** is the Noise Abatement Task Force materials — do not cite it as the heli route PDF.

Procedures are **voluntary**. Do not paste this document into the public UI as regulatory text.

## Pattern altitudes (MSL)

| Category | MSL | AGL (approx) |
| --- | --- | --- |
| Large turbine | 2,900 ft | 1,506 ft |
| Small piston | 2,400 ft | 1,006 ft |
| Helicopter | 1,900 ft | 506 ft |

Field elevation used: ~1,394 ft MSL.

## Traffic pattern

- Left traffic: 4L / 22L (with tower-closed exceptions)
- Right traffic: 4R / 22R
- Downwind: keep close — about **¾–1 statute mile** (Chart Supp: ~¾ mi from **runway end**)

## Quiet / avoid repetitive ops

- **22:00–05:30 Arizona** time (= **0500–1230Z** Chart Supplement): avoid repetitive operations / touch-and-goes / training in terminal airspace
- App codes: `NIGHT_REPETITIVE` (≥2 circuit/approach cycles); `QUIET_HOUR_ACTIVITY` (presence without clear repetition)

## Departures

- Climb at best rate to at least 2,400 ft MSL (Vy itself is not measurable from ADS-B)
- Prefer calm-wind runways 4L/4R (NE corridor over Longbow golf / industrial / Salt River)
- Training often uses 4L/22R when available
- When tower closed, 4L/22R typically closed
- App may soft-flag SW (22) / early residential turnout as `NON_PREFERRED_DEPARTURE` with wind/ATC disclaimer (no wind data → calm-assumed, low severity)

## Helicopters (PDF **49031**)

- Maintain 1,900 ft MSL within 2 NM
- Remain east of Roosevelt Irrigation Canal (west of runways) — screen only **adjacent to runway latitudes**, not all west of a longitude line
- No repetitive training 22:00–05:30
- Prefer published helicopter routes when in Class D (Yankee / Gecko / Snake / Cactus) — app uses soft corridor approximations (`HELI_ROUTE_SOFT`)

## How the app maps these

See `src/lib/analysis.ts` and `src/lib/constants.ts`.

### Airport identity (KFFZ vs KIWA)

Screening lists are **Falcon Field (KFFZ) only**. Mesa Gateway (KIWA / IWA) is ~10 NM south and must not appear as FFZ traffic.

- OpenSky flight lists use `airport=KFFZ` (arrival + departure).
- After tracks load, `isKffzLocalTrack` requires closest approach ≤ ~4 NM of KFFZ ARP and rejects tracks closer to KIWA’s terminal area than to KFFZ.
- ADS-B.lol fallback searches ≤ ~8 NM of KFFZ (below KFFZ–KIWA separation) and applies the same dual gate.

### Finding codes

| Code | Intent |
| --- | --- |
| `BELOW_PATTERN_ALT` | Low on downwind/abeam only (final/base excluded) |
| `SLOW_DEPARTURE_CLIMB` | Still below climb target beyond ~1.5 NM |
| `WIDE_PATTERN` | Lateral offset from runway centerline ≳ ~1.1 SM |
| `NIGHT_REPETITIVE` | ≥2 quiet-hour circuit/approach cycles |
| `QUIET_HOUR_ACTIVITY` | Quiet-hour presence, not clearly repetitive |
| `LOW_OVER_MESA` | Low over Mesa outside preferred NE corridor |
| `NON_PREFERRED_DEPARTURE` | SW / early turnout vs calm-wind preference |
| `HELI_LOW_NEAR_FIELD` | Heli below 1,900 within 2 NM |
| `HELI_WEST_OF_FIELD` | West of canal adjacent to runway lats |
| `HELI_ROUTE_SOFT` | Soft miss vs approx published corridors |

### Explicit non-goals (not detectable from ADS-B)

- Power setting / RPM / blade slap
- Vy specifically (best-rate climb)
- PAPI / visual glidepath compliance
- Hover time
- ATC clearances or wind justifying runway / turnout

UI framing: **screening flags / review candidates** — never “violators.”
