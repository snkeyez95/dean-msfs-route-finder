# MSFS Performance Logger — Relocation Handoff (into ABRP)
*Written June 27, 2026 · supersedes the 2026-06-18 project-definition outline for the **move**;
that doc stays as the deeper project reference.*

> **Purpose:** prepare to fold this project into Dean's ABRP Electron app
> (`C:\Users\MultiBotPC\Desktop\DeanMSFS_v2`), most likely under a `perf/` subfolder, so the two
> become one app. ABRP will **spawn the existing Python engine and surface the existing HTML
> reports** — it will NOT rewrite the code or recreate the charts. **Nothing has been moved,
> renamed, or changed.** This is a read-only map so the eventual move is clean and lossless.

---

## 0. The one-paragraph headline

This engine was built to travel. Every internal path is derived from one anchor —
`SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))` — and every `.bat` self-locates with
`%~dp0` + `cd /d "%~dp0"`. **If the whole folder moves into `perf/` as one intact tree, almost
nothing needs repointing.** The only things that need a human's attention are a handful of *external*
paths (which point at Windows/the sim and should NOT move), the three chart libraries that load from
the internet, and making sure the analysis skill runs with the new folder as its working directory.

---

## 1. Path & constant inventory

Format: **what it is — `file:line` — verdict after the move.**

### `msfs_perf_logger.py`
| Item | Line | What it is | After move into `perf/` |
|---|---|---|---|
| `SCRIPT_DIR` | `:57` | self-locating via `__file__` | **Safe — moves automatically.** The anchor everything hangs off. |
| `SESSIONS_DIR` | `:58` | `SCRIPT_DIR/Sessions` | **Safe** (derived). Data folder rides along. |
| `LOG_FILE` | `:59` | `SCRIPT_DIR/msfs_perf_logger.log` | **Safe** (derived). |
| `USERCFG_PATH` | `:64–67` | `%APPDATA%\Microsoft Flight Simulator 2024\UserCfg.opt` | **External — must stay as-is.** Points at the sim, not the project. |
| `BACKUP_DIR` | `:367` | `SCRIPT_DIR/usercfg_backups` (+ `UserCfg_ORIGINAL.opt` sentinel `:461`) | **Safe** (derived). |
| `SIMBRIEF_USERNAME` | `:89` | `"snkeyez95"` | Embedded constant — **stays**. |
| PresentMon resolution | `find_presentmon()` `:173`, names `:132`, GitHub API `:133`, download dest `SCRIPT_DIR/PresentMon-x64.exe` `:230` | script-folder + PATH + auto-download | **Safe.** Exe lives next to the script and rides along. |
| Smoothness/coverage constants | `:70–95` | 16.67ms target, 33.3ms stutter, `COVERAGE_TLODS`, etc. | Embedded — **stay**. |
| `test_plan.json` | read relative to script folder | TLOD/OLOD sweep | **Safe** (rides along). |
| CDN `<script src>` tags | `:1828–1830` | Chart.js / hammer.js / chartjs-plugin-zoom from cdnjs | **Runtime internet dependency** — see §2 & §4. |

