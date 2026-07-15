'use strict';
// Phase 8a — native port of the data writers (msfs_perf_logger.py: write_sessions_nav 1929,
// update_index 1952). Produces the flight nav list + index.json/index.csv that ABRP and the reports
// read. Validated SEMANTICALLY (same parsed data) by _parity_writers.js — byte-identical formatting
// (json indent, \u escaping) is cosmetic for files that are parsed, so we match the DATA, not bytes.
const { COVERAGE_AIRCRAFT } = require('./coverage.js');

function isPrimaryAircraft(ac){ return COVERAGE_AIRCRAFT.includes(ac); }

// write_sessions_nav: ordered flight list (id/folder/label/track) every report.html loads for prev/next.
function buildSessionsNavEntries(sessions){
  const entries = [];
  for(const s of (sessions || [])){
    const folder = (s.folder || '').replace(/\\/g, '/');
    if(!folder) continue;
    const tlod = s.tlod;
    const ac = s.aircraft || '';
    const disp = s.timestamp_display || s.session_id || '';
    const label = [disp, ac, (tlod != null ? ('TLOD ' + tlod) : '')].filter(p => p).join(' · ');
    entries.push({ id: s.session_id != null ? s.session_id : null, folder, label, track: isPrimaryAircraft(ac) ? 'primary' : 'reference' });
  }
  return entries;
}
function buildSessionsNavJs(sessions){
  return 'window.SESSIONS_NAV = ' + JSON.stringify(buildSessionsNavEntries(sessions), null, 1) + ';\n';
}

// update_index: index.csv field set + row extraction (Python s.get(k, "") — value if key present even
// when null, else ""). index.json is read-append-write (last_updated is a wall clock = non-deterministic).
const INDEX_CSV_FIELDS = ["session_id", "timestamp", "driver_version", "sim_version", "aircraft",
  "route", "tlod", "olod", "p99_ft_ms", "stutter_pct", "consistency_pct",
  "avg_fps", "peak_vram_mb", "frame_count", "experiment", "online_traffic", "autofps_active", "gfx_fp", "folder"];
function buildIndexCsvRows(sessions){
  return (sessions || []).map(s => { const r = {}; for(const k of INDEX_CSV_FIELDS) r[k] = (k in s) ? s[k] : ''; return r; });
}

module.exports = { buildSessionsNavEntries, buildSessionsNavJs, buildIndexCsvRows, INDEX_CSV_FIELDS, isPrimaryAircraft };
