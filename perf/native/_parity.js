'use strict';
// Phase 8a parity check: run the Node stats port over every existing flight's frametimes.csv and diff
// field-by-field against _ref.json (the real Python output). Success = zero field diffs across all
// flights. Dev-only; read-only on Sessions. Run `python _ref.py` first to (re)generate _ref.json.
const fs = require('fs'), path = require('path');
const { parseFrametimes } = require('./stats.js');

const sessions = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const idx = JSON.parse(fs.readFileSync(path.join(sessions, 'index.json'), 'utf8'));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref.json'), 'utf8'));

let flights = 0, mism = 0, fieldDiffs = 0;
for(const s of idx.sessions || []){
  const folder = (s.folder || '').replace(/\//g, path.sep);
  const csvp = path.join(sessions, folder, 'frametimes.csv');
  if(!folder || !fs.existsSync(csvp)) continue;
  const key = s.session_id || folder;
  const py = ref[key];
  if(!py) continue;
  const node = parseFrametimes(csvp);
  flights++;
  if(!node){ console.log('NODE-NULL ' + key); mism++; continue; }
  const diffs = [];
  for(const k of Object.keys(py)){
    const a = node[k], b = py[k];
    if(a === b) continue;
    if(a == null && b == null) continue;
    diffs.push('  ' + k + ': node=' + a + '  py=' + b);
    fieldDiffs++;
  }
  if(diffs.length){ mism++; console.log('DIFF ' + key + '\n' + diffs.join('\n')); }
  else console.log('OK   ' + key + '  (p99=' + node.p99_ft_ms + ' frames=' + node.frame_count + ' cpuBound=' + node.cpu_bound_pct + '%)');
}
console.log('\n==== ' + flights + ' flights checked · ' + mism + ' with diffs · ' + fieldDiffs + ' total field diffs ====');
console.log(fieldDiffs === 0 ? 'PARITY PASS — Node math is byte-for-byte identical to Python.' : 'PARITY FAIL — investigate the diffs above.');
