'use strict';
// v6.22.1 (Dean 2026-10-02): the Scenery-impact view used to exclude AutoFPS flights (a copy of the
// fixed-TLOD baseline quarantine). Once AutoFPS became Dean's daily driver that starved the view to ~27 of
// 99 flights, so almost everything sat at COLLECTING. Scenery is a RELATIVE per-airport z-score vs your own
// same-plane+same-end taxi (the baseline is also AutoFPS, so the regime cancels), so AutoFPS flights now
// COUNT. This proves they're included, and that experiment/excluded flights are still dropped.
const X = require('./lib/extract.js');
const T = X.runner('Scenery impact — AutoFPS inclusion:');
const html = X.html;

function sandbox(){
  let src = 'let S={selICAOs:new Set()};\nfunction frAptName(i){return null;}\n';
  const m = /const _SCN_M=\[[^\n]*\];/.exec(html); if(!m) throw new Error('_SCN_M not found');
  src += m[0] + '\n';
  src += X.grab('_pstdev', html) + '\n';
  src += X.grab('_scnAgg', html) + '\n';
  src += 'return {_scnAgg};';
  return new Function(src)();
}
const { _scnAgg } = sandbox();

// dep-end sample only (arr taxi metrics null → no arr sample), so per-airport counts are exact.
function f(dep, ac, stut, vram, extra){
  return Object.assign({ aircraft:ac, dep_icao:dep, arr_icao:'ZZZZ'+Math.random().toString(36).slice(2,6),
    dep_taxi_stutter:stut, dep_taxi_vram:vram, dep_taxi_p99:18,
    arr_taxi_stutter:null, arr_taxi_vram:null, dep_scenery:true }, extra||{});
}

// All AutoFPS: KTST flown 3× (heavy), plus a Fenix|dep baseline pool at 3 other airports.
const flights = [
  f('KTST','Fenix',0.50,11200,{autofps_active:true}),
  f('KTST','Fenix',0.52,11300,{autofps_active:true}),
  f('KTST','Fenix',0.48,11100,{autofps_active:true}),
  f('KAAA','Fenix',0.10,9000,{autofps_active:true}),
  f('KBBB','Fenix',0.12,9100,{autofps_active:true}),
  f('KCCC','Fenix',0.11,9050,{autofps_active:true}),
];

const rows = _scnAgg(flights);
const kt = rows.find(r=>r.icao==='KTST');

// 1. AutoFPS flights are COUNTED (the whole point) — old code would have returned zero rows.
T('1. AutoFPS flights produce Scenery rows (not excluded)', rows.length > 0, 'rows='+rows.length);
T('   KTST row exists from 3 AutoFPS flights', !!kt, kt && JSON.stringify({n:kt.n,chip:kt.chip}));
T('   KTST n === 3 (all three AutoFPS flights counted)', kt && kt.n === 3, kt && kt.n);
T('   KTST is NOT stuck COLLECTING (it reached a verdict)', kt && kt.chip !== 'collecting', kt && kt.chip);
T('   heavy taxi vs the lighter pool → positive impact z', kt && kt.impactZ > 0, kt && kt.impactZ);

// 2. experiment + excluded flights are STILL dropped.
const withExcl = flights.concat([
  f('KTST','Fenix',9.9,13000,{autofps_active:true, excluded:true}),
  f('KTST','Fenix',9.9,13000,{autofps_active:true, experiment:'clouds'}),
]);
const kt2 = _scnAgg(withExcl).find(r=>r.icao==='KTST');
T('2. excluded + experiment flights do NOT inflate the count', kt2 && kt2.n === 3, kt2 && kt2.n);
T('   …and their extreme values did not skew the mean', kt2 && Math.abs(kt2.per.stut.mean - 0.50) < 0.05, kt2 && kt2.per.stut.mean);

// 3. a pure fixed-TLOD (no autofps) set still works unchanged (regression).
const fixed = [
  f('KFIX','PMDG',0.40,11000,{}), f('KFIX','PMDG',0.42,11100,{}), f('KFIX','PMDG',0.41,11050,{}),
  f('KP1','PMDG',0.10,9000,{}), f('KP2','PMDG',0.11,9050,{}), f('KP3','PMDG',0.12,9100,{}),
];
const kfix = _scnAgg(fixed).find(r=>r.icao==='KFIX');
T('3. fixed-TLOD flights still aggregate (regression)', kfix && kfix.n === 3 && kfix.chip !== 'collecting', kfix && JSON.stringify({n:kfix.n,chip:kfix.chip}));

process.exit(T.done() ? 1 : 0);
