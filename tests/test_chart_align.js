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
  // The alignment change shipped with REPORT_V = 'chart-align-vram-label'. Later report changes bump
  // it again (any bump regenerates every report, so this fix rides along), so don't pin the exact
  // string — assert only that the marker exists and has moved past the value that PRECEDED this fix.
  const PRE_ALIGN = 'vram-cpu-lines';
  T('REPORT_V bumped so existing reports regenerate once', !!m && m[1] !== PRE_ALIGN, m && m[1]);
  const loader = fs.readFileSync(path.resolve(__dirname, '..', 'perf', 'native', 'report_assets.js'), 'utf8');
  T('report_assets loads chart.js from the split file (not a stale JSON blob)', /CHART_JS: rd\('chart\.js'\)/.test(loader));
}
T('chart.js parses', (() => { try { new Function(src); return true; } catch (_) { return false; } })());

// ── v6.16.0: no stray hover markers (Dean 2026-08-02) ───────────────────────
// Chart.js draws its own marker on the active point of EVERY dataset. Under interaction mode
// 'index' it resolves that per dataset, and the telemetry lines (altitude and VATSIM traffic at
// 1 Hz, TLOD every ~10 s) are sampled at different instants than the frametime line — so their
// markers appeared several seconds away from the crosshair and read as a broken hover. The only
// markers should be the bullseyes xhairPlugin draws AT the crosshair pixel.
console.log('\nno stray hover markers:');
{
  const both = src.match(/elements:\{point:\{hoverRadius:0,hitRadius:0\}\}/g) || [];
  T('both charts disable the built-in hover point', both.length === 2, both.length + ' found');
  T('the frametime chart still uses index-mode interaction',
    /interaction:\{mode:'index',axis:'x',intersect:false\}/.test(src));
  T('the moving-average chart keeps nearest-mode interaction',
    /interaction:\{mode:'nearest',axis:'x',intersect:false\}/.test(src));
  T('our own bullseyes are still drawn at the CROSSHAIR pixel, not per dataset',
    /bullseye\(x,px,py,m\.color\(\)\)/.test(src));
  T('every line still hides its points when not hovered (pointRadius 0)',
    (src.match(/pointRadius:0/g) || []).length >= 7);
}

process.exit(T.done() ? 1 : 0);
