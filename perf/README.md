# perf/ — MSFS Performance Engine (native, v6.0.0)

ABRP's built-in performance logger: records per-frame timing while MSFS 2024 flies (Intel
PresentMon), samples VRAM + system telemetry, auto-starts via SimConnect when the aircraft rolls,
and files each flight as `frametimes.csv` + `summary.json` + a self-contained `report.html` under
`%APPDATA%\A Better Route Planner\Sessions\` (set via the `MSFS_PERF_ROOT` env var by main.js).

**Since v6.0.0 the engine is pure Node** — `perf/native/` — spawned by `main.js`
(`perf-start-capture` runs `native/run_capture.js` detached via Electron-as-node;
`perf-prep-next` runs `native/prep.js` in-process). It was ported module-by-module from the
original Python engine and proven **byte-for-byte identical** over 21 real flights plus a live
baseline flight before the cutover.

## What's here

| Item | Role |
|---|---|
| `native/` | The engine (20 modules): capture orchestration, SimConnect auto-start + self-healing reconnect, PresentMon control, VRAM/telemetry samplers, stats/trim/phase math, report + index writers, CapFrameX export, auto-TLOD prep |
| `native/report_assets/` | CSS/JS baked into generated reports |
| `vendor/` | Chart.js + plugins bundled so reports render fully offline |
| `PresentMon-x64.exe` | Intel's frame-capture tool (on disk + shipped via extraResources; gitignored) |
| `msfs_perf_logger.py` + `test_plan.json` | The RETIRED Python engine — kept as the validation reference and a dev-only fallback (`nativePerfEngine:false` in config). No longer tracked as a binary or shipped. The original standalone project is archived at `Documents\Claude_TLOD_OLOD` |
| `build_pyi/perf-engine.spec` | PyInstaller spec, kept only so the fallback exe could ever be re-frozen |
| `Convert_to_CapFrameX.bat` | Drag-and-drop CapFrameX export helper (native `capframex.js` will replace it with an in-app button) |
| `docs/` | Historical project docs from the port |

## Packaging

`build.files` excludes `perf/**` from the asar; `extraResources` ships `PresentMon-x64.exe`,
`vendor/`, and the `native/` runtime (dev files filtered). `node-simconnect` + its dependency
closure is `asarUnpack`'d; the detached capture resolves it via `NODE_PATH` →
`app.asar.unpacked/node_modules`. Verified by a packaged-runtime probe (7/7) before v6 shipped.
