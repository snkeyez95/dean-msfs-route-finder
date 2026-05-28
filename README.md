# Dean's MSFS Route Finder

**v4.5.19**

A Windows Electron desktop app for Microsoft Flight Simulator 2024. Scans your 3rd-party scenery folder, detects installed airports by ICAO code, and provides flight planning tools powered by real SayIntentions.AI commercial traffic data.

## Features

- **My Airports tab** — Scans scenery folder, auto-matches airports by ICAO, manual ICAO assignment for unmatched airports
- **Plan a Flight tab** — Filter routes by aircraft, mode, direction, region, airline, and duration. Routes sourced from SayIntentions.AI registry
- **Challenging Approaches tab** — 20 famous challenging approaches with METAR, wind analysis, SimBrief and SkyVector links
- **Settings tab** — My Fleet configuration, SayIntentions.AI cookie management, manual JSON import via drag and drop

## Setup

1. Install the app
2. Go to **Settings** tab
3. Paste your SayIntentions.AI session cookie
4. Click **Save Cookie** then **Refresh Routes**
5. Go to **My Airports** tab and scan your scenery folder
6. **Plan a Flight** tab will populate with matching routes

## Data Source

SayIntentions.AI commercial routes API. Requires a SayIntentions.AI account and session cookie. Routes are stored in a local rolling 14-day registry that builds up over time with each refresh or manual import.

## My Fleet

Configure which aircraft you own. Only checked aircraft appear as filter options. The registry stores routes for all fleet aircraft (checked or unchecked) so data is ready when you acquire new aircraft.

## Manual Import

In your browser, navigate to:

```
https://p2.sayintentions.ai/p2/api/commercial-routes/list?page=X&limit=100
```

Copy the response, save as `.txt` or `.json`, then drag and drop onto the import zone in the Settings tab.

## Aircraft Supported

- Fenix A319, A320, A321 (and neo variants)
- PMDG 737-800 (and other 737 variants)
- Configurable via **My Fleet** panel in Settings

## Tech Stack

- Electron 28.3.3
- Node.js v18.18.2
- No framework — single `index.html`

## Update

Run `update.bat` to pull the latest from GitHub and relaunch.
