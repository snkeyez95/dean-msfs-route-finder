'use strict';
// Dev-only parity: run the Node CapFrameX converter over the existing flights and diff each output's
// SHA-256 against the Python oracle (_ref_cfx.json). PASS = byte-for-byte identical exports.
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { convertOne, metaFromSessionDir } = require('./capframex.js');

const SESSIONS = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const GPU = 'NVIDIA GeForce RTX 3080 Ti';
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_cfx.json'), 'utf8'));
const idx = JSON.parse(fs.readFileSync(path.join(SESSIONS, 'index.json'), 'utf8'));
const tmp = path.join(__dirname, '_cfx_nat_out'); fs.mkdirSync(tmp, { recursive: true });

let ok = 0, fail = 0;
for (const s of idx.sessions) {
  const folder = (s.folder || '').replace(/\//g, path.sep);
  const src = path.join(SESSIONS, folder, 'frametimes.csv');
  if (!fs.existsSync(src)) continue;
  const r = convertOne(src, tmp, metaFromSessionDir(path.join(SESSIONS, folder)), GPU);
  const id = s.session_id || folder;
  if (!r) { console.log('  native produced nothing:', id); fail++; continue; }
  const data = fs.readFileSync(r.outPath);
  const sha = crypto.createHash('sha256').update(data).digest('hex');
  const rf = ref[id];
  if (!rf) { console.log('  no oracle for', id); fail++; continue; }
  if (sha === rf.sha && data.length === rf.len && path.basename(r.outPath) === rf.name) { ok++; }
  else {
    fail++;
    console.log('  DIFF ' + id + '  native[' + sha.slice(0, 10) + ' len' + data.length + ' ' + path.basename(r.outPath) + ']  py[' + rf.sha.slice(0, 10) + ' len' + rf.len + ' ' + rf.name + ']');
  }
}
console.log('\nCFX PARITY ' + (fail === 0 ? 'PASS' : 'FAIL') + ' — ' + ok + '/' + (ok + fail) + ' exports byte-for-byte identical to Python');
