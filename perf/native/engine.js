'use strict';
// perf/native/engine.js — the offline engine orchestrator. PORT of msfs_perf_logger.py file_session
// (+ its stats-dict assembly) + update_index + write_sessions_nav + _write_telemetry_csv.
//
// Given a captured flight's data (raw frametimes CSV + settings + VRAM summary + telemetry + the live
// phase_log), it writes the full Sessions/ artifact set exactly as the Python engine does:
//   frametimes.csv (copy) · telemetry.csv · summary.json · report.html · index.json · index.csv ·
//   sessions_nav.js · combined_report.html
// The capture front-half (8b) produces the inputs; this is the back-half that files them. Sub-writers
// (stats, phases, report, combined, index rows) are already byte-proven individually.
const fs = require('fs'), path = require('path');
const { computeStats } = require('./stats.js');
const { trimHead, trimTail, splitFrametimesByPhase, computePhaseStats, computePhaseVram } = require('./phases.js');
const { readChronological, readTelemetry } = require('./report_charts.js');
const { buildReport } = require('./report_html.js');
const { buildCombinedReport } = require('./report_combined.js');
const { buildSessionsNavJs, INDEX_CSV_FIELDS } = require('./index_writer.js');

const HEAD_TRIM_S = 5;
const TELEMETRY_COLUMNS = ['wall_ms', 'phase', 'alt_ft', 'vram_mb', 'sys_ram_pct', 'sys_cpu_pct', 'top_proc', 'top_proc_cpu'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const p2 = n => String(n).padStart(2, '0');

const dateDir     = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate());
const timeStr     = d => p2(d.getHours()) + p2(d.getMinutes());
const isoSeconds  = d => dateDir(d) + 'T' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
const displayStr  = d => MON[d.getMonth()] + ' ' + p2(d.getDate()) + ' ' + d.getFullYear() + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes());

// Assemble the full `smoothness` dict: compute_stats + trim markers + phases (Python's capture glue).
function computeSmoothness(ftTrimmed, cpuTrimmed, gpuTrimmed, stopTrimS, phaseLog, recordingWallStart) {
  const stats = computeStats(ftTrimmed, cpuTrimmed, gpuTrimmed);
  stats.start_trim_s = HEAD_TRIM_S;
  stats.stop_trim_s = Math.round((stopTrimS || 0) * 10) / 10;   // round(trim_s, 1)
  const buckets = splitFrametimesByPhase(ftTrimmed, phaseLog || [], recordingWallStart || 0);
  if (Object.keys(buckets).length) {
    const phases = computePhaseStats(buckets, ftTrimmed.length);
    if (Object.keys(phases).length) stats.phases = phases;
  }
  return stats;
}

