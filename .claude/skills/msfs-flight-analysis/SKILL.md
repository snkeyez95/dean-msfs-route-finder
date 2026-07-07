---
name: msfs-flight-analysis
description: Use when Dean asks to analyze his MSFS 2024 flight performance logs - e.g. "analyze my last flight", "compare PMDG vs Fenix", "show me TLOD 100 flights", "what's the tradeoff of raising TLOD", "did rBAR actually help", "what caused that spike", "why did it stutter", "it felt rough on approach", "diagnose the spike at X", or any request to interpret data in the Sessions folder (index.json, summary.json, frametimes.csv, telemetry.csv).
---

# MSFS Flight Performance Analysis

Dean logs MSFS 2024 performance data with `msfs_perf_logger.py`. This skill is the playbook for
analyzing that data well - comparative, quantitative, and to the point.

## Where the data lives

- `Sessions\index.json` - one compact entry per flight (aircraft, tlod, olod, driver_version,
  sim_version, p99_ft_ms, stutter_pct, consistency_pct, avg_fps, peak_vram_mb, frame_count, folder).
  **Always start here** - read this one file to see the whole history before going deeper.
  `sim_version` is the MSFS exe's raw Windows file-version (e.g. `1.4.3.0`), captured automatically
  from 2026-06-16 onward; flights before that are `null`/missing since it wasn't tracked yet - don't
  treat a missing value as "version unknown and irrelevant," treat it as "predates tracking."
- `Sessions\<date>\<time_TLODxxx_OLODxxx>\summary.json` - full detail for one flight: settings,
  the complete `smoothness` block (p50/p95/p99/p999/max, stdev, 1%/0.1% low, gpu/cpu-bound %,
  duration_seconds, frame_count), `vram` block (avg/peak/pct/total), and a `notes` field Dean
  sometimes fills in (e.g. "forgot GSX") - **always check `notes`** before comparing two flights,
  since a missing addon or different scenery load invalidates an apples-to-apples VRAM comparison.
- **SCENERY / 5-PHASE MODEL (v6.3.8+):** `smoothness.phases` now splits into **five** phases —
  `dep_taxi` (departing taxi + takeoff roll), `climb`, `cruise`, `descent`, `arr_taxi` (landing
  rollout + taxi-in). There is NO combined "ground" phase anymore. **Each phase carries BOTH
  metrics**: frametime (`p99_ft`, `stutter_pct`, `avg_ft`, `frame_count`, `pct_of_total`) AND VRAM
  (`vram_peak`, `vram_avg` in MB). This is what lets you attribute ground performance to the
  DEPARTURE vs ARRIVAL airport separately — arrival taxi is almost always the worse/heavier end
  (payware + aircraft avionics on approach), and arrival-taxi `vram_peak` is usually the flight's
  VRAM peak. Each flight also carries `settings.dep_icao`/`arr_icao` and `dep_scenery`/`arr_scenery`
  (booleans: is that airport a 3rd-party scenery the user owns). The `index.json` entries and the
  `perf-compare-data` payload carry `dep_icao/arr_icao/dep_scenery/arr_scenery` +
  `dep_taxi_p99/stutter/vram` + `arr_taxi_p99/stutter/vram` per flight — so you can answer "which of
  my payware airports has the worst arrival-taxi VRAM/frametime" directly. **Pre-v6.3.8 flights**
  (before this) keep the old combined `ground` in their untouched summary.json but gain a
  `phases_ext.json` SIDECAR in the folder with the 5-phase split (same shape) — read the sidecar for
  the taxi split on those; new flights have it inline in summary.json. Only flights WITH telemetry
  (2026-06-22 onward) can be split; older ones have neither. When ranking airports by ground cost,
  normalize per-aircraft (Fenix's avionics make its taxi heavier than PMDG's) and gate on sample
  size - one taxi at one airport is not a verdict (a fresh reboot alone swings ground numbers).
