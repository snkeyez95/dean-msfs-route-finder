'use strict';
// perf/native/phases.js — head/tail TRIM + flight-phase SPLIT + per-phase stats.
// PORT of msfs_perf_logger.py: _trim_head_seconds / _trim_tail_seconds /
// _split_frametimes_by_phase / _compute_phase_stats.
//
// The split is capture-coupled: at capture time Python feeds the LIVE _phase_log (transitions
// recorded on the tracker tick) + _recording_wall_start. The exact same tick loop also writes
// telemetry.csv, so telemetry's phase-change rows reconstruct _phase_log at tick granularity —
// which is what lets us validate this against existing flights. NOTE: Python passes the *trimmed*
// frametimes but transitions measured from the *un-trimmed* recording start (a ~HEAD_TRIM_S skew);
// we replicate that exactly so output matches byte-for-byte.
const { pyRound, pySum } = require('./stats.js');

const TARGET_FRAMETIME_MS = 16.67;
const STUTTER_FRAMETIME_MS = TARGET_FRAMETIME_MS * 2.0;   // 33.34 — must match stats.js / Python

// Remove the first `seconds` worth of frames (by cumulative frametime). Returns [ft, cpu, gpu].
function trimHead(ft, cpu, gpu, seconds) {
  if (seconds <= 0 || !ft.length) return [ft, cpu, gpu];
  const budget = seconds * 1000.0; let consumed = 0.0, cut = 0;
  for (let i = 0; i < ft.length; i++) { consumed += ft[i]; if (consumed >= budget) { cut = i + 1; break; } }
  return [ft.slice(cut), cpu && cpu.length ? cpu.slice(cut) : cpu, gpu && gpu.length ? gpu.slice(cut) : gpu];
}

// Remove the last `seconds` worth of frames (by cumulative frametime). Returns [ft, cpu, gpu].
function trimTail(ft, cpu, gpu, seconds) {
  if (seconds <= 0 || !ft.length) return [ft, cpu, gpu];
  const budget = seconds * 1000.0; let consumed = 0.0, cut = ft.length;
  for (let i = ft.length - 1; i >= 0; i--) { consumed += ft[i]; if (consumed >= budget) { cut = i; break; } }
  return [ft.slice(0, cut), cpu && cpu.length ? cpu.slice(0, cut) : cpu, gpu && gpu.length ? gpu.slice(0, cut) : gpu];
}

// v6.6 CANONICAL TAIL TRIM — MOVEMENT-AGNOSTIC. The old tail trim keyed off the SimConnect movement/
// stop signal, which fails when the user quits mid-taxi (never fully stops, no parking brake). Instead
// detect the sim's SHUTDOWN TEARDOWN directly from the frametimes: it's always a trailing burst of huge
// frames (menu transition / process teardown) that never recovers to sustained normal gameplay —
// regardless of whether the aircraft stopped, parked, or was still rolling. This keeps real (smooth)
// parked-at-gate frames and cuts only the teardown. Refines the CapFrameX >200ms/last-60s rule by
// requiring "no sustained normal run after", so a genuine late hitch followed by more flying is kept.
const TEARDOWN_MS = 200.0;       // a frame this big at the tail = teardown, not gameplay (taxi never sustains it)
const TEARDOWN_WINDOW_S = 120;   // only consider the last N seconds — protect real mid-flight spikes
const TEARDOWN_RESUME_S = 15;    // a sustained normal run this long after a big frame = flight continued (keep it)
const TEARDOWN_NORMAL_MS = 60;   // "normal gameplay frame" ceiling for the resume test
// Returns the cut index: everything from here to the end is teardown. ft.length = no teardown found.
function flightEndIndex(ft) {
  const n = ft.length; if (n < 10) return n;
  let t = 0, w = 0;
  for (let i = n - 1; i >= 0; i--) { t += ft[i]; if (t >= TEARDOWN_WINDOW_S * 1000) { w = i; break; } }
  for (let i = w; i < n; i++) {
    if (ft[i] <= TEARDOWN_MS) continue;
    let run = 0, resumed = false;
    for (let j = i + 1; j < n; j++) { if (ft[j] <= TEARDOWN_NORMAL_MS) { run += ft[j]; if (run >= TEARDOWN_RESUME_S * 1000) { resumed = true; break; } } else run = 0; }
    if (!resumed) return i;
  }
  return n;
}
// Trim the teardown tail; returns [ft, cpu, gpu, secondsCut] (secondsCut → stored as stop_trim_s).
function trimTeardownTail(ft, cpu, gpu) {
  const cut = flightEndIndex(ft);
  if (cut >= ft.length) return [ft, cpu, gpu, 0];
  let cutMs = 0; for (let i = cut; i < ft.length; i++) cutMs += ft[i];
  return [ft.slice(0, cut), cpu && cpu.length ? cpu.slice(0, cut) : cpu, gpu && gpu.length ? gpu.slice(0, cut) : gpu, cutMs / 1000];
}

