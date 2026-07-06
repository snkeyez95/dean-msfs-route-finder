# A Better Route Planner — v6.1.0

A Windows Electron desktop app for Microsoft Flight Simulator 2024. Scans your 3rd-party scenery folder, detects installed airports by ICAO code, fetches real scheduled airline routes via SayIntentions.AI, and provides flight planning tools powered by live weather.

**Workflow:** Find a real commercial route using airports you own scenery for → verify aircraft type → open pre-filled in SimBrief → fly with live ATC on SayIntentions.

---

## Features

- **My Airports** — Scans your MSFS scenery folder and auto-matches installed airports by ICAO code. Fuzzy fallback for non-standard folder names. Manual ICAO assignment for unmatched folders.
- **Plan a Flight** — Browse real commercial routes filtered by your fleet, airport library, region, airline, and duration. Live weather scoring on every route. Sort by duration, distance, or reliability.
- **Free Route Mode** — Search any departure/arrival ICAO pair, not limited to your library. Looks up airport names as you type, flags airports in your library. Falls back to a SimBrief button if no registry match found.
- **Trip Planner** — Paste a multi-leg itinerary (ICAOs or city names). Registry-aware disambiguation for ambiguous cities. Track legs with checkboxes, SimBrief button on every leg.
- **Challenging Approaches** — 20 curated technically demanding approaches worldwide with live METAR, wind guidance, scenery links, and real registry routes from your library airports.
- **Route Registry** — Rolling 21-day database of routes harvested from SayIntentions.AI. Auto-refreshes every 8 hours in the background.
- **Route Snapshot** — Permanent backup of all routes ever seen. Never pruned. Up to 20,000 routes. Exportable and re-importable.
- **Live Weather** — METAR data from aviationweather.gov for all relevant airports. Auto-refreshes every 30 minutes. Color-coded VFR / MVFR / IFR / LIFR scoring.
- **Live D-ATIS** — Real digital ATIS in the expanded route panel: the actual active runway, approach in use, and information letter, pulled from atis.info (US) and atis.guru (international). A built-in interpreter translates the cryptic report into plain English, with the full raw text one click away. Arrival data shows on the arrival airport, departure data on the departure airport.
- **SimBrief Integration** — One-click opens SimBrief pre-filled with airline, flight number, aircraft type, origin, destination, and callsign. When live D-ATIS is available, the active departure and arrival runways are pre-selected too.
- **Community Routes** — Download a shared route database from GitHub when you don't have a SayIntentions cookie yet.
- **Performance Logging** — A built-in engine captures real per-frame timing (via Intel PresentMon), VRAM, and system telemetry during a flight, then files a self-contained dashboard: frametime/FPS charts, stutter and variance breakdowns, phase-of-flight split, and VRAM headroom — all offline, no internet needed to view.
- **Baseline Recommendation** — Analyzes your fixed-TLOD benchmark flights and recommends one balanced Terrain-LOD setting that keeps both heavy aircraft (PMDG + Fenix) smooth with VRAM headroom, with Smoothest / Balanced / Best-visuals modes.
- **Maintenance Tools** — Dedicated tab: MSFS shader-cache cleaner, per-aircraft WASM cache cleaners (PMDG/Fenix), and NVIDIA Control Panel backup/restore — surfaced automatically when a sim update, GPU driver update, or aircraft update is detected.
- **GSX Pro Profiles** — Per-airport GSX profile detection with auto-install of bundled profiles and a flightsim.to fallback link.
- **Aircraft & Utility Activation** — Junction-based activation for aircraft and utility add-ons, so you can keep your Community folder slim for performance.
- **Companion Apps** — Optionally close background apps during a flight and reopen them when the sim closes, plus one-click launch of companion apps alongside MSFS.
- **Dark / Light theme** — Toggle in the title bar.

---

## Setup

**Requirements:** Windows 10/11, Node.js v18+

**First run:**
1. Double-click `setup.bat` to install dependencies
2. Double-click `start.bat` to launch the app
3. Go to **Settings → My Fleet** and check the aircraft you own
4. Set your scenery folder path in **My Airports**
5. Follow the SayIntentions cookie setup below to enable live route data

---

## SayIntentions.AI Cookie Setup

The app fetches real commercial route data from SayIntentions.AI. This requires a valid session cookie from your SayIntentions account.