- `Sessions\<date>\<time...>\frametimes.csv` - raw per-frame PresentMon data. Beyond frametime it
  carries a full forensic stack (`TimeInMs`, `MsCPUBusy`, `MsCPUWait`, `MsGPUBusy`, `MsGPUWait`,
  `MsGPULatency`, `MsRenderPresentLatency`, `MsAnimationError`, `PresentMode`) - the basis for spike
  forensics below. Don't hand-parse this 250k+ row file; run `--spike-report` (below) instead.
- `Sessions\<date>\<time...>\telemetry.csv` - 1 Hz sidecar (wall_ms, phase, alt_ft, vram_mb,
  sys_ram_pct, sys_cpu_pct, top_proc, top_proc_cpu). **Only exists for flights from 2026-06-22
  onward** (when telemetry was added); earlier flights have none - treat absence as "predates
  telemetry," not "nothing happened." This is what lets a spike be tied to a flight phase, an
  altitude, a VRAM level, or another process hogging the CPU.
- `Sessions\combined_report.html` - already does TLOD-vs-smoothness/VRAM charting and a filterable
  table; mention it as a no-token follow-up but don't treat it as a substitute for the analysis
  asked for here.

## What matters, and why

FPS is capped (30 native / 60 via FSR frame-gen), so it's context only, never the headline. The
two things that actually move are:

1. **Smoothness** - `p99_ft_ms` is the headline number (target &le;16.7ms is butter, &le;20ms is
   smooth, &le;33.3ms is starting to stutter, above that is a real problem). Back it up with
   `stutter_pct` (frames over the stutter threshold), `consistency_pct`, `frametime_stdev_ms`, and
   `one_pct_low_fps` / `point_one_pct_low_fps` for how bad the worst moments get.
2. **VRAM headroom** - `peak_vram_mb` against the known 12,288 MB card. `avg_vram_mb` shows typical
   load; the gap between avg and peak shows how spiky it is. No VRAM creep across a long flight
   (peak not still climbing near the end) rules out a leak - mention this when a flight runs long.

## Known confounds - always check before comparing flights

Before treating two flights as comparable, check whether these differ between them, and call it
out explicitly if so rather than silently averaging over it:

- **Driver version** (`driver_version`) - 610.47, 591.86 (accidental Windows Update swap), and
  566.36 are not equivalent; 566.36 is the current known-good baseline (paired with rBAR disabled).
- **Sim version** (`sim_version`) - a jump in this value between two flights means a sim update
  installed in between. If P99/VRAM shifts right after a `sim_version` change, that's the prime
  suspect before blaming TLOD, aircraft, or driver - this is exactly how the SU5 regression that
  kicked off this whole investigation would show up if it happened again. Always check this first
  when a flight performs unexpectedly worse than recent history at the same TLOD/aircraft.
- **rBAR fix timing** - sessions before 2026-06-15 13:19 predate the rBAR-disable fix and ran
  meaningfully hotter on VRAM for the same TLOD; don't present pre/post-fix VRAM deltas as a TLOD
  or aircraft effect.
- **Aircraft + scenery weight** - PMDG vs Fenix is its own variable, and so is payware vs default
  scenery at the departure/arrival. Dean doesn't log routes/scenery as structured data, so check
  `notes` and ask Dean if it's not obvious and the comparison hinges on it.
- **GSX or other addons** running or not (sometimes noted in `notes`).
- **Flight duration** - a 47-minute hop and a 125-minute flight aren't directly comparable for VRAM
  creep; normalize the framing ("no creep over 2 hours" is a stronger claim than over 45 minutes).

## How to answer common question types

**"Analyze my last flight" / single-flight deep dive**
Read its `summary.json`. Lead with P99 + grade, stutter%, peak VRAM + % of 12GB. Compare against
the next-best prior flight at the *same TLOD* if one exists (call out the comparison flight by
date/aircraft). Note duration and whether VRAM was still climbing at the end. Flag anything in
`notes`.

