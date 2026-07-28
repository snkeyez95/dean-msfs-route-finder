'use strict';
// v6.15.3 — the frametime chart and the moving-average chart must share an IDENTICAL plot area, or
// the hover bullseyes sit at different screen x for the same instant (Dean 2026-07-28). The upper
// chart carries up to five right-hand axes; the lower one had none, so its plot area ran wider.
// Chart.js can't run headless here, so assert the WIRING — every piece the alignment depends on.
// Also covers the VRAM legend chip carrying avg + peak MB.
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('report chart alignment + VRAM label:');
const src = fs.readFileSync(path.resolve(__dirname, '..', 'perf', 'native', 'report_assets', 'chart.js'), 'utf8');

// ── shared geometry ─────────────────────────────────────────────────────────
console.log('plot-area sync:');
T('_geo is declared (hoisted before either chart lays out)', /var _geo=\{l:0,r:0\}/.test(src));
T('avg chart mirrors the upper chart\'s LEFT gutter',
  /afterFit:function\(sc\)\{if\(_geo\.l\)sc\.width=_geo\.l;\}/.test(src));
T('avg chart has a RIGHT spacer axis', /yPad:\{type:'linear',position:'right'/.test(src));
T('the spacer is sized from the upper chart\'s right gutter',
  /afterFit:function\(sc\)\{sc\.width=_geo\.r\|\|0;\}/.test(src));
T('the spacer renders nothing (no ticks, no border, no grid)',
  /yPad[\s\S]{0,240}ticks:\{display:false\}[\s\S]{0,140}border:\{display:false\}/.test(src) &&
  /yPad[\s\S]{0,300}grid:\{display:false,drawOnChartArea:false,drawTicks:false\}/.test(src));

// ── the sync must fire at every point the geometry can change ───────────────
console.log('\nre-sync triggers:');
T('once both charts exist', /_syncGeo\(\);\s*\n\s*try\{ window\.addEventListener\('resize'/.test(src));
T('on a legend chip toggle (adds/removes a right axis)',
  /renderLegend\(\);chart\.update\(\);_syncGeo\(\)/.test(src));
T('on window resize', /addEventListener\('resize'[\s\S]{0,60}_syncGeo/.test(src));
T('guarded against a render loop (no update when unchanged)',
  /if\(l===_geo\.l&&r===_geo\.r\)return;/.test(src));
T('_syncGeo bails out safely before avgChart exists',
  /typeof avgChart==='undefined'\|\|!avgChart\)return/.test(src));

// ── VRAM legend label ───────────────────────────────────────────────────────
console.log('\nVRAM chip label:');
T('avg + peak are computed from the plotted series',
  /_vramStat=\(function\(\)\{[\s\S]{0,220}return\{peak:mx,avg:su\/vramData\.length\}/.test(src));
T('the chip shows both numbers with units',
  /VRAM \(avg '\+_mb\(_vramStat\.avg\)\+' · peak '\+_mb\(_vramStat\.peak\)\+' MB\)/.test(src));
T('falls back to a bare "VRAM" when the flight has no VRAM series',
  /_vramStat\s*\?\([\s\S]{0,140}\):'VRAM'/.test(src));
T('thousands-separated', /function _mb\(v\)\{return Math\.round\(v\)\.toLocaleString\(\)/.test(src));

// ── the asset must actually reach generated reports ─────────────────────────
console.log('\ndelivery:');
{
  const bf = fs.readFileSync(path.resolve(__dirname, '..', 'perf', 'native', 'backfill_phases.js'), 'utf8');
  const m = bf.match(/const REPORT_V = '([^']+)'/);
  T('REPORT_V bumped so existing reports regenerate once', !!m && m[1] === 'chart-align-vram-label', m && m[1]);
  const loader = fs.readFileSync(path.resolve(__dirname, '..', 'perf', 'native', 'report_assets.js'), 'utf8');
  T('report_assets loads chart.js from the split file (not a stale JSON blob)', /CHART_JS: rd\('chart\.js'\)/.test(loader));
}
T('chart.js parses', (() => { try { new Function(src); return true; } catch (_) { return false; } })());

process.exit(T.done() ? 1 : 0);
