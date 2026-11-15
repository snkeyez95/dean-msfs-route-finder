'use strict';
// v6.31.0 ✱ Fresh routes — four levels with adjustable look-backs (Settings → Fresh Routes).
// Runs the REAL freshBuild / freshHides / freshCfg / freshNoteHtml / setFreshLevel / renderFreshSettings
// out of index.html, then checks the levels against Dean's real route registry + flight log (read-only).
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
function grab(name) {
  const i = html.indexOf('function ' + name + '('); if (i < 0) throw new Error('fn ' + name);
  const st = html.lastIndexOf('\n', i) + 1; let d = 0, s = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { d++; s = true; } else if (html[j] === '}') { d--; if (s && d === 0) return html.slice(st, j + 1); } }
}
const stmt = n => { const i = html.indexOf('const ' + n + '='); return html.slice(i, html.indexOf(';', i) + 1); };
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };

const S = { cfg: { freshCfg: {} } };
let saved = 0, rendered = 0;
const chips = [0, 1, 2, 3].map(n => ({ dataset: { fresh: String(n) }, on: false, classList: { toggle(c, v) { this._o.on = v; } } }));
chips.forEach(c => { c.classList._o = c; });
const els = {};
const env = { S, window: { api: { saveConfig() { saved++; }, perfListSessions: async () => ({ sessions: [] }) } },
  document: { querySelectorAll: () => chips, getElementById: id => (els[id] = els[id] || { innerHTML: '', style: {} }) },
  renderRoutes() { rendered++; }, esc: s => String(s) };
const code = [stmt('FRESH_DEFAULTS'), stmt('FRESH_MAX'), ...['freshCfg', 'freshBuild', 'freshHides', 'freshNoteHtml', 'setFreshLevel', 'paintFreshChips', 'renderFreshSettings', 'freshSet', 'loadFlownLog'].map(grab)].join('\n')
  + '\nreturn {freshCfg, freshBuild, freshHides, freshNoteHtml, setFreshLevel, renderFreshSettings, freshSet, loadFlownLog, FRESH_MAX};';
const F = new Function(...Object.keys(env), code)(...Object.values(env));

console.log('1. the three rules (KLAX→KSFO flown)');
const flown = [{ dep: 'KLAX', arr: 'KSFO' }];
const sb = [{ dep: 'KLAX', arr: 'KSFO' }];
const cfg = F.freshCfg();
const L = n => F.freshBuild(n, cfg, sb, flown, new Set());
ok(F.freshBuild(0, cfg, sb, flown, new Set()) === null, 'Off → no filter');
ok(F.freshHides(L(1), 'KLAX', 'KSFO') && F.freshHides(L(1), 'KSFO', 'KLAX') && !F.freshHides(L(1), 'KLAX', 'KSEA'), 'Same route: hides the pair both ways, nothing else');
const l2 = L(2);
ok(F.freshHides(l2, 'KLAX', 'KSEA') && F.freshHides(l2, 'KDEN', 'KSFO'), 'Same dep/arr: hides KLAX→anywhere and anywhere→KSFO');
ok(!F.freshHides(l2, 'KSFO', 'KDEN') && !F.freshHides(l2, 'KDEN', 'KLAX'), '…but keeps KSFO→X and X→KLAX (the other roles)');
const l3 = L(3);
ok(F.freshHides(l3, 'KLAX', 'KSEA') && F.freshHides(l3, 'KDEN', 'KLAX') && F.freshHides(l3, 'KDEN', 'KSFO'), 'Any airport: hides every route touching KLAX or KSFO');
ok(!F.freshHides(l3, 'KSFO', 'KDEN'), '…except departures from KSFO, where you last landed (fly onward)');
ok(F.freshHides(F.freshBuild(3, Object.assign({}, cfg, { keepCurrentDep: false }), sb, flown, new Set()), 'KSFO', 'KDEN'), '…and that exception can be switched off');
const sess = new Set(['KLAX>KSFO']);
ok([1, 2, 3].every(n => !F.freshHides(F.freshBuild(n, cfg, sb, flown, sess), 'KSFO', 'KLAX')), 'a pair SimBriefed/activated this session stays visible at every level');

console.log('2. look-backs');
const many = Array.from({ length: 15 }, (_, i) => ({ dep: 'AA' + String(i).padStart(2, '0'), arr: 'BB' + String(i).padStart(2, '0') }));
const c5 = F.freshBuild(3, Object.assign({}, cfg, { airportN: 5 }), [], many, new Set());
ok(c5.flights === 5 && c5.any.has('AA04') && !c5.any.has('AA05'), 'Any airport honours its own count (5 → newest 5 flights only)');
const c2 = F.freshBuild(2, Object.assign({}, cfg, { depArrN: 12 }), [], many, new Set());
ok(c2.flights === 12, 'Same dep/arr honours its own count');
const sb40 = Array.from({ length: 40 }, (_, i) => ({ dep: 'X' + i, arr: 'Y' + i }));
ok(F.freshBuild(1, Object.assign({}, cfg, { routeN: 35 }), sb40, [], new Set()).pairs.size === 35, 'Same route can look back past the old fixed 30');
S.cfg.freshCfg = { routeN: 0, depArrN: 999, airportN: 'x' };
const cc = F.freshCfg();
ok(cc.routeN === 30 && cc.depArrN === F.FRESH_MAX && cc.airportN === 10 && cc.keepCurrentDep === true, 'bad settings fall back to defaults / clamp to 1–100', cc);
S.cfg.freshCfg = {};
ok(/slice\(0,FRESH_MAX\)/.test(html) && F.FRESH_MAX === 100, 'SimBrief history now keeps 100 plans (was 30)');

