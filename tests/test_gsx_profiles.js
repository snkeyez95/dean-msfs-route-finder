'use strict';
// v6.29.0 GSX profile housekeeping: version-aware placement, install record, removed list, health
// check, profile-only folder detection, two-editions drop picker, and the Maintenance panel render.
// Synthetic cases run in a throwaway temp folder (deleted at the end); real-data checks are READ-ONLY.
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const G = require(path.join(ROOT, 'gsx_profiles.js'));

let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (extra !== undefined ? '  → ' + JSON.stringify(extra) : '')); } };

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsxprof-'));
const mk = (rel, text, daysAgo) => {
  const p = path.join(TMP, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text);
  if (daysAgo != null) { const t = new Date(Date.now() - daysAgo * 864e5); fs.utimesSync(p, t, t); }
  return p;
};
const ini = (ver, extra) => '[general]\ncreator = RW Profiles\nscenario = Test Airport\n' + (ver == null ? '' : 'notes = ' + ver + '\n') + (extra || '') + '\n[gate 1]\nx = 1\n';

try {
  console.log('1. version parsing');
  ok(G.iniVersion('notes = v1.7').join('.') === '1.7', '"v1.7"');
  ok(G.iniVersion('notes = 1.5').join('.') === '1.5', '"1.5"');
  ok(G.iniVersion('NOTES=Version 2.0.1').join('.') === '2.0.1', '"Version 2.0.1"');
  ok(G.iniVersion('notes = V. 1.1').join('.') === '1.1' && G.iniVersion('notes = V1.7.0').join('.') === '1.7.0', 'real formats "V. 1.1", "V1.7.0"');
  ok(G.iniVersion('notes = v1.3 - Designed with scenery v2.1.0').join('.') === '1.3', '"v1.3 - Designed with scenery v2.1.0" → 1.3 (not the scenery version)');
  ok(G.iniVersion('notes = FlyTampa EKCH, GSX Profile 1.3') === null && G.iniVersion('notes = custumized by PassengerFlight v1.0') === null, 'version buried in prose → unknown (falls back to date)');
  ok(G.iniVersion('notes = ') === null, 'blank → unknown');
  ok(G.iniVersion('notes = GSX profile for GregMason MCI scenery.') === null, 'prose → unknown');
  ok(G.iniVersion('notes = 2024 update') === null, '"2024 update" is not read as version 2024');
  ok(G.cmpVer([1, 10], [1, 9]) > 0 && G.cmpVer([1, 3], [1, 3, 0]) === 0, 'compare 1.10 > 1.9, 1.3 == 1.3.0');
  ok(G.icaoOf('egcc-iniBuilds.ini') === 'EGCC' && G.icaoOf('EGCC_inibuilds_airport.ini') === 'EGCC' && G.icaoOf('cyyz.py') === 'CYYZ' && G.icaoOf('kjfkextra.ini') === null, 'ICAO from file names');
  ok(G.stemOf('X-Y_handler.py') === 'x-y' && G.stemOf('X-Y.ini') === 'x-y', 'profile stem pairs .ini/.py/_handler.py');

  console.log('2. version-aware placement (the EGSS risk)');
  const gdir = path.join(TMP, 'GSX', 'MSFS'); fs.mkdirSync(gdir, { recursive: true });
  const led = path.join(TMP, 'ledger.json'), rem = path.join(TMP, 'removed.json');
  // installed v1.3, OLDER file date; scenery ships v1.2 with a NEWER date → old date rule would stomp it
  mk('GSX/MSFS/egss-x.ini', ini('v1.3'), 30); mk('GSX/MSFS/egss-x.py', 'py-new', 30);
  const s1 = mk('scn/egss/egss-x.ini', ini('1.2'), 1), s1p = mk('scn/egss/egss-x.py', 'py-old', 1);
  let r = G.placeSet([s1p, s1], gdir, { ledgerPath: led, removedPath: rem });
  ok(r.find(x => x.base === 'egss-x.ini').action === 'kept-local', 'scenery v1.2 (newer date) does NOT replace your v1.3', r);
  ok(r.find(x => x.base === 'egss-x.py').action === 'kept-local', '…and its script follows the profile decision (stays yours)');
  ok(/v1\.3/.test(fs.readFileSync(path.join(gdir, 'egss-x.ini'), 'utf8')), 'file on disk still v1.3');
  // scenery ships v1.5 with an OLDER date than the installed v1.3 → version wins → update
  mk('GSX/MSFS/egll-x.ini', ini('1.3'), 1);
  const s2 = mk('scn/egll/egll-x.ini', ini('1.5'), 60);
  r = G.placeSet([s2], gdir, { ledgerPath: led, removedPath: rem });
  ok(r[0].action === 'updated' && /1\.5/.test(r[0].why), 'scenery v1.5 (older date) replaces your v1.3', r);
  // unknown versions → date rule
  mk('GSX/MSFS/kmci-x.ini', ini(null), 30);
  const s3 = mk('scn/kmci/kmci-x.ini', ini(null, 'foo = 2'), 1);
  r = G.placeSet([s3], gdir, { ledgerPath: led, removedPath: rem });
  ok(r[0].action === 'updated' && /date/.test(r[0].why), 'no versions → newer file date wins (old behaviour)');
  // identical → current; new → installed
  const s4 = mk('scn/kbos/kbos-x.ini', ini('1.0'));
  r = G.placeSet([s4], gdir, { ledgerPath: led, removedPath: rem });
  ok(r[0].action === 'installed', 'new profile installed');
  r = G.placeSet([s4], gdir, { ledgerPath: led, removedPath: rem });
  ok(r[0].action === 'current', 'identical → nothing to do');
  const L = JSON.parse(fs.readFileSync(led, 'utf8'));
  ok(L.some(e => e.file === 'kbos-x.ini' && e.action === 'installed' && /scn/.test(e.from)) && L.some(e => e.file === 'egll-x.ini' && e.action === 'updated'), 'install record lists installs + updates with their source');
  ok(!L.some(e => e.action === 'kept-local' || e.action === 'current'), 'record holds only real changes (no noise)');

  console.log('3. move to backup + never reinstalled');
  mk('GSX/MSFS/limc-asx.ini', ini(null)); mk('GSX/MSFS/limc-asx.py', 'a'); mk('GSX/MSFS/limc-asx_handler.py', 'b');
  mk('GSX/MSFS/limc-gsx.ini', ini(null)); mk('GSX/MSFS/limc-gsx.py', 'c');
  const mv = G.moveToBackup(gdir, 'LIMC-ASX.ini', { removedPath: rem });
  ok(mv.ok && mv.moved.length === 3, 'moves the profile + its own 2 scripts (case-insensitive name)', mv);
  ok(fs.existsSync(path.join(gdir, 'limc-gsx.ini')) && fs.existsSync(path.join(gdir, 'limc-gsx.py')), 'the other edition is untouched');
  ok(mv.backupDir === path.join(TMP, 'GSX', 'MSFS_backup') && fs.existsSync(path.join(mv.backupDir, 'limc-asx_handler.py')), 'backup sits BESIDE the GSX folder (GSX can\'t load it)');
  const back = mk('scn/limc/Aerosoft VDGS/limc-asx.ini', ini(null));
  r = G.placeSet([back], gdir, { ledgerPath: led, removedPath: rem });
  ok(r[0].action === 'skipped-removed' && !fs.existsSync(path.join(gdir, 'limc-asx.ini')), 'Scan Now does not put a moved-to-backup file back');
  ok(G.moveToBackup(gdir, '..\\..\\x.ini', { removedPath: rem }).ok === false, 'refuses anything outside the GSX folder');
  // shared script stays when another .ini shares the stem
  mk('GSX/MSFS/eddb-a.ini', ini(null)); mk('GSX/MSFS/sub/eddb-a.ini', ini(null)); mk('GSX/MSFS/eddb-a.py', 'x');
  const mv2 = G.moveToBackup(gdir, 'eddb-a.ini', { removedPath: rem });
  ok(mv2.ok && mv2.moved.length === 1 && fs.existsSync(path.join(gdir, 'eddb-a.py')), 'a script still used by another copy of the profile is left in place');
  G.removedDel(rem, ['limc-asx.ini']);
  ok(!G.removedSet(rem).has('limc-asx.ini'), 'dropping a file yourself clears it from the removed list');

  console.log('4. health check');
  const h = path.join(TMP, 'H'); fs.mkdirSync(h);
  const hw = (n, t, d) => { const p = path.join(h, n); fs.writeFileSync(p, t); if (d != null) { const tt = new Date(Date.now() - d * 864e5); fs.utimesSync(p, tt, tt); } };
  hw('egcc-ib.ini', ini('v1.7')); hw('egcc-ib.py', 'x'); hw('EGCC_old_copy.ini', ini('v1.4'));
  hw('egkk-rw.ini', ini('v1.4')); hw('EGKK_rw_old.ini', ini('v1.2')); hw('EGKK-MK-A320-GSX-VDGS.ini', '[general]\ncreator = MK\n');
  hw('cyyz.py', 'orphan'); hw('kjfk-a.ini', ini('1.0'));
  const H = G.healthCheck(h, { owned: ['CYYZ', 'KJFK', 'LGAV', 'KBOS'], flown: { CYYZ: 4, LGAV: 3, KJFK: 9, KBOS: 0 }, ledgerPath: led, removedPath: rem });
  const egcc = H.duplicates.find(d => d.icao === 'EGCC'), egkk = H.duplicates.find(d => d.icao === 'EGKK');
  ok(egcc && egcc.kind === 'older-version' && egcc.keep === 'egcc-ib.ini', 'same profile, two versions → suggests keeping v1.7', egcc);
  ok(egcc.items.find(i => i.file === 'egcc-ib.ini').scripts.includes('egcc-ib.py'), '…lists the script that belongs to it');
  ok(egkk && egkk.kind === 'choice' && egkk.keep === null, 'different editions/authors → no suggestion (your call)');
  ok(egkk.items.find(i => i.file === 'EGKK_rw_old.ini').olderThan === 'egkk-rw.ini (v1.4)', '…but the RW v1.2 is still marked as an older version of v1.4');
  ok(H.orphans.length === 1 && H.orphans[0].file === 'cyyz.py', 'orphan script found');
  ok(JSON.stringify(H.missing) === JSON.stringify([{ icao: 'CYYZ', flights: 4 }, { icao: 'LGAV', flights: 3 }]), 'flown airports without a profile, most flown first; unflown ones left out', H.missing);
  ok(H.duplicates[0].kind === 'older-version', 'clear-cut cases listed first');
  const egccItem = egcc.items.find(i => i.file === 'egcc-ib.ini');
  ok(/not installed by ABRP/.test(egccItem.origin), 'origin says when ABRP has no record of a file');

  console.log('5. scenery vs GSX-download folders');
  mk('lib/pkg/manifest.json', '{"package_version":"1.0.0","content_type":"SCENERY"}'); mk('lib/wrap/inner/manifest.json', '{"package_version":"1.0.0","content_type":"SCENERY"}'); mk('lib/dl/x.ini', ini(null)); mk('lib/dl/x.py', 'x');
  mk('lib/scn-with-gsx/manifest.json', '{"package_version":"1.0.0","content_type":"SCENERY"}'); mk('lib/scn-with-gsx/Official GSX Profile/y.ini', ini(null)); mk('lib/empty/readme.txt', 'x');
  ok(G.hasPackage(path.join(TMP, 'lib/pkg')) && G.hasPackage(path.join(TMP, 'lib/wrap')), 'package and wrapper count as scenery');
  ok(!G.hasPackage(path.join(TMP, 'lib/dl')) && !G.hasPackage(path.join(TMP, 'lib/empty')), 'a GSX download / an empty folder is not scenery');
  ok(G.isProfileOnly(path.join(TMP, 'lib/dl')) && !G.isProfileOnly(path.join(TMP, 'lib/scn-with-gsx')) && !G.isProfileOnly(path.join(TMP, 'lib/empty')), 'profile-only download recognised; scenery that bundles a profile is not');
  const eds = G.editionsIn(['a/leib-x-GSXVDGS.ini', 'a/leib-x-NOOLVDGS.ini', 'a/leib-x.py', 'b/kjfk.ini', 'c/kjfk.ini']);
  ok(JSON.stringify(eds) === JSON.stringify({ LEIB: ['leib-x-GSXVDGS.ini', 'leib-x-NOOLVDGS.ini'] }), 'two differently-named profiles for one airport = editions (same name twice is a variant, not this)', eds);
} finally { fs.rmSync(TMP, { recursive: true, force: true }); }

