# AutoFPS 0.5.2.0-test25 — periodic spike protection: fires correctly, but recovery re-arms the trigger

Follow-up to your standing ask for a real periodic-spike episode. This one is a clean repro: **12
separate periodic episodes over 16 minutes, 10.5% of the flight**, with your protection activating
4 times and each time recovering straight back into the condition that caused it.

Flight was **offline (no VATSIM/injected traffic)**, **default arrival scenery**, and a **light
aircraft** — so almost nothing competing for the main thread except terrain LOD itself.

---

## Setup

| | |
|---|---|
| AutoFPS | **0.5.2.0-test25** |
| MSFS | 2024, 1.7.35.0 (Steam, DX12) |
| GPU / driver | RTX 3080 Ti 12GB / 566.36 |
| Mode | FSR3, frame gen 2× |
| TLOD range | **Min 125 / Max 500**, IFR profile |
| Aircraft | Citation Sovereign+ (light bizjet) |
| Route | EDDF → LOWS (Frankfurt → Salzburg, over the Alps), 40.1 min |
| Traffic | **Offline** — no VATSIM, no injected traffic |
| Scenery | Departure payware, **arrival default** |

**Flight result:** P99 21.58 ms · stutter 0.36% · consistency 98.6% · P99.9 **49.77 ms** · max 158 ms
**Bottleneck:** 99.9% CPU-bound — avg CPU busy **16.46 ms**, avg GPU busy **7.71 ms**
**During the episodes:** GPU **41–51%**, VRAM **87–89%** → **VRAM+ never engaged** (below the hold
threshold), GPU nowhere near saturated. This is pure engine/main-thread overload from TLOD.

**Where AutoFPS ran TLOD:** median **457**, max **500**, 21% of samples at the cap.

---

## What my logger independently detected

My own tool classifies periodic stutter from the raw PresentMon per-frame record (separate data
source from your RTSS buffer — so this is an independent confirmation, not a re-read of your log).
Criteria: spikes >1.8× the local 10-second median, coalesced, then runs of ≥4 spikes at a 0.7–1.8 s
cadence with near-zero interval variance.

**Result: 227 periodic spikes of 683 total. 12 episodes. 253 s = 10.51% of the flight.**

| # | Wall clock | Dur | Spikes | Cadence | Spike ms | Base ms | **TLOD at onset** |
|---|---|---|---|---|---|---|---|
| 1 | 21:02:45–21:03:28 | 43 s | 30 | 1.02 s ±0.02 | 41.1 | 16.55 | **486** |
| 2 | 21:03:35–21:04:13 | 38 s | 25 | 1.01 s ±0.02 | 40.4 | 16.55 | **500** |
| 3 | 21:04:16–21:04:27 | 11 s | 10 | 1.02 s ±0.02 | 42.3 | 16.55 | **486** |
| 4 | 21:05:51–21:06:08 | 17 s | 13 | 1.01 s ±0.02 | 39.5 | 16.55 | **486** |
| 5 | 21:06:30–21:06:52 | 22 s | 20 | 1.02 s ±0.03 | 39.3 | 16.55 | **490** |
| 6 | 21:10:43–21:10:57 | 14 s | 13 | 1.01 s ±0.05 | 44.8 | 16.55 | **491** |
| 7 | 21:12:51–21:13:06 | 14 s | 12 | 1.02 s ±0.03 | 39.5 | 16.56 | **494** |
| 8 | 21:13:25–21:13:40 | 15 s | 11 | 1.02 s ±0.03 | 43.1 | 16.56 | **500** |
| 9 | 21:15:59–21:16:12 | 12 s | 12 | 1.03 s ±0.05 | 43.9 | 16.52 | **487** |
| 10 | 21:16:15–21:16:47 | 33 s | 25 | 1.02 s ±0.03 | 46.0 | 16.52 | **489** |
| 11 | 21:17:46–21:18:04 | 18 s | 14 | 1.02 s ±0.03 | 45.2 | 16.54 | **464** |
| 12 | 21:18:22–21:18:37 | 14 s | 12 | 1.02 s ±0.02 | 41.2 | 16.54 | **453** |

The cadence is textbook — **1.01–1.03 s, σ 0.02–0.05** — and **every single episode begins with TLOD
at 453–500**, i.e. at or near the 500 cap. Base frametime is a steady 16.5 ms throughout; the spikes
are 39–46 ms on top of an otherwise clean 60 fps.

---

## What your protection did (from your log)

