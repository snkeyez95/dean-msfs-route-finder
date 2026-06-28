# MSFS 2024 Performance Logger — Project Definition & Integration Handoff
*Written June 18, 2026 · for handing this project to another Claude session*

> **Superseded by `docs/2026-06-27-relocation-handoff.md` for the ABRP relocation; this remains the project-definition reference (data contract, pipeline, key functions). Note: the §12 quick-start path goes stale once the project moves.**

> **Purpose of this document:** give a fresh Claude session enough context to
> understand this project completely and integrate it into another project —
> without re-reading the whole codebase. Read this top-to-bottom first; dive into
> `msfs_perf_logger.py` only where you need exact implementation detail.

---

## 1. What this project is, in one paragraph

A small, self-contained **Python tool that silently measures how smooth MSFS 2024
flights are** and files the results for later analysis. It uses Intel PresentMon to
capture per-frame timing, samples GPU VRAM, stamps the sim's graphics settings
(TLOD/OLOD), driver version, sim version, aircraft, and SimBrief route onto each
run, then writes a tidy per-flight folder plus rolled-up index files and HTML
reports. **It only measures — it never changes sim settings** (one optional helper,
`prep.bat`, writes a test value into the config, but the core logger is read-only on
the sim). Analysis across flights is done by Claude reading the output folder.

**The single most important thing to understand for integration:** the project's real
product is its **structured data contract** — `Sessions/index.json` and per-flight
`summary.json`. Anything that integrates with this project should read those, not
scrape HTML or re-run captures.

---

## 2. Goal & domain context

- **Goal:** find the TLOD/OLOD graphics setting that stays *smooth* without exceeding
  the 12 GB VRAM ceiling on the user's RTX 3080 Ti.
- **The metric that matters is frame smoothness** — P99 frametime, 1%/0.1% lows,
  stutter % — **NOT raw FPS** (FPS is capped: 30 native, 60 via FSR3 frame generation,
  so the FPS number is near-constant and uninformative).
- **TLOD** = Terrain Level of Detail, **OLOD** = Objects Level of Detail (the two MSFS
  graphics sliders being swept). Higher = more detail = more load.
- **User:** Dean — non-technical, wants plain-English explanations and "set it and
  forget it" automation. Rig: RTX 3080 Ti 12GB, MSFS 2024 (Steam), flat-screen (not VR).

---

## 3. Tech stack & dependencies

| Piece | What | Required? |
|---|---|---|
| Python 3.9+ | the whole tool is one script | yes |
| Intel PresentMon (`PresentMon-x64.exe`) | frame capture engine; found on PATH or in folder, or auto-downloaded | yes (no captures without it) |
| `nvidia-ml-py` (pip) | VRAM sampling via NVML | optional (degrades gracefully) |
| `SimConnect` (pip) | auto-start trigger, aircraft name, ground-speed/altitude tracking | optional (manual mode if absent) |
| SimBrief public API | per-flight route label (username `snkeyez95`) | optional, timeout-guarded |
| `nvidia-smi` | driver version stamp | optional |
| PowerShell | sim version stamp (reads MSFS exe file-version) | optional |

**No third-party Python packages beyond the two optional ones above.** Everything
else is stdlib. Single-file design (`msfs_perf_logger.py`, ~2300 lines).

---

## 4. File / folder structure

```
Claude_TLOD_OLOD/
├── msfs_perf_logger.py          ← the entire tool (one file)
├── record.bat                   ← manual capture launcher  (python msfs_perf_logger.py)
├── record_auto.bat              ← auto-start launcher       (--auto)  runs minimized
├── prep.bat                     ← write next test setting   (--next-test)
├── test_plan.json               ← TLOD/OLOD sweep definition prep.bat steps through
├── msfs_perf_logger.log         ← append-only run log
├── README.md                    ← user-facing guide (NOTE: currently stale, see §11)
├── 2026-06-13-step-by-step-guide.md   ← user walkthrough (stale, manual-era)
├── 2026-06-13-driver-rollback-guide.md ← driver A/B reference (still valid, side-quest)
├── Sessions/                    ← ALL OUTPUT DATA lives here
│   ├── index.json               ← master list of every flight (READ THIS FIRST)
│   ├── index.csv                ← same data, Excel-friendly
│   ├── combined_report.html     ← cross-flight dashboard (Chart.js), auto-rebuilt
│   └── <YYYY-MM-DD>/<HHMM_TLOD###_OLOD###>/
│        ├── frametimes.csv      ← raw per-frame data (large: 50–120 MB/flight)
│        ├── summary.json        ← computed stats + settings (THE per-flight contract)
│        └── report.html         ← single-flight visual report
├── usercfg_backups/             ← UserCfg.opt snapshots prep.bat makes before each write
└── nvidia_settings_backup/      ← NVIDIA driver-profile backups (driver A/B side-quest)
```

---

## 5. Entry points (how it runs)

