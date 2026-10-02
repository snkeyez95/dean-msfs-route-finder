# A Better Route Planner (ABRP) — Portability / Architecture Export

> Prepared 2026-10-01 for an external AI (Grok) portability review. This is the documentation package.
> The **actual source code is in the public GitHub repo** (see §3) — ~21,500 lines across 30+ files,
> which is why it is not pasted inline here.

---

## 1. App overview

### Purpose
A **Windows desktop application for Microsoft Flight Simulator 2024** that does two largely independent jobs:

1. **Flight planning / route finder** — scans a 3rd-party scenery folder to detect installed airports by ICAO, pulls real scheduled airline routes (via SayIntentions.AI), filters/sorts them by fleet, library, region, airline, duration and live weather, and one-click exports a plan to SimBrief. Also activates/deactivates scenery addons via filesystem symlinks, offers a live VATSIM ATC frequency helper, and a curated "challenging/scenic approaches" browser.

2. **Performance capture & analysis suite** — arms a background capture that records per-frame timing (Intel PresentMon), VRAM (nvidia-smi), 1 Hz system telemetry, and SimConnect flight phase/landing data; then trims, computes smoothness statistics, splits the flight into 5 phases, and writes a self-contained HTML report plus a rolling index/dashboard. Includes AutoFPS TLOD-trace analysis, a baseline-TLOD recommender, a settings A/B comparator, scenery performance ranking, and (new) a landing-performance readout (touchdown FPM / G / rating).

Single-user, local-first desktop tool. Not multi-tenant, not a web service.

### Main features
- Scenery folder scan → ICAO detection (fuzzy fallback); scenery activate/deactivate via NTFS junctions; wrapper-package handling; GSX profile auto-install.
- Route registry (rolling, pruned) + 20k permanent snapshot; 8-hour background refresh with rate-limit handling; community-routes sharing via GitHub.
- Live weather (METAR) scoring; D-ATIS (US + synthetic-from-METAR); active-runway resolution.
- SimBrief one-click plan export; Free Route (any ICAO pair); Trip Planner; Challenging/Scenic approaches.
- Live VATSIM ATC frequency helper with an in-sim transparent overlay (top-down ownership via VATSpy/SimAware/VATGlasses polygons).
- Performance: arm/launch+capture, PresentMon frametime capture, VRAM/telemetry sampling, SimConnect auto-start + phase split + parking-brake/landing detection, HTML reports, dashboard, Compare, Baseline recommender, Settings A/B, Scenery impact ranking, spike forensics, CapFrameX export.
- Companion app launch/close automation; NVIDIA control-panel backup/restore; shader/WASM cache cleaners; data backup/restore + setup export/import.
- Silent auto-update via GitHub Releases (electron-updater).

### Tech stack
- **Runtime:** Electron 28.3.3 (Chromium + Node.js 18.18.2). Windows x64 only.
- **Language:** JavaScript (no TypeScript, no build/transpile step for app code). HTML/CSS inline.
- **Frontend:** a single ~8,500-line `index.html` (all HTML/CSS/JS in one file), plus a small `overlay.html` (transparent in-sim overlay window). No framework — vanilla DOM. Charting via bundled Chart.js (offline, in `perf/vendor` / report assets).
- **Main process:** `main.js` (Electron main — IPC, API proxy, file I/O, window mgmt, auto-update, process automation). `preload.js` exposes a `contextBridge` API.
- **Performance engine:** native **Node.js** modules in `perf/native/*.js` (a from-scratch port of an earlier Python engine). External tools invoked as child processes: **PresentMon-x64.exe** (frame capture), **nvidia-smi** (VRAM), **PowerShell 5.1** (process/OS actions), and **SimConnect** via the `node-simconnect` npm package.
- **Data storage:** **plain JSON files** on disk (no database). Config, route registry, route snapshot, per-flight session folders (CSV + JSON + HTML), an append-only index.json/index.csv.
- **Packaging/hosting:** electron-builder → NSIS installer; auto-update + community-route data hosted as **GitHub Releases / repo files**. No server backend of our own.
- **Legacy:** a frozen Python engine (`perf/perf-engine.exe`, built from `perf/msfs_perf_logger.py`) remains bundled as a fallback and for the `--spike-report` / CapFrameX-convert CLI paths; the native Node engine is the primary.

