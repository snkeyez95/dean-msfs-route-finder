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

// Map chronological frametimes to phase buckets via wall-clock transitions.
// phaseLog: [[wallTime, phase], ...] ; recordingWallStart: baseline wall time.
function splitFrametimesByPhase(ftChron, phaseLog, recordingWallStart) {
  if (!phaseLog || !phaseLog.length || !ftChron.length) return {};
  const transitions = phaseLog
    .map(([t, p]) => [t - recordingWallStart, p])
    .sort((a, b) => a[0] - b[0]);
  const buckets = { ground: [], climb: [], cruise: [], descent: [] };
  let elapsedMs = 0.0, transIdx = 0, current = transitions[0][1];
  for (const ft of ftChron) {
    const elapsedS = elapsedMs / 1000.0;
    while (transIdx + 1 < transitions.length && elapsedS >= transitions[transIdx + 1][0]) {
      transIdx += 1; current = transitions[transIdx][1];
    }
    if (current in buckets) buckets[current].push(ft);
    elapsedMs += ft;
  }
  return buckets;
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
  trimHead, trimTail, splitFrametimesByPhase, computePhaseStats, phaseLogFromTelemetry,
  STUTTER_FRAMETIME_MS,
};
