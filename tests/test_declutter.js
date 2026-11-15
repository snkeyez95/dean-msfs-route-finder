'use strict';
// v6.30.0 declutter (Dean 2026-11-14):
//  1. Performance dashboard: flight table first; fleet cards / coverage / TLOD filter / charts folded in a
//     closed <details>; an existing dashboard is rebuilt once (DASH_V marker); "Show coverage" opens it;
//     a row whose TLOD has no filter chip is never hidden.
//  2. Utilities list: only folders whose manifest.json has MSFS package fields count as packages (WebView2/
//     Chromium component folders inside desktop apps showed up as "1.0.0.12", "120.0.6050.0"…).
//  3. Display Resolution on Launch removed (UI, launch hook, watcher, IPCs); leftover-restore kept.
const fs = require('fs'), path = require('path'), os = require('os');
const ROOT = path.resolve(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };

console.log('1. Performance dashboard');
const { buildCombinedReport } = require(path.join(ROOT, 'perf', 'native', 'report_combined.js'));
const idxPath = path.join(process.env.APPDATA || '', 'A Better Route Planner', 'Sessions', 'index.json');
const sessions = fs.existsSync(idxPath) ? JSON.parse(fs.readFileSync(idxPath, 'utf8')).sessions : [
  { timestamp: '2026-11-13T10:41:00', aircraft: 'Fenix', tlod: 125, p99_ft_ms: 18, stutter_pct: 0.04, peak_vram_mb: 11000, folder: '2026-11-13/a' },
  { timestamp: '2026-06-13T13:21:00', aircraft: 'Fenix', tlod: 80, p99_ft_ms: 20.6, stutter_pct: 0.28, peak_vram_mb: 11300, folder: '2026-06-13/b', excluded: true }];
