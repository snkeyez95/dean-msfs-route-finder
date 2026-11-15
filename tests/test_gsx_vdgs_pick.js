'use strict';
// GSX bundled-profile scan: when a scenery ships both an "Aerosoft VDGS" and a "GSX VDGS" edition of
// its profile, only the GSX edition may be offered for install (otherwise Scan Now re-adds the
// Aerosoft edition Dean removed, and GSX sees two profiles for one airport).
// Runs the REAL helpers sliced out of main.js against the REAL scenery folders when present.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');

function grab(name){
  const i = src.indexOf('function ' + name + '('); if(i < 0) throw new Error('fn not found: ' + name);
  let d = 0, s = false;
  for(let j = i; j < src.length; j++){
    if(src[j] === '{'){ d++; s = true; } else if(src[j] === '}'){ d--; if(s && d === 0) return src.slice(i, j + 1); }
  }
  throw new Error('unbalanced ' + name);
}
const constLine = re => { const m = src.match(re); if(!m) throw new Error('const not found: ' + re); return m[0]; };
const code = [
  constLine(/const GSX_SKIP_DIRS = .*;/),
  constLine(/const gsxIsProfileFile = .*;/),
  constLine(/const GSX_VDGS_DIR = .*;/),
  grab('gsxWalkFiles'), grab('gsxLooksBundled'), grab('gsxPreferGsxVdgs'),
  'return {gsxWalkFiles, gsxLooksBundled, gsxPreferGsxVdgs, GSX_SKIP_DIRS};'
].join('\n');
const H = new Function('fs', 'path', code)(fs, path);
const scan = (folder, icao) => H.gsxPreferGsxVdgs(
  H.gsxWalkFiles(folder, 6, H.GSX_SKIP_DIRS).filter(f => H.gsxLooksBundled(f.base, icao)), folder);

let pass = 0, fail = 0;
const ok = (c, m) => { if(c){ pass++; console.log('  ok  ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// 1. Synthetic: both editions → only GSX edition survives.
const os = require('os');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gsxvdgs-'));
try{
  const mk = (rel) => { const p = path.join(tmp, rel); fs.mkdirSync(path.dirname(p), {recursive:true}); fs.writeFileSync(p, 'x'); };
  mk('pkgA/Aerosoft VDGS/xxxx-asx.ini'); mk('pkgA/Aerosoft VDGS/xxxx-asx.py');
  mk('pkgA/GSX VDGS/xxxx-gsx.ini');     mk('pkgA/GSX VDGS/xxxx-gsx.py');
  mk('pkgB/Aerosoft VDGS/yyyy-asx.ini'); mk('pkgB/Official GSX Profile/yyyy-only.ini');
  mk('pkgC/Official GSX Profile/zzzz.ini'); mk('pkgC/Official GSX Profile/zzzz.py');
  const a = scan(path.join(tmp, 'pkgA'), 'xxxx').map(f => f.base).sort();
  ok(JSON.stringify(a) === JSON.stringify(['xxxx-gsx.ini','xxxx-gsx.py']), 'both editions → GSX edition only (' + a.join(',') + ')');
  const b = scan(path.join(tmp, 'pkgB'), 'yyyy').map(f => f.base).sort();
  ok(b.length === 2, 'no GSX-VDGS folder → nothing dropped (Aerosoft-only package untouched)');
  const c = scan(path.join(tmp, 'pkgC'), 'zzzz').map(f => f.base).sort();
  ok(c.length === 2, 'ordinary package → unchanged');
} finally { fs.rmSync(tmp, {recursive:true, force:true}); }

// 2. Real scenery (skipped cleanly on a machine without it).
const LIB = 'C:\\Users\\MultiBotPC\\Documents\\MSFS\\Scenery';
const limc = path.join(LIB, 'aerosoft-airport-limc-milan');
if(fs.existsSync(limc)){
  const r = scan(limc, 'limc').map(f => path.relative(limc, f.abs));
  ok(r.length === 3 && r.every(p => /GSX VDGS/i.test(p)), 'real LIMC → only the 3 GSX VDGS files (' + r.length + ')');
  ok(!r.some(p => /ASXVDGS/i.test(p)), 'real LIMC → no ASXVDGS file offered');
} else console.log('  skip real LIMC (not installed)');
const eddf = path.join(LIB, 'aerosoft-airport-eddf-frankfurt');
if(fs.existsSync(eddf)){
  const r = scan(eddf, 'eddf').map(f => path.relative(eddf, f.abs));
  ok(r.length > 0 && !r.some(p => /Aerosoft VDGS/i.test(p)), 'real EDDF → Aerosoft VDGS editions dropped, GSX ones kept (' + r.length + ')');
} else console.log('  skip real EDDF (not installed)');

// 3. Renderer one-time cache clear (index.html gsxEvaluate): cached entries that list Aerosoft-VDGS
//    files are dropped once (so they rescan with the new rule); others stay; flag set; runs once.
{
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const i = html.indexOf('if(!S.cfg.gsxVdgsPickV1){'); ok(i > 0, 'one-time cache clear present in gsxEvaluate');
  let d = 0, s = false, j = i;
  for(; j < html.length; j++){ if(html[j] === '{'){ d++; s = true; } else if(html[j] === '}'){ d--; if(s && d === 0) break; } }
  const run = new Function('S', 'RLOG', 'let dirty=false;const cache=S.cfg.gsxScanCache;' + html.slice(i, j + 1) + ';return dirty;');
  const S = {cfg:{gsxScanCache:{
    'aerosoft-airport-limc-milan': {bundled:true, files:[{abs:'C:\\lib\\aerosoft-airport-limc-milan\\Aerosoft VDGS\\LIMC-x.ini'},{abs:'C:\\lib\\aerosoft-airport-limc-milan\\GSX VDGS\\LIMC-y.ini'}]},
    'inibuilds-airport-egll-heathrow': {bundled:true, files:[{abs:'C:\\lib\\egll\\Official GSX Profile\\egll.ini'}]},
    'nothing-here': {bundled:false, files:[]}
  }}};
  ok(run(S, () => {}) === true, 'first run marks config dirty (saved)');
  ok(!('aerosoft-airport-limc-milan' in S.cfg.gsxScanCache), 'LIMC entry dropped → rescanned with the rule');
  ok('inibuilds-airport-egll-heathrow' in S.cfg.gsxScanCache && 'nothing-here' in S.cfg.gsxScanCache, 'other entries kept');
  S.cfg.gsxScanCache['aerosoft-x'] = {bundled:true, files:[{abs:'C:\\lib\\aerosoft-x\\Aerosoft VDGS\\a.ini'}]};
  ok(run(S, () => {}) === false && 'aerosoft-x' in S.cfg.gsxScanCache, 'second run is a no-op (flag set — no rescan loop)');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