All modes are `python msfs_perf_logger.py [flag]`, wrapped by `.bat` launchers:

| Command | Flag | What it does |
|---|---|---|
| `record.bat` | *(none)* | Manual capture. Records until you press Enter or close the sim, then files the session. |
| `record_auto.bat` | `--auto` | Waits via SimConnect for the aircraft to roll (≥2 kt sustained 3 s), then auto-starts. Press Enter to force-start. Runs minimized. |
| `prep.bat` | `--next-test` | With sim CLOSED: reads `test_plan.json`, finds the next untested TLOD/OLOD combo, backs up `UserCfg.opt`, writes the new value. The ONLY part of the tool that writes to the sim. |
| — | `--combined` | Rebuild `Sessions/combined_report.html` from `index.json`. |
| — | `--rebuild-session <id>` | Regenerate one flight's `report.html` from its `summary.json` + `frametimes.csv` (e.g. `2026-06-18_1328`). |

---

## 6. Data contract — the integration surface ⭐

**This is the part another project should build against.**

### `Sessions/index.json` — master list
```jsonc
{
  "version": "1.0",
  "sessions": [
    {
      "session_id": "2026-06-18_1328",        // <date>_<HHMM>, unique key
      "timestamp": "2026-06-18T13:28:17",
      "timestamp_display": "Jun 18 2026 13:28",
      "driver_version": "566.36",
      "sim_version": "1.7.27.0",
      "tlod": 150, "olod": 120,
      "p99_ft_ms": 17.49,                      // headline smoothness metric
      "stutter_pct": 0.02,
      "consistency_pct": 99.9,
      "avg_fps": 60.0,
      "peak_vram_mb": 9950,
      "frame_count": 237814,
      "aircraft": "Fenix",                     // "Fenix" | "PMDG" | raw title | null
      "route": "1809 KSFO-KRDM",               // raw SimBrief string (may carry flight #)
      "folder": "2026-06-18\\1328_TLOD150_OLOD120"  // relative to Sessions/
    }
    // … one object per flight
  ],
  "last_updated": "2026-06-18T14:34:40"
}
```

### `Sessions/<date>/<folder>/summary.json` — per-flight detail
Superset of the index entry. Key nested blocks:
- `settings{}` — `tlod, olod, upscaling, frame_gen, target_fps, fg_multiplier,
  texture_quality, usercfg_found, aircraft, simbrief_route, sim_version`
- `smoothness{}` — `avg_ft_ms, p50/p95/p99/p999_ft_ms, max_ft_ms, frametime_stdev_ms,
  consistency_pct, stutter_pct, stutter_count, spike_count, one_pct_low_fps,
  point_one_pct_low_fps, avg_fps, frame_count, duration_seconds, gpu_bound_pct,
  cpu_bound_pct, avg_cpu_busy_ms, avg_gpu_busy_ms, stop_trim_s`
  - plus **`phases{}`** when SimConnect was active: `ground/low/high`, each with
    `frame_count, avg_ft, p99_ft, stutter_pct, pct_of_total`
    (phase split by altitude: ground / <10,000 ft MSL / ≥10,000 ft MSL)
- `vram{}` — `available, avg_vram_mb, peak_vram_mb, total_vram_mb, peak_pct, sample_count`
- top level also: `driver_version, sim_version, raw_csv, report, notes`

### `frametimes.csv` — raw per-frame
PresentMon output. Has frametime + CPU/GPU-busy columns but **no wall-clock timestamp**
(phase correlation is done by summing frame durations). Large; needed only for
frame-level re-analysis and `--rebuild-session`.

**Grading thresholds (shared constants):** P99 ≤20 ms = good, ≤33.3 = ok, else bad.
Stutter <0.5% good, <2% ok. Target frametime 16.67 ms (60 fps). Stutter = frame >33.3 ms.

---

## 7. End-to-end pipeline (what happens during a capture)

1. Resolve PresentMon; read `UserCfg.opt` for TLOD/OLOD (re-read at recording start so
   it reflects what the user actually set in-sim).
2. `--auto`: block in `wait_for_auto_start()` until ground speed sustains ≥2 kt (or Enter).
3. Capture context while sim is live: aircraft (SimConnect `TITLE`), SimBrief route,
   sim version, driver version.
4. Start PresentMon → temp CSV; start VRAM sampler thread; start `_sc_tracker()` thread
   (passively logs ground-speed for tail-trim, airborne state, and phase transitions).
5. Stop on Enter or sim exit. Mid-air-end → prompt to discard (60 s auto-keep timeout).
6. Trim tail junk (post-landing menu/shutdown frames) using last-movement timestamp.
7. `compute_stats()` → smoothness metrics; `_split_frametimes_by_phase()` → phase stats.
8. `file_session()` writes the folder, updates `index.json`/`index.csv`, regenerates
   `report.html` and `combined_report.html`.

---