**"Compare PMDG vs Fenix"**
Filter `index.json` sessions by `aircraft` into two groups. For each group, report the median (not
just best) P99, stutter%, and peak VRAM, plus n (flight count) - a median from 1 flight is just
that flight, say so. State the TLOD each group was tested at; if they're not the same TLOD, say
the comparison is TLOD-confounded before drawing a conclusion. Give the headline number delta in
plain terms ("PMDG ran ~2ms tighter P99 and ~750MB lower peak VRAM, but on a lighter scenery load
and a different TLOD - so call this suggestive, not conclusive").

**"Show me TLOD 100 flights" / filter by setting**
Filter `index.json` by `tlod`. List them chronologically with aircraft, driver, P99, VRAM. If asked
to also filter by aircraft, AND both conditions. Point out if results span multiple driver versions
or pre/post-rBAR-fix dates, since that affects whether the set is internally comparable.

**"Tradeoff of raising TLOD" / TLOD-vs-performance trend**
Group `index.json` sessions by `tlod`, take the median P99 and median peak VRAM per TLOD bucket
(same logic as `_group_by_tlod()` in msfs_perf_logger.py). Walk the trend in order: state the delta
between consecutive TLOD steps in both ms and MB - e.g. "TLOD 80 &rarr; 100: P99 +1.0ms, VRAM peak
+650MB. TLOD 100 &rarr; 125: P99 +2.3ms, VRAM peak +800MB." Identify the highest TLOD still &le;20ms
P99 (the "knee") as the practical ceiling given current settings, and say how much headroom is left
to the next step up. Caveat low-n buckets (n=1) as unconfirmed.

## Spike forensics - put on the Holmes hat

When Dean asks **"what caused that spike", "why did it stutter", "it felt rough on approach/taxi",
"diagnose the spike at X"** - this is detective work, not a stat dump. Don't read frametimes.csv by
hand. Run the engine:

```
python msfs_perf_logger.py --spike-report <SESSION_ID> [N]
```

It prints a human table and a `SPIKE_JSON_BEGIN ... SPIKE_JSON_END` block. **Reason over the JSON.**
Each event has: time (mm:ss into flight), peak frametime, a `class`, the evidence (`why`), the raw
columns, and - if telemetry exists - phase, alt_ft, vram_mb, sys_cpu_pct, and the top other process.

### The #1 rule: filter capture-gaps before saying anything

The report separates **non-render gaps** (alt-tab to a VATSIM client/charts, pause, loading screen,
menu, shutdown) from real stutters. A "frametime" of seconds isn't a stutter - the sim simply wasn't
presenting. **Never present these as performance problems.** Mention them only as "X minutes where
the sim wasn't rendering (alt-tab/pause), excluded." (Validated: one VATSIM flight had 22 min of
these - all normal online-flying behavior, zero stutters.)

### The #2 rule: lead with timestamp/phase, not the raw peak

