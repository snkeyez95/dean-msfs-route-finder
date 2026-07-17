'use strict';
// CLI backup — the same code the app's Maintenance tab runs (lib/data_backup.js), so the two can
// never drift apart. Useful when the app won't start, or for a quick manual run.
//
//   node tools\backup-data.js                 back up to the default folder
//   node tools\backup-data.js "D:\Some Path"  back up somewhere else
const path = require('path');
const { backupData, DEFAULT_DEST } = require('../lib/data_backup.js');

const appDir = path.join(process.env.APPDATA || '', 'A Better Route Planner');
const dest = process.argv[2] || DEFAULT_DEST;

console.log('ABRP data backup');
console.log('  from: ' + appDir + '   (read only — never modified)');
console.log('  to:   ' + dest);
console.log('='.repeat(72));

const r = backupData(appDir, dest, msg => console.log('  ' + msg));

console.log('='.repeat(72));
if(!r.ok && r.error){ console.error('STOPPED: ' + r.error); process.exit(1); }
if(!r.ok){ console.error(r.errors.length + ' job(s) FAILED:'); for(const e of r.errors) console.error('  ' + e); process.exit(1); }
console.log('backup complete — ' + r.human + ', ' + r.files + ' files, ' + r.flights + ' flight days  (' + r.seconds + 's)');
console.log('  ' + r.dest);
console.log('  restore instructions written to "READ ME - how to restore.txt"');
