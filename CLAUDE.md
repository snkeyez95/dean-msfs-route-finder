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
start.bat         — launch the app from source (dev)
publish.bat       — git add/commit/push community_routes.json to GitHub
release.bat       — build installer + publish GitHub Release (auto-updater)
community_routes.json — shared route database (dev only); auto-written after each refresh
tests/            — the test suite. Run: `node tests\run_all.js` or double-click tests\run_tests.bat
tools/            — dev scripts (sync-notes.js mirrors Claude's roadmap/memory into docs/notes)
docs/notes/       — BACKUP COPIES of the roadmap + Claude's memory (live ones sit in %USERPROFILE%\.claude,
                    which git never sees). Refresh with `node tools\sync-notes.js`.
C:\Temp\abrp-build\ — build output (outside project to avoid file-lock issues); installer .exe lands here after release.bat

User data folder (all writable files): C:\Users\MultiBotPC\AppData\Roaming\A Better Route Planner\
  config.json         — saved config (auto-migrated from old dean-msfs-route-finder folder, then .dean_msfs_v4.json)
  dean_msfs_debug.log — fresh each session, API keys redacted
  community_routes.json — routes backup when running as installed .exe

Never modify config.json, dean_msfs_debug.log, or community_routes.json directly.

---

## Standing Instructions — Always Follow These

1. When you finish ALL changes, always automatically run:
   git add -A && git commit -m "vX.X.X: description" && git push
   Do not wait for confirmation. Do not ask. Just do it as the final step.

2. Never modify dean_msfs_debug.log, config.json, or community_routes.json directly.

3. Never hardcode airport lists, fleet configs, or user preferences.
   Everything must derive dynamically from the live config at runtime.

4. Version bumps go in: package.json (version field), index.html (title bar and footer),
   and README.md changelog section.

5. Provide instruction blocks as a single consolidated block of plain text.
   Never split into multiple code blocks with prose between them.

6. EVERYTHING YOU CREATE LIVES IN THIS PROJECT FOLDER. No exceptions.
   Tests go in tests/. Dev scripts go in tools/. Never write work that matters to a temp folder,
   a scratch directory, or anywhere outside this repo. (Why: on 2026-07-16 a Windows disk-cleanup
   deleted ~57 test files that had been sitting in %TEMP% for weeks. They were gone for good, and
   I had told Dean they were safe. Temp means temporary.)
   If a task genuinely needs a throwaway file, say so first and delete it when done.

7. Run `node tests\run_all.js` before the final commit of any code change. If a suite fails, fix it
   or say plainly that you didn't. If a change isn't covered, add a suite in tests/.

8. If the roadmap or memory changed, run `node tools\sync-notes.js` before committing so the
   backup copies in docs/notes stay current.

9. VERIFY AT THE SURFACE. For any user-facing change, exercise the real renderer path and assert on
   what actually appears on screen — the chip, the row, the dropdown, the card — not just that the
   underlying constant or data is right. Run it against Dean's REAL saved config/data where possible,
   since a default-shaped fixture hides exactly the bugs an existing install hits.
   Pattern to copy: tests/test_777_surfaces.js. (Why: v6.19.0 added the PMDG 777 and every test
   passed — they proved FLEET_DEF contained the aircraft. Plan a Flight showed no 777 chip at all,
   because his saved fleet had no key for it. The tests checked the code, not the screen.)
   "Tests pass" is not "Dean will see it."

---

## Response Style

### Reporting on completed work

Use this shape:

**Changed:** files touched, one line each
**What it does:** 1-2 sentences, plain language
**Why:** 1 sentence, only if not obvious
**Next:** action items (see below)
**Worth knowing:** only if it clears the bar (see below)

Rules:
- Be brief by default. Length tracks the size of the change, not the size of
  your enthusiasm. Most summaries fit on one screen.
- No preamble. No restating my request. No summarizing the summary. No closing
  pleasantries.
