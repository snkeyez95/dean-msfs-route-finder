'use strict';
// v6.32.0 GSX drop zone: version check + install record names the dropped .zip.
// Runs the REAL 'gsx-install-dropped' handler sliced out of main.js against a throwaway GSX folder,
// with real .zip archives (built with PowerShell 5.1 Compress-Archive, extracted by the handler's own
// extractor), and the REAL renderer drop flow from index.html.
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const G = require(path.join(ROOT, 'gsx_profiles.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
function grabFrom(src, name) {
  const i = src.indexOf('function ' + name + '('); if (i < 0) throw new Error('fn ' + name);
  const st = src.lastIndexOf('\n', i) + 1; let d = 0, s = false;
  for (let j = i; j < src.length; j++) { if (src[j] === '{') { d++; s = true; } else if (src[j] === '}') { d--; if (s && d === 0) return src.slice(st, j + 1); } }
}
function handlerSrc(name) {
  const i = main.indexOf("ipcMain.handle('" + name + "'"); let d = 0, s = false;
  for (let j = main.indexOf('=>{', i) + 2; j < main.length; j++) { if (main[j] === '{') { d++; s = true; } else if (main[j] === '}') { d--; if (s && d === 0) return main.slice(i, main.indexOf(');', j) + 2); } }
}
const constLine = re => main.match(re)[0];

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'gsxdrop-'));
const GD = path.join(TMP, 'GSX', 'MSFS'), LED = path.join(TMP, 'ledger.json'), REM = path.join(TMP, 'removed.json');
fs.mkdirSync(GD, { recursive: true });
const H = {};
const sandbox = {
  ipcMain: { handle: (n, f) => { H[n] = f; } }, fs, path, os, cp, require, GSXP: G,
  LOG: { info() {}, error() {}, warn() {} }, gsxResolveDir: () => GD,
  GSX_LEDGER: () => LED, GSX_REMOVED: () => REM,
};
const code = [constLine(/const GSX_SKIP_DIRS = .*;/), constLine(/const gsxIsProfileFile = .*;/), constLine(/const GSX_ARCHIVE_RE *= *.*;/),
  grabFrom(main, 'gsxWalkFiles'), grabFrom(main, 'gsxFindExtractor'), grabFrom(main, 'gsxExtractArchive'), handlerSrc('gsx-install-dropped')].join('\n');
