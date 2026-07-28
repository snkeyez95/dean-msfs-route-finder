# AutoFPS 0.5.2.0-RC3 — periodic spike protection fires correctly, but recovery re-arms the trigger

You'd asked for a real periodic-spike episode. This flight had 12 of them — 10.5% of 40 minutes —
with protection activating 4 times and each time recovering back into the condition that caused it.

**Setup:** AutoFPS **0.5.2.0-RC3** (auto-updated from test25 15 min pre-flight) · MSFS 2024 1.7.35.0
Steam/DX12 · RTX 3080 Ti 12GB, driver 566.36 · FSR3, FG 2× · **TLOD Min 125 / Max 500, IFR** ·
Citation Sovereign+ (light bizjet) · EDDF→LOWS over the Alps, 40.1 min · **offline, no injected
traffic, default arrival scenery.**

**Flight:** P99 21.58 ms · P99.9 49.77 ms · stutter 0.36% · **99.9% CPU-bound** (CPU busy 16.46 ms,
GPU busy 7.71 ms). During the episodes GPU sat at **41–51%** and VRAM **87–89%**, so VRAM+ never
engaged and the GPU was never the limit. AutoFPS ran TLOD at **median 457, max 500** (21% at cap).

---

## The episodes

Detected from the PresentMon per-frame record on my side — separate data from your RTSS buffer, so
this is an independent read rather than a re-parse of your log. Spikes are 39–46 ms against a steady
**16.5 ms** base.

| # | Wall clock | Dur | Spikes | Cadence | Spike ms | **TLOD at onset** |
|---|---|---|---|---|---|---|
| 1 | 21:02:45–21:03:28 | 43 s | 30 | 1.02 s ±0.02 | 41.1 | **486** |
| 2 | 21:03:35–21:04:13 | 38 s | 25 | 1.01 s ±0.02 | 40.4 | **500** |
| 3 | 21:04:16–21:04:27 | 11 s | 10 | 1.02 s ±0.02 | 42.3 | **486** |
| 4 | 21:05:51–21:06:08 | 17 s | 13 | 1.01 s ±0.02 | 39.5 | **486** |
| 5 | 21:06:30–21:06:52 | 22 s | 20 | 1.02 s ±0.03 | 39.3 | **490** |
| 6 | 21:10:43–21:10:57 | 14 s | 13 | 1.01 s ±0.05 | 44.8 | **491** |
| 7 | 21:12:51–21:13:06 | 14 s | 12 | 1.02 s ±0.03 | 39.5 | **494** |
| 8 | 21:13:25–21:13:40 | 15 s | 11 | 1.02 s ±0.03 | 43.1 | **500** |
| 9 | 21:15:59–21:16:12 | 12 s | 12 | 1.03 s ±0.05 | 43.9 | **487** |
| 10 | 21:16:15–21:16:47 | 33 s | 25 | 1.02 s ±0.03 | 46.0 | **489** |
| 11 | 21:17:46–21:18:04 | 18 s | 14 | 1.02 s ±0.03 | 45.2 | **464** |
| 12 | 21:18:22–21:18:37 | 14 s | 12 | 1.02 s ±0.02 | 41.2 | **453** |

227 periodic spikes of 683 total, 253 s in episodes. Every episode starts with TLOD at 453–500.

## What protection did

```
21:04:27  activated @ TLOD 485      21:04:59  recovery activated
21:06:37  activated @ TLOD 486      21:07:20  recovery activated
21:16:38  activated @ TLOD 477      21:17:11  recovery activated
21:18:28  activated @ TLOD 453      21:19:00  recovery activated
```

The reductions work — SRed climbs, TLOD drops, stutter stops every time:

```
21:04:31  SRed:55   TLOD:445        21:16:54  SRed:103  TLOD:397
21:06:54  SRed:74   TLOD:426        21:18:46  SRed:107  TLOD:388
```

## The loop

Activation to recovery: **32 s, 43 s, 33 s, 32 s.** Then SRed decays, TLOD climbs back to the cap,
and the stutter returns. The second cycle in full:

| Time | | TLOD | SRed |
|---|---|---|---|
| 21:06:37 | activated | 486 | — |
| 21:06:54 | reduced, stutter stops | **426** | 74 |
| 21:07:20 | recovery (43 s later) | 432 | 55 |
| 21:07:34 | SRed nearly gone | 441 | **5** |
| 21:12:51 | episode 7 | **494** | — |
| 21:13:25 | episode 8 | **500** | — |

Same pattern at 21:04→21:05:51 and 21:17:11→21:17:46. The scene hadn't changed between recovery and
re-trigger — same aircraft, same terrain, same ceiling — so TLOD came back to 485–500, which is
where every episode starts.

A few things I couldn't work out from the outside:

- Is recovery on a fixed timer, or is it meant to see some change in conditions before giving TLOD
  back? From the log it looks like elapsed time alone.
- Would holding a floor after a re-trigger at similar TLOD make sense, rather than returning to the
  previous ceiling? The first activation needed SRed 55; the last two needed 103–107, which made me
  wonder whether the earlier recoveries gave back too much.
- Is there a case for backing off the session's effective Max TLOD after a few re-triggers, or does
  that cut across what VRAM+ is doing?

## Detection latency

Episodes 1 and 2 ran 21:02:45→21:04:13 — 55 spikes at a 1.02 s cadence — with **no verification
attempts in the log** until 21:04:26. There are no "RTSS buffer stale" messages anywhere in the
flight and no MSFS-not-active gating, so neither of those explains the ~100 s gap.

## On the aircraft

I'd assumed a light aircraft would be my smoothest flight and got the opposite. With a heavy add-on
the aircraft takes the main-thread headroom and AutoFPS settles TLOD lower; with the Citation there's
nothing else using it, so TLOD goes to ~500 and terrain LOD becomes the bottleneck. Light aircraft +
high Max TLOD + dense terrain may be the harder case for periodic overload.

I'll lower my own Max TLOD for this aircraft class regardless. Happy to send the full log or the
per-frame data if it's useful.
