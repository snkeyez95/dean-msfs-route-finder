'use strict';
// Dev-only parity: run the Node trim + phase split + phase stats over each telemetry flight and diff
// against the Python oracle (pure PORT parity) AND against the captured summary.json phases
// (reconstruction fidelity). PASS = port matches Python byte-for-byte on the reconstructed inputs.
const fs = require('fs'), path = require('path');
const { readChronological, readTelemetry } = require('./report_charts.js');
const { trimHead, trimTail, splitFrametimesByPhase, computePhaseStats, phaseLogFromTelemetry } = require('./phases.js');

const SESSIONS = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_phases.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(SESSIONS, 'index.json'), 'utf8'));

function diffPhases(a, b) {
  const diffs = [];
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of keys) {
    const pa = a[k], pb = b[k];
    if (!pa || !pb) { diffs.push(k + ':missing'); continue; }
    for (const f of ['frame_count', 'avg_ft', 'p99_ft', 'stutter_pct', 'pct_of_total']) {
      if (pa[f] !== pb[f]) diffs.push(k + '.' + f + ' ' + pa[f] + '!=' + pb[f]);
    }
  }
  return diffs;
}

let portPass = 0, portFail = 0, fidTotal = 0, fidFrameDrift = 0;
for (const s of idx.sessions) {
  const folder = (s.folder || '').replace(/\//g, path.sep);
  const fdir = path.join(SESSIONS, folder);
  const id = s.session_id || folder;
  if (!ref[id]) continue;                      // only the telemetry flights the oracle covers
  const sm = JSON.parse(fs.readFileSync(path.join(fdir, 'summary.json'), 'utf8')).smoothness;
  let { ft, cpu, gpu } = readChronological(path.join(fdir, 'frametimes.csv'));
  [ft, cpu, gpu] = trimHead(ft, cpu, gpu, sm.start_trim_s || 0);
  [ft, cpu, gpu] = trimTail(ft, cpu, gpu, sm.stop_trim_s || 0);
  const plog = phaseLogFromTelemetry(readTelemetry(fdir));
  const phases = computePhaseStats(splitFrametimesByPhase(ft, plog, 0.0), ft.length);

  // 1) PORT parity vs Python on identical reconstructed inputs (must be exact)
  const pd = diffPhases(phases, ref[id].phases);
  if (pd.length === 0 && ft.length === ref[id].trimmed) portPass++;
  else { portFail++; console.log('  PORT DIFF ' + id + ' (trim n=' + ft.length + ' vs ' + ref[id].trimmed + '): ' + pd.slice(0, 4).join(' ; ')); }

  // 2) fidelity vs the captured summary (reconstruction from telemetry vs live phase_log)
  fidTotal++;
  const fd = diffPhases(phases, ref[id].summary_phases);
  const frameDiffs = fd.filter(d => d.includes('.frame_count'));
  if (frameDiffs.length) fidFrameDrift++;
}
console.log('\nPHASES PORT PARITY ' + (portFail === 0 ? 'PASS' : 'FAIL') + ' — ' + portPass + '/' + (portPass + portFail) + ' telemetry flights byte-identical to Python on reconstructed inputs');
console.log('Reconstruction fidelity vs captured summary.json: ' + (fidTotal - fidFrameDrift) + '/' + fidTotal + ' flights match live phase_log exactly (frame-count drift on ' + fidFrameDrift + ')');