console.log('3. controls');
S.cfg.freshLevel = 0; F.setFreshLevel(2);
ok(S.cfg.freshLevel === 2 && S.freshOnly === true && S.cfg.freshOnly === true && chips[2].on && !chips[1].on && saved > 0 && rendered > 0, 'picking a level saves it, lights its chip, re-renders');
F.setFreshLevel(0);
ok(S.freshOnly === false && chips[0].on, 'Off turns it off');
ok(/if\(typeof S\.cfg\.freshLevel!=='number'\)S\.cfg\.freshLevel=S\.cfg\.freshOnly\?1:0;/.test(html), 'existing on/off setting carries over (on → Same route)');
for (const n of [0, 1, 2, 3]) ok(new RegExp('data-fresh="' + n + '" onclick="setFreshLevel\\(' + n + '\\)"').test(html), 'chip ' + n + ' wired');
F.renderFreshSettings();
const fsHtml = els['fresh-settings'].innerHTML;
ok(/value="30"[^>]*freshSet\('routeN'/.test(fsHtml.replace(/onchange=/g, ' onchange=').replace(/value="30" onchange/, 'value="30" freshSet(\'routeN\'')) || (/freshSet\('routeN'/.test(fsHtml) && /value="30"/.test(fsHtml)), 'Settings panel: Same route box shows 30');
ok(/freshSet\('depArrN'/.test(fsHtml) && /freshSet\('airportN'/.test(fsHtml) && /keepCurrentDep/.test(fsHtml), 'Settings panel: both flight counts + the current-airport checkbox');
ok(/>Fresh Routes<\/div>/.test(html) && /<div id="fresh-settings"><\/div>/.test(html) && /renderFreshSettings\(\);renderFlightApps\(\)/.test(html), 'Settings → Fresh Routes section is in the page and fills when Settings opens');
rendered = 0; S.freshOnly = true; F.freshSet('airportN', '7');
ok(S.cfg.freshCfg.airportN === 7 && rendered === 1, 'changing a number saves it and refreshes Plan a Flight');

console.log('4. note under the chips');
S.cfg.freshLevel = 3; S.flownLog = [{ dep: 'KCLE', arr: 'KATL' }, { dep: 'KBOS', arr: 'KDCA' }]; S.freshHidden = 42; S.cfg.freshCfg = {};
const note = F.freshNoteHtml();
ok(/Hiding 42 routes that touch 4 airports from your last 2 flights: KCLE, KATL, KBOS, KDCA/.test(note) && /Departures from KATL/.test(note), 'Any airport note: count, airports, current-airport exception', note);
S.cfg.freshLevel = 2; ok(/leave an airport you departed from, or land where you arrived/.test(F.freshNoteHtml()), 'Same dep/arr note');
S.cfg.freshLevel = 1; ok(/you SimBriefed \(last 30 plans/.test(F.freshNoteHtml()), 'Same route note');
S.cfg.freshLevel = 0; ok(F.freshNoteHtml() === '', 'Off → no note');

console.log('5. real data (read-only)');
const UD = path.join(process.env.APPDATA || '', 'A Better Route Planner');
if (fs.existsSync(path.join(UD, 'routeRegistry.json')) && fs.existsSync(path.join(UD, 'Sessions', 'index.json'))) {
  const R = Object.values(JSON.parse(fs.readFileSync(path.join(UD, 'routeRegistry.json'), 'utf8')));
  const C = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8'));
  const lib = new Set((C.savedRows || []).filter(r => r.icao).map(r => r.icao));
  const pool = R.filter(r => lib.has(r.departure_airport) && lib.has(r.arrival_airport));
  (async () => {
    env.window.api.perfListSessions = async () => JSON.parse(fs.readFileSync(path.join(UD, 'Sessions', 'index.json'), 'utf8'));
    const log = await F.loadFlownLog();
    ok(log.length > 50 && log.every((x, i) => i === 0 || log[i - 1].ts >= x.ts), 'flight log loads newest-first (' + log.length + ' flights)');
    S.cfg.freshCfg = {};
    const hid = n => { const f = F.freshBuild(n, F.freshCfg(), C.recentSimBriefRoutes || [], log, new Set()); return pool.filter(r => F.freshHides(f, r.departure_airport, r.arrival_airport)).length; };
    const h1 = hid(1), h2 = hid(2), h3 = hid(3);
    console.log('       hidden of ' + pool.length + ': same route ' + h1 + ' · same dep/arr ' + h2 + ' · any airport ' + h3);
    ok(h1 > 0 && h2 > 0 && h3 > h2, 'each level hides something, and Any airport hides the most');
    const cur = log[0].arr, fAny = F.freshBuild(3, F.freshCfg(), [], log, new Set());
    const fromCur = pool.filter(r => r.departure_airport === cur);
    ok(fromCur.length === 0 || fromCur.some(r => !F.freshHides(fAny, r.departure_airport, r.arrival_airport)), 'routes onward from ' + cur + ' (last landing) are still offered at Any airport');
    done();
  })().catch(e => { ok(false, 'real data crashed: ' + e.message); done(); });
} else { console.log('  skip real data'); done(); }

function done() { console.log(`\n${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0); }
