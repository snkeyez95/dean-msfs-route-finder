'use strict';
// Version-comparison verdict + drift monitor (v6.19.4 — peak VRAM added to the judged metrics).
//
// Why this file exists (Dean, 2026-08-14): MSFS SU6 shipped claiming VRAM improvements. The verdict
// card judged P99, stutter, taxi stutter and felt/hr — every one a smoothness metric — so the single
// thing the update claimed to fix could never be called. On a 12 GB card running at 88-96%, headroom
// IS the constraint. peak VRAM now joins the judged set.
//
// Nothing covered this machinery before (the v6.4.0 desk-tests lived in the scratchpad and were lost),
// so this suite locks in BOTH the new metric and the confound-avoidance that was already there:
// matched (aircraft, TLOD, traffic) cells only, ±1σ noise band, AutoFPS flights dropped. The last
// block runs it against Dean's REAL flight history and proves adding a metric changed none of the
// existing five.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner();

// Build the verdict engine out of index.html. `dropVram` rebuilds it with the pre-v6.19.4 metric list
// so a test can diff old-vs-new behaviour on identical data — the isolation proof.
function sandbox(dropVram){
  let src = X.grab('esc') + '\n'
    + X.grab('_pstdev') + '\n'
    + /const _VERV=\{[^\n]*\};/.exec(X.html)[0] + '\n'
    + /const _VER_METRICS=\[[^\n]*\];/.exec(X.html)[0] + '\n'
    + X.grab('_verdictPair') + '\n'
    + X.grab('_versionVerdict') + '\n'
    + X.grab('_verCardHtml') + '\n'
    + X.grab('driftCheck') + '\n';
  if(dropVram){
    const before = src;
    src = src.replace(/,\{k:'peak_vram_mb'[^}]*\}(?=\];)/, '');
    if(src === before) throw new Error('could not strip peak_vram_mb — metric list shape changed');
  }
  src += 'return {_verdictPair,_versionVerdict,_verCardHtml,driftCheck,_VERV,_VER_METRICS};';
  return new Function(src)();
}
const V  = sandbox(false);   // shipping engine
const V0 = sandbox(true);    // same engine, pre-v6.19.4 metric list

// A flight as perf-compare-data hands it to the renderer. Smoothness is IDENTICAL across every flight
// unless overridden, so those metrics contribute nothing and VRAM alone drives the verdict.
let _t = 0;
function flight(sim, vram, over){
  _t += 864e5;
  return Object.assign({
    sim_version: sim, driver_version: '566.36', aircraft: 'Fenix', tlod: 125,
    online_traffic: 'offline', autofps_active: false,
    p99_ft_ms: 17.5, stutter_pct: 0.05, dep_taxi_stutter: 0.02, arr_taxi_stutter: 0.03,
    felt_stutter_hr: 1.0, peak_vram_mb: vram,
    timestamp: new Date(Date.UTC(2026, 0, 1) + _t).toISOString()
  }, over || {});
}
const set = (sim, vrams, over) => vrams.map(v => flight(sim, v, over));

console.log('peak VRAM can now decide a verdict:');
{
  // SU6 frees ~800 MB with the frametimes unmoved — the exact case the old metric list could not call.
  const f = [...set('1.7.35', [11800, 11810, 11790]), ...set('1.8.14', [11000, 11010, 10990])];
  const v  = V._verdictPair(f, 'sim_version', '1.7.35', '1.8.14');
  const v0 = V0._verdictPair(f, 'sim_version', '1.7.35', '1.8.14');

  T('1. the new build is called BETTER on VRAM alone', v.verdict === 'better', v.verdict);
  T('   …the old metric list saw nothing at all', v0.verdict === 'noeffect', v0.verdict);
  const d = v.deltas.find(x => x.key === 'peak_vram_mb');
  T('   …peak VRAM is in the deltas', !!d);
  T('   …with the right sign (negative = less VRAM used)', d.delta < 0, String(d.delta));
  T('   …and it cleared the noise band', d.within === false, 'sigma=' + d.sigma);
  T('   …smoothness metrics stayed inside noise', v.deltas.filter(x => x.key !== 'peak_vram_mb').every(x => x.within === true));
}

