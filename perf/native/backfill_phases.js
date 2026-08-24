'use strict';
// v6.3.8 sidecar backfill — recompute the 5-phase split (dep_taxi/climb/cruise/descent/arr_taxi) +
// per-phase VRAM for pre-v6.3.8 flights (which have telemetry) and write a NEW phases_ext.json in
// each session folder. ORIGINALS (summary/frametimes/telemetry) are NEVER modified — the guardrail.
// Idempotent (skips folders already corrected). Mirrors engine.js computeSmoothness + the VRAM merge
// exactly, so backfilled old flights match natively-written new flights.
// Run detached on launch by main.js; also runnable standalone (node backfill_phases.js <SessionsDir>).
//
// v6.6 TEARDOWN CORRECTION: the pre-v6.6 tail trim (movement-based stop_trim_s) under-cut on flights
// where the sim shutdown/menu teardown ran while sitting at the gate (or quitting mid-taxi), leaving a
// 300–1300 ms burst of frames in the kept window → inflated max_ft_ms / spike_count / perceptible_count
// and a poisoned arr_taxi phase. This backfill re-trims EVERY logged flight with the canonical
// movement-agnostic trimTeardownTail (phases.js), recomputes those corrected values into the sidecar
// (trim_v:'teardown'), and regenerates each report.html from the trimmed data — WITHOUT touching the
// original logs. Readers (main.js perf-compare-data) prefer the corrected sidecar values.
const fs = require('fs'), path = require('path');
const { readChronological, readTelemetry } = require('./report_charts.js');
const { trimHead, trimTail, trimTeardownTail, splitFrametimesByPhase, computePhaseStats, phaseLogFromTelemetry, computePhaseVram } = require('./phases.js');
const { buildReport } = require('./report_html.js');
const { buildCombinedReport } = require('./report_combined.js');
const { writeSidecar: writeAutofpsSidecar } = require('./autofps_log.js');

const { detectPeriodicStutter } = require('./periodicity.js');

const HEAD = 5;
const TRIM_V = 'teardown';   // marker: this sidecar carries the v6.6 teardown-corrected metrics/phases
const PERIODIC_V = 'skip1-bridge'; // classifier version stamped into the sidecar; a change forces a one-time reclassification of every flight (v6.12.2 = dropped-spike bridging)
const VRAM_V = 'anchor-trim';  // marker: bump to force a one-time sidecar recompute (v6.17.0: the end trim now reproduces the capture's own brake/movement anchor instead of re-deriving it, so max/spike/perceptible + the phase split match the flight's summary)
const REPORT_V = 'fps-hover-dot-v4'; // marker: bump to force a one-time report.html regen for ALL flights (v6.19.5: FPS chart line reads from the smoothed series instead of reciprocated per-frame spikes)
const r2 = n => Math.round(n * 100) / 100;
const r1 = n => Math.round(n * 10) / 10;

// Read frametimes.csv → head-trim (5 s) → the flight's OWN end trim. Returns { ft, teardownS } or null.
// Only needs frametimes.csv, so it works even on flights that predate telemetry.
//
// v6.17.0 (Dean 2026-08-02): RESPECT THE CAPTURE'S ANCHOR. This used to always re-trim with
// trimTeardownTail, which is the frametime-SHAPE fallback — but a capture that found a ground-truth
// end (parking brake set and held, or last movement) already cut the tail correctly and recorded how
// much it cut. Re-deriving it here kept shutdown frames the capture had thrown away, so the sidecar
// disagreed with the flight's own summary: 37 of 51 flights, including ALL 20 with trim_method
// 'brake'. The report and the Compare view both read the sidecar, so they showed the inflated
// numbers (2026-08-01_2211: max 116.1 ms in summary, 193.36 in the report; 2026-06-24_0948, the
// steadiest flight on record, 62.36 -> 153.85). trimTail by the recorded stop_trim_s reproduces the
// exact array the capture kept. Flights with no recorded anchor keep the teardown heuristic.
function readTrimmedFt(dir, summary) {
  const raw = path.join(dir, 'frametimes.csv');
  if (!fs.existsSync(raw)) return null;
  let ft; try { ({ ft } = readChronological(raw)); } catch (_) { return null; }
  [ft] = trimHead(ft, [], [], HEAD);
  const sm = (summary && summary.smoothness) || {};
  if ((sm.trim_method === 'brake' || sm.trim_method === 'movement') && sm.stop_trim_s > 0) {
    [ft] = trimTail(ft, [], [], sm.stop_trim_s);
    return { ft, teardownS: sm.stop_trim_s };
  }
  let tS; [ft, , , tS] = trimTeardownTail(ft, [], []);
  return { ft, teardownS: tS };
}
// Teardown-corrected top-level metrics from the trimmed frametimes (single pass).
function corrMetrics(ft) {
  let max = 0, spike = 0, perc = 0;
  for (const v of ft) { if (v > max) max = v; if (v > 50) spike++; if (v > 100) perc++; }
  return { max_ft_ms: r2(max), spike_count: spike, perceptible_count: perc };
}
function routeIcaos(summary) {
  const route = String((summary.settings && summary.settings.simbrief_route) || summary.notes || '').toUpperCase();
  const m = /([A-Z]{3,4})-([A-Z]{3,4})/.exec(route);
  return { dep_icao: m ? m[1] : null, arr_icao: m ? m[2] : null };
}

