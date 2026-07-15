'use strict';
// perf/native/periodicity.js — v6.12.1 PERIODIC-STUTTER CLASSIFIER.
// Inspired by ResetXPDR's AutoFPS 0.5.2.0-test periodic spike detection (AVSIM thread, 2026-06/07):
// when the MSFS graphics engine is overloaded (TLOD/OLOD too high for the scene), it emits spikes
// that MARCH — repeating at a ~0.7–1.8s cadence with near-zero timing variation. One-off spikes
// (scenery streaming, addon main-thread work) don't. Telling the two apart answers the question a
// raw spike count can't: "would lowering TLOD actually fix this stutter?"
//   PERIODIC episodes  → the engine-overload signature → lower TLOD/OLOD for that phase.
//   APERIODIC spikes   → streaming/main-thread hitches → TLOD won't help (scenery/addon/CPU).
// ABRP holds FULL PresentMon frametimes (AutoFPS only sees RTSS's last-1024 ring), so this runs
// retroactively over every logged flight. Pure math, desk-testable, no capture change.
//
// Method: 10s-chunk local baselines (median — robust, phase-aware: taxi vs cruise medians differ) →
// spike events = frames > max(25ms, 1.8× local median), consecutive/near frames coalesced (<0.35s
// apart = one event) → maximal runs of inter-spike intervals inside the cadence band whose timing
// std is tiny (≤ max(0.16s, 10% of the mean)) → runs of ≥4 spikes = a periodic episode.
// AutoFPS's live logs showed real detections at interval std 0.01–0.13s; the band + std gate mirror
// its enforced 0.7–1.8s cadence window.
//
// v6.12.2 — adopts ResetXPDR AutoFPS Test15's "adjacent + skip-1 only" idea: once a fundamental
// cadence is set from ≥2 real adjacent beats, a single DROPPED spike (a gap ≈ 2× the mean) BRIDGES
// the run instead of breaking it — so one sustained overload no longer fragments into many short
// episodes on the odd missed spike. A gap ≈ 3×+ the mean (two consecutive drops = a harmonic) still
// breaks the run, exactly as Test15 excludes higher harmonics.

const CADENCE_MIN_S = 0.7, CADENCE_MAX_S = 1.8;   // AutoFPS's enforced periodic-cadence band
const REL_SPIKE = 1.8;                            // spike = frame > 1.8× the local (10s) median…
const ABS_MIN_MS = 25;                            // …and above an absolute floor (60fps noise guard)
const CHUNK_S = 10;                               // local-baseline chunk length
const MERGE_S = 0.35;                             // spikes closer than this = one event (multi-frame hitch)
const MIN_RUN_SPIKES = 4;                         // ≥4 spikes (3 intervals) to call an episode
const MAX_EPISODES_STORED = 12;