- Plain words. Avoid: comprehensive, robust, seamless, leverage, delve, ensure,
  holistic, streamlined.
- The code speaks for itself. Don't narrate what the diff already shows.
- One idea per bullet. No nested bullets.
- If nothing meaningful happened, say so in one line.

### Next

Only things I have to DO. Tag each one:

- [TEST]    — what to check, and what a pass looks like
- [RUN]     — the literal command, e.g. `.\release.bat`
- [DECIDE]  — a fork you need my call on
- [BLOCKED] — you can't proceed without something from me

Max 3. If there's nothing: **Next:** Ready to use.

### Worth knowing

Default: omit this section. Most changes don't warrant it.

Include something ONLY if I would be worse off not hearing it. That means one of:
- A bug or breakage you noticed but didn't fix
- Something I asked for that fights something else in the code
- A decision you made that a reasonable person would've made differently
- A simpler approach you'd have taken if starting fresh

Not this:
- Polish, refactors, "we could also add..."
- Restating a tradeoff I already knew about
- Anything you'd say just to seem thorough

Max 2. One line each. Pitch it, don't argue it — I'll ask for the full case if
I want it.

If nothing clears the bar, leave the section out entirely. Do not write
"nothing to note." Silence is the signal.

---

## Dev Workflow

1. Dean pastes instructions into Claude Code (terminal or Code tab)
2. Claude Code edits files, commits, pushes to GitHub automatically
3. Dean runs release.bat (build + GitHub Release); his installed app then updates itself
   (as of v6.3.2: silent auto-update with an 8s countdown — no clicks, no installer wizard)
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

- Primary registry: up to 5,000 routes, 21-day pruning
- Snapshot registry: up to 20,000 routes, never pruned
- Auto-refresh: every 8 hours when enabled, fires immediately if overdue on launch
- SI dataset: ~140-165 pages × 100 routes = ~15,000 total routes
- Rate limit: ~30-36 pages per window, 65s reset, handled automatically
- Cookie: p2_session_id from sayintentions.ai — expires ~monthly

---

## Current Feature Queue

Priority order:
1. BookmarkDrop bookmarklet (eliminates cookie dependency)
2. Weather condition pill filter
3. Share app with friends / testers

---

## Features Already Built

- My Airports: scenery folder scan, auto ICAO matching, fuzzy fallback
- Plan a Flight: routes filtered by fleet/library/region/airline/duration, live weather scoring
- Free Route mode: search any ICAO pair — not limited to library
- Trip Planner: paste multi-leg itinerary, city/ICAO resolution, ambiguity confirmation, leg tracking
- Challenging Approaches: 20 curated approaches, live METAR, real routes from library
- Route Registry: rolling 21-day database, smart SI fetch with rate limit handling
- Route Snapshot: permanent 20,000 route backup, auto-written as community_routes.json
- Auto-publish: community_routes.json pushed to GitHub silently after each successful refresh (≥50 new)
- publish.bat: manual publish to GitHub in one click
- Auto-refresh: 8-hour schedule, background silent, pulsing indicator
- Live Weather: METAR from aviationweather.gov, VFR/MVFR/IFR/LIFR scoring
- SimBrief integration: one-click pre-filled flight plan
- Dark/Light theme toggle
- Community routes download (Settings → Manual Import → Community Routes)
- Update available banner when new version detected on GitHub
- Cookie expiry detection with amber banner and auto-refresh pause

---

## Known Issues

- KLAS is a WRAPPER folder (KLAS FlyTampa) holding two packages (airport + city). As of v6.3.14
  activating KLAS links its INNER packages directly into Community (MSFS ignores a wrapper folder);
  wrapper detection is general (any addon whose top folder has no manifest.json but whose subfolders do)
- GPU errors in cmd window — harmless GLES3 errors in dev mode only
- Active runway unavailable at some airports — shows "Check ATIS" as fallback