new Function(...Object.keys(sandbox), code)(...Object.values(sandbox));
const drop = o => H['gsx-install-dropped'](null, Object.assign({ gsxFolder: '' }, o));
const ini = v => '[general]\ncreator = RW\nscenario = Test\nnotes = ' + v + '\n[gate 1]\nx = 1\n';
const mk = (rel, t) => { const p = path.join(TMP, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, t); return p; };
const zip = (dir, out) => { const r = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', "Compress-Archive -Path '" + dir + "\\*' -DestinationPath '" + out + "' -Force"], { windowsHide: true }); return r.status === 0 && fs.existsSync(out); };
const ledger = () => JSON.parse(fs.readFileSync(LED, 'utf8'));

(async () => {
  try {
    console.log('1. new + identical files');
    mk('dl/kabc/kabc-x.ini', ini('v1.2')); mk('dl/kabc/kabc-x.py', 'py12');
    const z1 = path.join(TMP, 'kabc-profile.zip');
    ok(zip(path.join(TMP, 'dl', 'kabc'), z1), 'built a real .zip with PowerShell 5.1');
    let r = await drop({ paths: [z1] });
    ok(r.copied.length === 2 && fs.existsSync(path.join(GD, 'kabc-x.ini')), 'new profile from a .zip installs', r);
    const L1 = ledger();
    ok(L1.every(e => e.from.startsWith(z1 + ' \u203a ')) && L1.some(e => e.from === z1 + ' \u203a kabc-x.ini'), 'install record names the .zip (not a temp folder)', L1.map(e => e.from));
    r = await drop({ paths: [z1] });
    ok(r.copied.length === 0 && r.unchanged.length === 2 && ledger().length === 2, 'dropping the same zip again: "already up to date", nothing rewritten or recorded', r);

    console.log('2. newer drop replaces; older drop asks');
    mk('dl2/kabc-x.ini', ini('v1.4')); mk('dl2/kabc-x.py', 'py14');
    r = await drop({ paths: [path.join(TMP, 'dl2')] });
    ok(r.copied.length === 2 && /v1\.4/.test(fs.readFileSync(path.join(GD, 'kabc-x.ini'), 'utf8')), 'newer v1.4 replaces v1.2 without asking');
    ok(ledger().slice(-2).every(e => e.action === 'updated'), 'recorded as "updated"');
    r = await drop({ paths: [z1] });
    ok(r.ok === false && r.older && r.older[0].file === 'kabc-x.ini' && r.older[0].dropped === '1.2' && r.older[0].installed === '1.4', 'older v1.2 drop → asks first, installs nothing', r);
    ok(/v1\.4/.test(fs.readFileSync(path.join(GD, 'kabc-x.ini'), 'utf8')), '…and v1.4 is untouched while asking');
    r = await drop({ paths: [z1], olderChoice: 'keep' });
    ok(r.copied.length === 0 && r.keptYours.includes('kabc-x.ini') && r.keptYours.includes('kabc-x.py') && fs.readFileSync(path.join(GD, 'kabc-x.py'), 'utf8') === 'py14', '"Keep mine" skips the older profile AND its script', r);
    r = await drop({ paths: [z1], olderChoice: 'install' });
    ok(r.copied.includes('kabc-x.ini') && /v1\.2/.test(fs.readFileSync(path.join(GD, 'kabc-x.ini'), 'utf8')), '"Install anyway" installs the older one');
    ok(/you chose to install v1\.2 over v1\.4/.test(ledger().find(e => e.file === 'kabc-x.ini' && e.why).why), '…and the record says you chose the downgrade');

    console.log('3. replaces in place, never a second copy');
    fs.mkdirSync(path.join(GD, 'sub')); fs.writeFileSync(path.join(GD, 'sub', 'kxyz-p.ini'), ini('v1.0'));
    mk('dl3/kxyz-p.ini', ini('v2.0'));
    r = await drop({ paths: [path.join(TMP, 'dl3')] });
    ok(!fs.existsSync(path.join(GD, 'kxyz-p.ini')) && /v2\.0/.test(fs.readFileSync(path.join(GD, 'sub', 'kxyz-p.ini'), 'utf8')), 'a profile living in a subfolder is updated there, not duplicated at the top');

    console.log('4. editions + removed list still work');
    mk('dl4/kqrs-GSXVDGS.ini', ini('1.0')); mk('dl4/kqrs-NOVDGS.ini', ini('1.0'));
    r = await drop({ paths: [path.join(TMP, 'dl4')] });
    ok(r.editions && r.choices.KQRS, 'two editions in one drop still ask which one');
    G.removedAdd(REM, ['kqrs-gsxvdgs.ini']);
    r = await drop({ paths: [path.join(TMP, 'dl4')], pickIni: ['kqrs-GSXVDGS.ini'] });
    ok(r.copied.length === 1 && !G.removedSet(REM).has('kqrs-gsxvdgs.ini'), 'picked edition installs and comes off the "never reinstall" list');
  } catch (e) { ok(false, 'crashed: ' + e.stack); }
  finally { fs.rmSync(TMP, { recursive: true, force: true }); }

  console.log('5. renderer flow');
  {
    const grab = n => grabFrom(html, n);
    const calls = []; const rd = { style: {}, innerHTML: '' };
    let mode = 'older';
    const api = { gsxInstallDropped: async o => { calls.push(o);
      if (!o.olderChoice) return { ok: false, older: [{ file: 'kabc-x.ini', dropped: '1.2', installed: '1.4' }] };
      return o.olderChoice === 'keep' ? { ok: true, copied: [], unchanged: ['kabc-x.py'], keptYours: ['kabc-x.ini'] } : { ok: true, copied: ['kabc-x.ini'], unchanged: [], keptYours: [] }; } };
    const env = { window: { api }, S: { cfg: {} }, RLOG() {}, gsxRefresh: async () => {}, renderApts() {}, gsxToast() {} };
    const src = grab('esc') + '\n' + html.slice(html.indexOf('let _gsxDrop=null;'), html.indexOf('let _gsxDrop=null;') + 20) + '\n'
      + ['gsxInstallPaths', 'gsxDropContinue', 'gsxPickOlder', 'gsxPickVariant', 'gsxPickEdition'].map(grab).join('\n') + '\nreturn {gsxInstallPaths, gsxPickOlder};';
    const F = new Function(...Object.keys(env), src)(...Object.values(env));
    await F.gsxInstallPaths(['C:\\x\\kabc.zip'], rd);
    ok(/older<\/b> than what you have installed/.test(rd.innerHTML) && /dropped v1\.2, yours v1\.4/.test(rd.innerHTML) && /Keep mine \(newer\)/.test(rd.innerHTML) && /Install the older one anyway/.test(rd.innerHTML), 'older drop shows the question with both versions and two buttons');
    F.gsxPickOlder('keep'); await new Promise(r => setTimeout(r, 0));
    ok(calls.length === 2 && calls[1].olderChoice === 'keep', '"Keep mine" re-runs the install with that choice');
    ok(/Nothing to install/.test(rd.innerHTML) && /Kept your newer copy of: kabc-x\.ini/.test(rd.innerHTML) && /Already up to date \(left as is\): kabc-x\.py/.test(rd.innerHTML), 'result line says what happened to every file', rd.innerHTML);
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