**Getting your cookie (first time or after expiry):**
1. Open your browser and go to [sayintentions.ai](https://sayintentions.ai)
2. Sign in to your account
3. Press **F12** to open Developer Tools
4. Click the **Application** tab (Chrome) or **Storage** tab (Firefox)
5. In the left panel expand **Cookies** and click `https://p2.sayintentions.ai`
6. Find the cookie named **p2_session_id**
7. Click it and copy the entire value from the Value field at the bottom
8. In the app go to **Settings → Route Data Source**
9. Paste the value into the cookie field and click **Save Cookie**
10. Click **Refresh Routes** to do your first harvest

**Cookie expiry:** Cookies expire approximately monthly. When yours expires the app shows an amber warning banner at the top. Auto-refresh pauses automatically and resumes once a new cookie is saved.

**Auto-refresh:** Once your cookie is saved, check *Auto-refresh routes every 8 hours* in Settings. The app harvests new routes silently in the background three times per day, building temporal coverage across different traffic windows.

**Rate limiting:** SayIntentions rate-limits at approximately 30–36 pages per window with a 65-second reset. The app handles this automatically — it waits and resumes from where it left off. A full harvest takes approximately 6 minutes including wait times.

---

## Updating the App

Run `update.bat` to pull the latest version from GitHub and relaunch automatically. Verify by checking the version number in the bottom-right corner of the app.

---

## Route Registry

The app maintains a local database of routes saved to `%USERPROFILE%\.dean_msfs_v4.json`

- **Primary registry:** up to 5,000 routes, pruned to 21 days of activity
- **Snapshot registry:** permanent backup of all routes ever seen, never pruned, up to 20,000 routes
- Routes are deduplicated by SayIntentions route ID
- Registry grows automatically via auto-refresh and manual Refresh Routes runs

**Exporting and restoring:** In *Settings → Route Backup*, click **Export Snapshot** to save a JSON file. This file can be dragged onto the Manual Import zone to restore routes on any install.

---

## Community Routes

A Better Route Planner includes a community route database that allows users without a SayIntentions.AI cookie to get a full route database instantly.

**For users without an SI cookie:**
1. Go to **Settings → Manual Import**
2. Expand the **Community Routes** section
3. Click **Download Community Routes**
4. Routes merge into your registry immediately
5. Your **Plan a Flight** tab populates based on your installed scenery

The community database contains 10,000–20,000 real commercial routes covering major airports worldwide, with a focus on narrowbody operations (737 family, A320 family). It is updated automatically whenever the app owner runs a live route refresh and 50 or more new routes are captured.

You do not need an SI cookie to use the app. The community routes provide a solid baseline that works immediately after install.

If you have an SI cookie, your own live refreshes supplement and eventually supersede the community data through normal auto-refresh operation.

**For the app owner:** After each successful route refresh, `community_routes.json` is written to the app folder automatically and pushed to GitHub silently. You can also export manually via *Settings → Route Backup → Export to community_routes.json*, then run `publish.bat` to push.

---

## Manual Route Import

**Getting routes without a SayIntentions cookie**

1. Go to the **Settings** tab
2. Scroll down to **Manual Import**
3. Click the **▶ Community Routes** toggle to expand it
4. Click **Download Community Routes**

This pulls a shared database of 10,000–20,000 real commercial routes directly from GitHub and merges them into your registry immediately. No cookie required.

**Importing a snapshot from another install**

Drag and drop a `community_routes.json` or any exported snapshot file onto the drop zone in *Settings → Manual Import*. The app will merge routes and report how many were added.

---

## Weather System

Live METAR data is fetched from aviationweather.gov for all airports relevant to your route library. Auto-refreshes every 30 minutes.

| Score | Category | Color  | Meaning              |
|-------|----------|--------|----------------------|
| 0–2   | VFR      | Green  | Clear, uneventful    |
| 3–6   | MVFR     | Blue   | Some weather         |
| 7–12  | IFR      | Amber  | Challenging          |
| 13–18 | IFR      | Orange | Serious conditions   |
| 19+   | LIFR     | Red    | Extreme weather      |

Scoring factors include flight category, precipitation type, wind speed, gusts, and ceiling.

---

## My Fleet

In *Settings → My Fleet*, check the aircraft you own. This filters routes to only show flights operated by aircraft in your sim.

| Code | Aircraft            |
|------|---------------------|
| B738 | PMDG 737-800        |
| B737 | PMDG 737-700        |
| B739 | PMDG 737-900        |
| B38M | PMDG 737 MAX 8      |
| B39M | PMDG 737 MAX 9      |
| A319 | Fenix A319          |
| A320 | Fenix A320          |
| A20N | Fenix A320neo       |
| A321 | Fenix A321          |
| A21N | Fenix A321neo       |

---

## File Structure

```
DeanMSFS_v2/
  index.html            frontend (HTML/CSS/JS — single file)
  main.js               Electron main process, IPC handlers, API proxy
  preload.js            contextBridge exposing APIs to renderer
  package.json          Electron app config and version
  CLAUDE.md             dev instructions (read automatically by Claude Code)
  README.md             this file
  start.bat             launch the app
  setup.bat             install Node dependencies (first run)
  update.bat            pull latest from GitHub and relaunch
  publish.bat           push community_routes.json to GitHub
  release.bat           build installer + publish GitHub Release (auto-updater)
  _updater.ps1          PowerShell updater script
  community_routes.json shared route database (dev copy; published to GitHub)
  perf/                 performance-logging engine (Python engine + bundled PresentMon + chart libs)
    perf-engine.exe     the frozen capture engine (bundled into the installer)
    native/             Node port of the engine (in progress; replaces Python at v6)
    vendor/             bundled chart libraries (offline report rendering)
```

All writable user data lives in `%APPDATA%\A Better Route Planner\`:
`config.json` (preferences), `routeRegistry.json` + `routeSnapshot.json` (route data),
`Sessions\` (logged flights), `dean_msfs_debug.log` (session log, cookies redacted).

---

## Debug Log

The app writes a session log to `dean_msfs_debug.log` in the user-data folder (`%APPDATA%\A Better Route Planner\`). Fresh each session. Cookies are redacted automatically.

Key log prefixes:
```
[INFO ]           general info
[ERROR]           errors
[RENDERER] [WX]   weather system
[RENDERER] [SI]   SayIntentions operations
[SI]              route fetch operations
```

---

## Known Issues

- **KLAS duplicate:** two KLAS folders (airport + city scenery). Both valid, leave as-is.
- **GPU errors in cmd window:** harmless GLES3 errors visible in dev mode via `start.bat`. Disappear when packaged as `.exe`.
- **Active runway:** some airports don't return active runway data from aviationweather.gov. "Check ATIS" shown as fallback.

---

## Changelog

```
v6.2.2   GSX profile updates replace in place with no .bak copies (Dean request) — a newer bundled profile simply overwrites the installed one. The safety rules stay: identical files are left alone, and a profile that's newer than the scenery's copy is never overwritten
v6.2.1   GSX PROFILE UPDATES. The bundled-profile auto-install is now update-aware. Before, an airport whose GSX profile name already existed in your GSX folder was skipped entirely — so a scenery update shipping a NEWER profile silently kept your stale copy (real case: iniBuilds KJFK bundled a July 2026 .ini while the installed copy was from May 2025). Now every never-scanned scenery folder is checked regardless of install status, and when a bundled profile name-matches an installed one anywhere in the GSX tree: identical content = left alone, your copy newer (e.g. you tuned it) = never clobbered, scenery copy newer = updated in place plus a toast telling you. No flat duplicates are ever created for profiles living in GSX subfolders. Proven by a 7-check desk-test incl. a replay of the exact KJFK case
v6.2.0   LAB FINDINGS. The Settings Lab's data now becomes answers: a new 🧪 Lab view (fourth button next to Dashboard / Compare / Baseline) shows one Finding Card per experiment with a plain-English verdict banner — FREE UPGRADE (keep the prettier setting), REAL IMPROVEMENT (worth adopting), COSTS YOU (leave it), TRADE-OFF, or NO EFFECT. The honesty core: every metric delta (ground stutter, ground P99, overall P99, big spikes/hr, peak VRAM) is drawn as a diverging bar OVER a shaded band showing your normal flight-to-flight variation (±1 standard deviation of your own baseline flights) — a bar inside the band is honestly labeled "within noise", so "no measurable difference" is a real result, not spin. Each card overlays experiment vs baseline frametime lines in two auto-scaled fingerprint charts — "Ground phase only" (where stutter lives) and "Full flight" — with the x-axis normalized to % of flight so different routes compare fairly; chart data is cached per flight (~12 KB, built once from the raw capture, survives archiving, works on gzipped archives). Winning verdicts get an "Apply this setting" button: one click writes the value to UserCfg.opt (backed up + verified, sim must be closed) and makes it your new Lab baseline, with an adopted ribbon and un-apply. The old always-visible Lab panel shrinks to a one-line status strip (checkbox · next flight · progress dots · open Lab), and Compare's "Lab experiment" grouping now shows each experiment's verdict chip with a jump to the Lab. Proven by a 34-check suite: engineered SAVES/NO-EFFECT/COSTS/FREE verdicts, gzip-identical chart caches, byte-identical apply/un-apply round-trip, and a real-flight smoke (106-min KORD-KATL: cache in 0.8s, ground phase correctly isolated, flight logs untouched)
v6.1.0   THE SETTINGS LAB. After your 24-flight TLOD benchmark completes, a new checkbox unlocks in the Performance tab (greyed until then): check it and every Launch + Capture flight runs ONE curated settings experiment — the same way auto-TLOD worked — alternating with baseline control flights. v1 queue: volumetric clouds quality up (the "free visuals" test), off-screen terrain pre-caching down, glass-cockpit refresh down + up, Objects LOD down + up; photogrammetry-off is a manual-tag experiment (toggle it in-sim, mark the flight from the Lab panel). Experiment values are written to UserCfg.opt with the same backup + verify discipline as auto-TLOD, restored automatically on control flights and whenever you un-check the box — an experiment can never silently become your config. Lab flights are tagged and QUARANTINED from the baseline recommendation and benchmark grid, and the Compare view gains a "Lab experiment" grouping. Verdict cards appear as flights accumulate (experiment vs your 4 time-nearest matching baseline flights: ground stutter, ground P99, overall P99, peak VRAM, big spikes), marked preliminary until each setting has 2 flights. Unchecked = nothing runs, full manual control. Proven by a 20-check test suite against a copy of the real UserCfg (byte-identical restores, scheduler walk, quarantine math)
v6.0.1   The post-v6 polish wave (Fable review-hardened). WEATHER TRUTH: fixed a casing bug that had zeroed the VFR/IFR part of weather scoring and pinned category pills to VFR; airports now show how OLD their observation is (amber >90min, red >3h) and stale reports can't win best/worst-weather sorting; airports with no D-ATIS (most of the world) get a generated briefing from their METAR — wind, suggested runway, altimeter; US D-ATIS gained an automatic second source. PLAN RECOVERY: dashboard Recent Routes are clickable (reopens the full route panel) and Free Route falls back to your 20,000-route snapshot archive when SI no longer serves a pair; routes you've SimBriefed are protected from registry cleanup. NEW: third library mode "No library needed" shows every route with no scenery requirement; CapFrameX button converts all flights in one click; Export/Import My Setup (whole install in one small zip, validated + auto-backed-up on import); Archive Older Raw Captures (79% smaller in place, verified byte-for-byte, nothing deleted, newest 5 stay raw); expanding a route now aligns its header to the top of the view in all three route views. POLISH: real app icon at last; uninstaller offers a complete data cleanup (defaults to KEEPING flight logs; auto-updates never touch data); safer archive/import guards from a self-review pass (4 fixes)
v6.0.0   THE NATIVE ENGINE. The performance logger is now built into ABRP itself — pure Node, no bundled Python engine anymore (perf-engine.exe retired from the installer, ~10 MB smaller). Proven before the swap: byte-for-byte identical stats/reports/files against the old engine across all logged flights, then validated on a real KFLL–MMUN baseline flight where both engines measured the same P99 to the hundredth of a millisecond. New reliability the old engine never had: the capture self-heals through SimConnect drops mid-flight (a hiccup can no longer end or truncate a recording), waits up to 30 minutes for the sim to launch, survives PresentMon failing to exit on sim close (90-second SimConnect-dead backstop — caught in the wild on the validation flight), anchors flight-phase timing exactly at recording start, and writes its own native_capture.log for visibility. Also in this release: ACTIVE-FLIGHT PROTECTION — routes you've sent to SimBrief can no longer be deleted by the background route refresh's cleanup (that vanished a planned flight mid-session once; fixed and shielded). Plus the full-app deep-audit fixes: crash-safe (atomic) config and route-data writes, escaped remote route text, a junction-removal safety guard, safer archive handling, and packaging that correctly ships PresentMon and the SimConnect libraries.
v5.9.44  Capture reliability fix. The performance logger could quit itself mid-arming — before you ever took off — if Windows briefly failed to see the MSFS process during a heavy flight load, falsely concluding "the sim closed" (this cost a real 76-minute capture). It now confirms the sim is alive by whether it can reach SimConnect (the sim's own data link), which is impossible unless MSFS is actually running, and only gives up after that link stays unreachable for a sustained 90 seconds. A transient hiccup during loading can no longer abort a real flight.
v5.9.43  Baseline table now highlights the exact metric(s) that failed a TLOD in red — e.g. TLOD 175's consistency (under 99%) and peak VRAM (over the ceiling) light up red so you see at a glance what tripped the "fail", with a hover tooltip naming each limit. Also fixed garbled dashes in release.bat (em-dash rendered as mojibake in the console) — now plain hyphens
v5.9.42  Baseline view wording: the "how this was built" line now reconciles with the benchmark count — "16 of your 18 benchmark flights — 2 ran on a different GPU driver (your baseline is 566.36), left out so it's apples-to-apples" — instead of a confusing "4 excluded" that didn't match the 18/24 on screen. Replaced the engineering jargon "knee" with plain "best balance" throughout. Recommendation logic unchanged
v5.9.41  New Performance → Baseline view: one blended TLOD recommendation — your best single global setting that keeps BOTH heavy planes (PMDG + Fenix) smooth with VRAM headroom (lighter aircraft only do better). Built from a clean subset (modal driver, in-grid TLODs, no reference aircraft, non-AutoFPS — fixes the all-vs-all confound trap), blended worst-of-the-two so it's safe for both. One headline number, with an optional expand for the 3 modes (Smoothest / Balanced / Best-visuals), per-plane knees, the supporting metric table, and honest caveats (driver used, excluded flights, sim-version seam, VRAM route-noise). Shows benchmark progress (X/24) and firms up as cells reach 3 flights. Reads TLOD 125 at 18/24 (PMDG outliers; will likely rise toward 150 as the last cells fill). The msfs-flight-analysis chat skill uses the same spec
v5.9.40  Performance + housekeeping. Route data (the rolling registry + 20,000-route snapshot) now lives in its own routeRegistry.json + routeSnapshot.json instead of inside config.json. Before, every settings save rewrote the entire ~16 MB config (route blob and all); now a settings save writes ~18 KB — 926x smaller — and route saves only touch their own file. One-time automatic migration on first launch, lossless (validated: 3,268 registry + 20,000 snapshot entries preserved, all preferences intact). Also cleared ~335 MB of regenerable build cruft from the working tree
v5.9.39  Decluttered Settings: the three maintenance tools (Shader Cache Cleaner, Aircraft WASM Cache, NVIDIA Control Panel backup/restore) now live in their own Maintenance tab in the left nav (just below Settings) instead of stacked on the Settings page. The version-change banner's "Open Maintenance" button opens the new tab
v5.9.38  New Settings → MSFS Maintenance → NVIDIA Control Panel Settings: Back up / Restore buttons (ports the old TLOD backup_nvidia_settings.bat / restore_nvidia_settings.bat). Back up copies the two driver .bin files — your global 3D settings + all game profiles incl. MSFS — from C:\ProgramData\NVIDIA Corporation\Drs into ABRP's data folder, archiving any previous backup with a timestamp; Restore copies them back (reboot to apply). Shows the last-backup time. Needs ABRP running as Administrator
v5.9.37  The version-change watcher now also monitors your PMDG & Fenix aircraft versions (read from each package's manifest.json in your aircraft library; liveries excluded). When PMDG or Fenix pushes an update, the launch banner recommends cleaning that aircraft's WASM — the right move to avoid stale-cache crashes after an aircraft update. Sim/driver detection unchanged
v5.9.36  New: version-change watcher. On launch ABRP reads your current GPU driver (nvidia-smi) and MSFS Steam build id, and if either changed since you last opened the app, a banner recommends clearing the right caches — a Sim Update suggests shader cache + PMDG/Fenix WASM; a driver update suggests shader cache only. "Open Maintenance" jumps straight to the cleaners. First launch seeds silently (no false prompt)
v5.9.35  New Settings → MSFS Maintenance → Aircraft WASM Cache: separate "Clean PMDG WASM" and "Clean Fenix WASM" buttons (distinct from the shader cleaner). Each rebuilds that aircraft's compiled WASM modules — the fix for stale-cache CTDs / "orange screen" after a Sim Update or aircraft update — while PRESERVING your saved aircraft state (the "work" folder: panel states, options, airframe hours). Guards against running with MSFS open, and the panel explains WHEN to use it (after a Sim Update, or a PMDG/Fenix update if crashing — not for driver updates). Verified on this PC that it keeps the work folder
v5.9.34  Shader Cache Cleaner: added NVIDIA ComputeCache (Roaming\NVIDIA\ComputeCache) — spotted by comparing against a flightsim.to cache tool — and broadened the NVIDIA sweep to catch DXCache / GLCache / ComputeCache / NV_Cache across all four roots (Local\NVIDIA, Local\NVIDIA Corporation, Roaming\NVIDIA, LocalLow\NVIDIA). Now clears the complete set of GPU + MSFS shader caches
v5.9.33  Shader Cache Cleaner corrected after verifying against NVIDIA's documented procedure: (1) it now finds NVIDIA's DXCache wherever it lives — newer drivers put it under LocalLow\NVIDIA\PerDriverVersion (164 MB on this PC), which the original .bat missed (it only checked Local\NVIDIA, which is empty here). It now sweeps BOTH roots for DXCache/GLCache. (2) The dialog now shows the correct TWO-reboot procedure — disable NVIDIA Shader Cache → REBOOT (releases the locked cache so it can actually be deleted) → close apps → clear → re-enable → REBOOT again
v5.9.32  Shader Cache Cleaner: the confirm dialog now carries the full pre/post checklist from the original .bat — the 6 "before" items (disable NVIDIA Shader Cache, close MSFS/AutoFPS/REX/overlays/Steam) and the 4 "after" steps including re-enable NVIDIA Shader Cache and REBOOT. The condensed note still shows in the panel
v5.9.31  New Settings → MSFS Maintenance → Shader Cache Cleaner: one button clears the MSFS / NVIDIA / DX12 / Steam shader caches (7 locations, ported from Clear_MSFS2024_ShaderCache.bat). Guards against running while MSFS is open, reports what it cleared, and shows the before/after manual steps (disable + re-enable NVIDIA Shader Cache, reboot). The auto-prompt when a sim or driver version change is detected comes next
v5.9.30  Companion Apps: new per-app "close on sim exit" checkbox — tick it on any companion you launch (Navigraph Charts, vPilot, etc.) and ABRP auto-closes it when MSFS closes. Works whether you start via Quick Launch or Launch + Capture (it folds into the same sim-close watcher that reopens your background apps)
v5.9.29  Fix: re-arming a capture (e.g. hitting Arm Capture after a Launch + Capture had already closed your apps) no longer wipes the app-reopen list. The close now MERGES with the existing saved list instead of overwriting it — so a re-arm that finds nothing left to close keeps your original apps queued to reopen. (Found when a salvaged flight left apps closed and none came back.)
v5.9.28  Plan a Flight (from the audit): region filters expanded from just Europe + North America to the whole world — added Central America, South America, Asia, Middle East, Africa, and Oceania, each mapped by ICAO region prefix. The mapping is now data-driven so it's easy to extend
v5.9.27  CRITICAL fix: the v5.9.26 auto-quit checked whether MSFS was running via psutil, which returned a false negative (couldn't read the process name) and wrongly quit the capture ~15s into normal flight loading — killing a real flight's capture. Switched to the reliable tasklist check (the same method the rest of the app uses) plus a 3-second re-check, so a loading flight can never be aborted. Rebuilt perf-engine.exe
v5.9.26  Engine update pass (rebuilt perf-engine.exe): (1) the capture engine now auto-quits if you arm a capture but close the sim without flying — no more lingering engines piling onto a later flight; (2) the engine log no longer floods with benign "SIM def" SimConnect retries during flight load, so it's actually readable; (3) the engine writes its status so the title-bar badge can show amber "Capture armed" vs red "Recording". Validated the rebuilt engine runs and the new logic behaves; the live capture path confirms on your next flight
v5.9.25  Fix: the Compare view's "group by" / "holding" dropdown menus were grey-on-grey and unreadable when open — they now theme with the app (dark popup in dark mode, light in light mode)
v5.9.24  New "Compare" view in the Performance tab (button next to Dashboard): group your logged flights by aircraft, sim version, GPU driver, or TLOD and see the key metrics — P99 frametime, stutter, consistency, avg + peak VRAM — averaged per group, with the best in each marked ★. Defaults to Fenix vs PMDG. Use the "holding" filters to lock aircraft + TLOD constant so a sim/driver comparison stays apples-to-apples. Reads only the small per-flight summaries, so it keeps working after you clean up large raw capture files; the chat flight-analysis skill still handles narrative deep-dives
v5.9.23  A global "● Capture" badge now appears in the title bar (next to Launch MSFS) whenever a performance capture is running — visible from any tab, so you can always see logging is live, and watch it clear when a capture ends (a visual confirm of the auto-quit). Click it to jump to the Performance tab. The close-ABRP confirmation also fires when a capture is active now, and is clearer that closing ABRP does NOT stop logging (it keeps running and files on sim-close). The badge will gain "armed vs recording" detail once the engine writes its status (next engine update)
v5.9.22  Reliability: only one capture engine runs at a time. Arming captures repeatedly without flying left engines waiting, and they all fired on your next takeoff and collided over the temp capture file + PresentMon (one still captured fine, but it logged a burst of errors). ABRP now clears any existing capture engine + leftover PresentMon before arming a fresh one. (Found during the deep review of the KPHL-KBOS flight.)
v5.9.21  Moved the one-click "Launch + Capture" button to where it belongs — right beside Quick Launch on each route card in Plan a Flight (and the other route lists), not the Performance tab. Same size as Quick Launch with a subtle accent tint to tell them apart. Open the route in SimBrief first so auto-TLOD can read the aircraft
v5.9.20  Phase 3 — new one-click "Launch + Capture" button on the Performance tab. It auto-sets the next benchmark TLOD for your SimBrief aircraft (runs the engine's --prep-next, the SAME coverage model that draws the tracker, so the value matches; UserCfg.opt is backed up first), closes your checked background apps, launches your companion apps, launches MSFS, and arms the capture — your apps reopen when the sim closes. It reports the TLOD it set (e.g. "TLOD 175 for Fenix") so you can confirm it matches the tracker's next-flight cell. Plain Arm Capture and Quick Launch are unchanged. (Status indicator + armed-but-never-flown cleanup coming next.)
v5.9.19  Two small fixes: (1) Multi-instance apps now all reopen — if you run two of the same app off one .exe (e.g. Radarr + Radarr-4K), the reopen relaunches each Startup shortcut instead of just one. (2) Fresh Routes: a route you send to SimBrief now stays visible in Plan a Flight for the rest of the session so you can still reference it, and only starts hiding next launch (it still appears in the dashboard recent list right away)
v5.9.18  Fix: the close step now records ALL your apps' locations again, not just one. v5.9.16 read each app's path via a property that throws "access denied" for elevated/service apps (Plex, the *arr suite), silently dropping them — so only 1 of 7 got saved and only 1 reopened. Reverted to reading the path via the system process table (the method that captured them all), with the property read kept only as a safe fallback. The reopen half was already working
v5.9.17  Real fix for the installer's "cannot be closed — Retry" prompt. The v5.9.15 attempt hooked a macOS-only event that never fires on Windows; this sets the fast-exit flags directly where the in-app "restart to install" triggers, so ABRP skips its slow on-quit cleanup and exits before the installer checks. Takes effect once the running app being replaced already has this (i.e., from the update after this one)
v5.9.16  THE reopen fix: apps now reliably reopen after the sim closes. Root cause was Windows PowerShell 5.1 collapsing the saved app list to a single entry when reading it back (a 5.1 ConvertFrom-Json quirk), so only one app ever reopened — and it went unnoticed because the dev tests ran in PowerShell 7. ABRP now handles the saved-app data in Node (reliable on every Windows/PowerShell version) and uses PowerShell only to do the actual close and relaunch. Built to work on any Windows machine, not just this one. Validated in real PowerShell 5.1
v5.9.15  Fix: the installer's "A Better Route Planner cannot be closed — Retry" prompt during an update. When the auto-updater restarts ABRP to install, it now exits immediately (skips the close-confirm dialog and the on-quit scenery cleanup) so the installer doesn't catch it still shutting down. Takes effect for updates after this one
v5.9.14  Fix: reopen was relaunching zero apps (regression in v5.9.13 — relaunching with the captured command-line arguments made the launch throw). Reverted to the proven method: a Startup shortcut when the app has one, otherwise a plain exe-path launch (no arguments). Still skips already-running apps, and now logs the exact per-app outcome so any remaining issue points to the specific app
v5.9.13  App reopen no longer depends on Startup shortcuts: it now relaunches each app exactly how it was running (captured exe path + command-line arguments), so apps without a Startup shortcut come back correctly too. Also skips any app that's already running (prevents duplicate instances / port clashes); the Startup shortcut is now only a last-ditch fallback
v5.9.12  Fix: the "reopen apps after the sim closes" step now actually works — it relaunches apps through their Startup shortcut when there is one (apps like Plex and the *arr suite only restart correctly that way, matching what record_clean.bat does), falling back to the saved exe path, and logs how many paths were saved/reopened
v5.9.11  Phase 3 (part 2): the "Apps to close during flight" checkboxes now actually work — hitting Arm Capture closes your checked apps (by their mode) and ABRP reopens them when the sim closes (and kills "close only after sim" apps like Steam then). A safety net reopens anything still closed on the next ABRP launch. This makes Arm Capture a full record_clean.bat replacement (close → capture → reopen) — so don't run record_clean.bat alongside it
v5.9.10  The "Detect running apps" button now toggles the list open/closed (was open-only) and relabels to "Hide list" while open
v5.9.9   Settings tidy-up: the "Apps to close during flight" list is now two columns and sits up top right under Route Data Source, and every Settings section header is now click-to-collapse (state remembered). Drag-to-reorder sections is next
v5.9.8   Phase 3 (part 1): new "Apps to close during flight" section in Settings — choose which background apps get closed before a logged flight and how (close & reopen / close, don't reopen / close only after the sim), plus a "Detect running apps" picker. Seeded from your record_clean setup and fully editable. Config-only for now; the actual close/reopen wires into one-click Quick-Launch capture next
v5.9.7   Phase 2 close-out: PresentMon is now bundled inside the engine exe (capture is fully self-contained — no external tools or Python needed), and ABRP now shows a "MSFS is running — confirm close?" prompt if you close it mid-flight (your capture keeps running regardless, since it runs detached). Phase 2 done: ABRP bundles and starts performance captures on its own
v5.9.6   Phase 2: the performance logger is now a bundled, Python-free engine. Built perf-engine.exe (PyInstaller, with SimConnect / VRAM / system-telemetry baked in) and ship it outside the app archive so ABRP can run it directly — this fixes "Arm Capture" doing nothing in the installed app (the script was sealed inside app.asar and the Windows-Store Python couldn't launch it). Arm Capture now starts the bundled engine
v5.9.5   Phase 2 (part 1): ABRP can now start a performance capture itself. New "Arm Capture" button on the Performance tab launches the logging engine headless + auto-start — it records when your aircraft begins its takeoff roll and files automatically when you close the sim, running detached so closing ABRP doesn't stop it. Engine gains a --headless mode (no console window). Still uses your system Python for now; the bundled, install-free engine comes next
v5.9.4   Offline charts: the 3 chart libraries the per-flight reports used to fetch from the internet (Chart.js, hammer.js, chartjs-plugin-zoom) are now bundled with the app, so report charts render with no internet connection (and load a touch faster). Existing reports repointed in place; the app seeds the libraries into your data folder automatically
v5.9.3   Polish: the embedded performance reports now follow ABRP's own light/dark theme — toggle the app's theme and the dashboard/report flip with it (no more separate blue-themed report when the app is dark). Existing reports updated in place; new captures get it built in
v5.9.2   Polish: the embedded performance reports now use a slim, theme-aware scrollbar that stays hidden until you mouse over it (matching ABRP's dark style) instead of the chunky default gray one — it adapts to the report's own light/dark too. Existing reports updated in place; new captures get it built in
v5.9.1   New: Performance tab — your MSFS smoothness dashboard now lives inside ABRP. Opens straight to your combined dashboard (TLOD-vs-smoothness and VRAM charts, the coverage/"fly next" tracker, and the flight table); click any flight in that table to view its full report — charts, phases, VRAM — embedded right in the app. A Dashboard button returns you to the overview, and an open-in-browser button is there if you want it. Groundwork for folding the standalone performance logger into ABRP (engine relocated under perf/, flight data stored in your AppData folder)
v5.8.5   Fix: Trip Planner SimBrief calls now logged (dep/arr visible in debug log for future diagnosis). City resolver now explicitly maps Munich→EDDM, Frankfurt→EDDF, Dusseldorf→EDDL, Cologne→EDDK, Stuttgart→EDDS rather than relying on AI lookup fallback
v5.8.4   Fix: weather went all-N/A once your library passed 400 airports (aviationweather caps a request at 400) — the batch now chunks and merges, and the scored block always matches the live METAR shown. New: "Fresh routes" toggle on Plan a Flight hides city pairs you've flown recently, either direction (now remembers your last 30 SimBrief flights; dashboard shows 10)
v5.8.3   METAR and D-ATIS now show a "· X min ago" freshness stamp (amber if unusually old) so you can see at a glance you're looking at the most recent observation, not stale data
v5.8.2   Free Route "no match" results now look like a normal route card — Open in SimBrief sits in the action row beside FlightAware / SkyVector / Quick Launch, and the "no scheduled routes" note moves to the bottom
v5.8.1   Free Route "No registry match" panel now has Quick Launch and the scenery Activate control, same as Plan a Flight — activate airport scenery (and the aircraft bundle, when it's a PMDG/Fenix) before launching; the Citation links scenery only, no aircraft junction needed
v5.8.0   Free Route "No registry match" now shows live weather for your departure & arrival — active runway, D-ATIS, METAR and wind — the same panel as matched routes (minus flight info). Helps when flying planes with no scheduled routes, e.g. the Citation Sovereign+
v5.7.7   Free Route adds an Aircraft picker (sourced from My Fleet) that filters routes to the plane you're flying and pre-fills SimBrief — including Marketplace planes with no scheduled routes, e.g. the new Citation Sovereign+ (C680). Plan a Flight is unchanged
v5.7.6   Only one copy of the app can run at a time (prevents a two-instance race that wiped active add-ons); and closing the app no longer clears scenery/aircraft while MSFS is running, so add-ons reliably reach the sim
v5.7.5   Quick Launch now delays MSFS by 5 seconds while companion apps still start immediately, avoiding a sim-startup conflict with another tool
v5.7.4   Fix: D-ATIS/METAR in an expanded route no longer goes blank after switching tabs and back (the panel re-hydrates from cache on every re-render); auto-refresh now survives PC sleep — replaced the single 8-hour timer with a minute-by-minute wall-clock check that self-reschedules, so it no longer ends up "past due" without firing
v5.7.3   Scenery and aircraft activations now auto-clear when the app closes — both start unchecked next launch (utilities stay active; only real junctions removed, never installed folders)
v5.7.2   Quick Launch companion apps now accept .bat / .cmd scripts (run via cmd from their own folder, console hidden), not just .exe
v5.7.1   SimBrief now pre-fills the active runways from live D-ATIS (origrwy/destrwy) — departure airport's departure runway and arrival airport's landing runway
v5.7.0   Live D-ATIS in expanded route panels — real active runway, approach & info letter from atis.info (US) / atis.guru (intl), with a plain-English interpreter; arrival/departure data routed to the correct airport; Plan a Flight, Free Route & Trip Planner
v5.6.3   Aircraft group dependencies — mark that one group "requires" another (e.g. Fenix 319/321 needs the 320 base); activating it auto-links the required group too
v5.6.2   Add utilities from the Aircraft & Util tab — drop a folder or .zip/.rar/.7z (or browse) to copy it into your Util library
v5.6.1   Plan a Flight "Activate" now also links the route's aircraft bundle (matched by type) alongside scenery
v5.6.0   Aircraft & Utility activation — junction add-on bundles into Community on demand (new Aircraft & Util tab; folder-defined groups; per-item utility toggles; symlink-only safety)
v5.5.7   Settings reordered — GSX Pro moved above Route Backup / Manual Import
v5.5.6   GSX drag-and-drop now accepts .rar / .7z archives (via 7-Zip or WinRAR); clear message if no extractor is installed
v5.5.5   GSX column filter dropdown (All / Installed / Missing); existing Show dropdown relabeled to "ICAO Matched / Unmatched" for clarity
v5.5.4   ICAO names now resolve correctly (aviationweather "name" field); code after "airport" keyword is auto (not guess); saved rows backfill names on launch
v5.5.3   Better ICAO detection (reads code after "airport" keyword, validates against aviationweather.gov); correct flightsim.to GSX link format
v5.5.2   Settings → GSX Pro: "Recheck GSX profiles" button — clears the cache and forces a full re-scan
v5.5.1   GSX status cached per scenery folder — no re-scan every launch; only new scenery is deep-scanned, removed scenery pruned, manual Scan Now forces a full recheck
v5.5.0   GSX Pro profile status in My Airports — installed badge, flightsim.to search link, auto-install of scenery-bundled profiles, drag-and-drop install
v5.4.2   Remove runway compass SVG — text-only wind and active runway display
v5.4.1   Runway compass redesigned — dark instrument panel style, high contrast in all themes
v5.4.0   Wind & runway compass visual in route expansion panel, dynamic runway data fetch
v5.3.1   Fix map dot alignment (correct projection), republish with working map
v5.3.0   Dashboard map shorter, airport dots halved, expand-route scrolls header to top
v5.2.1   Data folder renamed to "A Better Route Planner" (auto-migrates existing data)
v5.2.0   Route fetch now retries on 502/504 gateway errors (was stopping mid-refresh)
v5.1.0   All user data consolidated under AppData, build-path file-lock fix
v5.0.9   Version display consistency across title bar, sidebar, footer
v5.0.8   Windows-style title bar buttons on right
v5.0.7   Auto-updater for installed .exe, release.bat for publishing new versions
v5.0.6   Quick Launch fires MSFS + all companion apps instantly, silent direct MSFS exe launch
v5.0.5   Rename to A Better Route Planner, sidebar brand updated`nv5.0.4   Clickable airport dots on dashboard map — popup shows city and scenery developer
v5.0.3   World map upgraded to 50m resolution, thicker neon glow, richer gradient background
v5.0.2   Real world map using Natural Earth 110m data (world-atlas + topojson-client)
v5.0.1   Neon glow world map, Both-airports mode default, scenery checkboxes as junction activators, SimBrief route tracking on dashboard
v5.0.0   Full redesign: sidebar nav, dashboard map, fleet+companion panes, scenery checklist, partial activation
v4.5.40  Last v4 release — Quick Launch companion apps, git-pull updater (tagged v4.5.40-stable)
v4.5.39  Fix override panel collapsed by default, remove unused Steam exe field
v4.5.38  Sim Integration redesign: silent auto-detect on launch, status display, no input fields
v4.5.37  Auto-detect MSFS install (Steam/Store), pre-fill Community folder + launch method
v4.5.36  Scenery activation (junction points) + Quick Launch Steam bypass
v4.5.35  Remove SI API endpoint URL from README
v4.5.34  Auto community_routes.json export + silent GitHub publish, publish.bat
v4.5.33  Smart disambiguation with registry-aware route counts, 21-day pruning
v4.5.32  Trip Planner — paste itinerary, resolve ambiguities, track legs with checkboxes
v4.5.31  Free Route mode — search any ICAO pair, not limited to your library
v4.5.30  Snapshot export fixed filename, cap raised to 20,000 routes
v4.5.29  Handle ECONNRESET and network errors in fetch retry logic
v4.5.28  Remove rate limit diagnostic UI
v4.5.27  Community Routes download, update available banner
v4.5.26  Challenging Approaches real routes from library airports
v4.5.25  METAR scope optimization, sort by reliability
v4.5.24  Route snapshot backup, cookie expiry detection, auto-refresh indicator
v4.5.23  Expanded route weather refresh fix
v4.5.22  Empty SI response detection
v4.5.21  Light/dark theme toggle
v4.5.20  Auto-refresh every 8 hours, progress panel, 21-day pruning
v4.5.19  Smart 503/429 retry with live countdown
v4.5.18  Rate limit handling rewrite
```

---

## Credits

- Route data: [SayIntentions.AI](https://sayintentions.ai)
- Weather data: [aviationweather.gov](https://aviationweather.gov)
- D-ATIS data: [atis.info](https://atis.info) (US), [atis.guru](https://atis.guru) (international)
- Charts: [SkyVector](https://skyvector.com)
- Flight planning: [SimBrief](https://simbrief.com)