// CSV field escaping matching Python csv.writer (quote only when needed; double embedded quotes).
function csvCell(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
function csvRow(vals) { return vals.map(csvCell).join(',') + '\r\n'; }   // csv.writer default CRLF

function writeTelemetryCsv(sessionDir, rows) {
  if (!rows || !rows.length) return;
  let out = csvRow(TELEMETRY_COLUMNS);
  for (const r of rows) out += csvRow(Array.isArray(r) ? r : TELEMETRY_COLUMNS.map(c => r[c]));
  fs.writeFileSync(path.join(sessionDir, 'telemetry.csv'), out);
}

function readIndex(sessionsDir) {
  const p = path.join(sessionsDir, 'index.json');
  if (fs.existsSync(p)) {
    try { const d = JSON.parse(fs.readFileSync(p, 'utf8')); if (!d.sessions) d.sessions = []; return d; }
    catch (_) { /* fall through to fresh */ }
  }
  return { version: '1.0', sessions: [] };
}

// PORT of update_index + write_sessions_nav: append entry, write index.json (indent 2), nav, and csv.
function updateIndex(sessionsDir, entry, now) {
  fs.mkdirSync(sessionsDir, { recursive: true });
  const data = readIndex(sessionsDir);
  data.sessions.push(entry);
  data.last_updated = isoSeconds(now || new Date());
  fs.writeFileSync(path.join(sessionsDir, 'index.json'), JSON.stringify(data, null, 2));

  fs.writeFileSync(path.join(sessionsDir, 'sessions_nav.js'), buildSessionsNavJs(data.sessions));

  const csvPath = path.join(sessionsDir, 'index.csv');
  const header = INDEX_CSV_FIELDS;
  const existingHeader = fs.existsSync(csvPath)
    ? (fs.readFileSync(csvPath, 'utf8').split(/\r?\n/)[0] || '').split(',') : null;
  if (existingHeader && existingHeader.join(',') !== header.join(',')) {   // header drift -> rewrite all
    let out = csvRow(header);
    for (const s of data.sessions) out += csvRow(header.map(k => (k in s) ? s[k] : ''));
    fs.writeFileSync(csvPath, out);
  } else if (!fs.existsSync(csvPath)) {
    fs.writeFileSync(csvPath, csvRow(header) + csvRow(header.map(k => (k in entry) ? entry[k] : '')));
  } else {
    fs.appendFileSync(csvPath, csvRow(header.map(k => (k in entry) ? entry[k] : '')));
  }
}

// File a captured flight. opts: {rawCsvPath, settings, vram, startedAt(Date), telemetryRows, phaseLog,
// recordingWallStart, stopTrimS, driverVersion, simVersion, sessionsDir}. Returns the session dir.
function fileSession(opts) {
  const { rawCsvPath, settings, vram, startedAt, telemetryRows, phaseLog, recordingWallStart,
    stopTrimS, driverVersion, simVersion, sessionsDir } = opts;
  const now = startedAt || new Date();
  const tlodStr = settings.tlod != null ? 'TLOD' + settings.tlod : 'TLODna';
  const olodStr = settings.olod != null ? 'OLOD' + settings.olod : 'OLODna';
  const folderName = timeStr(now) + '_' + tlodStr + '_' + olodStr;
  const sessionId = dateDir(now) + '_' + timeStr(now);
  const sessionDir = path.join(sessionsDir, dateDir(now), folderName);
  fs.mkdirSync(sessionDir, { recursive: true });

  // 1. raw frametimes copy
  try { fs.copyFileSync(rawCsvPath, path.join(sessionDir, 'frametimes.csv')); } catch (_) {}

  // 1b. telemetry sidecar (before the report, so the altitude overlay picks it up)
  writeTelemetryCsv(sessionDir, telemetryRows);

  // stats from trimmed frames
  let { ft, cpu, gpu } = readChronological(rawCsvPath);
  [ft, cpu, gpu] = trimHead(ft, cpu, gpu, HEAD_TRIM_S);
  [ft, cpu, gpu] = trimTail(ft, cpu, gpu, stopTrimS || 0);
  const smoothness = computeSmoothness(ft, cpu, gpu, stopTrimS, phaseLog, recordingWallStart);
  // per-phase VRAM (peak/avg) from the just-written telemetry, merged into the frametime phase stats
  // so each of the 5 phases (incl. departing/arrival taxi) carries both metrics (Dean 2026-07-07).
  try {
    const tel = readTelemetry(sessionDir);
    if (tel && smoothness.phases) {
      const pv = computePhaseVram(tel);
      for (const ph of Object.keys(smoothness.phases)) {
        if (pv[ph]) { smoothness.phases[ph].vram_peak = pv[ph].vram_peak; smoothness.phases[ph].vram_avg = pv[ph].vram_avg; }
      }
    }
  } catch (_) {}
  const sortedFt = ft.slice().sort((a, b) => a - b);

  // 2. summary.json
  const summary = {
    session_id: sessionId,
    timestamp: isoSeconds(now),
    timestamp_display: displayStr(now),
    driver_version: driverVersion,
    sim_version: simVersion,
    settings,
    smoothness,
    vram,
    raw_csv: 'frametimes.csv',
    report: 'report.html',
    notes: settings.simbrief_route || settings.notes || '',
  };
  fs.writeFileSync(path.join(sessionDir, 'summary.json'), JSON.stringify(summary, null, 2));

  // 3. report.html (proven byte-identical writer)
  try {
    const html = buildReport(sessionId, settings, smoothness, vram, ft, sortedFt, sessionDir,
      driverVersion, simVersion);
    fs.writeFileSync(path.join(sessionDir, 'report.html'), html);
  } catch (e) { /* report is non-fatal, like Python */ }

  // 4. index + combined dashboard
  const entry = {
    session_id: sessionId, timestamp: summary.timestamp, driver_version: driverVersion,
    sim_version: simVersion, tlod: settings.tlod, olod: settings.olod,
    p99_ft_ms: smoothness.p99_ft_ms, stutter_pct: smoothness.stutter_pct,
    consistency_pct: smoothness.consistency_pct, avg_fps: smoothness.avg_fps,
    peak_vram_mb: vram ? vram.peak_vram_mb : null, frame_count: smoothness.frame_count,
    aircraft: settings.aircraft, route: settings.simbrief_route || '',
    ...(settings.experiment ? { experiment: settings.experiment } : {}),   // Settings Lab tag (absent = normal flight)
    // scenery attribution (v6.3.8): dep/arr ICAO + whether each is a 3rd-party scenery the user owns
    ...(settings.dep_icao ? { dep_icao: settings.dep_icao } : {}),
    ...(settings.arr_icao ? { arr_icao: settings.arr_icao } : {}),
    ...(settings.dep_scenery != null ? { dep_scenery: settings.dep_scenery } : {}),
    ...(settings.arr_scenery != null ? { arr_scenery: settings.arr_scenery } : {}),
    timestamp_display: displayStr(now),
    folder: path.join(dateDir(now), folderName),   // relative to Sessions (matches Python os.path.relpath)
  };
  updateIndex(sessionsDir, entry, now);

  const idx = readIndex(sessionsDir);
  try { fs.writeFileSync(path.join(sessionsDir, 'combined_report.html'), buildCombinedReport(idx.sessions)); } catch (e) {}

  return sessionDir;
}

module.exports = { fileSession, computeSmoothness, updateIndex, writeTelemetryCsv, HEAD_TRIM_S };