---

## 2. Full file tree (one line each)

```
DeanMSFS_v2/
├── index.html              — ENTIRE frontend: all HTML/CSS/JS for the renderer (~8,555 lines, single file)
├── main.js                 — Electron main process: IPC handlers, API proxy, file I/O, windows, auto-update, PowerShell/process automation (~2,875 lines)
├── preload.js              — contextBridge: exposes a safe `window.api` surface to the renderer (~97 lines)
├── overlay.html            — transparent, click-through in-sim VATSIM/landing overlay window (~201 lines)
├── package.json            — Electron app config, version, deps, electron-builder/NSIS build config
├── package-lock.json       — locked dependency tree
├── README.md               — user-facing documentation + changelog
├── CLAUDE.md               — dev-time project instructions (read by the Claude Code CLI; NOT used at app runtime)
├── community_routes.json   — shared route snapshot (dev copy; auto-written after each refresh, published to GitHub)
├── start.bat               — launch the app from source (dev): `electron .`
├── build.bat               — local build helper
├── release.bat             — build NSIS installer + publish a GitHub Release (drives the auto-updater)
├── publish.bat             — git add/commit/push community_routes.json to GitHub
│
├── lib/
│   └── data_backup.js      — backup/restore + setup export/import logic (zip of config + registry + snapshot)
│
├── build/
│   ├── icon.ico            — app icon
│   └── installer.nsh       — NSIS installer customizations (force-close running app, clean-uninstall prompt)
│
├── tools/                  — dev-only scripts (not shipped in the installer)
│   ├── sync-notes.js       — mirrors the dev roadmap/memory (lives in ~/.claude) into docs/notes backups
│   ├── backup-data.js      — manual data backup script
│   └── backup-data.bat     — wrapper for the above
│
├── tests/                  — Node test suite (run: `node tests\run_all.js`); ~35 suites. Excluded from installer.
│   ├── run_all.js          — runs every test_*.js, reports pass/fail per suite
│   ├── lib/extract.js      — harness: slices functions out of index.html for desk-testing (`grab`), runner()
│   └── test_*.js           — ~35 suites (routes, weather, VATSIM, perf engine, landing, settings A/B, etc.)
│
├── docs/
│   ├── notes/              — BACKUP copies of the dev roadmap + Claude memory (the live ones live in ~/.claude)
│   └── *.md                — assorted design/decision docs (incl. this export)
│
└── perf/                   — the performance capture + analysis engine
    ├── native/             — the PRIMARY engine: native Node.js modules (port of the Python engine)
    │   ├── capture.js          — --auto capture orchestrator: connect → wait-for-rolling → start PresentMon/VRAM/telemetry → tick 1 Hz → trim → fileSession
    │   ├── run_capture.js      — detached entry point the app spawns to run a capture
    │   ├── simconnect.js       — SimConnect auto-start, phase tracker, resilient sampler, parking-brake + landing (VERTICAL SPEED/G FORCE) detection via node-simconnect
    │   ├── presentmon.js       — spawn/stop PresentMon-x64.exe, parse its CSV, stop-on-sim-exit
    │   ├── vram.js             — nvidia-smi 1 Hz VRAM/GPU-util sampler + summarize
    │   ├── telemetry.js        — 1 Hz system telemetry (top non-MSFS process, CPU/RAM)
    │   ├── stats.js            — smoothness math: percentiles, stutter %, consistency, 1%/0.1% low, cpu/gpu-bound, felt-stutter counts
    │   ├── phases.js           — trim (head/teardown/brake anchor) + 5-phase split (dep_taxi/climb/cruise/descent/arr_taxi)
    │   ├── periodicity.js      — periodic-stutter (engine-overload) classifier
    │   ├── engine.js           — fileSession: assembles summary.json, writes report.html, updates index, dashboard
    │   ├── report_html.js      — builds the per-flight HTML report (template strings) + flight debrief
    │   ├── report_charts.js    — chart data series (frametime, altitude, TLOD trace, VRAM, traffic) + phase bars
    │   ├── report_combined.js  — the dashboard (combined_report.html) builder
    │   ├── report_assets.js    — loader that inlines report_assets/* into the report HTML
    │   ├── report_assets/      — report/dashboard CSS + JS (chart.js wrapper, theme, nav) inlined into reports
    │   ├── debrief.js          — plain-English per-flight debrief (rank, attribution, watch-line, landing line)
    │   ├── index_writer.js     — append-only index.json + index.csv writers (field list)
    │   ├── coverage.js         — benchmark coverage model (aircraft × TLOD grid) for the baseline recommender
    │   ├── autofps_log.js      — parse the AutoFPS app's log → TLOD trace sidecar (autofps_trace.json) + stats; live tail
    │   ├── gfx_watch.js        — read UserCfg.opt graphics block + AutoFPS config; curated watch-key fingerprint (Settings A/B)
    │   ├── settings.js         — read/write UserCfg.opt graphics settings (TLOD/OLOD etc.) with backup+verify
    │   ├── prep.js             — auto-TLOD prep-next: pick the next benchmark TLOD from SimBrief aircraft + coverage
    │   ├── sysinfo.js          — driver/sim version, SimBrief route fetch, aircraft-title normalize, VATSIM connect/pilots
    │   ├── lab.js              — (dormant) Settings Lab experiment runner
    │   ├── lab_report.js       — (dormant) Lab verdict/report builder
    │   ├── live_stats.js       — perf_live.json channel: rolling frametime tail → live overlay strip
    │   ├── backfill_phases.js  — one-time re-trim + sidecar backfill + report regen for old flights (version-gated)
    │   ├── archive.js          — gzip old raw frametimes in place (storage), transparent .gz readers
    │   └── capframex.js        — export a session to CapFrameX format
    │
    ├── msfs_perf_logger.py — LEGACY Python engine (oracle + fallback; still used for --spike-report CLI)
    ├── perf-engine.exe     — frozen PyInstaller build of the above (bundled fallback)
    ├── PresentMon-x64.exe  — Intel PresentMon frame-capture tool (invoked by the engine)
    ├── test_plan.json      — TLOD sweep plan for the benchmark
    ├── vendor/             — bundled offline chart libraries (Chart.js etc.) for reports
    ├── build_pyi/          — PyInstaller spec/build artifacts for the Python exe
    ├── docs/               — engine reference docs
    ├── Convert_to_CapFrameX.bat — legacy CLI wrapper
    └── README.md           — engine notes
```

