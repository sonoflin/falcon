# Encoded screening criteria (internal notes)

Derived from Falcon Field Airport public noise abatement guidance (revised 11/04/2024) and helicopter-only guidance. Procedures are voluntary. Do not paste this document into the public UI.

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
- Downwind: keep close — about ¾–1 statute mile

## Quiet / avoid repetitive ops

- 22:00–05:30 Arizona time: avoid repetitive operations / touch-and-goes in terminal airspace

## Departures

- Climb at best rate to at least 2,400 ft MSL
- Prefer calm-wind runways 4L/4R (NE corridor over Longbow golf / industrial / Salt River)
- Training often uses 4L/22R when available
- When tower closed, 4L/22R typically closed

## Helicopters

- Maintain 1,900 ft MSL within 2 NM
- Remain east of Roosevelt Irrigation Canal (west of runways)
- No repetitive training 22:00–05:30
- Prefer published helicopter routes when in Class D (Yankee/Gecko/Snake/Cactus Two)

## How the app maps these

See `src/lib/analysis.ts` and `src/lib/constants.ts`. UI copy stays operational (altitudes, times, distances) without program branding.