// Full 5-phase + per-phase VRAM sidecar from the teardown-trimmed frametimes (needs telemetry).
function computeExt(dir, summary) {
  const tel = readTelemetry(dir);
  if (!tel || !tel.length) return null;                   // no telemetry (pre-2026-06-22) → can't split
  const t = readTrimmedFt(dir, summary); if (!t) return null;
  const buckets = splitFrametimesByPhase(t.ft, phaseLogFromTelemetry(tel), 0);   // telemetry wall_ms is recording-relative
  const phases = computePhaseStats(buckets, t.ft.length);
  if (!Object.keys(phases).length) return null;
  // v6.15.5: same trim window as the capture path — spawn-in + shutdown samples never enter a phase average
  let keptMs = 0; for (const v of t.ft) keptMs += v;
  const pv = computePhaseVram(tel, HEAD, HEAD + keptMs / 1000);
  for (const ph of Object.keys(phases)) if (pv[ph]) { phases[ph].vram_peak = pv[ph].vram_peak; phases[ph].vram_avg = pv[ph].vram_avg; }
  const { dep_icao, arr_icao } = routeIcaos(summary);
  return Object.assign({ v: 1, phases, dep_icao, arr_icao, teardown_trim_s: r1(t.teardownS), trim_v: TRIM_V, vram_v: VRAM_V }, corrMetrics(t.ft));
}

// Ensure the sidecar carries the v6.6 teardown correction. Recomputes phases (when telemetry exists) +
// corrected max/spike/perceptible from the teardown-trimmed frametimes, MERGING into any existing
// sidecar so previously-written fields (dep/arr scenery flags, report marker) are preserved.
// Idempotent: no-op once trim_v === 'teardown'. Returns { ext, wrote }.
function backfillCorrection(dir, summary, extPath) {
  let ext = null;
  if (fs.existsSync(extPath)) { try { ext = JSON.parse(fs.readFileSync(extPath, 'utf8')); } catch (_) {} }
  // Recompute when the teardown correction is missing OR the per-phase VRAM predates the v6.15.5
  // trim window (an old sidecar averaged the shutdown samples into its taxi phases).
  if (ext && ext.trim_v === TRIM_V && ext.vram_v === VRAM_V) return { ext, wrote: false };   // already corrected
  const full = computeExt(dir, summary);                            // teardown-trimmed phases + metrics (null if no telemetry)
  if (full) {
    ext = Object.assign(ext || {}, full);
  } else {
    const t = readTrimmedFt(dir, summary); if (!t) return { ext, wrote: false };   // no frametimes → nothing to do
    ext = Object.assign(ext || { v: 1 }, corrMetrics(t.ft), { teardown_trim_s: r1(t.teardownS), trim_v: TRIM_V, vram_v: VRAM_V });
  }
  try { fs.writeFileSync(extPath, JSON.stringify(ext)); } catch (_) { return { ext, wrote: false }; }
  return { ext, wrote: true };
}