console.log('6. wiring in main.js / preload / renderer');
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const pre = fs.readFileSync(path.join(ROOT, 'preload.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(/GSXP\.placeSet\(files\|\|\[\], dir, \{ledgerPath:GSX_LEDGER\(\), removedPath:GSX_REMOVED\(\)/.test(mainSrc), 'Scan Now installs go through placeSet with the record + removed list');
ok(!/function gsxPlaceFile/.test(mainSrc), 'old date-only placement is gone');
ok(/notScenery=all\.filter\(f=>!GSXP\.hasPackage/.test(mainSrc) && /return \{success:true,folders,pkgMap,notScenery\}/.test(mainSrc), 'scan-folder leaves out non-scenery folders');
ok(/if\(GSXP\.isProfileOnly\(p\)\)\{ gsxPaths\.push\(p\)/.test(mainSrc) && /if\(GSXP\.isProfileOnly\(tmp\)\)\{ gsxPaths\.push\(p\)/.test(mainSrc), 'scenery drop routes GSX downloads (folder or archive) to GSX');
ok(/return \{ok:false, editions:true, choices:eds\}/.test(mainSrc) && /variant!=='\*'/.test(mainSrc), 'GSX drop asks about editions; "install all" variant works');
ok(/'gsx_ledger\.json','gsx_removed\.json'\]/.test(mainSrc), 'record + removed list are part of Export My Setup');
ok(/gsxHealth:/.test(pre) && /gsxMoveToBackup:/.test(pre), 'preload bridges present');
ok(/await procFolders\(res\.folders,res\.pkgMap\)/.test(html), 'launch-time library refresh keeps wrapper info (KLAS) — was dropped before');
ok(/id="gsxh-btn"/.test(html) && /onclick="gsxHealthRun\(\)"/.test(html), 'Maintenance → GSX Profile Check button present');

console.log('7. surfaces (real renderer functions)');
function grab(name) {
  const i = html.indexOf('function ' + name + '('); if (i < 0) throw new Error('fn ' + name);
  const st = html.lastIndexOf('\n', i) + 1; let d = 0, s = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { d++; s = true; } else if (html[j] === '}') { d--; if (s && d === 0) return html.slice(st, j + 1); } }
}
const escSrc = grab('esc');
// 7a. Panel render
{
  const render = new Function('S', escSrc + '\n' + grab('fsUrl') + '\n' + grab('gsxHealthHtml') + '\nreturn gsxHealthHtml;')({ is2024: true });
  const sample = { ok: true, fileCount: 9, backupDir: 'C:\\x\\MSFS_backup', removedCount: 2,
    duplicates: [{ icao: 'EGKK', kind: 'choice', keep: null, items: [
      { file: 'egkk-rw.ini', version: '1.4', creator: 'RW', date: '2026-01-01', scripts: ['egkk-rw.py'], origin: 'installed by ABRP from x' },
      { file: 'EGKK_rw_old.ini', version: '1.2', creator: 'RW', date: '2025-01-01', scripts: [], origin: 'not installed by ABRP', olderThan: 'egkk-rw.ini (v1.4)' },
      { file: '<img src=x onerror=alert(1)>.ini', version: null, creator: '', date: '2026-01-01', scripts: [], origin: '' }] },
      { icao: 'EGCC', kind: 'older-version', keep: 'egcc-ib.ini', items: [
      { file: 'egcc-ib.ini', version: '1.7', creator: 'RW', date: '2026-01-01', scripts: [], origin: '' },
      { file: 'EGCC_old.ini', version: '1.4', creator: 'RW', date: '2025-01-01', scripts: [], origin: '' }] }],
    orphans: [{ icao: 'CYYZ', file: 'cyyz.py', origin: 'not installed by ABRP' }],
    missing: [{ icao: 'CYYZ', flights: 4 }, { icao: 'LGAV', flights: 1 }] };
  const out = render(sample);
  ok(/3<\/b> airports? with more than one profile|<b>2<\/b> airports with more than one profile/.test(out), 'summary line counts the problems');
  ok(/older version of egkk-rw\.ini \(v1\.4\)/.test(out), 'EGKK v1.2 row says "older version of …"');
  ok(/&#10003; KEEP<\/td><td[^>]*><b>egcc-ib\.ini/.test(out) && (out.match(/gsxHealthMove\(&quot;egcc-ib\.ini&quot;\)/g) || []).length === 0, 'suggested keeper is labelled KEEP in words and has no Move button');
  ok(/gsxHealthMove\(&quot;EGCC_old\.ini&quot;\)/.test(out), 'the older copy has a Move to backup button');
  ok(/cyyz\.py/.test(out) && /CYYZ · 4 flights/.test(out) && /LGAV · 1 flight /.test(out), 'orphan + missing airports listed (singular "flight")');
  ok(!/<img src=x/.test(out) && /&lt;img src=x/.test(out), 'file names are escaped');
  ok(/miscellaneous\/gsx-pro\?q=cyyz&amp;base=msfs2024/.test(out), 'flightsim.to button opens the GSX section with the MSFS 2024 filter (same link as My Airports)');
  ok(/MSFS_backup/.test(out) && /2 file\(s\) you moved/.test(out), 'says where backups go');
  const clean = render({ ok: true, fileCount: 5, backupDir: 'b', removedCount: 0, duplicates: [], orphans: [], missing: [] });
  ok(/No problems found/.test(clean), 'clean folder → plain "No problems found"');
}
// 7b. Drop flow: editions picker → pick → install with the chosen edition only
(async () => {
  const calls = [];
  const rd = { style: {}, innerHTML: '' };
  const api = { gsxInstallDropped: async (o) => { calls.push(o);
    if (!o.pickIni) return { ok: false, editions: true, choices: { LEIB: ['leib-GSXVDGS.ini', 'leib-NOOLVDGS.ini'], EGKK: ['a.ini', 'b.ini'] } };
    return { ok: true, copied: ['leib-GSXVDGS.ini', 'leib.py', 'b.ini'] }; } };
  const env = { window: { api }, S: { cfg: {} }, RLOG: () => {}, gsxRefresh: async () => {}, renderApts: () => {}, gsxToast: () => {} };
  const code = escSrc + '\n' + html.slice(html.indexOf('let _gsxDrop=null;'), html.indexOf('let _gsxDrop=null;') + 20) + '\n'
    + ['gsxInstallPaths', 'gsxDropContinue', 'gsxPickVariant', 'gsxPickEdition'].map(grab).join('\n')
    + '\nreturn {gsxInstallPaths, gsxPickEdition, get st(){return _gsxDrop;}};';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  await F.gsxInstallPaths(['C:\\dl\\leib.zip'], rd, { prefix: 'PRE ' });
  ok(/Two profiles for the same airport/.test(rd.innerHTML) && /LEIB/.test(rd.innerHTML) && /&#10003; GSX docking boards/.test(rd.innerHTML) && rd.innerHTML.startsWith('PRE '), 'drop with two editions shows a picker (GSX edition labelled) under the scenery-box prefix');
  F.gsxPickEdition('LEIB', 'leib-GSXVDGS.ini');
  ok(calls.length === 1 && /Still to choose/.test(rd.innerHTML) && /EGKK/.test(rd.innerHTML), 'waits until every airport is decided (no partial install)');
  F.gsxPickEdition('EGKK', 'b.ini');
  await new Promise(r => setTimeout(r, 0));
  ok(calls.length === 2 && JSON.stringify(calls[1].pickIni) === JSON.stringify(['leib-GSXVDGS.ini', 'b.ini']), 'then installs with exactly the chosen editions', calls[1]);
  ok(/Installed 3 GSX file/.test(rd.innerHTML), 'result line shows what was installed');

  console.log('8. real data (read-only)');
  {
    const gi = new Function('S', grab('gsxInstalled') + '\nreturn gsxInstalled;');
    const GD0 = path.join(process.env.APPDATA || '', 'Virtuali', 'GSX', 'MSFS');
    const files = fs.existsSync(GD0) ? fs.readdirSync(GD0).map(f => f.toLowerCase()) : ['cyyz.py', 'egll-24-inibuilds.ini'];
    const inst = gi({ gsxFiles: files });
    ok(inst('EGLL') === true, 'My Airports: EGLL shows GSX ✓ (it has a profile)');
    ok(!files.includes('cyyz.py') || inst('CYYZ') === false, 'My Airports: CYYZ no longer shows GSX ✓ because of a lone cyyz.py');
  }
  const LIB = 'C:\\Users\\MultiBotPC\\Documents\\MSFS\\Scenery';
  if (fs.existsSync(LIB)) {
    const dirs = fs.readdirSync(LIB, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
    const not = dirs.filter(d => !G.hasPackage(path.join(LIB, d)));
    ok(not.every(d => G.isProfileOnly(path.join(LIB, d))), 'every folder the library scan would now skip is a GSX download (' + not.length + ': ' + not.join(', ') + ')');
    ok(['KLAS FlyTampa', 'aerosoft-airport-limc-milan', 'inibuilds-airport-egll-heathrow'].filter(d => dirs.includes(d)).every(d => G.hasPackage(path.join(LIB, d))), 'real sceneries (incl. the KLAS wrapper) still count as scenery');
  } else console.log('  skip (no scenery library on this machine)');
  const GD = path.join(process.env.APPDATA || '', 'Virtuali', 'GSX', 'MSFS');
  if (fs.existsSync(GD)) {
    const R = G.healthCheck(GD, { owned: [], flown: {}, ledgerPath: 'none', removedPath: 'none' });
    ok(R.fileCount > 50 && Array.isArray(R.duplicates), 'health check runs on the real GSX folder (' + R.fileCount + ' files, ' + R.duplicates.length + ' airport(s) with >1 profile)');
  } else console.log('  skip (no GSX folder)');

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crash: ' + e.stack); process.exit(1); });
