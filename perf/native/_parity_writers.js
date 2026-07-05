'use strict';
// Phase 8a writers parity: build the Node nav entries + csv rows over the live sessions, diff
// (semantically) vs _ref_writers.json. Run `python _ref_writers.py` first. Read-only.
const fs = require('fs'), path = require('path');
const { buildSessionsNavEntries, buildIndexCsvRows, INDEX_CSV_FIELDS } = require('./index_writer.js');

const sdir = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const idx = JSON.parse(fs.readFileSync(path.join(sdir, 'index.json'), 'utf8'));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_writers.json'), 'utf8'));
const sessions = idx.sessions || [];

const nav = buildSessionsNavEntries(sessions);
const rows = buildIndexCsvRows(sessions);
let diffs = 0;

if(JSON.stringify(nav) !== JSON.stringify(ref.nav)){
  diffs++; console.log('NAV DIFF:');
  for(let i = 0; i < Math.max(nav.length, ref.nav.length); i++)
    if(JSON.stringify(nav[i]) !== JSON.stringify(ref.nav[i])) console.log('  [' + i + '] node=' + JSON.stringify(nav[i]) + ' py=' + JSON.stringify(ref.nav[i]));
} else console.log('NAV:        ' + nav.length + ' entries match');

if(JSON.stringify(INDEX_CSV_FIELDS) !== JSON.stringify(ref.fields)){ diffs++; console.log('CSV FIELDS DIFF: node=' + JSON.stringify(INDEX_CSV_FIELDS) + ' py=' + JSON.stringify(ref.fields)); }
else console.log('CSV fields: ' + INDEX_CSV_FIELDS.length + ' match');

if(JSON.stringify(rows) !== JSON.stringify(ref.rows)){
  diffs++; console.log('CSV ROWS DIFF:');
  for(let i = 0; i < Math.max(rows.length, ref.rows.length); i++)
    if(JSON.stringify(rows[i]) !== JSON.stringify(ref.rows[i])) console.log('  row[' + i + '] node=' + JSON.stringify(rows[i]) + ' py=' + JSON.stringify(ref.rows[i]));
} else console.log('CSV rows:   ' + rows.length + ' match');

console.log(diffs === 0 ? '\nWRITERS PARITY PASS — sessions_nav + index.csv data identical to Python.' : '\nWRITERS PARITY FAIL — investigate above.');