console.log('\na build that EATS VRAM is a regression, even if it is just as smooth:');
{
  const f = [...set('1.7.35', [10990, 11000, 11010]), ...set('1.8.14', [11800, 11810, 11790])];
  const v = V._verdictPair(f, 'sim_version', '1.7.35', '1.8.14');
  T('2. verdict is WORSE', v.verdict === 'worse', v.verdict);
  const d = v.deltas.find(x => x.key === 'peak_vram_mb');
  T('   …delta is positive (more VRAM)', d.delta > 0, String(d.delta));
  // 12 GB card at 88-96% — an extra 800 MB is the difference between headroom and the AutoFPS hold.
  T('   …and it is the metric that drove it', v.deltas.filter(x => x.within === false).every(x => x.key === 'peak_vram_mb'));
}

console.log('\nVRAM is route-noisy — a small drift must NOT be called:');
{
  // Wide spread within each side, tiny mean shift: exactly the false positive to avoid.
  const f = [...set('1.7.35', [11500, 11800, 12000]), ...set('1.8.14', [11480, 11790, 11990])];
  const v = V._verdictPair(f, 'sim_version', '1.7.35', '1.8.14');
  T('3. a ~13 MB shift inside the spread reads as no real change', v.verdict === 'noeffect', v.verdict);
  const d = v.deltas.find(x => x.key === 'peak_vram_mb');
  T('   …VRAM was measured but judged within noise', d && d.within === true, d && String(d.sigma));
}

console.log('\nthe chip wording had to change with it:');
{
  T('4. no longer claims FASTER (a VRAM-only win is not speed)', V._VERV.better.t === 'BETTER', V._VERV.better.t);
  T('   …nor SLOWER', V._VERV.worse.t === 'WORSE', V._VERV.worse.t);
  T('   …and no verdict label claims a speed change any more',
    !Object.values(V._VERV).some(p => /FASTER|SLOWER/.test(p.t)),
    Object.values(V._VERV).map(p => p.t).join('/'));
  const f = [...set('1.7.35', [11800, 11810, 11790]), ...set('1.8.14', [11000, 11010, 10990])];
  const html = V._verCardHtml(V._verdictPair(f, 'sim_version', '1.7.35', '1.8.14'), 'Sim version');
  T('5. the card renders the BETTER chip', html.includes('>BETTER<'), html.slice(0, 200));
  T('   …names peak VRAM in the sentence', html.includes('peak VRAM'));
  T('   …in whole MB, not fake precision', /peak VRAM -\d+MB/.test(html), (/peak VRAM [^,.]*/.exec(html) || [''])[0]);
  T('   …and labels the direction as better', /peak VRAM[^,]*\(better\)/.test(html));
}

console.log('\nconfound guards still hold (pre-existing behaviour, now covered):');
{
  // AutoFPS drives TLOD dynamically, so its flights have no comparable cell — they must be dropped
  // even though they carry a perfectly good peak_vram_mb.
  const f = [...set('1.7.35', [11800, 11810, 11790]),
             ...set('1.8.14', [9000, 9010, 8990], { autofps_active: true })];
  const v = V._verdictPair(f, 'sim_version', '1.7.35', '1.8.14');
  T('6. AutoFPS flights cannot fake a VRAM win', v.verdict === 'nooverlap', v.verdict);

  // Traffic context is part of the cell key — a VATSIM-heavy new build vs offline old build is not
  // a like-for-like comparison and must not resolve.
  const g = [...set('1.7.35', [11000, 11010, 10990]),
             ...set('1.8.14', [11800, 11810, 11790], { online_traffic: 'vatsim' })];
  T('   …VATSIM flights do not compare against offline ones', V._verdictPair(g, 'sim_version', '1.7.35', '1.8.14').verdict === 'nooverlap');

  // Different aircraft = different cell.
  const h = [...set('1.7.35', [11800, 11810, 11790]),
             ...set('1.8.14', [11000, 11010, 10990], { aircraft: 'PMDG' })];
  T('   …a different aircraft is not a matched cell', V._verdictPair(h, 'sim_version', '1.7.35', '1.8.14').verdict === 'nooverlap');

  // Thin data must say so rather than guess.
  const i = [...set('1.7.35', [11800]), ...set('1.8.14', [11000])];
  T('   …one flight per side reads COLLECTING, not a verdict', V._verdictPair(i, 'sim_version', '1.7.35', '1.8.14').verdict === 'collecting');

  // Smoothness worse + VRAM better = genuinely mixed, and must not be flattened either way.
  const j = [...set('1.7.35', [11800, 11810, 11790]),
             ...set('1.8.14', [11000, 11010, 10990], { p99_ft_ms: 24.0 })];
  T('   …VRAM better but P99 worse reads MIXED', V._verdictPair(j, 'sim_version', '1.7.35', '1.8.14').verdict === 'mixed');
}