// Regenerate report.html from the teardown-trimmed frametimes + corrected stats so the headline max +
// the frametime chart drop the shutdown burst. Uses the sidecar's 5-phase split (or the summary's for
// native 5-phase flights). Gated by ext.report_trim_v so it runs once. report.html is derived
// (regenerable) — raw logs stay put. Returns true if it rewrote the report.
function regenReport(dir, summary, ext, tpSet, history) {
  try {
    if (ext && ext.report_trim_v === REPORT_V) return false;
    const rp = path.join(dir, 'report.html');
    if (!fs.existsSync(rp)) return false;
    const t = readTrimmedFt(dir, summary); if (!t) return false;
    const ft = t.ft, sortedFt = ft.slice().sort((a, b) => a - b);
    const sm = summary.smoothness || {};
    const phases = (ext && ext.phases) || sm.phases || null;
    const stats = Object.assign({}, sm, corrMetrics(ft), phases ? { phases } : {});   // corrected max/spike; does NOT touch summary.json
    // v6.12.1: the regenerated verdict needs the periodicity classification (summary first, sidecar for old flights)
    if (stats.periodic_stutter === undefined && ext && ext.periodic_stutter !== undefined) stats.periodic_stutter = ext.periodic_stutter;
    const dep_icao = (ext && ext.dep_icao) || (summary.settings && summary.settings.dep_icao) || routeIcaos(summary).dep_icao;
    const arr_icao = (ext && ext.arr_icao) || (summary.settings && summary.settings.arr_icao) || routeIcaos(summary).arr_icao;
    const settings = Object.assign({}, summary.settings, {
      dep_icao, arr_icao,
      dep_scenery: (summary.settings && summary.settings.dep_scenery != null) ? summary.settings.dep_scenery
        : (ext && ext.dep_scenery != null) ? ext.dep_scenery : (dep_icao ? tpSet.has(dep_icao) : false),
      arr_scenery: (summary.settings && summary.settings.arr_scenery != null) ? summary.settings.arr_scenery
        : (ext && ext.arr_scenery != null) ? ext.arr_scenery : (arr_icao ? tpSet.has(arr_icao) : false) });
    const html = buildReport(summary.session_id, settings, stats, summary.vram, ft, sortedFt, dir,
      summary.driver_version, summary.sim_version, history || []);
    fs.writeFileSync(rp, html);
    return true;
  } catch (_) { return false; }
}