---

## 3. Complete source code — how to hand it to Grok

The app is **~21,500 lines of JavaScript/HTML across 30+ files** (plus a ~3,600-line legacy Python engine and bundled binaries). It is **not reproduced inline** — a chat paste of that size truncates and is unusable, and it is already version-controlled. Two clean ways to give Grok the real, complete source:

**Option A — point Grok at the public repo (easiest):**
```
https://github.com/snkeyez95/dean-msfs-route-finder
```
It contains every source file at current `main`. Exclude `node_modules/` and the `*.exe` binaries from review.

**Option B — make a self-contained zip of the source (no binaries / deps):**
```bash
cd "C:/Users/MultiBotPC/Desktop"
powershell -Command "Compress-Archive -Path 'DeanMSFS_v2/index.html','DeanMSFS_v2/main.js','DeanMSFS_v2/preload.js','DeanMSFS_v2/overlay.html','DeanMSFS_v2/package.json','DeanMSFS_v2/README.md','DeanMSFS_v2/lib','DeanMSFS_v2/perf/native','DeanMSFS_v2/build','DeanMSFS_v2/tools' -DestinationPath 'abrp-source-export.zip' -Force"
```
That produces `abrp-source-export.zip` with all human-written source and no `node_modules`, no `.exe`, no 11 MB route JSON. Hand that to Grok.

> If you specifically want a single concatenated text file of all source for pasting, say so and I'll generate one on disk (`abrp-allsource.txt`) — but it will be very large; the repo/zip is the better review input.

---

## 4. Dependencies & setup

