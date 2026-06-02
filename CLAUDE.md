# CLAUDE.md — Dean's MSFS Route Finder

This file is read automatically at the start of every Claude Code session.
Do not delete or rename this file.

---

## Project Overview

Dean's MSFS Route Finder is a Windows Electron desktop app for Microsoft Flight Simulator 2024.
It scans a 3rd-party scenery folder, detects installed airports by ICAO code, fetches real
scheduled airline routes via SayIntentions.AI, and provides flight planning tools with live weather.

GitHub repo: https://github.com/snkeyez95/dean-msfs-route-finder

---

## Dean's Setup

- PC: Windows, runs as Administrator
- Scenery folder: C:\Users\MultiBotPC\Documents\MSFS\Scenery
- App folder: C:\Users\MultiBotPC\Desktop\DeanMSFS_v2
- Node.js: v18.18.2 / Electron: 28.3.3
- Sim aircraft: Fenix A319, Fenix A320, Fenix A321, PMDG 737-800

---

## File Structure

index.html        — entire frontend (HTML/CSS/JS, single file)
main.js           — Electron main process, IPC handlers, API proxy, file logging
preload.js        — contextBridge exposing APIs to renderer
package.json      — Electron app config and version number
CLAUDE.md         — this file, read automatically every session
README.md         — user-facing documentation
start.bat         — launch the app
update.bat        — pull latest from GitHub and relaunch
_updater.ps1      — PowerShell updater script
build.bat         — electron-builder for .exe packaging (future)
dean_msfs_debug.log — written to app folder, fresh each session (API keys redacted)

Config saved to: C:\Users\MultiBotPC\.dean_msfs_v4.json (dot prefix, not underscore)
Contains: folder path, siCookie, savedRows, myFleet, routeRegistry,
          routeRegistrySnapshot, autoRefreshEnabled, siLastFetch, theme

---

## Standing Instructions — Always Follow These

1. When you finish ALL changes, always automatically run:
   git add -A && git commit -m "vX.X.X: description" && git push
   Do not wait for confirmation. Do not ask. Just do it as the final step.

2. Never modify dean_msfs_debug.log, .dean_msfs_v4.json, or community_routes.json directly.

3. Never hardcode airport lists, fleet configs, or user preferences.
   Everything must derive dynamically from the live config at runtime.

4. Version bumps go in: package.json (version field), index.html (title bar and footer),
   and README.md changelog section.

5. Provide instruction blocks as a single consolidated block of plain text.
   Never split into multiple code blocks with prose between them.

---

## Dev Workflow

1. Dean pastes instructions into Claude Code (terminal or Code tab)
2. Claude Code edits files, commits, pushes to GitHub automatically
3. Dean runs update.bat to pull latest and relaunch
4. Verify version in bottom-right corner of app matches expected version

---

## Architecture Notes

- Single-file frontend: all HTML, CSS, and JS lives in index.html
- Main process (main.js) handles: IPC, SI API proxy, file I/O, version check
- Preload.js exposes: si-fetch-page, load-config, save-config, scan-folder, version-check
- Route registry stored as object keyed by SI route ID (deduplication by ID)
- Weather scoring via scoreMETAR() — VFR=0-2, MVFR=3-6, IFR=7-12, LIFR=13+
- Smart retry logic (siFetchPageSmart): 429 → wait 65s, 503 → retry 3x/30s,
  ECONNRESET → retry 3x/30s, empty response → treat as cookie expired

---

## Route Data

- Primary registry: up to 5,000 routes, 7-day pruning
- Snapshot registry: up to 20,000 routes, never pruned
- Auto-refresh: every 8 hours when enabled, fires immediately if overdue on launch
- SI dataset: ~140-165 pages × 100 routes = ~15,000 total routes
- Rate limit: ~30-36 pages per window, 65s reset, handled automatically
- Cookie: p2_session_id from sayintentions.ai — expires ~monthly

---

## Current Feature Queue

Priority order:
1. Free Route mode in Plan a Flight (ICAO input, bypasses library filter)
2. Trip Planner (multi-leg itinerary, collapsed section in Plan a Flight)
3. Phase 2: .exe build + electron-updater for tester distribution
4. BookmarkDrop bookmarklet (eliminates cookie dependency)
5. Weather condition pill filter
6. Sort by Most Reliable (times_seen) — meaningful after 1+ week of auto-refresh data

---

## Features Already Built

- My Airports: scenery folder scan, auto ICAO matching, fuzzy fallback
- Plan a Flight: 1,700+ routes filtered by fleet/library/region/airline/duration
- Challenging Approaches: 20 curated approaches, live METAR, real routes from library
- Route Registry: rolling 7-day database, smart SI fetch with rate limit handling
- Route Snapshot: permanent 20,000 route backup, export/restore
- Auto-refresh: 8-hour schedule, background silent, pulsing indicator
- Live Weather: METAR from aviationweather.gov, VFR/MVFR/IFR/LIFR scoring
- SimBrief integration: one-click pre-filled flight plan
- Dark/Light theme toggle
- Community routes download (Settings → Manual Import → Community Routes)
- Update available banner when new version detected on GitHub
- Cookie expiry detection with amber banner and auto-refresh pause

---

## Known Issues

- KLAS duplicate folders (airport + city scenery) — both valid, leave as-is
- GPU errors in cmd window — harmless GLES3 errors in dev mode only
- Active runway unavailable at some airports — shows "Check ATIS" as fallback
