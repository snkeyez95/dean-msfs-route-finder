---
name: scenery_static_config_check
description: "How to run Dean's per-airport 'static aircraft + settings' scenery check (recurring request)"
metadata: 
  node_type: memory
  type: reference
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-07-21T00:09:51.102Z
---

Dean periodically asks to "check for static aircraft and other settings" on his newest/updated
payware airports (scenery folder: C:\Users\MultiBotPC\Documents\MSFS\Scenery). The recipe:

**Match ICAO → folder** (dev-prefixed, e.g. inibuilds-airport-kord-chicago, flytampa-airport-lgav-athens).

**Per airport, read:**
- `manifest.json` → `package_version` + `release_notes` = the ONLY real "did it update?" signal.
  Some devs (FlyTampa, MK-Studios) bake dated changelogs; iniBuilds/DRS often leave them blank.
  MSFS keeps NO scenery update log; `ContentInfo/*/ContentHistory.json` is just a content list
  (revision 1), NOT a version history. On-disk mtime is unreliable (a batch install stamps them all
  the same day). So: compare package_version to the dev's latest release to know if it's current.
- **iniBuilds airports ship `scenery_config.json`** with a `configurable_options` array — each option
  has name, `perf` (low/medium/high), `defaults_to`, and toggles by RENAMING a BGL (.bgl ↔
  .bgl.disabled). THIS is the static-aircraft/clutter/GSE/people toggle set. (KJFK has a real
  "Static Aircraft" perf=medium option; KORD's are all cosmetic low-perf.)
- Other devs (FlyTampa, MK-Studios, DRS/Aerosoft) usually BAKE statics into the scene BGL or into
  Scenarii/*.spb world-scripts (MK-Studios calls parked planes "Civilian_*") — no clean user toggle.
- DRS/Aerosoft airports may ship TWO VDGS variants (Aerosoft VDGS vs GSX VDGS folders) — pick the one
  matching the user's setup (GSX if they run GSX).

**VERIFY against https://sceneryaddons.org** — Dean's preferred source. Its front page lists each
addon's LATEST version (compare to installed package_version to confirm current) and each airport's
product page lists the removable-content options WITH performance ratings (low/medium). Verified
2026-07-20 that the site's option list matches the local scenery_config.json exactly.

**Flipping method (CORRECTED — verified 2026-07-20):** iniBuilds provides these as MANUAL .bgl renames
(x.bgl → x.bgl.disabled), NOT an iniManager configurator (the site states "configuration requires
manual file renaming"). Rename alone is the supported path; if MSFS 2024 nags about a content
mismatch, layout.json can be rebuilt. NEVER edit payware packages without Dean's explicit go
(outside the project folder; his safety rule). KJFK medium-impact removables = Static Aircraft
(kjfk-scene-statics.bgl), General Clutter (kjfk-scene-gen_clutter.bgl), GSE, 3D People.

**Why it matters for Dean:** 12GB VRAM, arrival-taxi is his VRAM-peak phase; disabling Static Aircraft
at big hubs (esp. if flying AI/online traffic, which makes scenery statics redundant) is a real VRAM
lever. See [[dean_colorblind]] is unrelated; relevant perf context in the roadmap AutoFPS notes.