### Runtime dependencies (`package.json`)
```json
{
  "name": "dean-msfs-route-finder",
  "version": "6.22.0",
  "main": "main.js",
  "dependencies": {
    "electron-updater": "^6.8.9",
    "node-simconnect": "^4.2.0",
    "topojson-client": "^3.1.0",
    "world-atlas": "^2.0.2"
  },
  "devDependencies": {
    "electron": "^28.0.0",
    "electron-builder": "^24.0.0"
  }
}
```
- `node-simconnect` — pure-JS SimConnect client (talks to MSFS). Native-ish; must be `asarUnpack`'d (it is).
- `electron-updater` — GitHub-Releases auto-update.
- `topojson-client` + `world-atlas` — the dashboard world map.
- `electron` + `electron-builder` — dev/build only.

### Bundled (not npm) external tools
- `perf/PresentMon-x64.exe` — Intel PresentMon (frame capture). Shipped via electron-builder `extraResources`.
- `perf/perf-engine.exe` — frozen Python fallback engine (+ `perf/vendor` chart libs).
- `nvidia-smi` — expected on PATH (ships with the NVIDIA driver). **Assumes an NVIDIA GPU.**
- `powershell` (Windows PowerShell **5.1**, not pwsh 7) — used for process/OS actions.

### Environment variables
The app needs **none** to run. The engine uses internal env vars when ABRP spawns it as a child process:
- `MSFS_PERF_ROOT` — writable data root (the app's userData folder) for the engine.
- `ABRP_BENCHMARK` — the benchmark aircraft/TLOD grid passed to the capture child.
- `ABRP_THIRDPARTY_ICAOS` — the set of payware ICAOs (for scenery tagging).
- `ABRP_VATSIM_CID` — the user's VATSIM CID (connection-confirmed traffic tagging).
- `ABRP_AUTOFPS_LOG_DIR` — override for the AutoFPS log location.
No secrets/API keys live in env; the SayIntentions session cookie and SimBrief username live in the user's `config.json`.

### Build / run / deploy
```bash
# Run from source (dev)
npm install
npm start                 # = electron .   (or start.bat)

# Tests
node tests\run_all.js

# Build installer + publish a GitHub Release (auto-updater source)
.\release.bat             # electron-builder --win --x64 --publish always
```
Build output lands in `C:\Temp\abrp-build\` (outside the project, to dodge file locks). Installer = NSIS, one-click:false, user-chosen dir.

### External services / APIs the app calls (all public, read-only unless noted)
- **aviationweather.gov** — METAR/weather.
- **atis.info / atis.guru / datis.clowd.io** — D-ATIS.
- **sayintentions.ai** — real scheduled routes (needs the user's session cookie) + SI WX/ATIS API (needs the user's SI API key).
- **data.vatsim.net / metar.vatsim.net** — VATSIM live ATC datafeed + injected weather.
- **dispatch.simbrief.com / simbrief.com** — SimBrief flight-plan export (opens in browser).
- **api.github.com / github.com / raw.githubusercontent.com** — auto-update + community-route download/publish.
- **davidmegginson.github.io** — OurAirports CSV (global airport DB) download.
- **skyvector.com / flightaware.com / youtube.com / orbxdirect.com / inibuilds.com / flytampa.com / simmarket.com** — outbound links only (opened in the user's browser), not API calls.
- **fonts.googleapis.com** — web font (cosmetic).

---

## 5. Claude-specific elements

**There are NONE at runtime.** The shipped application has **zero dependency on Claude, Anthropic APIs, Claude Artifacts, or Claude Projects.** Verified: a grep for `anthropic|claude|openai` across the entire app runtime (`index.html`, `main.js`, `preload.js`, `overlay.html`, `perf/native/`) returns a **single hit — a code comment** referencing `CLAUDE.md`, not a runtime call.

The Claude footprint is **development-time only** and does not ship or run:
- `CLAUDE.md` — project instructions read by the Claude Code CLI (the dev assistant). Ignored by the app. Excluded from the installer.
- `.claude/skills/msfs-flight-analysis/` (outside this tree) and `docs/notes/` — a Claude Code "skill" + mirrored dev roadmap/memory used while building. Not part of the app, not referenced by it.
- The app was authored with Claude Code as the dev tool — but it produces a standard Electron app that runs entirely offline-of-Anthropic.

**Takeaway for Grok:** nothing needs to be de-Claude'd to port or maintain this app. The only cleanup if you want zero Claude artifacts in the repo is deleting `CLAUDE.md` and `docs/notes/` (pure dev scaffolding).

---

## 6. Portability notes (the real constraints)

This app is **tightly coupled to Windows + an NVIDIA GPU + MSFS 2024**, by design. The biggest portability facts:

**Hard OS coupling (Windows-only):**
- Spawns **Windows PowerShell 5.1** (`powershell`, not `pwsh`) for process enumeration, app close/reopen, registry reads. All data parsing is done in Node (deliberate — a past bug came from PS-version JSON differences), but the OS actions are PowerShell.
- **NTFS junctions** (symlinks) are the scenery activation mechanism (Community folder ↔ library). No equivalent on other OSes without rework.
- **Windows registry** reads (via `regedit`) for MSFS/scenery detection.
- **NSIS installer** + `electron-updater` (Windows Squirrel-style flow).
- Shader/WASM cache cleaners target Windows/NVIDIA cache paths.

**Hardware / sim coupling:**
- **NVIDIA-only**: VRAM + GPU util come from `nvidia-smi`. No AMD/Intel path.
- **PresentMon-x64.exe** (Windows ETW frame tracing) is the capture backbone — Windows-only.
- **SimConnect** (`node-simconnect`) — MSFS-specific; needs MSFS 2020/2024 running. SimConnect DLLs are versioned against the MSFS SDK.
- **AutoFPS** integration parses a 3rd-party app's log file at a known `%APPDATA%` path.
- Capture reads **UserCfg.opt** (MSFS graphics config) — path differs Steam vs MS-Store (the Steam path is assumed in a couple of places; the native `settings.js` is path-agnostic but the caller resolves it).

**Hard-coded / machine assumptions:**
- Paths like the scenery folder and app-data folder default to a specific `C:\Users\...` layout but are **config-driven** (stored in `config.json`, user-editable). Rule in the project: never hard-code airport lists, fleet, or user prefs — everything derives from the live config at runtime. A few Steam-vs-Store sim paths are the exception to watch.
- VRAM headroom math assumes a **12,288 MB (12 GB)** card in a couple of spots, though the capture reads the real total; a different card is mostly handled but worth auditing.
- Build output is hard-coded to `C:\Temp\abrp-build\`.

**Architecture notes a reviewer should know:**
- **Single-file frontend**: all renderer HTML/CSS/JS is in `index.html` (~8,555 lines). Intentional, but it's the main maintainability risk — no module boundaries on the UI side. Tests cope by "grabbing" functions out of the file with a regex harness (`tests/lib/extract.js`).
- **No database**: everything is JSON files + per-flight folders (CSV/JSON/HTML). Scales fine for one user; the route registry is capped + rotated, the raw frametime CSVs are gzip-archivable.
- **No TypeScript / no bundler for app code** — plain JS loaded directly by Electron. Low tooling, but no type safety.
- **Two engines coexist**: the native Node engine (primary) and a frozen Python exe (fallback + `--spike-report` CLI). Full de-Python is possible but the Python path still serves spike forensics.
- **Capture runs detached**: the engine is spawned as a detached child so closing the app never kills a recording. Cross-process coordination is via small JSON status files (`capture_status.json`, `perf_live.json`), not IPC.
- **External data fragility**: SayIntentions routes depend on a session cookie that expires ~monthly; the D-ATIS intl source is an HTML scrape; these are the softest external dependencies. The 20k route snapshot + GitHub community file are the insurance.

**What a non-Windows / non-MSFS port would require (if ever):** replacing PresentMon (frame capture), nvidia-smi (VRAM), PowerShell (process/OS), junctions (scenery), and SimConnect (sim link) — i.e. the entire capture + scenery-activation half. The route-planning half (HTML UI + public web APIs + JSON storage) is largely OS-agnostic and would port far more easily.

---

*End of export. Source: GitHub repo above, or the zip command in §3.*