## 8. Key functions to know (in `msfs_perf_logger.py`)

- `main()` — orchestrates the whole capture run.
- `read_settings()` — parses `UserCfg.opt` (`{Graphics}` block only, never `{GraphicsVR}`).
- `wait_for_auto_start()` — SimConnect roll trigger + Enter escape hatch.
- `_sc_tracker()` — background SimConnect poll (speed/altitude/on-ground).
- `compute_stats()` — all smoothness math; returns stats dict + sorted frametimes.
- `_split_frametimes_by_phase()` / `_compute_phase_stats()` — phase breakdown.
- `file_session()` — writes all artifacts, updates indexes, triggers report rebuilds.
- `rebuild_combined_report()` — builds the Chart.js cross-flight dashboard from index.json.
- `rebuild_session_report()` — single-flight report regen (`--rebuild-session`).
- `get_sim_version()` / `get_driver_version()` / `get_simbrief_route()` / `get_aircraft_title()`
  — context stampers, all timeout-guarded and non-fatal.

---

## 9. How another project would integrate this

Depending on the integration goal, the clean seams are:

- **Consume the data (most common):** read `Sessions/index.json` for the flight list
  and each `summary.json` for detail. Stable keys, JSON, no HTML scraping. The
  `session_id` is the join key; `folder` locates the per-flight artifacts.
- **Trigger a capture programmatically:** launch `python msfs_perf_logger.py --auto`
  (or `record_auto.bat`) — designed to be fired by a companion app the same way it
  would launch Navigraph Charts. It self-manages start/stop.
- **Reuse the analysis:** `compute_stats()` and the grading helpers (`grade_p99`,
  `grade_stutter`) are pure functions over a frametime list — importable if the other
  project also has PresentMon-style data.
- **Extend the schema:** add fields to the `settings`/`index_entry` dicts in
  `file_session()`; `index.csv` self-heals its header when fields change.

**Integration cautions:**
- `frametimes.csv` files are large (50–120 MB each, ~519 MB so far) and grow per flight.
  A consumer should prefer `summary.json` and only touch raw CSV when it truly needs
  frame-level data. (Deferred plan: downsample old CSVs to per-second buckets — see §11.)
- All sim-context capture is best-effort: any of aircraft/route/sim_version/driver/VRAM
  can be `null`/absent if its dependency was unavailable. Consumers must tolerate nulls.
- `route` may carry a flight-number prefix in stored data (e.g. `"1809 KSFO-KRDM"`);
  display code strips it, raw data keeps it.

---

## 10. Current state (as of 2026-06-18)

- ✅ Manual + auto capture both working; auto-start is speed-only (brake var unreliable
  on Fenix), with an Enter escape hatch and a 60 s auto-keep on the mid-air prompt.
- ✅ Per-flight + combined HTML reports; combined report is an interactive Chart.js
  dashboard (avg P99 by TLOD, Fenix-vs-PMDG toggle, filterable flight table).
- ✅ Stamps driver, sim version, aircraft, SimBrief route, flight-phase breakdown.
- ✅ 8 flights logged (Fenix + PMDG, TLOD 80–150 @ OLOD 120).
- 🔬 Side-investigation ongoing: NVIDIA driver A/B for VRAM headroom (see driver guide).

---

## 11. Known issues, constraints & deferred items

- **Stale docs:** `README.md` and `2026-06-13-step-by-step-guide.md` predate auto-mode,
  SimConnect, SimBrief, aircraft tagging, phase breakdown, and the new combined report —
  they still describe the manual-only tool and list now-built features as "left out."
  Update before relying on them. (The driver-rollback guide is still accurate.)
- **Raw-CSV storage growth** is the only thing that scales badly. Decision (2026-06-18):
  keep full detail for now; future plan is to **summarize/downsample old flights**
  (per-second buckets), opt-in only, never touching `summary.json`/`report.html`.
- **No wall-clock in PresentMon CSV** — phase correlation is approximate (sums frame
  durations from recording start). Fine for trend analysis, not frame-exact.
- **SimBrief returns the latest dispatch** regardless of whether it matches the flight
  flown — `route` is a label only, never affects performance stats.
- **`prep.bat` is the only sim-writing path** and refuses to run while MSFS is open;
  it always backs up `UserCfg.opt` first. Everything else is read-only on the sim.
- **Capture permission:** PresentMon needs the Windows account in the local
  "Performance Log Users" group (one-time) to run without admin elevation.

---

## 12. Quick-start for the receiving session

> "You're inheriting an MSFS 2024 performance logger at
> `C:\Users\MultiBotPC\Documents\Claude_TLOD_OLOD`. Read
> `2026-06-18-project-definition-outline.md` first — it's the full project handoff.
> The data contract you'll integrate against is `Sessions/index.json` +
> per-flight `summary.json`. The tool is one file, `msfs_perf_logger.py`. Tell me
> what you want to integrate it into and I'll map the seams."
