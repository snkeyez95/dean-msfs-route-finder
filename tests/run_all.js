'use strict';
// Runs every suite in tests/ and prints one tally. Exit code 1 if anything failed.
//   node tests/run_all.js        (or double-click tests\run_tests.bat)
const fs = require('fs'), path = require('path'), cp = require('child_process');
const DIR = __dirname;
const suites = fs.readdirSync(DIR).filter(f => /^test_.*\.js$/.test(f)).sort();

console.log('ABRP test suite — ' + suites.length + ' file(s)\n' + '='.repeat(70));
const results = [];
for(const s of suites){
  const t0 = Date.now();
  const r = cp.spawnSync(process.execPath, [path.join(DIR, s)], { encoding: 'utf8' });
  const out = (r.stdout || '') + (r.stderr || '');
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const skipped = /^SKIP —/m.test(out);
  const m = out.match(/(\d+) passed, (\d+) failed/);
  const matrix = out.match(/matrix clean|MATRIX FAILED/);
  let line;
  if(skipped) line = 'SKIP';
  else if(m) line = m[1] + ' passed, ' + m[2] + ' failed';
  else if(matrix) line = matrix[0];
  else line = r.status === 0 ? 'ok' : 'FAILED';
  results.push({ s, status: r.status, skipped, line, secs, out });
  const tag = skipped ? '  SKIP ' : (r.status === 0 ? '  ok   ' : '  FAIL ');
  console.log(tag + s.padEnd(32) + line.padEnd(26) + secs + 's');
}
const failed = results.filter(r => !r.skipped && r.status !== 0);
if(failed.length){
  console.log('\n' + '='.repeat(70) + '\nFAILURES — full output:\n');
  for(const f of failed){ console.log('--- ' + f.s + ' ---'); console.log(f.out); }
}
const skipped = results.filter(r => r.skipped).length;
console.log('\n' + '='.repeat(70));
console.log(failed.length ? (failed.length + ' SUITE(S) FAILED') : 'ALL SUITES PASS' +
  (skipped ? '  (' + skipped + ' skipped — needs the app\'s data cache)' : ''));
process.exit(failed.length ? 1 : 0);