### `.bat` launchers
| Item | File:line | Verdict |
|---|---|---|
| Self-locate + `cd /d "%~dp0"` | `record_clean.bat:43`, also `prep.bat:9`, `record_auto.bat`, `tools/*.bat` | **Safe — self-relocating.** |
| `record_clean.log` | `record_clean.bat:41` (`%~dp0record_clean.log`) | **Safe** (derived). |
| `%TEMP%\msfs_closed_apps.txt` state file | `record_clean.bat:40` | **External — stays.** |
| Windows Startup folder | `record_clean.bat:70` (`$env:APPDATA\...\Start Menu\Programs\Startup\`) | **External — stays.** |
| `TARGETS` / `NORESTORE` / `ENDAPPS` app lists | `record_clean.bat:32–36` | Embedded — **stay**. |

`tools/*.bat` sit one level below root and reach back up for the script — they stay correct **as long
as `tools/` keeps its position relative to `msfs_perf_logger.py`** (it will, if the whole tree moves
together).

---

## 2. Relocation hazards — the short list that actually needs attention

Almost everything above is green. These are the only items a person needs to handle:

1. **Analysis skill working directory (not a find-and-replace).** `.claude/skills/msfs-flight-analysis/SKILL.md`
   refers to the data with **relative** paths (`Sessions\index.json`, `Sessions\<date>\...`) — *not*
   a hardcoded `C:\...` path, so there's nothing to search-and-replace inside it. The real
   requirement: the skill must (a) be discoverable from ABRP's `.claude/skills/` (or wherever the
   integrated app looks), and (b) run with the **new project root as the working directory**, so
   `Sessions\` resolves to `perf/Sessions\`. Verify both after the move.
2. **CDN chart libraries** (`msfs_perf_logger.py:1828–1830`). The reports pull Chart.js, hammer.js,
   and chartjs-plugin-zoom from cdnjs at view time. They render fine in any browser with internet. If
   ABRP ever displays them in an **offline** webview, the charts silently go blank. Fix-later option:
   vendor those three JS files locally and point the tags at them. **Not doing it now.**
3. **External paths must NOT be "fixed."** `USERCFG_PATH`, `%TEMP%\msfs_closed_apps.txt`, and the
   Windows Startup folder look absolute but deliberately point at Windows/the sim. Leave them.
4. **The 2026-06-18 doc** hardcodes the current project path in its quick-start (`:251–256`) — it will
   read stale after the move. (It now carries a "superseded for relocation" banner.)

---

## 3. File manifest

| Class | Items |
|---|---|
| **Core code** | `msfs_perf_logger.py` (one file, the whole engine) |
| **Launchers** | `record_clean.bat`, `record_auto.bat`, `prep.bat`, `record.bat`, `tools/*.bat` |
| **Data — must carry over intact** | **entire `Sessions/` tree** — `index.json`, `index.csv`, `sessions_nav.js`, `combined_report.html`, and every `<date>/<flight>/` folder (`frametimes.csv` + `telemetry.csv` + `summary.json` + `report.html`); plus `test_plan.json` and `usercfg_backups/` |
| **Generated / regenerable** | all per-flight `report.html`, `combined_report.html`, `sessions_nav.js`, `index.csv` (rebuild with `--rebuild-all`) |
| **Backup** | `usercfg_backups/`, `nvidia_settings_backup/` |
| **Logs (regenerable)** | `msfs_perf_logger.log`, `record_clean.log` |
| **Stale / deletable after review** | `__pycache__/`, `README.md` (manual-era), `docs/2026-06-13-step-by-step-guide.md` (manual-era) |

⭐ **The irreplaceable payload is `Sessions/` — 17 flights of history** (Jun 13 → Jun 26, Fenix/PMDG
baseline runs + the Citation reference flight). Everything else can be regenerated or reinstalled;
this cannot. Move it without loss, verify `index.json` reads back all 17 before deleting the original.

---

## 4. HTML reporting — how it's built (so it's preserved verbatim)

The charts Dean wants kept exactly as-is are generated entirely from Python string constants inside
the one script — so moving the file preserves them automatically. No external template/asset files.

- **Per-flight `report.html`** — `write_report()` `:1609`. Assembled from `THEME_BASE_CSS` +
  `REPORT_CSS` `:1108` + `CHART_JS` `:1206` (the zoomable frametime+altitude chart and the
  moving-average "felt smoothness" strip) + `NAV_JS` `:1400` (prev/next flight nav).
- **Combined dashboard `combined_report.html`** — `rebuild_combined_report()` `:2069`, driven by
  `DASH_JS` `:1986` (by-TLOD bar charts drawn as inline SVG, the TLOD filter, the Combined/by-aircraft
  toggle, and the filterable flight table). Same theme CSS.
- **Only runtime dependency:** the three cdnjs `<script>` tags at `:1828–1830` (Chart.js 4.4.1,
  hammer.js 2.0.8, chartjs-plugin-zoom 2.0.1). The inline-SVG bar charts on the dashboard need no
  internet; the Chart.js line charts on the per-flight reports do. See hazard §2.2.

---

## 5. Dependencies & permissions

| Piece | What it gives | If missing |
|---|---|---|
| **Python 3.9+** | the whole tool (stdlib only) | nothing runs |
| **PresentMon exe** (`PresentMon-x64.exe`) | frame capture | **required** — no captures; auto-download attempted, else manual drop-in |
| `nvidia-ml-py` (pip) | VRAM sampling via NVML | degrades gracefully — no VRAM block in output |
| `SimConnect` (pip) | auto-start trigger, aircraft name, altitude/phase | degrades to manual capture mode |
| `nvidia-smi` | driver-version stamp | optional — field left null |
| PowerShell | sim-version stamp (MSFS exe file-version) | optional — field left null |
| SimBrief public API | per-flight route label (user `snkeyez95`) | optional, timeout-guarded |

**One-time Windows requirement:** the user account must be in the local **"Performance Log Users"**
group so PresentMon can capture without admin elevation. This is a machine/account setting, not a
project file — it travels with the PC, not the folder, so the move doesn't affect it.

CLI flags worth knowing for integration: `--auto` (SimConnect auto-start capture), `--prep-next`
(SimBrief-driven TLOD write, chained ahead of `--auto` in `record_clean.bat`), `--next-test`
(`prep.bat`), `--rebuild-all` (`:3480` — regenerate every report + dashboard), `--rebuild-session ID`,
`--combined`, `--spike-report ID [N]` (the forensics engine).

---

## 6. Optional single-knob repoint (DOCUMENTED ONLY — not applied)

If Dean ever wants ABRP to point the engine at a root without editing code, `SCRIPT_DIR` could read
an optional env var, defaulting to today's behavior:

```python
SCRIPT_DIR = os.environ.get("MSFS_PERF_ROOT", os.path.dirname(os.path.abspath(__file__)))
```

ABRP would set `MSFS_PERF_ROOT` when spawning the process; the `.bat`s could honor the same var. This
is one behavior-neutral line and is **not needed** for a clean move (the move works as-is) — it's only
useful if ABRP ever wants to keep code and data in different places. **Not applied this session.**

---

## 7. Acceptance criteria — how we'll know the move was clean

1. `Sessions/index.json` opens and lists **all 17 flights** at the new path.
2. A full rebuild regenerates every per-flight `report.html` + `combined_report.html` with no errors,
   and they look **identical** to before.
3. The per-flight charts **render** (cdnjs reachable / libraries resolve).
4. A fresh **manual** capture (`record.bat`) and an **`--auto`** capture each file a new session
   folder + update `index.json`.
5. **`record_clean.bat`** still closes the `TARGETS`/`NORESTORE` apps, reopens them (and kills
   `ENDAPPS`/Steam) after the sim exits; **`prep.bat`** still steps `UserCfg.opt` and writes a backup
   first.
6. The **msfs-flight-analysis skill** finds the data when invoked with the new project root as the
   working directory (and is discoverable from the integrated app's skill location).

---

## 8. Carry-over project facts (unchanged, for the receiving session)

- **What it is:** a single-file Python tool that silently measures MSFS 2024 frame smoothness with
  Intel PresentMon, stamps TLOD/OLOD + driver + sim version + aircraft + SimBrief route, and files a
  per-flight folder plus rolled-up `index.json`/`index.csv` and HTML reports. It **only measures** —
  the one exception is `prep.bat`, which writes a test TLOD/OLOD into `UserCfg.opt` (always backing it
  up first) and refuses to run while the sim is open.
- **The integration surface is the data contract**, not the HTML: `Sessions/index.json` (master list)
  + per-flight `summary.json` (full detail). Stable JSON keys, `session_id` is the join key, `folder`
  locates artifacts. Consumers should read these, never scrape HTML or re-run captures.
- **Why FPS doesn't matter:** it's capped (30 native / 60 via FSR3 frame-gen), so the headline metric
  is smoothness — `p99_ft_ms`, 1%/0.1% lows, stutter % — not frame rate.
- **The deeper reference** for the data schema, pipeline, and key functions remains
  `docs/2026-06-18-project-definition-outline.md` (§6 data contract, §8 key functions). Still accurate
  except for the now-stale current-path quick-start.
