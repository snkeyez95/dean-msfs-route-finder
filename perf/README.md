# perf/ — MSFS Performance Logger (vendored into ABRP)

The MSFS 2024 performance-logging engine, ported from the standalone `Claude_TLOD_OLOD`
project so ABRP can host it. **Phase 0 = relocation only; not yet wired into the app.**

## What's here
- `msfs_perf_logger.py` — the capture / stats / report engine (the file that matters).
- `test_plan.json` — the TLOD/OLOD test sweep.
- `docs/` — reference + handoff docs (some are stale / manual-era, kept for history).

## Data home (the one change vs the original)
The engine writes flight data to **`DATA_ROOT`**, which defaults to this folder but is
overridden by the `MSFS_PERF_ROOT` environment variable. ABRP sets `MSFS_PERF_ROOT` to its
user-data folder, so flight history lives at:

    %APPDATA%\A Better Route Planner\Sessions\

— writable and surviving app updates. Code/assets (this script, PresentMon) stay here.
Behavior is **identical to the original** when `MSFS_PERF_ROOT` is unset (`DATA_ROOT` falls
back to this folder).

The original standalone project (`Documents\Claude_TLOD_OLOD`) stays fully intact and usable
until the ABRP port is confirmed working. See the project roadmap for the full plan.
