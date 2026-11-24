'use strict';
// v6.35.2 — AutoFPS "Log+" writes one log per session (MSFS_AutoFPS_20261124_094146.log) instead of the
// daily MSFS_AutoFPS20261124.log. Dean's EGKK-LFBD flight (2026-11-24) got no TLOD line on its chart
// because only the daily name was read. Runs the real autofps_log.js against temp copies.
const fs = require('fs'), path = require('path'), os = require('os');
const X = require('./lib/extract.js');
const A = require(path.join(X.ROOT, 'perf', 'native', 'autofps_log.js'));
const T = X.runner('autofps Log+:');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afps-lp-'));
const line = (hms, tlod) => '2026-11-24 ' + hms + '.588 [INF] [ LODController:UpdateVariables    ] Mode:FSR FPS:60 Pri:TLOD TLOD:' + tlod + ' TLODRng:50 OLOD:120 AGL:9 FPM:-0 GPU:83% VRAM:83% CPU:47% Dom:81%(#0) Top2Avg:76% MSFS:39% ';
const ep = hms => new Date('2026-11-24T' + hms).getTime() / 1000;
fs.writeFileSync(path.join(tmp, 'MSFS_AutoFPS20261124.log'), [line('09:30:00', 50), line('09:40:00', 60)].join('\n'));
const sess = path.join(tmp, 'MSFS_AutoFPS_20261124_094146.log');
fs.writeFileSync(sess, [line('09:41:56', 70), line('10:00:00', 200), line('11:00:00', 150)].join('\n'));
fs.utimesSync(sess, new Date(), new Date(Date.now() + 1000));
fs.writeFileSync(path.join(tmp, 'MSFS_AutoFPS_20261123_174900.log'), line('09:45:00', 999));   // other day: ignored
fs.writeFileSync(path.join(tmp, 'MSFS_AutoFPS_20261124_bad.log'), line('09:45:00', 888));      // not the AutoFPS pattern: ignored

console.log('1. finding the logs');
const files = A.findLogs(tmp, ep('09:35:00'), ep('11:10:00')).map(f => path.basename(f));
T('a flight window finds the daily log AND the Log+ session log, daily first', files.join() === 'MSFS_AutoFPS20261124.log,MSFS_AutoFPS_20261124_094146.log', files);

console.log('2. the flight trace (what the chart draws)');
const tr = A.buildTrace(tmp, ep('09:35:00'), ep('11:10:00'));
T('samples come from both files, in time order: 60 → 70 → 200 → 150', tr && tr.samples.map(s => s.tlod).join() === '60,70,200,150', tr && tr.samples.map(s => s.tlod));
T('nothing from another day or a non-AutoFPS file', tr && !tr.samples.some(s => s.tlod === 999 || s.tlod === 888));
const sd = fs.mkdtempSync(path.join(os.tmpdir(), 'afps-sess-'));
T('the trace sidecar gets written for a Log+ flight', A.writeSidecar(sd, ep('09:35:00'), ep('09:35:00'), ep('11:10:00'), tmp) === true && fs.existsSync(path.join(sd, 'autofps_trace.json')));

console.log('3. the live overlay TLOD reads the session log being written');
const live = fs.mkdtempSync(path.join(os.tmpdir(), 'afps-live-'));
const now = new Date(), p2 = n => String(n).padStart(2, '0');
const ymd = now.getFullYear() + p2(now.getMonth() + 1) + p2(now.getDate());
const stamp = d => d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' + p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds());
const ln = (d, tlod) => stamp(d) + '.000 [INF] [ LODController:UpdateVariables    ] Mode:FSR FPS:60 Pri:TLOD TLOD:' + tlod + ' TLODRng:50 OLOD:120 AGL:9 VRAM:83%';
fs.writeFileSync(path.join(live, 'MSFS_AutoFPS' + ymd + '.log'), ln(new Date(now - 3600e3), 50));   // daily stopped an hour ago
fs.writeFileSync(path.join(live, 'MSFS_AutoFPS_' + ymd + '_000001.log'), ln(new Date(now - 5e3), 340));
fs.utimesSync(path.join(live, 'MSFS_AutoFPS' + ymd + '.log'), new Date(now - 3600e3), new Date(now - 3600e3));
const t = A.tailLatest(live, 60);
T('overlay shows TLOD 340 from the session log (not "stale" from the old daily log)', t && t.tlod === 340, t);

console.log('4. Dean\'s real Log+ flight (read-only)');
const REAL = path.join(process.env.APPDATA || '', 'MSFS_AutoFPS', 'log');
const real = path.join(REAL, 'MSFS_AutoFPS_20261124_094146.log');
if (fs.existsSync(real)) {
  const r = A.buildTrace(REAL, ep('09:46:00'), ep('11:21:00'));
  T('EGKK-LFBD: ' + (r ? r.samples.length + ' samples, TLOD ' + r.stats.tlod_min + '–' + r.stats.tlod_max + ', median ' + r.stats.tlod_med : 'nothing'), r && r.samples.length > 300);
} else console.log('  skip (log not present)');

for (const d of [tmp, sd, live]) fs.rmSync(d, { recursive: true, force: true });
T.done();
