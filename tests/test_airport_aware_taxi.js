'use strict';
// v6.36.0 — Sim Profiles test verdicts judge taxi stutter against each AIRPORT END's usual in the same
// aircraft. Dean's Contact shadows Ultra test read "COSTS" only because two of its flights arrived at
// heavy payware (KSFO, KEWR). Runs the real profiles.js / profiles_store.js and renders the real card.
const path = require('path');
const X = require('./lib/extract.js');
const P = require(path.join(X.ROOT, 'perf', 'native', 'profiles.js'));
const { loadFlights } = require(path.join(X.ROOT, 'perf', 'native', 'profiles_store.js'));
const T = X.runner('airport-aware taxi:');

const BASE_V = { 'Graphics/ContactShadows/Quality': 2 }, EXP_V = { 'Graphics/ContactShadows/Quality': 3 };
let t0 = Date.parse('2026-12-01T10:00:00Z');
const fl = (vals, ends, o) => Object.assign({ session_id: 's' + (t0 += 3600e3), timestamp: new Date(t0).toISOString().slice(0, 19), aircraft: 'Fenix',
  p99: 17.6, felt: 8, dur: 3600, vram: 11000, vramTotal: 12288, gpu: 10, cpuBound: 85, sim: '1', afps: 'off', traffic: 'offline', excluded: false,
  taxiEnds: ends, settings: { graphics: Object.assign({}, vals) } }, o || {});
const e = (icao, end, stut) => ({ icao, end, stut });
const OLD = {};   // flights on some older setup: they only feed each airport's history

console.log('1. heavy airports on the test side no longer read as a cost');
{
  const hist = [fl(OLD, [e('KSFO', 'arr', 0.33)]), fl(OLD, [e('KSFO', 'arr', 0.35)]), fl(OLD, [e('KEWR', 'arr', 0.20)]), fl(OLD, [e('KEWR', 'arr', 0.22)]),
    fl(OLD, [e('KBOS', 'arr', 0.10)]), fl(OLD, [e('KBOS', 'arr', 0.12)]), fl(OLD, [e('KDCA', 'arr', 0.08)]), fl(OLD, [e('KDCA', 'arr', 0.10)])];
  const base = [fl(BASE_V, [e('KBOS', 'arr', 0.11)]), fl(BASE_V, [e('KDCA', 'arr', 0.09)]), fl(BASE_V, [e('KBOS', 'arr', 0.12)])];
  const test = [fl(EXP_V, [e('KSFO', 'arr', 0.34)]), fl(EXP_V, [e('KEWR', 'arr', 0.21)]), fl(EXP_V, [e('KSFO', 'arr', 0.33)])];
  const v = P.experimentVerdict({ values: EXP_V, baseValues: BASE_V, budget: 3 }, hist.concat(base, test));
  const row = v.rows.find(r => r.k === 'taxi');
  T('raw taxi stutter rose 0.11 → 0.29, but each airport ran its usual → not a cost', v.verdict !== 'costs' && row && row.within === true, v.verdict + ' ' + JSON.stringify(row));
  T('the row says what it compares against', row && /that airport/.test(row.label));
}

console.log('2. a genuinely rougher taxi at the SAME airports still counts');
{
  const hist = [fl(OLD, [e('KSFO', 'arr', 0.30)]), fl(OLD, [e('KSFO', 'arr', 0.31)]), fl(OLD, [e('KSFO', 'arr', 0.32)])];
  const base = [fl(BASE_V, [e('KSFO', 'arr', 0.31)]), fl(BASE_V, [e('KSFO', 'arr', 0.30)]), fl(BASE_V, [e('KSFO', 'arr', 0.32)])];
  const test = [fl(EXP_V, [e('KSFO', 'arr', 0.90)]), fl(EXP_V, [e('KSFO', 'arr', 0.95)]), fl(EXP_V, [e('KSFO', 'arr', 0.92)])];
  const v = P.experimentVerdict({ values: EXP_V, baseValues: BASE_V, budget: 3 }, hist.concat(base, test));
  T('3× the usual KSFO taxi stutter → COSTS', v.verdict === 'costs' && v.rows.find(r => r.k === 'taxi').within === false, v.verdict);
}