4 activations, 4 recoveries:

```
21:04:27  verification ended with continued detection
21:04:27  Automatic periodic spike TLOD reduction activated @ TLOD 485
21:04:59  Automatic periodic spike TLOD reduction recovery activated
21:06:37  verification ended with continued detection
21:06:37  Automatic periodic spike TLOD reduction activated @ TLOD 486
21:07:20  Automatic periodic spike TLOD reduction recovery activated
21:16:38  verification ended with continued detection
21:16:38  Automatic periodic spike TLOD reduction activated @ TLOD 477
21:17:11  Automatic periodic spike TLOD reduction recovery activated
21:18:28  verification ended with continued detection
21:18:28  Automatic periodic spike TLOD reduction activated @ TLOD 453
21:19:00  Automatic periodic spike TLOD reduction recovery activated
```

**The reductions themselves work.** SRed climbs, TLOD drops, and the stutter stops each time:

```
21:04:31  SRed:55   TLOD:445   GPU:50%  VRAM:89%
21:06:54  SRed:74   TLOD:426   GPU:48%  VRAM:89%
21:16:54  SRed:103  TLOD:397   GPU:51%  VRAM:89%
21:18:46  SRed:107  TLOD:388   GPU:43%  VRAM:89%
```

---

## The finding: recovery restores the exact condition that triggered it

Time from activation to recovery: **32 s, 43 s, 33 s, 32 s.** After each recovery SRed decays and
TLOD climbs straight back toward the cap — and the stutter returns.

The clearest instance:

| Time | Event | TLOD | SRed |
|---|---|---|---|
| 21:06:37 | **activated** | 486 | — |
| 21:06:54 | reduced, stutter stops | **426** | 74 |
| 21:07:20 | **recovery activated** (43 s later) | 432 | 55 |
| 21:07:34 | SRed nearly gone | 441 | **5** |
| 21:12:51 | *episode 7 begins* | **494** | — |
| 21:13:25 | *episode 8 begins* | **500** | — |

TLOD went 426 → 500 and the periodic stutter came right back. Same loop at 21:04 → 21:05:51, and at
21:17:11 → 21:17:46. Twelve episodes in sixteen minutes.

So the reduction is correctly sized and effective; **the recovery timer is the part that doesn't
hold.** It appears to recover on elapsed time rather than on any evidence that the underlying
condition changed — and here it hadn't: same aircraft, same Alpine terrain, same TLOD ceiling. Each
recovery walked TLOD back up to 485–500, which is precisely where every episode starts.

**Possible directions (your call, obviously):**
- Hold the reduction longer when the scene hasn't changed (still cruising, similar terrain density).
- On a re-trigger at a similar TLOD, keep a floor / decay SRed more slowly instead of returning to
  the previous ceiling — the third and fourth activations needed SRed 103–107 where the first needed
  55, which suggests the earlier recoveries gave back too much.
- Optionally back off the effective Max TLOD for the session after N re-triggers.

## Second observation: first detection took ~100 s

Episodes 1 and 2 ran **21:02:45 → 21:04:13** — 55 spikes at a clean 1.02 s cadence — before the first
verification fired at 21:04:26. There are **zero** verification attempts in the log before that
moment.

To save you ruling things out: there are **no "RTSS buffer stale" messages anywhere in the flight**
(so the test23 stale-buffer early-exit wasn't the cause), and no MSFS-not-active gating messages
either. From the per-frame record the signature was unambiguous for ~100 s before protection
engaged, so it looks threshold- rather than state-related.

## Note on the aircraft — the light-aircraft case may be the stress case

Worth flagging: this happened on a *light* aircraft, which I'd assumed would be my smoothest flight.
It's the opposite. With a heavy add-on (PMDG/Fenix) the aircraft consumes the main-thread headroom,
so AutoFPS settles TLOD lower and the engine rarely overloads. With the Citation there's nothing
else consuming the headroom, so AutoFPS pushes TLOD to ~500 — and terrain LOD itself becomes the
bottleneck. Light aircraft + high Max TLOD + dense terrain looks like the worst case for periodic
overload, and that's the combination that produced this.

My own takeaway for my setup is that Max 500 is simply too high for this aircraft class over the
Alps, and I'll lower it. But since your protection is designed for exactly this scenario, the
recovery-re-arms-the-trigger loop above seemed worth reporting.

Happy to upload the full AutoFPS log, and the per-frame data / episode list from my side, if useful.