const h = buildCombinedReport(sessions);
const iTable = h.indexOf('<table>'), iDet = h.indexOf('<details class="summ" id="fleetSummary">');
ok(iTable > 0 && iDet > iTable, 'flight table comes before the folded section');
ok(!/<details class="summ" id="fleetSummary" open/.test(h), 'folded section is closed by default');
for (const id of ['covpanel', 'chartP99', 'chartVram', 'tlodFilter', 'segCombined']) ok(h.indexOf('id="' + id + '"') > iDet, id + ' lives inside the folded section');
ok(/<summary>Fleet summary &amp; TLOD charts<\/summary>/.test(h), 'section label');
ok(/<body data-dash-v="2">/.test(h), 'dashboard carries the layout marker');
const bf = read('perf/native/backfill_phases.js');
ok(/const DASH_V = '2';/.test(bf) && /data-dash-v="' \+ DASH_V \+ '"/.test(bf) && /if \(reports > 0 \|\| dashStale\)/.test(bf), 'launch backfill rebuilds a dashboard without the current marker');
const css = read('perf/native/report_assets/dash.css');
ok(/summary::before\{content:'▸'/.test(css) && !/[\x00-\x08\x0e-\x1f]/.test(css), 'arrow glyph is a real ▸ (no control characters in the CSS)');
// dash.js row filter: run the real render() against a stub DOM
{
  const js = read('perf/native/report_assets/dash.js');
  const rows = [{ t: '125', p: '1' }, { t: '80', p: '1' }, { t: 'n/a', p: '0' }].map(r => ({ style: {}, getAttribute: k => k === 'data-tlod' ? r.t : r.p }));
  const els = {}; const get = id => (els[id] = els[id] || { innerHTML: '', classList: { toggle() {} }, style: {}, addEventListener() {} });
  const document = { getElementById: get, querySelectorAll: () => rows };
  const localStorage = { getItem: () => null, setItem() {} };
  new Function('document', 'localStorage', 'window', 'DD', js)(document, localStorage, {}, { tlods: [100, 125], counts: {}, p99: { combined: [18, 19], fenix: [], pmdg: [] }, vram: { combined: [10, 11], fenix: [], pmdg: [] } });
  ok(rows.every(r => r.style.display === ''), 'every row visible by default, incl. a TLOD (80) with no filter chip', rows.map(r => r.style.display));
}
const html = read('index.html');
ok(/if\(!S\.cfg\.perfHideCoverage\)\{ try\{ const p=_perfCovPanel\(\); const d=p&&p\.closest\('details'\); if\(d\)d\.open=true;/.test(html), '"Show coverage" opens the folded section and scrolls to it');
ok(/from the table at the top of the dashboard/.test(html) && !/table at the bottom of the dashboard/.test(html), 'toolbar hint says the table is at the top');

console.log('2. Utilities: real MSFS packages only');
const G = require(path.join(ROOT, 'gsx_profiles.js'));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'declutter-'));
try {
  const mk = (rel, text) => { const p = path.join(TMP, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); return path.dirname(p); };
  const real = mk('pkg/manifest.json', JSON.stringify({ content_type: 'MISC', package_version: '1.0.0', title: 'x' }));
  const bom = mk('bom/manifest.json', '\uFEFF' + JSON.stringify({ package_version: '2.0' }));
  const broken = mk('broken/manifest.json', '{ "package_version": "1.0", }');
  const webview = mk('app/WebView2Data/EBWebView/hyphen-data/120.0.6050.0/manifest.json', JSON.stringify({ manifest_version: 2, name: 'hyphens-data', version: '120.0.6050.0' }));
  const crl = mk('app/x/6498.2026.10.20/manifest.json', JSON.stringify({ description: 'Microsoft CRLSet', name: 'MicrosoftCRLSet', version: '6498.2026.10.20' }));
  ok(G.isMsfsPackageDir(real) && G.isMsfsPackageDir(bom) && G.isMsfsPackageDir(broken), 'MSFS manifest (incl. BOM / slightly malformed) → package');
  ok(!G.isMsfsPackageDir(webview) && !G.isMsfsPackageDir(crl), 'WebView2 / Chromium component manifest → not a package');
  ok(!G.isMsfsPackageDir(path.join(TMP, 'app')), 'folder with no manifest → not a package');
} finally { fs.rmSync(TMP, { recursive: true, force: true }); }
const main = read('main.js');
ok(/function pkgIsPackageDir\(dir\)\{ return GSXP\.isMsfsPackageDir\(dir\); \}/.test(main), 'Aircraft/Utilities scan uses the MSFS-manifest check');
const UTIL = 'C:\\Users\\MultiBotPC\\Documents\\MSFS\\Util';
if (fs.existsSync(UTIL)) {
  const found = [];
  (function w(d, n) { if (n > 5) return; let e; try { e = fs.readdirSync(d, { withFileTypes: true }).filter(x => x.isDirectory()); } catch (_) { return; }
    for (const x of e) { const f = path.join(d, x.name); if (G.isMsfsPackageDir(f)) found.push(x.name); else w(f, n + 1); } })(UTIL, 0);
  ok(found.length > 0 && found.every(n => !/^[\d.]+$/.test(n)), 'real Util folder: no version-number rows (' + found.join(', ') + ')');
} else console.log('  skip real Util folder');

console.log('3. Display Resolution on Launch removed');
const pre = read('preload.js');
ok(!/display-res-settings|renderDisplayResSettings|drSetEnabled|drSetMode|drRestoreNow|DLDSR/.test(html), 'Settings panel and its code are gone');
ok(!/displayListModes|displayGetCurrent|displayRestoreNow/.test(pre), 'preload bridges gone');
ok(!/displayApplyForLaunch|startDisplayWatch|display-list-modes|display-get-current|display-restore-now|function displayListModes|function displayGetCurrent/.test(main), 'launch hook, watcher and IPCs gone');
ok(/function displayRestore\(\)/.test(main) && /if \(fs\.existsSync\(DISPLAY_STATE\(\)\) && !isMsfsRunning\(\)\) displayRestore\(\);/.test(main), 'leftover-restore safety kept (only acts if an old run left display_res.json)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
