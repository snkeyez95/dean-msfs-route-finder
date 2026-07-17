'use strict';
// The cheapest, broadest safety net: every shipped JS module must parse, and every <script> block in
// the two HTML files must parse. Catches a typo before it reaches a release. Needs no real data.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('parse checks:');

const files = [];
const perfNative = path.join(X.ROOT, 'perf', 'native');
for(const f of fs.readdirSync(perfNative)) if(f.endsWith('.js') && !f.startsWith('_')) files.push(path.join(perfNative, f));
files.push(path.join(X.ROOT, 'main.js'), path.join(X.ROOT, 'preload.js'));

const cp = require('child_process');
let bad = 0;
for(const f of files){
  const r = cp.spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if(r.status !== 0){ console.log('  FAIL ' + path.relative(X.ROOT, f) + ': ' + (r.stderr || '').split('\n')[0]); bad++; }
}
T(files.length + ' node modules parse clean', bad === 0, bad + ' failed');

for(const html of ['index.html', 'overlay.html']){
  const src = fs.readFileSync(path.join(X.ROOT, html), 'utf8');
  const re = /<script>([\s\S]*?)<\/script>/g;
  let m, n = 0, err = null;
  while((m = re.exec(src))){ n++; try { new Function(m[1]); } catch(e){ err = e.message; break; } }
  T(html + ' — ' + n + ' script block(s) parse clean', !err, err);
}
process.exit(T.done() ? 1 : 0);
