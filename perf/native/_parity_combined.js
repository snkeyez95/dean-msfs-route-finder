'use strict';
// Phase 8a combined-dashboard parity: build the dashboard in Node from the real index.json, diff vs
// _ref_combined.html (real Python, \n-normalized). Run `python _ref_combined.py` first.
const fs = require('fs'), path = require('path');
const { buildCombinedReport } = require('./report_combined.js');

const sdir = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const idx = JSON.parse(fs.readFileSync(path.join(sdir, 'index.json'), 'utf8'));
const node = buildCombinedReport(idx.sessions || []);
const py = fs.readFileSync(path.join(__dirname, '_ref_combined.html'), 'utf8').replace(/\r\n/g, '\n');

if(node === py){
  console.log('COMBINED PARITY PASS — combined_report.html byte-for-byte identical to Python (' + node.length + ' chars).');
} else {
  console.log('COMBINED PARITY FAIL: node=' + node.length + ' py=' + py.length);
  for(let i = 0; i < Math.min(node.length, py.length); i++) if(node[i] !== py[i]){
    console.log('first diff @char ' + i + ':');
    console.log('  node: …' + JSON.stringify(node.slice(Math.max(0, i - 30), i + 70)));
    console.log('  py:   …' + JSON.stringify(py.slice(Math.max(0, i - 30), i + 70)));
    break;
  }
}
