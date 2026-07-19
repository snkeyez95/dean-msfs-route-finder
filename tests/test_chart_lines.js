'use strict';
// v6.13.11 — toggleable chart series + VRAM line + busiest-core (AutoFPS Dom) line.
// Covers: (1) autofps_log parseTrace captures the Dom busiest-core field; (2) writeSidecar emits the
// v2 6-field sample tuple; (3) chartVramSeries / chartDomSeries build windowed series; (4) chart.js
// carries the datasets + toggle wiring; (5) report_html packs vram/cpu into the CHART payload.
const fs = require('fs'), path = require('path'), os = require('os');
const X = require('./lib/extract.js');
const A = require(path.join(X.ROOT, 'perf', 'native', 'autofps_log.js'));
const RC = require(path.join(X.ROOT, 'perf', 'native', 'report_charts.js'));
const T = X.runner();

// ── real-format UpdateVariables lines, with and without the Dom field ──────────────────────────
function line(sec, tlod, withDom){
  const d = new Date(sec * 1000), p = n => String(n).padStart(2, '0');
  const stamp = d.getFullYear() + '-' + p(d.getMonth()+1) + '-' + p(d.getDate()) + ' ' +
                p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds()) + '.000';
  return stamp + ' [INF] [ LODController:UpdateVariables    ] Mode:FSR3 FPS:60 Pri:FPS TLOD:' + tlod +
    ' TLODRng:125-600 OLOD:120 AGL:43017 FPM:2 GPU:43% VRAM:96%' +
    (withDom ? ' LTD CPU:35% Dom:73%(#0) Top2Avg:65% MSFS:32%' : '');
}
const t0 = Math.floor(new Date('2026-07-18T20:41:00').getTime() / 1000);
const txt = [line(t0, 477, true), line(t0 + 10, 329, true), line(t0 + 20, 351, false)].join('\n');
const samples = A.parseTrace(txt, t0 - 5, t0 + 30);
T('parseTrace returns all 3 samples', samples.length === 3, samples.length);
T('Dom (busiest core) parsed from a real line', samples[0].dom === 73, JSON.stringify(samples[0]));
T('Dom parsed on the 2nd line too', samples[1].dom === 73);
T('Dom is null when the field is absent', samples[2].dom === null, JSON.stringify(samples[2]));
T('VRAM still parsed alongside Dom', samples[0].vram === 96);

// ── writeSidecar emits v2, 6-field tuples ─────────────────────────────────────────────────────
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chartlines-'));
// stub the log dir so buildTrace finds our lines
const logDir = path.join(dir, 'log'); fs.mkdirSync(logDir);
const d0 = new Date(t0 * 1000), pp = n => String(n).padStart(2, '0');
const logName = 'MSFS_AutoFPS' + d0.getFullYear() + pp(d0.getMonth()+1) + pp(d0.getDate()) + '.log';
fs.writeFileSync(path.join(logDir, logName), 'header\n' + txt + '\n');
// anchor 10s before the first line so t_rel = 10/20/30 and both Dom samples clear the 5s head-trim.
const wrote = A.writeSidecar(dir, t0 - 10, t0 - 15, t0 + 30, logDir);
T('writeSidecar wrote the trace', wrote === true);
const trace = JSON.parse(fs.readFileSync(path.join(dir, 'autofps_trace.json'), 'utf8'));
T('sidecar schema is v2', trace.v === 2, trace.v);
T('sample tuple has 6 fields', trace.samples[0].length === 6, JSON.stringify(trace.samples[0]));
T('6th field is the busiest core (73)', trace.samples[0][5] === 73);
T('absent-Dom sample stores null in slot 5', trace.samples[2][5] === null);

// ── chartDomSeries builds a windowed busiest-core series ──────────────────────────────────────
// trace samples t_rel are (t - anchor); anchor was t0 → t_rel 0,10,20. x=(t_rel-5)/60.
const dom = RC.chartDomSeries(dir, 10);
T('chartDomSeries returns points for the Dom-bearing samples', dom && dom.length === 2, dom && dom.length);
T('chartDomSeries y is the busiest-core %', dom && dom[0][1] === 73, JSON.stringify(dom && dom[0]));

// old v1 sidecar (5-field tuples) yields no CPU line
fs.writeFileSync(path.join(dir, 'autofps_trace.json'), JSON.stringify({ v: 1, recording_wall_start: t0,
  samples: [[0, 477, 120, 43017, 96], [10, 329, 120, 43017, 95]] }));
T('v1 sidecar (5-field) → chartDomSeries returns null (no CPU line)', RC.chartDomSeries(dir, 10) === null);

// ── chartVramSeries builds a windowed VRAM(MB) series from telemetry ──────────────────────────
const tel = 'wall_ms,phase,alt_ft,vram_mb,sys_ram_pct,sys_cpu_pct,top_proc,top_proc_cpu,gspeed_kt,vatsim_traffic\n' +
  '10000,cruise,35000,11700,40,30,claude.exe,9,420,3\n' +
  '70000,cruise,36000,11790,41,31,dwm.exe,4,430,2\n' +
  '130000,cruise,36000,11500,40,29,vpilot.exe,3,431,4\n';
fs.writeFileSync(path.join(dir, 'telemetry.csv'), tel);
const vr = RC.chartVramSeries(dir, 10);
T('chartVramSeries returns a point per in-window telemetry row', vr && vr.length === 3, vr && vr.length);
T('chartVramSeries y is VRAM in MB', vr && vr[1][1] === 11790, JSON.stringify(vr && vr[1]));

// ── chart.js carries the datasets + toggle wiring ─────────────────────────────────────────────
const cjs = fs.readFileSync(path.join(X.ROOT, 'perf', 'native', 'report_assets', 'chart.js'), 'utf8');
T("chart.js reads CHART.vram", /CHART\.vram/.test(cjs));
T("chart.js reads CHART.cpu", /CHART\.cpu/.test(cjs));
T("chart.js has a VRAM dataset", /label:'VRAM'/.test(cjs));
T("chart.js has a Busiest core dataset", /label:'Busiest core'/.test(cjs));
T("chart.js has a yVram axis", /yVram:\{/.test(cjs));
T("chart.js has a yCpu axis", /yCpu:\{/.test(cjs));
T("chart.js exposes toggleSeries", /window\.toggleSeries\s*=/.test(cjs));
T("chart.js persists hidden series", /cfxSeriesHidden/.test(cjs));

// ── report_html packs vram + cpu into the CHART payload ───────────────────────────────────────
const rhtml = fs.readFileSync(path.join(X.ROOT, 'perf', 'native', 'report_html.js'), 'utf8');
T("report_html builds chartVramSeries", /chartVramSeries/.test(rhtml));
T("report_html builds chartDomSeries", /chartDomSeries/.test(rhtml));
T("report_html emits vram + cpu in CHART json", /vram:\s*vramPoints/.test(rhtml) && /cpu:\s*domPoints/.test(rhtml));

fs.rmSync(dir, { recursive: true, force: true });
process.exit(T.done() ? 1 : 0);