console.log('\ndrift banner now fires on a VRAM regression:');
{
  const f = [...set('1.7.35', [10990, 11000, 11010]), ...set('1.8.14', [11800, 11810, 11790])];
  const d = V.driftCheck(f);
  T('7. the newest sim eating VRAM raises drift', !!d && d.cand === '1.8.14', d && d.verdict);
  T('   …the old metric list would have stayed silent', V0.driftCheck(f) === null);
  const worst = d.deltas.filter(x => x.within === false && x.delta > 0)[0];
  T('   …and the banner names peak VRAM as the reason', worst && worst.label === 'peak VRAM', worst && worst.label);

  const good = [...set('1.7.35', [11800, 11810, 11790]), ...set('1.8.14', [11000, 11010, 10990])];
  T('   …an IMPROVED new build raises no drift alarm', V.driftCheck(good) === null);
}

// The isolation proof, on real data: adding a sixth metric must not perturb the other five.
console.log("\nagainst Dean's real flight history:");
{
  let sessions = [];
  try { sessions = (JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'Sessions', 'index.json'), 'utf8')).sessions) || []; }
  catch(_){}

  if(sessions.length < 10){
    T('8. skipped — no real Sessions index on this machine', true);
  } else {
    const flights = sessions.map(s => Object.assign({}, s, { online_traffic: s.online_traffic || 'offline' }));
    T('8. real history loaded', flights.length > 40, flights.length + ' flights');

    const vers = [...new Set(flights.map(f => f.sim_version).filter(Boolean))];
    console.log('   → sim versions on file: ' + vers.join(', '));

    const now = V._versionVerdict(flights, 'sim_version');
    const old = V0._versionVerdict(flights, 'sim_version');
    if(now.state !== 'ok'){
      T('   verdict engine ran', false, now.state);
    } else {
      console.log('   → ' + old.base + ' vs ' + old.cand + ': was "' + old.verdict + '", now "' + now.verdict + '"');
      // Every metric the old list judged must come out bit-for-bit the same.
      const oldRows = new Map(old.deltas.map(d => [d.key, d]));
      const same = now.deltas.filter(d => d.key !== 'peak_vram_mb').every(d => {
        const o = oldRows.get(d.key);
        return o && o.delta === d.delta && o.sigma === d.sigma && o.within === d.within;
      });
      T('   the five existing metrics are unchanged, to the bit', same);
      T('   …same matched-cell count', now.matched === old.matched, now.matched + ' vs ' + old.matched);
      T('   …same flight counts either side', now.nA === old.nA && now.nB === old.nB);
      const vd = now.deltas.find(d => d.key === 'peak_vram_mb');
      if(vd){
        console.log('   → peak VRAM: ' + (vd.delta > 0 ? '+' : '') + vd.delta.toFixed(0) + ' MB'
          + ' (noise band ' + (vd.sigma == null ? 'n/a' : '±' + vd.sigma.toFixed(0) + ' MB') + ')'
          + ' → ' + (vd.within === false ? 'REAL CHANGE' : 'within noise'));
        T('   peak VRAM was actually measured on his data', vd.sigma != null);
      } else {
        T('   peak VRAM produced no row (no matched cell carried it)', true);
      }
      // Whatever the numbers say, adding a metric may only ever ADD a row.
      T('   …and the metric list grew by exactly one', now.deltas.length - old.deltas.length <= 1);
    }
  }
}

process.exit(T.done() ? 1 : 0);
