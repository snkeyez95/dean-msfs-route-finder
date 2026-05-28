# Dean's MSFS Route Finder — v4.5.27

A Windows Electron desktop app for Microsoft Flight Simulator 2024. Scans your 3rd-party scenery folder, detects installed airports by ICAO code, fetches real scheduled airline routes via SayIntentions.AI, and provides flight planning tools powered by live weather.

One-stop workflow: Find a real commercial route using airports you own scenery for, verify aircraft type, open pre-filled in SimBrief, fly with live ATC on SayIntentions.

---

## Features

- My Airports — Scans your MSFS scenery folder and auto-matches installed airports by ICAO code
- Plan a Flight — Browse 3,000+ real commercial routes filtered by your fleet, airport library, region, airline, and duration. Live weather scoring on every route.
- Challenging Approaches — 20 curated technically demanding approaches worldwide with live METAR, wind guidance, scenery info, and real airline routes from your library airports
- Route Registry — Rolling 7-day database of routes harvested from SayIntentions.AI. Auto-refreshes every 8 hours in the background.
- Route Snapshot — Permanent backup of all routes ever seen. Never pruned. Exportable and re-importable.
- Live Weather — METAR data from aviationweather.gov for all relevant airports. Auto-refreshes every 30 minutes. Color-coded VFR/MVFR/IFR/LIFR scoring.
- SimBrief Integration — One-click opens SimBrief pre-filled with airline, flight number, aircraft type, origin, destination, and callsign
- Dark / Light theme — Toggle in the title bar

---

## Setup

Requirements: Windows 10/11, Node.js v18+

First Run:
1. Double-click setup.bat to install dependencies
2. Double-click start.bat to launch the app
3. Go to Settings, My Fleet and check the aircraft you own
4. Set your scenery folder path in My Airports
5. Follow the SayIntentions cookie setup below to enable live route data

---

## SayIntentions.AI Cookie Setup

The app fetches real commercial route data from SayIntentions.AI. This requires a valid session cookie from your SayIntentions account.

Getting your cookie (first time or after expiry):
1. Open your browser and go to sayintentions.ai
2. Sign in to your account
3. Press F12 to open Developer Tools
4. Click the Application tab (Chrome) or Storage tab (Firefox)
5. In the left panel expand Cookies and click https://p2.sayintentions.ai
6. Find the cookie named p2_session_id
7. Click on it and copy the entire value from the Value field at the bottom
8. In the app go to Settings, Route Data Source
9. Paste the value into the cookie field and click Save Cookie
10. Click Refresh Routes to do your first harvest

Cookie expiry:
Cookies expire approximately monthly. When yours expires the app will show an amber warning banner at the top. Repeat the steps above to get a fresh cookie. Auto-refresh pauses automatically and resumes once a valid cookie is saved.

Auto-refresh:
Once your cookie is saved, check Auto-refresh routes every 8 hours in Settings. The app will harvest new routes silently in the background three times per day, building temporal coverage across different traffic windows.

Rate limiting:
SayIntentions rate-limits at approximately 30-36 pages per window with a 65 second reset. The app handles this automatically — when a rate limit is hit it waits and resumes from where it left off. A full 165-page harvest takes approximately 6 minutes including wait times.

---

## Updating the App

Run update.bat to pull the latest version from GitHub and relaunch automatically. Verify the update by checking the version number in the bottom-right corner of the app.

---

## Route Registry

The app maintains a local database of routes in C:\Users\MultiBotPC\.dean_msfs_v4.json

Primary registry: up to 5,000 routes, pruned to 7 days of activity
Snapshot registry: permanent backup of all routes ever seen, never pruned, up to 10,000 routes
Routes are deduplicated by SayIntentions route ID
Registry grows automatically via auto-refresh and manual Refresh Routes runs

Exporting and restoring the snapshot:
In Settings, Route Backup, click Export Snapshot to save a JSON file to your Downloads folder. This file can be dragged onto the Manual Import zone to restore routes on any install.

---

## Manual Route Import

In Settings, Manual Import, drag and drop a SayIntentions JSON file or a previously exported snapshot file. The app will merge new routes and report how many were added.

To manually fetch routes from SayIntentions in a browser:
https://p2.sayintentions.ai/p2/api/commercial-routes/list?page=1&limit=100
Copy the response, save as a .txt or .json file, and drag onto the import zone.

---

## Weather System

Live METAR data is fetched from aviationweather.gov for all airports relevant to your route library. Weather auto-refreshes every 30 minutes.

Weather scoring:
0-2   VFR   Green   Clear, uneventful
3-6   MVFR  Blue    Some weather
7-12  IFR   Amber   Challenging
13-18 IFR   Orange  Serious conditions
19+   LIFR  Red     Extreme weather

Scoring factors include flight category, precipitation type, visibility, wind speed, gusts, and ceiling.

---

## My Fleet

In Settings, My Fleet, check the aircraft you own. This filters routes to only show flights operated by aircraft in your sim.

B738  PMDG 737-800
B737  PMDG 737-700
B739  PMDG 737-900
B38M  PMDG 737 MAX 8
B39M  PMDG 737 MAX 9
A319  Fenix A319
A320  Fenix A320
A20N  Fenix A320neo
A321  Fenix A321
A21N  Fenix A321neo

---

## File Structure

DeanMSFS_v2/
  index.html           frontend (HTML/CSS/JS)
  main.js              Electron main process, IPC handlers, API proxy
  preload.js           contextBridge exposing APIs to renderer
  package.json         Electron app config
  start.bat            launch the app
  update.bat           pull latest from GitHub and relaunch
  _updater.ps1         PowerShell updater script
  build.bat            electron-builder packaging (future)
  README.md            this file
  dean_msfs_debug.log  session log, fresh each launch (API keys redacted)

Config file: C:\Users\MultiBotPC\.dean_msfs_v4.json

---

## Debug Log

The app writes a session log to dean_msfs_debug.log in the app folder. Fresh each session. API keys and cookies are redacted automatically.

Key log prefixes:
[INFO ]              general info
[ERROR]              errors
[RENDERER] [WX]      weather system
[RENDERER] [SI]      SayIntentions operations
[RENDERER] [RL-TEST] rate limit diagnostic
[SI]                 route fetch operations

---

## Known Issues

- KLAS duplicate: two KLAS folders (airport + city scenery). Both valid, leave as-is.
- GPU errors in cmd window: harmless GLES3 errors visible in dev mode via start.bat. Disappear when packaged as .exe.
- Active runway: some airports do not return active runway data. Check ATIS is shown as fallback.

---

## Changelog

v4.5.27  Community Routes download, update available banner
v4.5.26  Challenging Approaches real routes from library airports, README rewrite
v4.5.25  METAR scope optimization, sort by reliability, Challenging Approaches SI integration
v4.5.24  Route snapshot backup, cookie detection, auto-refresh indicator, times seen display
v4.5.23  Expanded route weather refresh fix, remove score display
v4.5.22  Empty SI response detection
v4.5.21  Light/dark theme toggle
v4.5.20  Auto-refresh every 8 hours, progress panel, 7-day pruning
v4.5.19  Smart 503/429 retry with live countdown
v4.5.18  Rate limit diagnostic rewrite, 7-phase multi-cycle empirical testing

---

## Credits

Route data: SayIntentions.AI — https://sayintentions.ai
Weather data: aviationweather.gov — https://aviationweather.gov
Charts: SkyVector — https://skyvector.com
Flight planning: SimBrief — https://simbrief.com
