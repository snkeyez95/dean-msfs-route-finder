'use strict';
// v6.15.6 — high-altitude logging + the phase split (Dean's KORD-CYYZ Citation flight, 2026-07-30).
//
// ALT_SANE_FT was 45,000 — a guard meant to reject unsettled SimConnect reads, but set INSIDE the
// envelope of aircraft actually flown. The Citation Sovereign+ cruised at ~45,500 ft, so:
//   1. alt_ft went blank in telemetry for 16 minutes (24.0 -> 39.9 min; last value 44,998),
//   2. PhaseTracker.update() returns the CURRENT phase when alt is null, so the tracker froze on
//      'climb' for that whole level cruise — the flight filed 51.8% climb / 3.3% cruise,
//   3. when altitude came back, the stale baseline spread 16 minutes of gap into one climb-rate
//      calculation.
// This suite locks all three down against the REAL modules.
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('altitude cap + phase split:');
const ROOT = path.resolve(__dirname, '..');
const SC = require(path.join(ROOT, 'perf/native/simconnect.js'));
const RC = require(path.join(ROOT, 'perf/native/report_charts.js'));
const scSrc = fs.readFileSync(path.join(ROOT, 'perf/native/simconnect.js'), 'utf8');
const rcSrc = fs.readFileSync(path.join(ROOT, 'perf/native/report_charts.js'), 'utf8');

// ── 1. the cap clears real aircraft, still catches garbage ──────────────────
console.log('the altitude cap:');
{
  T('ALT_SANE_FT is above every civil ceiling', SC.ALT_SANE_FT >= 60000, String(SC.ALT_SANE_FT));
  T('...and still low enough to catch unsettled reads', SC.ALT_SANE_FT <= 100000);
  T('the Citation cruise that was being discarded now passes (45,500 ft)', 45500 < SC.ALT_SANE_FT);
  T('Concorde-era 60,000 ft passes', 60000 < SC.ALT_SANE_FT);
  T('the chart filter uses the SAME cap (a mismatch clips the altitude line)',
    /ALT_SANE_FT = 70000/.test(rcSrc) && SC.ALT_SANE_FT === 70000);
  T('simconnect.js still discards above the cap', /if \(alt > ALT_SANE_FT\) alt = null;/.test(scSrc));
}

// ── 2. the tracker no longer mislabels a high level cruise ──────────────────
console.log('\nphase split at high altitude:');
{
  // Replay the shape of the real flight at 1 Hz: climb to 45,000, then 10 minutes level at 45,500.
  const run = () => {
    const tr = new SC.PhaseTracker(0);
    let t = 0, alt = 40000;
    for (; alt < 45000; t++, alt += 40) tr.update(false, alt, t);   // climbing ~2400 fpm
    const climbEnd = tr.update(false, alt, t);
    for (let i = 0; i < 600; i++, t++) tr.update(false, 45500, t);  // level at 45,500
    return { tr, climbEnd, levelPhase: tr.current };
  };
  const { climbEnd, levelPhase, tr } = run();
  T('the climb is still classified as a climb', climbEnd === 'climb');
  T('level flight at 45,500 ft reads as CRUISE (used to freeze on climb)',
    levelPhase === 'cruise', levelPhase);
  T('the transition was actually recorded in the phase log',
    tr.phaseLog.some(([, p]) => p === 'cruise'));
  // and the descent that follows is still caught
  let t2 = 10000, alt2 = 45500;
  for (let i = 0; i < 30; i++, t2++, alt2 -= 50) tr.update(false, alt2, t2);
  T('a descent from that altitude is still classified as descent', tr.current === 'descent', tr.current);
}

// ── 3. a stale baseline across a gap must not fake level flight ─────────────
console.log('\nclimb-rate baseline across a data gap:');
{
  const tr = new SC.PhaseTracker(0);
  tr.update(false, 30000, 0);
  tr.update(false, 30040, 1);
  T('normal 1 Hz sampling still measures the climb', tr.current === 'climb', tr.current);
  // 16-minute gap, then a sample 2,000 ft higher: dividing across the gap gives ~125 fpm -> "cruise"
  const after = tr.update(false, 32000, 1 + 960);
  T('a long gap does NOT report a bogus near-zero climb rate', after === 'climb', after);
  // the sample after the gap re-establishes the baseline and measures normally again
  tr.update(false, 32040, 1 + 961);
  T('the next sample measures against the fresh baseline', tr.current === 'climb');
  const tr2 = new SC.PhaseTracker(0);
  tr2.update(false, 30000, 0);
  tr2.update(false, 30000, 900);              // long gap, genuinely level
  T('after a gap the phase is held, not invented', tr2.current === 'climb' || tr2.current === 'cruise');
}

// ── 4. unchanged behaviour that must not regress ────────────────────────────
console.log('\nno regressions:');
{
  T('ground is still ground regardless of altitude', SC.classifyPhase(true, 5000) === 'ground');
  T('climb threshold unchanged (150 fpm)', SC.classifyPhase(false, 151) === 'climb' && SC.classifyPhase(false, 149) === 'cruise');
  T('descent threshold unchanged', SC.classifyPhase(false, -151) === 'descent');
  T('auto-start rolling detection still requires a sane on-ground altitude',
    SC.isRolling(10, true, 600) === true && SC.isRolling(10, true, null) === false);
  T('a null altitude still holds the current phase (no invented transition)',
    (() => { const tr = new SC.PhaseTracker(0); tr.update(false, 30000, 0); tr.update(false, 30040, 1);
      const before = tr.current; return tr.update(false, null, 2) === before; })());
  T('computeFpm math unchanged', SC.computeFpm(1000, 900, 60) === 100);
}

// ── 5. the chart plots high altitude now ────────────────────────────────────
console.log('\nchart altitude series:');
{
  const TMP = path.join(ROOT, 'tests', '_tmp_alt_phase');
  fs.mkdirSync(TMP, { recursive: true });
  const rows = ['wall_ms,phase,alt_ft,vram_mb,sys_ram_pct,sys_cpu_pct,top_proc,top_proc_cpu,gspeed_kt,vatsim_traffic'];
  for (let s = 0; s <= 300; s++) rows.push([s * 1000, 'cruise', 45500, 9000, 40, 30, 'msfs', 10, 400, ''].join(','));
  rows.push([301000, 'cruise', 999999, 9000, 40, 30, 'msfs', 10, 400, ''].join(','));   // garbage read
  fs.writeFileSync(path.join(TMP, 'telemetry.csv'), rows.join('\n'));
  const alt = RC.chartAltitudeSeries(TMP, 10);
  T('a 45,500 ft cruise is plotted (was silently dropped)', !!alt && alt.some(([, a]) => a === 45500));
  T('a garbage 999,999 ft read is still rejected', !alt.some(([, a]) => a > 70000));
  try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
}

process.exit(T.done() ? 1 : 0);
