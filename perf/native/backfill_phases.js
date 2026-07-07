'use strict';
// v6.3.8 sidecar backfill — recompute the 5-phase split (dep_taxi/climb/cruise/descent/arr_taxi) +
// per-phase VRAM for pre-v6.3.8 flights (which have telemetry) and write a NEW phases_ext.json in
// each session folder. ORIGINALS (summary/frametimes/telemetry) are NEVER modified — the guardrail.
// Idempotent (skips folders that already have the sidecar). Mirrors engine.js computeSmoothness +
// the VRAM merge exactly, so backfilled old flights match natively-written new flights.
// Run detached on launch by main.js; also runnable standalone (node backfill_phases.js <SessionsDir>).
const fs = require('fs'), path = require('path');
const { readChronological, readTelemetry } = require('./report_charts.js');
const { trimHead, trimTail, splitFrametimesByPhase, computePhaseStats, phaseLogFromTelemetry, computePhaseVram } = require('./phases.js');
const { buildReport } = require('./report_html.js');

const HEAD = 5;
// pre-v6.3.8 report.html files show the old 4-phase model — regenerate them from summary + the
// sidecar so the phase breakdown + payware ✳ reflect the new 5-phase model. Detected by the absence
// of "Departing taxi" in the existing report. report.html is derived (regenerable) — raw logs stay put.
function regenReportIfStale(dir, summary, ext, tpSet) {
  try {
    const rp = path.join(dir, 'report.html');
    if (!fs.existsSync(rp)) return;
    if (fs.readFileSync(rp, 'utf8').includes('Departing taxi')) return;   // already new-model
    const raw = path.join(dir, 'frametimes.csv');
    if (!fs.existsSync(raw)) return;
    let { ft } = readChronological(raw);
    const sm = summary.smoothness || {};
    [ft] = trimHead(ft, [], [], HEAD);
    [ft] = trimTail(ft, [], [], sm.stop_trim_s || 0);
    const sortedFt = ft.slice().sort((a, b) => a - b);
    const stats = Object.assign({}, sm, { phases: ext.phases });   // 5-phase (does not touch summary.json)
    const settings = Object.assign({}, summary.settings, {
      dep_icao: ext.dep_icao, arr_icao: ext.arr_icao,
      dep_scenery: ext.dep_icao ? tpSet.has(ext.dep_icao) : false,
      arr_scenery: ext.arr_icao ? tpSet.has(ext.arr_icao) : false });
    const html = buildReport(summary.session_id, settings, stats, summary.vram, ft, sortedFt, dir,
      summary.driver_version, summary.sim_version);
    fs.writeFileSync(rp, html);
    return true;
  } catch (_) { return false; }
}

function computeExt(dir, summary) {
  const raw = path.join(dir, 'frametimes.csv');
  if (!fs.existsSync(raw)) return null;
  const tel = readTelemetry(dir);
  if (!tel || !tel.length) return null;                   // no telemetry (pre-2026-06-22) → can't split
  const sm = (summary && summary.smoothness) || {};
  let { ft } = readChronological(raw);
  [ft] = trimHead(ft, [], [], HEAD);
  [ft] = trimTail(ft, [], [], sm.stop_trim_s || 0);
  const buckets = splitFrametimesByPhase(ft, phaseLogFromTelemetry(tel), 0);   // telemetry wall_ms is recording-relative
  const phases = computePhaseStats(buckets, ft.length);
  if (!Object.keys(phases).length) return null;
  const pv = computePhaseVram(tel);
  for (const ph of Object.keys(phases)) if (pv[ph]) { phases[ph].vram_peak = pv[ph].vram_peak; phases[ph].vram_avg = pv[ph].vram_avg; }
  const route = String((summary.settings && summary.settings.simbrief_route) || summary.notes || '').toUpperCase();
  const m = /([A-Z]{3,4})-([A-Z]{3,4})/.exec(route);
  return { v: 1, phases, dep_icao: m ? m[1] : null, arr_icao: m ? m[2] : null };
}

function runBackfill(sessionsDir, tpIcaos) {
  let idx; try { idx = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'index.json'), 'utf8')); } catch (_) { return { wrote: 0, skipped: 0, noData: 0, reports: 0 }; }
  let tpSet; try { tpSet = new Set((tpIcaos || JSON.parse(process.env.ABRP_THIRDPARTY_ICAOS || '[]')).map(x => String(x).toUpperCase())); } catch (_) { tpSet = new Set(); }
  let wrote = 0, skipped = 0, noData = 0, reports = 0;
  for (const s of (idx.sessions || [])) {
    if (!s.folder) continue;
    const dir = path.join(sessionsDir, s.folder.replace(/\//g, '\\'));
    const extPath = path.join(dir, 'phases_ext.json');
    let summary = null; try { summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8')); } catch (_) {}
    // a summary already carrying the 5-phase model is native — nothing to sidecar or regenerate
    if (summary && summary.smoothness && summary.smoothness.phases && (summary.smoothness.phases.dep_taxi || summary.smoothness.phases.arr_taxi)) { skipped++; continue; }
    let ext = null;
    if (fs.existsSync(extPath)) { try { ext = JSON.parse(fs.readFileSync(extPath, 'utf8')); } catch (_) {} skipped++; }
    else { ext = summary ? computeExt(dir, summary) : null; if (ext) { try { fs.writeFileSync(extPath, JSON.stringify(ext)); wrote++; } catch (_) {} } else { noData++; } }
    // regenerate a stale (old 4-phase) report.html from the sidecar so it shows the new model + ✳
    if (ext && summary && regenReportIfStale(dir, summary, ext, tpSet)) reports++;
  }
  return { wrote, skipped, noData, reports };
}

module.exports = { runBackfill, computeExt };

if (require.main === module) {
  const dir = process.argv[2] || path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
  const r = runBackfill(dir, process.argv[3] ? JSON.parse(process.argv[3]) : null);
  console.log('phases_ext backfill: wrote ' + r.wrote + ' · skipped ' + r.skipped + ' · no-data(no telemetry) ' + r.noData + ' · reports regenerated ' + r.reports);
}