// v6.3.8 — the single on-ground state is split into DEPARTING TAXI and ARRIVAL TAXI so ground
// performance attributes to the departure vs arrival airport. The classifier only knows "ground"
// (simconnect.js), so we split by the TIMELINE: ground before the first airborne phase = departing
// taxi (incl. takeoff roll); ground at/after the final landing = arrival taxi (incl. rollout);
// any interior ground (go-around/touch-and-go) is dropped as ambiguous.
function taxiBoundaries(transitions) {
  let dep = Infinity;                                  // ground before this elapsedS = departing taxi
  for (const [ts, p] of transitions) { if (p !== 'ground') { dep = ts; break; } }
  let arr = Infinity;                                  // ground at/after this elapsedS = arrival taxi
  for (const [ts, p] of transitions) { if (p === 'ground') arr = ts; }
  if (!(arr > dep)) arr = Infinity;                    // no genuine arrival ground (all-ground, or ended airborne)
  return { dep, arr };
}

// Map chronological frametimes to phase buckets via wall-clock transitions.
// phaseLog: [[wallTime, phase], ...] ; recordingWallStart: baseline wall time.
// Canonical phase keys: dep_taxi / climb / cruise / descent / arr_taxi (no combined "ground").
function splitFrametimesByPhase(ftChron, phaseLog, recordingWallStart) {
  if (!phaseLog || !phaseLog.length || !ftChron.length) return {};
  const transitions = phaseLog
    .map(([t, p]) => [t - recordingWallStart, p])
    .sort((a, b) => a[0] - b[0]);
  const { dep, arr } = taxiBoundaries(transitions);
  const buckets = { dep_taxi: [], climb: [], cruise: [], descent: [], arr_taxi: [] };
  let elapsedMs = 0.0, transIdx = 0, current = transitions[0][1];
  for (const ft of ftChron) {
    const elapsedS = elapsedMs / 1000.0;
    while (transIdx + 1 < transitions.length && elapsedS >= transitions[transIdx + 1][0]) {
      transIdx += 1; current = transitions[transIdx][1];
    }
    if (current === 'ground') {
      if (elapsedS < dep) buckets.dep_taxi.push(ft);
      else if (elapsedS >= arr) buckets.arr_taxi.push(ft);
      // else interior ground (go-around) — dropped
    } else if (current in buckets) {
      buckets[current].push(ft);
    }
    elapsedMs += ft;
  }
  return buckets;
}

// Per-phase VRAM (peak/avg MB) from 1 Hz telemetry, split into the same 5 phases by the taxi
// boundaries. telemetryRows: [{wall_ms, phase, vram_mb, ...}] (recording-relative wall_ms).
function computePhaseVram(telemetryRows) {
  if (!telemetryRows || !telemetryRows.length) return {};
  const trans = phaseLogFromTelemetry(telemetryRows);
  if (!trans.length) return {};
  const { dep, arr } = taxiBoundaries(trans);
  const acc = {};
  const add = (ph, v) => { if (v == null || isNaN(v)) return; if (!acc[ph]) acc[ph] = { sum: 0, n: 0, peak: 0 }; acc[ph].sum += v; acc[ph].n++; if (v > acc[ph].peak) acc[ph].peak = v; };
  for (const r of telemetryRows) {
    const v = r.vram_mb; if (v == null) continue;
    let ph = r.phase;
    if (ph === 'ground') { const s = r.wall_ms / 1000.0; ph = (s < dep) ? 'dep_taxi' : (s >= arr ? 'arr_taxi' : null); }
    if (!ph) continue;
    add(ph, v);
  }
  const out = {};
  for (const ph of Object.keys(acc)) out[ph] = { vram_peak: Math.round(acc[ph].peak), vram_avg: Math.round(acc[ph].sum / acc[ph].n) };
  return out;
}

// Per-phase summary stats. p99 here is the SIMPLE index percentile (s[int(n*0.99)]), NOT
// compute_stats' interpolated percentile — matches Python _compute_phase_stats exactly.
function computePhaseStats(buckets, totalFrames) {
  const result = {};
  for (const phase of Object.keys(buckets)) {
    const fts = buckets[phase];
    if (!fts.length) continue;
    const n = fts.length;
    const avg = pyRound(pySum(fts) / n, 2);
    const s = fts.slice().sort((a, b) => a - b);
    const p99 = pyRound(s[Math.min(Math.trunc(n * 0.99), n - 1)], 2);   // int(n*0.99) truncates
    let stut = 0; for (const f of fts) if (f > STUTTER_FRAMETIME_MS) stut++;
    result[phase] = {
      frame_count: n,
      avg_ft: avg,
      p99_ft: p99,
      stutter_pct: pyRound(stut / n * 100, 3),
      pct_of_total: totalFrames > 0 ? pyRound(n / totalFrames * 100, 1) : 0.0,
    };
  }
  return result;
}

// Reconstruct the transition list (Python's _phase_log form) from telemetry rows: the first row
// (initial phase) plus every row where the phase changes, at that row's wall_ms (already relative
// to the recording start, so recordingWallStart passed to the split is 0).
function phaseLogFromTelemetry(telemetryRows) {
  const log = [];
  let prev = null;
  for (const r of telemetryRows) {
    const ph = r.phase;
    if (!ph) continue;
    if (ph !== prev) { log.push([r.wall_ms / 1000.0, ph]); prev = ph; }
  }
  return log;
}

module.exports = {
  trimHead, trimTail, trimTeardownTail, flightEndIndex, splitFrametimesByPhase, computePhaseStats,
  phaseLogFromTelemetry, taxiBoundaries, computePhaseVram, STUTTER_FRAMETIME_MS,
};
