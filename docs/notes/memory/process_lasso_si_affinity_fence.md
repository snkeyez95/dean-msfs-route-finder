---
name: process-lasso-si-affinity-fence
description: "The SayIntentions/WebView2 CPU-storm that caused near-crash climb freezes, and the Process Lasso affinity fence that fixed it (validated)"
metadata: 
  node_type: memory
  type: project
  originSessionId: 169a96fe-eac5-4a96-b021-e23e74773bc5
  modified: 2026-09-22T16:30:59.195Z
---

**Symptom (2026-09-20, KLAX→KLAS, Citation X):** a handful of ~1-second freezes on climb-out that felt
like the sim was about to crash — a first for Dean. Frametimes: max 961 ms, stdev 7.32, 52 felt stutters
(>100 ms), climb stutter 0.419% / climb P99 22.79.

**Cause (from --spike-report):** a background CPU storm starving MSFS's main thread — every big freeze was
CPU-bound with the GPU idle. Top offenders: **`SayIntentionsAI.exe` + its ~6 `msedgewebview2.exe` UI helper
processes** (SI renders its interface in WebView2 — a Process Lasso search for "sayintentions" surfaces all
six webviews, confirming they're SI's children). Freezes hit 900–1,179 ms. **NOT** the sim, hardware, VRAM
(only ~80% on climb), or the 250/400 TLOD config. GPU-Z appeared once but is a required AutoFPS dependency
and benign — don't touch it.

**Why ProBalance (on 6+ months) didn't catch it:** ProBalance triggers on *overall* CPU load, which was
only 40–71% — not "system under duress" by its metric. But MSFS's problem is **single-core main-thread
contention**: SI/WebView2 landing on the sim's hot core. ProBalance is blind to that when total load looks
fine. So ProBalance is the wrong tool for this failure mode.

**Fix — Process Lasso persistent CPU affinity fence:** right-click each of `SayIntentionsAI.exe` and
`msedgewebview2.exe` → CPU Affinity → **Always** → check only cores **14 & 15** (Dean's CPU = 16 logical,
0–15; fence onto the top 2, off the sim's 0–13 main-thread lane). The rule is by process NAME, so it
auto-covers all six WebView2 PIDs and any future ones. MSFS left unrestricted (soft fence, not mutual
exclusion). Set 2026-09-21.

**Validated (2026-09-22, KDFW→KTPA):** climb went clean — worst climb spike **88 ms** (was 900–1,179 ms).
Max 136 ms (was 961), stdev 0.81 (was 7.32), 6 felt (was 52), climb stutter 0.04% (was 0.419%). Attributable,
not luck: **WebView2 dropped out of the top spikes entirely**, and SI still bursts (still top process on the
small spikes) but is now **capped ~100–215 ms** — contained, not absent. That's the fence doing its job.

**Caveats:**
- Dean's Process Lasso is **UNLICENSED** — persistent affinity is a Pro feature after the 30-day trial, so
  verify the rule re-applies after an SI restart (the CPU-affinity column should stay `14-15`, not revert to
  `0-15`). If it reverts, needs Pro, or set per-session via CPU Affinity → Current.
- If SI's own UI ever feels laggy on 2 cores, widen the fence to 12–15.
- Windows Defender exclusions for MSFS/Community folders were already done in prior discussions — an
  occasional `MsMpEng` blip on arrival is background noise (Defender can still scan non-excluded files), not
  chased further.
- The other recurring background offender across flights is SI generally (comms bursts near airports); the
  fence contains it. Closing SI when not using voice is the zero-cost alternative.

Related: [[autofps-tlod-band-250-400]] (same 250/400 era), [[project_next_steps]].