Most "spikes" are loading, not gameplay. On a typical flight nearly every spike sits at **spawn-in
(first ~90 s)** or **shutdown (last ~30 s)** - normal asset loading, dismiss them. Focus Dean on
**genuine mid-flight hitches**. If telemetry exists, say the phase/altitude ("a 198 ms hitch at
FL340 in cruise"); if not, the mm:ss timestamp alone tells you spawn vs cruise vs shutdown.

### Classification decision tree (what the `class` means)

- **CPU-bound** - `MsCPUBusy` ≈ the frame, and/or large `MsGPUWait` (GPU sat idle, starved). The
  signature of MSFS main-thread work: scenery/asset streaming, AI traffic injection, weather, addon
  logic (PMDG FMC), autosave. By far the most common - MSFS is main-thread limited.
- **GPU-bound** - `MsGPUBusy` ≈ the frame. Texture streaming / fill-rate / VRAM pressure. Notably
  *absent* in Dean's data so far, even at TLOD 175 / 97% VRAM - so if you see one, it's worth
  flagging as new.
- **present-stall** - render-present latency high while CPU+GPU are idle. The frame was ready but
  couldn't present: driver, vsync, an overlay (RTSS/Discord/GeForce), or the OS compositor.
- **external?** - neither CPU nor GPU elevated → the cause is outside MSFS. **Cross-check the
  telemetry join**: did `sys_cpu_pct` jump, or `top_proc` name something (Windows Defender, a
  download, Plex)? This is exactly the "another process grabbed a core" case.

### The microstutter tell

`MsAnimationError` (large magnitude) flags a hitch the *sim* felt even when frametime looks clean -
the simulation time-stepped unevenly. **When Dean says "it felt rough but the numbers looked fine,"
check animation error**, not just frametime.

### Retroactive vs going-forward

Classification (CPU/GPU/present/external from the PresentMon columns) works on **every flight ever
logged**. The telemetry join (phase, altitude, VRAM, system CPU/RAM, culprit process) only exists
for flights **2026-06-22 onward** - on an older flight, say the class and timestamp but note you
can't name the phase/process without telemetry.

### How to present it

Verdict first, evidence second - e.g. *"That rough approach was three CPU-bound hitches at 39-40 min
(GPU starved, 400-700 ms each) - classic main-thread load as VATSIM traffic poured in on arrival.
Not a TLOD or VRAM problem. The other 22 minutes of 'spikes' were just alt-tabs to your pilot
client."* Keep it stat-first and plain, same as the rest of this skill.

## Baseline recommendation - the single best TLOD ("what should I set?")

When Dean asks **"what's my baseline", "best TLOD", "what should I set globally", "did my baseline
change"** - this matches the in-app Performance -> Baseline view, and your answer MUST agree with it
(one spec, two surfaces). The method:

1. **Clean subset only - never all-vs-all** (the confound trap that faked a 2ms "sim update win" on
   2026-06-30). Use only: aircraft in {Fenix, PMDG}; TLOD in {100,125,150,175}; the modal
   `driver_version` (drop 591.86 / 610.47 flights); non-AutoFPS. Exclude the Citation (reference) and
   the out-of-grid Fenix-80 flight. Say how many you excluded and why.
2. **Per-aircraft, per-TLOD means** over the (target 3) flights/cell - averaging the 3 routes smooths
   the route-driven peak-VRAM noise.
3. **Blend = worst-of-the-two** at each TLOD across Fenix & PMDG (max p99, max stutter, MIN consistency,
   max peak VRAM). One number, safe for both heavies; lighter planes only do better. NOT per-aircraft.
4. **Hard limits:** consistency >= 99%, stutter <= 0.1%, peak VRAM <= 90% of 12,288 MB (~11,059). A
   TLOD "passes" if its blended profile clears all three.
5. **Three modes:** Smoothest = lowest-p99 passing TLOD; Best-visuals = highest passing TLOD; **Balanced
   (the headline) = the best-balance point** = highest TLOD whose blended p99 is within ~1.0ms of the
   best AND VRAM still under the limit. Lead with Balanced; break out the other two only if asked. (Avoid
   the word "knee" with Dean — say "best balance" / "sweet spot".)
6. **Honesty at low n:** with <3 flights/cell a single rough flight sways the pick - say "preliminary,
   firms up as the benchmark completes." A `sim_version` seam in the set is a caveat, not a result.

As of 2026-06-30 (18/24 flights) the tool recommends **TLOD 125** - PMDG's 150/175 cells each carry one
outlier flight at n=2 that drag the blend down; it will likely rise toward 150 as those cells get a 3rd
flight. Fenix's own knee is already 150; PMDG is the binding constraint.

## Presentation style Dean likes

Stat-first, then a short plain-English read - not a wall of caveats, not flowery narrative. Pattern
that's worked well in this project:

- Lead with the headline number and what it means (good/ok/bad), not a generic intro.
- Comparative numbers as explicit deltas ("776MB lighter, despite running 2.7x longer"), not just
  two numbers side by side for Dean to subtract himself.
- One short verdict line, grounded in the numbers just stated - not generic praise.
- Caveats stated plainly and only when they actually affect the conclusion (driver swap, missing
  GSX, different TLOD) - don't pad with hedges that don't change the takeaway.
- Visuals: the visualize tool's show_widget is a good fit for these analyses when Dean is comparing
  flights interactively in chat - reuse the stat-card / banner / comparison-table style already
  established (light theme, green-bordered banner for "best yet" results) rather than inventing a
  new look each time.
