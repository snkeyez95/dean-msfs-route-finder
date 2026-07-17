'use strict';
// Report chart script (perf/native/report_assets/chart.js) — v6.13.5 hover/layout pass.
// Executes the REAL asset with a mocked Chart.js + DOM to confirm it sets up without throwing:
//   both Chart instances build, the synced-hover listeners wire, and mousemove/leave run clean.
// (The browser pane renders external report files as static snapshots, so this mock-exec is how we
//  catch a wiring/runtime error before it reaches a real report.) Also asserts the structural markers.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('report chart script:');

const chartSrc = fs.readFileSync(path.join(X.ROOT, 'perf', 'native', 'report_assets', 'chart.js'), 'utf8');

// ── structural markers (the v6.13.6 unified hover) ──
T('shared inspected-time state (HOVER.x)', /var HOVER=\{x:null\}/.test(chartSrc));
T('bullseye marker (outer ring + coloured ring + centre)', /function bullseye/.test(chartSrc));
T('per-line markers incl. TLOD + Altitude', /add\('TLOD','yTlod'/.test(chartSrc) && /add\('Altitude','yAlt'/.test(chartSrc));
T('unified crosshair + readout plugins', /xhairPlugin/.test(chartSrc) && /readoutPlugin/.test(chartSrc));
T('native Chart tooltip disabled (replaced)', /tooltip:\{enabled:false\}/.test(chartSrc));
T('spike-snapping in the hover wiring', /function snapX/.test(chartSrc));
T('snap gated on a genuine spike (>=33ms + 1.4x local)', /bt>=33&&bt>cur\*1\.4/.test(chartSrc));
T('snap gated on vertical cursor proximity (reads TLOD/alt continuously)', /Math\.abs\(spY-py\)<=45/.test(chartSrc));
T('hover redraws BOTH charts (rAF-coalesced)', /function redraw\(\)\{if\(raf\)return;/.test(chartSrc) && /linked\.forEach\(function\(c\)\{c\.draw\(\)\;\}\)/.test(chartSrc));
T('reference labels at the right edge, before the tooltip', /a\.right-tw-9/.test(chartSrc) && /refLines=\{id:'tgt',afterDatasetsDraw/.test(chartSrc));

// ── mock-execute: build both charts + fire the hover handlers ──
const listeners = {};
const noop = () => {};
const fakeCanvas = id => ({ id, addEventListener: (ev, fn) => { (listeners[id] = listeners[id] || []).push([ev, fn]); },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 300 }) });
const els = { ftChart: fakeCanvas('ftChart'), ftAvgChart: fakeCanvas('ftAvgChart'),
  yScale: { value: '100', style: {} }, spikeBadge: { style: {}, textContent: '' },
  chartLegend: { innerHTML: '' }, unitBtn: {} };
let chartsMade = 0;
function ChartStub(el, cfg){ chartsMade++; this.canvas = el; this.data = cfg.data; this.options = cfg.options; this._syncX = null;
  this.scales = { x: { getPixelForValue: v => v * 8, getValueForPixel: p => p / 8 },
    yMs: { getPixelForValue: v => 300 - v }, y: { getPixelForValue: v => 150 - v } };
  this.chartArea = { left: 0, right: 800, top: 0, bottom: 300 };
  this.ctx = { save: noop, restore: noop, beginPath: noop, moveTo: noop, lineTo: noop, stroke: noop, arc: noop,
    fill: noop, fillRect: noop, fillText: noop, measureText: () => ({ width: 40 }), setLineDash: noop };
  this.tooltip = { opacity: 0, dataPoints: [] };
  this.getDatasetMeta = i => ({ data: (this.data.datasets[i].data || []).map(p => ({ x: (p.x || 0) * 8, y: 300 - (p.y || 0) })) }); }
ChartStub.prototype.update = noop; ChartStub.prototype.draw = noop; ChartStub.prototype.resetZoom = noop;

const CHARTDATA = { ft: [[0, 16.7], [1, 45], [2, 17]], mavg: [[0, 16.7], [1, 18], [2, 17]],
  alt: [[0, 10], [1, 20000], [2, 40000]], tlod: [[0, 125], [1, 700], [2, 700]], traffic: [[0, 12], [1, 0], [2, 0]],
  target: 16.67, stutter: 33.34, total_min: 2, over_count: 1, over_max: 45, avg_fps: 59.9, q1: 16, q3: 18 };

// window as a Proxy so `window.fn = ...` also creates the implicit browser global the script relies on.
const g = globalThis;
const sandbox = {
  Chart: ChartStub, CHART: CHARTDATA,
  document: { getElementById: id => els[id] || null, documentElement: {}, addEventListener: noop },
  getComputedStyle: () => ({ getPropertyValue: () => '#4ba3e6' }),
  localStorage: { getItem: () => null, setItem: noop },
  location: { search: '' },
  URLSearchParams: class { get(){ return null; } },
  MutationObserver: class { observe(){} },
};
for (const k in sandbox) g[k] = sandbox[k];
g.window = new Proxy({ CHART: CHARTDATA, api: {} }, { set(t, k, v){ t[k] = v; g[k] = v; return true; }, get(t, k){ return t[k]; } });

let setupErr = null;
try { (0, eval)(chartSrc); } catch (e) { setupErr = e.message; }
T('chart.js setup runs without throwing', setupErr === null, setupErr);
T('both charts built (over-flight + moving-average)', chartsMade === 2, chartsMade + '');

const fire = (id, ev, arg) => { const h = (listeners[id] || []).find(l => l[0] === ev); if (!h) return 'no-handler';
  try { h[1](arg); return 'ok'; } catch (e) { return 'THREW: ' + e.message; } };
T('over-flight chart has synced mousemove + mouseleave', (listeners.ftChart || []).some(l => l[0] === 'mousemove') && (listeners.ftChart || []).some(l => l[0] === 'mouseleave'));
T('mousemove over the frametime chart syncs without throwing', fire('ftChart', 'mousemove', { clientX: 400 }) === 'ok');
T('mouseleave clears the sync without throwing', fire('ftChart', 'mouseleave') === 'ok');
T('mousemove over the moving-average chart syncs without throwing', fire('ftAvgChart', 'mousemove', { clientX: 200 }) === 'ok');

process.exit(T.done() ? 1 : 0);