function median(arr) {
  if (!arr.length) return null;
  const s = arr.slice().sort((a, b) => a - b), n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
const r2 = x => Math.round(x * 100) / 100;

// Spike events from chronological frametimes: [{t (elapsed s at the spike frame), ms, base}].
function spikeEvents(ft) {
  const events = [];
  let t = 0, ci = 0;
  // chunk boundaries by accumulated rendered time
  while (ci < ft.length) {
    const chunk = [];
    const chunkStart = ci, tStart = t;
    let ct = 0;
    while (ci < ft.length && ct < CHUNK_S * 1000) { chunk.push(ft[ci]); ct += ft[ci]; ci++; }
    const base = median(chunk);
    if (base == null || base <= 0) { t = tStart + ct / 1000; continue; }
    const thr = Math.max(ABS_MIN_MS, REL_SPIKE * base);
    let et = tStart;
    for (let i = 0; i < chunk.length; i++) {
      const v = chunk[i];
      if (v > thr) {
        const last = events[events.length - 1];
        if (last && (et - last.t) < MERGE_S) { if (v > last.ms) last.ms = v; }   // coalesce multi-frame hitch
        else events.push({ t: et, ms: v, base });
      }
      et += v / 1000;
    }
    t = tStart + ct / 1000;
  }
  return events;
}

// Maximal periodic runs among the spike events. A run grows while each new interval sits in the
// cadence band AND stays close to the run's established mean; accepted when it has ≥ MIN_RUN_SPIKES
// real spikes and its beat-interval std passes the tightness gate. `beats` holds per-beat intervals
// (a bridged skip-1 gap contributes two half-beats) so mean/std track the FUNDAMENTAL cadence even
// across a dropped spike; `run` holds only the real spikes (what we report/count).
function periodicRuns(events) {
  const runs = [];
  let i = 0;
  while (i < events.length - 1) {
    const run = [events[i]];
    const beats = [];        // per-beat intervals (bridged gap → two half-beats)
    let adj = 0;             // real adjacent beats observed (need ≥2 before a bridge is allowed)
    let j = i;
    while (j < events.length - 1) {
      const d = events[j + 1].t - events[j].t;
      const mean = beats.length ? beats.reduce((a, b) => a + b, 0) / beats.length : null;
      if (mean === null) {
        if (d < CADENCE_MIN_S || d > CADENCE_MAX_S) break;   // start only on an in-band adjacent gap
        beats.push(d); adj++;
      } else {
        const tol = Math.max(0.25, 0.25 * mean);
        if (Math.abs(d - mean) <= tol) { beats.push(d); adj++; }                              // adjacent beat
        else if (adj >= 2 && Math.abs(d - 2 * mean) <= 1.5 * tol) { beats.push(d / 2, d / 2); }  // skip-1: one dropped spike
        else break;                                                                            // adrift / harmonic
      }
      run.push(events[j + 1]); j++;
    }
    if (run.length >= MIN_RUN_SPIKES && beats.length) {
      const mean = beats.reduce((a, b) => a + b, 0) / beats.length;
      const std = Math.sqrt(beats.reduce((s, v) => s + (v - mean) * (v - mean), 0) / beats.length);
      // band-check the FINAL cadence, not just the starting gap — per-beat drift (or bridging) can
      // walk a long run's mean out of the enforced band; a reported episode must sit inside it.
      if (mean >= CADENCE_MIN_S && mean <= CADENCE_MAX_S && std <= Math.max(0.16, 0.10 * mean)) runs.push({ run, mean, std });
    }
    i = Math.max(j, i + 1);
  }
  return runs;
}

// Full classification of one flight's (trimmed, chronological) frametimes.
// Returns { spikes_total, spikes_periodic, episodes:[{start_s, end_s, spikes, interval_s,
// interval_std_s, spike_ms, base_ms}] } — or null when the flight is too short to judge.
function detectPeriodicStutter(ft) {
  if (!ft || ft.length < 600) return null;   // < ~10-20s of frames: nothing to classify
  const events = spikeEvents(ft);
  const runs = periodicRuns(events);
  const episodes = runs.map(({ run, mean, std }) => ({
    start_s: r2(run[0].t), end_s: r2(run[run.length - 1].t), spikes: run.length,
    interval_s: r2(mean), interval_std_s: r2(std),
    spike_ms: r2(run.reduce((a, e) => a + e.ms, 0) / run.length),
    base_ms: r2(run.reduce((a, e) => a + e.base, 0) / run.length),
  })).sort((a, b) => b.spikes - a.spikes);
  const periodic = episodes.reduce((a, e) => a + e.spikes, 0);
  return { spikes_total: events.length, spikes_periodic: periodic,
    episodes: episodes.slice(0, MAX_EPISODES_STORED) };
}

module.exports = { detectPeriodicStutter, spikeEvents, periodicRuns,
  CADENCE_MIN_S, CADENCE_MAX_S, REL_SPIKE, ABS_MIN_MS, MIN_RUN_SPIKES };
