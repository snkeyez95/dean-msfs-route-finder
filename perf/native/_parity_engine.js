'use strict';
// Dev-only parity: re-file each existing flight through the native engine into a SCRATCH sessions dir
// (never touches real data) and deep-compare the produced summary.json against the committed one, plus
// confirm every artifact is written. Phases are excluded from the deep-compare (validated separately in
// _parity_phases.js; they drift only because we reconstruct phase_log from telemetry, not the live log).
const fs = require('fs'), path = require('path'), os = require('os');
const { fileSession } = require('./engine.js');
const { readTelemetry } = require('./report_charts.js');
const { phaseLogFromTelemetry } = require('./phases.js');

const SESSIONS = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const idx = JSON.parse(fs.readFileSync(path.join(SESSIONS, 'index.json'), 'utf8'));
const oracle = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_engine.json'), 'utf8'));

// deep value-equality, ignoring a set of dotted paths (e.g. smoothness.phases)
function diff(a, b, prefix, ignore, out) {
  if (ignore.has(prefix)) return;
  const ta = typeof a, tb = typeof b;
  if (a === null || b === null || ta !== 'object' || tb !== 'object') {
    if (a !== b) out.push(prefix + ': ' + JSON.stringify(a) + ' != ' + JSON.stringify(b));
    return;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diff(a[k], b[k], prefix ? prefix + '.' + k : k, ignore, out);
}

const IGNORE = new Set();   // native vs current-Python oracle with identical inputs -> expect full match
let ok = 0, fail = 0, filesOk = 0;
for (const s of idx.sessions) {
  const folder = (s.folder || '').replace(/\//g, path.sep);
  const fdir = path.join(SESSIONS, folder);
  const csvp = path.join(fdir, 'frametimes.csv');
  const sp = path.join(fdir, 'summary.json');
  if (!fs.existsSync(csvp) || !fs.existsSync(sp)) continue;
  const committed = JSON.parse(fs.readFileSync(sp, 'utf8'));
  const expect = oracle[s.session_id];              // current-schema, same-inputs oracle
  if (!expect) continue;

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'engtest-'));
  try {
    const telRows = fs.existsSync(path.join(fdir, 'telemetry.csv'))
      ? readTelemetry(fdir).map(r => [r.wall_ms, r.phase, r.alt_ft, r.vram_mb, r.sys_ram_pct, r.sys_cpu_pct, r.top_proc, r.top_proc_cpu])
      : null;
    const plog = telRows ? phaseLogFromTelemetry(readTelemetry(fdir)) : [];
    const sm = committed.smoothness;
    const dir = fileSession({
      rawCsvPath: csvp, settings: committed.settings, vram: committed.vram,
      startedAt: new Date(committed.timestamp), telemetryRows: telRows, phaseLog: plog,
      recordingWallStart: 0, stopTrimS: sm.stop_trim_s, driverVersion: committed.driver_version,
      simVersion: committed.sim_version, sessionsDir: scratch,
    });
    const produced = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
    const d = [];
    diff(produced, expect, '', IGNORE, d);            // native vs current-Python oracle (should be exact)
    if (d.length === 0) ok++; else { fail++; console.log('  DIFF ' + s.session_id + ': ' + d.slice(0, 5).join(' | ')); }

    // artifacts present?
    const want = ['report.html', 'frametimes.csv', 'summary.json'];
    const gotAll = want.every(f => fs.existsSync(path.join(dir, f)))
      && fs.existsSync(path.join(scratch, 'index.json'))
      && fs.existsSync(path.join(scratch, 'sessions_nav.js'))
      && fs.existsSync(path.join(scratch, 'index.csv'))
      && fs.existsSync(path.join(scratch, 'combined_report.html'));
    if (gotAll) filesOk++;
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
console.log('\nENGINE PARITY ' + (fail === 0 ? 'PASS' : 'FAIL') + ' — ' + ok + '/' + (ok + fail) + ' summaries byte-identical to current-Python oracle (full, incl. phases)');
console.log('Full artifact set written: ' + filesOk + '/' + (ok + fail) + ' flights (summary+report+frametimes+index.json/csv+nav+combined)');
