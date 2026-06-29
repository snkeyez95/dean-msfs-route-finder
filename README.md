# A Better Route Planner — v5.0.8

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
  index.html           frontend (HTML/CSS/JS — single file)
  main.js              Electron main process, IPC handlers, API proxy
  preload.js           contextBridge exposing APIs to renderer
  package.json         Electron app config and version
  CLAUDE.md            dev instructions (read automatically by Claude Code)
  README.md            this file
  start.bat            launch the app
  setup.bat            install Node dependencies (first run)
  update.bat           pull latest from GitHub and relaunch
  _updater.ps1         PowerShell updater script
  build.bat            electron-builder packaging (future)
  dean_msfs_debug.log  session log, fresh each launch (cookies redacted)
```

Config saved to: `%USERPROFILE%\.dean_msfs_v4.json`

---

## Debug Log

The app writes a session log to `dean_msfs_debug.log` in the app folder. Fresh each session. Cookies are redacted automatically.

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
