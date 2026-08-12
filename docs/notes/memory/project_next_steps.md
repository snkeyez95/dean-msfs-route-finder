---
name: project-next-steps
description: Current state and next steps for the MSFS Route Finder / ABRP app
metadata: 
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-08-12T02:24:39.322Z
---

> Keep this file CURRENT-STATE only. Full history lives in the roadmap plan
> `imperative-drifting-rain.md` + git log.

## ▶▶ CURRENT: v6.19.0 built + pushed 2026-08-11 (Dean released v6.18.0 and is running it)

Recent shipped work:
- **v6.19.0 — PMDG 777-300ER added as a first-class aircraft.** Three things a new aircraft needs, all
  now done: (1) ACTIVATION is pure filesystem — `pkgScanGroups` treats "any folder directly holding
  packages" as ONE activatable group, so **each aircraft needs its own subfolder** or it silently merges
  with its neighbour. `Documents\MSFS\Aircraft\PMDG\` is now split `737-800\` + `777-300ER\` (mirrors
  Fenix); liveries ride along automatically, `groupDeps` is only for cross-group base packs.
  (2) The 777 has its OWN benchmark label `PMDG 777` — critical because the title matchers are
  first-match-wins and the PMDG entry's bare `'pmdg'` term would otherwise log every 777 as the 737 and
  pollute its baseline/coverage/Scenery/Compare (and let SimBrief auto-TLOD write a 737 value to a 777).
  A one-shot `mig777Done` migration inserts it AHEAD of the PMDG entry. (3) Routes: `SI_ACFT_MAP` is the
  INGEST GATE — types absent from it are discarded and never stored, so B77W/B773 were added; **no 777
  route existed in the registry/snapshot/community file**, they accumulate from the next SI refresh.
- **v6.18.0 — VATSIM overlay rework**: UNICOM-gap next-up (now covers no-Center-at-all routes, not just
  gaps between Centers), chatter lines removed, next freq framed as a STANDBY slot, hover-expand live ATC
  chain with current-step highlight, and blink/chime only for ahead-of-aircraft controllers.

## Dean's flying (post-benchmark)
TLOD 125 recommendation stands (earned from 24 offline fixed-TLOD flights; **the 777 shows "collecting
0/12" and does NOT blank it** — `_blCompute` blends over aircraft that have data). Day-to-day he flies
VATSIM most flights + AutoFPS; those are logged/charted but quarantined from the grid. AutoFPS max was
300 → **450** as of the Aug 7 flight (parked at the 450 ceiling 60% of the flight, avg VRAM 10,584 MB,
GPU-bound 4%→24%, VRAM 98% on descent into payware KJFK — 450 is about the practical ceiling on 12 GB).

## Owed / next
- **[Dean] Tick "PMDG 777-300ER" in Settings → My Fleet** (added `def:false` on purpose), then let a
  route refresh run for 777 routes to appear.
- **[Dean] release.bat for v6.19.0**, then verify: two PMDG rows in Aircraft & Util; ticking 777-300ER
  junctions both its packages; a SimBrief 77W + Launch+Capture (no AutoFPS) announces "TLOD … for
  PMDG 777"; the flight files with `aircraft: "PMDG 777"`.
- The 20k snapshot stays frozen (Dean's 2026-07-06 call), so **777 routes live in the rolling registry
  only** — the published community_routes.json won't carry them unless that decision is revisited.
- A PMDG **777 radio adapter** is a separate future project: the 737 adapter correctly declines a 777
  title (the 777 SDK uses different event IDs), so Set-standby simply isn't offered on the 777.
