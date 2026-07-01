'use strict';
// Phase 8a report parity: build report.html in Node from the same inputs, diff vs the Python-written
// _ref_report.html (line-endings normalized — Python's text-mode write turns \n into \r\n, a write
// quirk, not content). Run `python _ref_report.py` first.
const fs = require('fs'), path = require('path');
const { buildReport } = require('./report_html.js');
const { readChronological } = require('./report_charts.js');

const sdir = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const meta = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_report_meta.json'), 'utf8'));
const fdir = path.join(sdir, meta.folder.replace(/\//g, path.sep));
const summary = JSON.parse(fs.readFileSync(path.join(fdir, 'summary.json'), 'utf8'));
const { ft } = readChronological(path.join(fdir, 'frametimes.csv'));
const sortedFt = ft.slice().sort((a, b) => a - b);

const node = buildReport(meta.session_id, summary.settings, summary.smoothness, summary.vram, ft, sortedFt, fdir, meta.driver_version, meta.sim_version);
const py = fs.readFileSync(path.join(fdir, '_ref_report.html'), 'utf8').replace(/\r\n/g, '\n');

if(node === py){
  console.log('REPORT PARITY PASS — report.html byte-for-byte identical to Python (' + node.length + ' chars).');
} else {
  console.log('REPORT PARITY FAIL: node=' + node.length + ' py=' + py.length);
  for(let i = 0; i < Math.min(node.length, py.length); i++) if(node[i] !== py[i]){
    console.log('first diff @char ' + i + ':');
    console.log('  node: …' + JSON.stringify(node.slice(Math.max(0, i - 30), i + 60)));
    console.log('  py:   …' + JSON.stringify(py.slice(Math.max(0, i - 30), i + 60)));
    break;
  }
}