console.log('3. first visits are skipped, not guessed');
{
  const base = [fl(BASE_V, [e('KJFK', 'arr', 0.1)]), fl(BASE_V, [e('KLAX', 'arr', 0.1)])];
  const test = [fl(EXP_V, [e('KEWR', 'arr', 0.9)]), fl(EXP_V, [e('LFBD', 'arr', 0.9)])];
  const v = P.experimentVerdict({ values: EXP_V, baseValues: BASE_V, budget: 2 }, base.concat(test));
  T('no airport history → no taxi row, no false cost', !v.rows.some(r => r.k === 'taxi') && v.verdict !== 'costs', v.verdict);
  T('a note says how many flights were skipped', v.notes.some(n => /4 flights at airports with too little history/.test(n)), v.notes);
  const one = [fl(OLD, [e('KSFO', 'arr', 0.3)]), fl(OLD, [e('KSFO', 'arr', 0.3)])];
  const v2 = P.experimentVerdict({ values: EXP_V, baseValues: BASE_V, budget: 2 }, one.concat([fl(BASE_V, [e('KSFO', 'arr', 0.3)]), fl(BASE_V, [e('KSFO', 'arr', 0.3)]), fl(EXP_V, [e('KSFO', 'arr', 2)]), fl(EXP_V, [e('KEWR', 'arr', 2)])]));
  T('only 1 judgeable test flight → shown but not judged', v2.rows.find(r => r.k === 'taxi').within === null, JSON.stringify(v2.rows.find(r => r.k === 'taxi')));
  const other = [fl(OLD, [e('KSFO', 'arr', 0.3)], { aircraft: 'PMDG' }), fl(OLD, [e('KSFO', 'arr', 0.3)], { aircraft: 'PMDG' })];
  const v3 = P.experimentVerdict({ values: EXP_V, baseValues: BASE_V, budget: 1 }, other.concat([fl(EXP_V, [e('KSFO', 'arr', 0.3)])]));
  T('history in a different aircraft doesn\'t count', !v3.rows.some(r => r.k === 'taxi'));
}

console.log('4. Dean\'s real tests (read-only)');
const fs = require('fs');
const real = loadFlights(path.join(X.APP_DATA, 'Sessions'));
let store = null; try { store = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'sim_profiles.json'), 'utf8')); } catch (_) {}
const cs = store && store.profiles.find(p => p.source === 'experiment' && /Contact shadows/.test(p.name));
if (cs) {
  T('taxi history covers flights from before graphics snapshots (' + real.taxiPool.length + ' airport ends)', real.taxiPool.length > real.length);
  const v = P.experimentVerdict(cs, real);
  T('Contact shadows Ultra: was "costs", now ' + v.verdict, v.verdict !== 'costs', v.sentence);

  console.log('5. the card Dean sees (real renderer)');
  const src = ['_spExpCard'].map(n => X.grab(n)).join('\n') + '\n' + X.html.match(/const _SP_EXP_STATUS=\{[^\n]*\};/)[0] + '\n' + X.html.match(/const _LABV=\{[\s\S]*?\n\};/)[0] + '\n' + X.grab('esc');
  const f = new Function('_spOpen', '_spK', '_spDisp', '_spDirTag', '_spDir', '_spCard', src + '\nreturn _spExpCard;');
  const card = f({}, () => ({ label: 'Contact shadows quality' }), (k, v) => String(v), () => '', () => 0, o => o.sub + o.extra);
  const html = card(Object.assign({}, cs, { result: v }));
  T('chip shows FREE UPGRADE, not COSTS', /FREE UPGRADE/i.test(html) && !/>COSTS</.test(html), html.match(/border-radius:5px;padding:1px 7px">[^<]*/g));
  T('says what it read when you decided', /When you decided, this read COSTS/i.test(html));
  T('taxi row labelled against the airport, unit pts', /Taxi stutter \(vs that airport&#39;s usual\)/.test(html) && / pts</.test(html));
} else console.log('  skip (no Contact shadows experiment in this store)');

process.exit(T.done() ? 1 : 0);