function runBackfill(sessionsDir, tpIcaos) {
  let idx; try { idx = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'index.json'), 'utf8')); } catch (_) { return { corrected: 0, skipped: 0, noData: 0, reports: 0 }; }
  let tpSet; try { tpSet = new Set((tpIcaos || JSON.parse(process.env.ABRP_THIRDPARTY_ICAOS || '[]')).map(x => String(x).toUpperCase())); } catch (_) { tpSet = new Set(); }
  let corrected = 0, skipped = 0, noData = 0, reports = 0, indexDirty = false;
  // v6.17.0: the debrief ranks a flight against the ones BEFORE it. index.json is append-ordered by
  // capture time (engine.js pushes), so array position is chronological — no sort needed.
  const allSessions = idx.sessions || [];
  const priorOf = cur => allSessions.slice(0, Math.max(allSessions.indexOf(cur), 0));
  for (const s of (idx.sessions || [])) {
    if (!s.folder) continue;
    const dir = path.join(sessionsDir, s.folder.replace(/\//g, '\\'));
    const extPath = path.join(dir, 'phases_ext.json');
    let summary = null; try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch (_) {}
    if (!summary) { noData++; continue; }
    // v6.6 teardown correction — recompute corrected metrics + re-trimmed phases into the sidecar for
    // EVERY flight (originals untouched). Also covers the pre-v6.3.8 5-phase split (computeExt).
    const { ext, wrote } = backfillCorrection(dir, summary, extPath);
    if (wrote) corrected++; else if (ext) skipped++; else noData++;
    // v6.12.1: periodic-stutter classification backfill — one-time per flight (gated on the field's
    // absence), from the same teardown-trimmed frametimes. Sidecar only; raw logs untouched. New
    // captures carry it in summary.smoothness; the sidecar covers every older flight. MUST run
    // BEFORE regenReport so the regenerated verdict picks it up.
    try {
      // recompute when never classified OR classified by an older classifier version (skip when the
      // flight's own summary already carries a native classification — new captures)
      const needP = ext && ext.periodic_v !== PERIODIC_V && !(summary.smoothness && summary.smoothness.periodic_stutter !== undefined);
      if (needP) {
        const t = readTrimmedFt(dir, summary);
        if (t) { ext.periodic_stutter = detectPeriodicStutter(t.ft); ext.periodic_v = PERIODIC_V; fs.writeFileSync(extPath, JSON.stringify(ext)); }
      }
    } catch (_) {}
    // v6.11.0: AutoFPS dynamic-TLOD trace backfill — for tagged flights whose sidecar doesn't exist
    // yet, recover the trace from AutoFPS's surviving daily logs. Anchor = summary.timestamp (second-
    // resolution, a few s before recordingWallStart — fine for a 10s-cadence step line). Log gone →
    // skip silently. MUST run BEFORE regenReport so the regenerated chart picks the trace up.
    try {
      // Rebuild when the sidecar is missing OR is the old v1 schema (5-field samples, no busiest-core
      // Dom field) — v6.13.11 adds the CPU line, and existing AutoFPS flights get it if their log survives.
      let needTrace = false;
      const tracePath = path.join(dir, 'autofps_trace.json');
      if (summary.settings && summary.settings.autofps_active) {
        if (!fs.existsSync(tracePath)) needTrace = true;
        else { try { const tj = JSON.parse(fs.readFileSync(tracePath, 'utf8')); if (!tj || !(tj.v >= 2)) needTrace = true; } catch (_) { needTrace = true; } }
      }
      if (needTrace) {
        const anchor = new Date(String(summary.timestamp)).getTime() / 1000;
        if (isFinite(anchor)) {
          let durS = (summary.smoothness && summary.smoothness.duration_seconds) || 0;
          try {   // telemetry's last wall_ms is the truest recording length when present
            const tel = readTelemetry(dir);
            if (tel && tel.length) durS = Math.max(durS, tel[tel.length - 1].wall_ms / 1000);
          } catch (_) {}
          if (durS > 0) writeAutofpsSidecar(dir, anchor, anchor - 10, anchor + durS + 30, null);
        }
      }
    } catch (_) {}
    // v6.17.0: backfill the index fields the Flight Debrief ranks on. New captures write these
    // directly (engine.js); older entries predate them, and this loop already has every summary.json
    // open, so filling them costs nothing. Prefer the sidecar's corrected spike/perceptible counts
    // (they're computed from the same trimmed array as everything else the report shows).
    try {
      const sm = summary.smoothness || {};
      const want = {
        frametime_stdev_ms: sm.frametime_stdev_ms,
        spike_count: (ext && ext.spike_count != null) ? ext.spike_count : sm.spike_count,
        perceptible_count: (ext && ext.perceptible_count != null) ? ext.perceptible_count : sm.perceptible_count,
        duration_seconds: sm.duration_seconds,
      };
      for (const k of Object.keys(want)) {
        if (want[k] != null && s[k] !== want[k]) { s[k] = want[k]; indexDirty = true; }
      }
    } catch (_) {}
    // regenerate the report from the trimmed data (idempotent via ext.report_trim_v)
    if (regenReport(dir, summary, ext, tpSet, priorOf(s))) {
      reports++;
      try { const e = ext || {}; e.report_trim_v = REPORT_V; fs.writeFileSync(extPath, JSON.stringify(e)); } catch (_) {}
    }
  }
  if (indexDirty) { try { fs.writeFileSync(path.join(sessionsDir, 'index.json'), JSON.stringify(idx, null, 2)); } catch (_) {} }
  // If any per-flight report regenerated, rebuild the dashboard too so its table reflects the same
  // builders (e.g. the AutoFPS 'dynamic TLOD' flag). combined_report.html is derived/regenerable.
  if (reports > 0) { try { fs.writeFileSync(path.join(sessionsDir, 'combined_report.html'), buildCombinedReport(idx.sessions || [])); } catch (_) {} }
  return { corrected, skipped, noData, reports };
}

module.exports = { runBackfill, computeExt, backfillCorrection, readTrimmedFt, corrMetrics, TRIM_V };

if (require.main === module) {
  const dir = process.argv[2] || path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
  const r = runBackfill(dir, process.argv[3] ? JSON.parse(process.argv[3]) : null);
  console.log('teardown backfill: corrected ' + r.corrected + ' · already-done ' + r.skipped + ' · no-data ' + r.noData + ' · reports regenerated ' + r.reports);
}
