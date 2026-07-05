'use strict';
// Phase 8a write parity: run the Node writeSettingsText over the SAME original UserCfg.opt for each
// case, hash the result, diff vs _ref_write.json (real Python). Run `python _ref_write.py` first.
// Read-only on the real config (operates on the in-memory text).
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const { writeSettingsText } = require('./settings.js');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_write.json'), 'utf8'));
const origText = fs.readFileSync(ref.usercfg_path, 'utf8');

let fails = 0;
for(const [key, r] of Object.entries(ref.cases)){
  const [tlod, olod] = key.split('_').map(Number);
  const res = writeSettingsText(origText, tlod, olod);
  if(!res.ok){ console.log('TLOD ' + key + ': NODE FAIL (' + res.reason + ')'); fails++; continue; }
  const buf = Buffer.from(res.text, 'utf8');
  const h = crypto.createHash('sha256').update(buf).digest('hex');
  const match = (h === r.sha256) && r.ok;
  if(!match) fails++;
  console.log('TLOD ' + tlod + '/' + olod + ':  node ' + h.slice(0, 12) + '  py ' + r.sha256.slice(0, 12) + '  len(node=' + buf.length + ' py=' + r.len + ')  ' + (match ? 'MATCH' : 'DIFF'));
}
console.log(fails === 0 ? '\nWRITE PARITY PASS — UserCfg writes are byte-for-byte identical to Python.' : '\nWRITE PARITY FAIL — investigate above.');
