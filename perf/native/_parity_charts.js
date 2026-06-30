'use strict';
// Phase 8a charts parity: run the Node report chart helpers over the same flight, diff vs
// _ref_charts.json (real Python). SVG compared byte-for-byte; series compared numerically (json float
// repr differs across langs, the values don't). Run `python _ref_charts.py` first.
const fs = require('fs'), path = require('path');
const { readChronological, svgPerfLine, chartFrametimeSeries, rollingMeanSeries, varianceBins, phaseBarsHtml } = require('./report_charts.js');

const sdir = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_charts.json'), 'utf8'));
const folder = ref.folder.replace(/\//g, path.sep);
const { ft } = readChronological(path.join(sdir, folder, 'frametimes.csv'));
const summary = JSON.parse(fs.readFileSync(path.join(sdir, folder, 'summary.json'), 'utf8'));
const phases = summary.smoothness.phases;

const [maxpts, meanpts] = chartFrametimeSeries(ft);
const roll = rollingMeanSeries(meanpts);
const diffs = [];
function cmpSeries(name, a, b){
  if(a.length !== b.length){ diffs.push(name + ' len: node=' + a.length + ' py=' + b.length); return; }
  for(let i = 0; i < a.length; i++) if(a[i][0] !== b[i][0] || a[i][1] !== b[i][1]){ diffs.push(name + '[' + i + ']: node=' + JSON.stringify(a[i]) + ' py=' + JSON.stringify(b[i])); if(diffs.length > 8) return; }
}
if(ft.length !== ref.ft_len) diffs.push('ft_len: node=' + ft.length + ' py=' + ref.ft_len);
const svgMs = svgPerfLine(ft, false), svgFps = svgPerfLine(ft, true);
if(svgMs !== ref.svg_ms){ diffs.push('svg_ms DIFF (node ' + svgMs.length + 'b, py ' + ref.svg_ms.length + 'b)'); for(let i = 0; i < Math.min(svgMs.length, ref.svg_ms.length); i++) if(svgMs[i] !== ref.svg_ms[i]){ diffs.push('  first diff @char ' + i + ': node…' + svgMs.slice(i, i + 40) + ' | py…' + ref.svg_ms.slice(i, i + 40)); break; } }
if(svgFps !== ref.svg_fps) diffs.push('svg_fps DIFF (node ' + svgFps.length + 'b, py ' + ref.svg_fps.length + 'b)');
cmpSeries('series_max', maxpts, ref.series_max);
cmpSeries('series_mean', meanpts, ref.series_mean);
cmpSeries('roll', roll, ref.roll);
if(JSON.stringify(varianceBins(ft)) !== JSON.stringify(ref.variance)) diffs.push('variance: node=' + JSON.stringify(varianceBins(ft)) + ' py=' + JSON.stringify(ref.variance));
if(phaseBarsHtml(phases) !== ref.phase_html) diffs.push('phase_html DIFF:\n  node=' + phaseBarsHtml(phases) + '\n  py  =' + ref.phase_html);

console.log('ft=' + ft.length + '  series=' + maxpts.length + '  roll=' + roll.length);
console.log('svg_ms byte-match: ' + (svgMs === ref.svg_ms) + '   svg_fps byte-match: ' + (svgFps === ref.svg_fps));
console.log('variance: ' + JSON.stringify(varianceBins(ft)));
console.log(diffs.length ? ('\nCHARTS PARITY FAIL:\n' + diffs.slice(0, 14).join('\n')) : '\nCHARTS PARITY PASS — SVG + series + variance + phase bars all byte/numeric-match Python.');
