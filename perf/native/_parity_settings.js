'use strict';
// Phase 8a settings parity: run the Node read_settings port over the SAME UserCfg.opt the Python
// oracle used, diff field-by-field. Run `python _ref_settings.py` first. Read-only.
const fs = require('fs'), path = require('path');
const { readSettings } = require('./settings.js');

const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_settings.json'), 'utf8'));
const node = readSettings(ref.usercfg_path);
const py = ref.settings;

const diffs = [];
for(const k of Object.keys(py)){
  if(JSON.stringify(node[k]) !== JSON.stringify(py[k])) diffs.push('  ' + k + ': node=' + JSON.stringify(node[k]) + ' py=' + JSON.stringify(py[k]));
}
console.log('UserCfg.opt:  ' + ref.usercfg_path);
console.log('node:         ' + JSON.stringify(node));
console.log('python:       ' + JSON.stringify(py));
console.log(diffs.length ? ('\nSETTINGS PARITY FAIL:\n' + diffs.join('\n')) : '\nSETTINGS PARITY PASS — read_settings matches Python.');
