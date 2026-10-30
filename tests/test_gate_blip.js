'use strict';
// v6.26.1 — gate-blip fix (Dean 2026-10-30, LOWW-LGKR). Parked at the gate (0 kt) the sim read "not on
// ground" for ONE second. That 1-s "cruise" turned the real arrival taxi into "interior ground" (dropped)
// → the report showed 4 phases, no arrival taxi; and the LandingTracker counted the flicker as a bounce.
// Proves: sub-10-s airborne runs between ground runs are folded back into ground (frametime split AND
// per-phase VRAM); a bounce must leave the runway within 15 s of touchdown; the backfill corrects the
// already-logged flight through the sidecar + index (summary.json untouched); and the surface — the
// regenerated report — shows the arrival taxi row and "no bounce".
const fs = require('fs'), path = require('path'), crypto = require('crypto');
const X = require('./lib/extract.js');
const T = X.runner('Gate-blip fix:');
const P = require('../perf/native/phases.js');
const { LandingTracker } = require('../perf/native/simconnect.js');
const B = require('../perf/native/backfill_phases.js');
const { readTelemetry } = require('../perf/native/report_charts.js');
const { buildReport } = require('../perf/native/report_html.js');

// ── 1. debounceGroundBlips ──
const gate = [[0,'ground'],[800,'climb'],[2000,'cruise'],[5000,'descent'],[6215,'ground'],[6401,'cruise'],[6402,'ground']];
const g1 = P.debounceGroundBlips(gate);
T('1. a 1-s blip while parked folds back into ground', JSON.stringify(g1) === JSON.stringify(gate.slice(0,5)), JSON.stringify(g1));
const tb = P.taxiBoundaries(g1);
T('   arrival taxi now starts at touchdown (6215), not after the blip', tb.arr === 6215, String(tb.arr));
T('   …and before the fix it started after the blip (the bug)', P.taxiBoundaries(gate).arr === 6402);
const depBlip = [[0,'ground'],[479,'cruise'],[480,'ground'],[1103,'climb'],[4000,'descent'],[4400,'ground']];
T('   a blip during departure taxi no longer ends dep_taxi early', P.taxiBoundaries(P.debounceGroundBlips(depBlip)).dep === 1103);
T('   a 10 s+ airborne run is real flight — kept; a 5 s one folds', P.debounceGroundBlips([[0,'ground'],[300,'climb'],[310,'ground']]).length === 3 && P.debounceGroundBlips([[0,'ground'],[300,'climb'],[305,'ground']]).length === 1);
T('   a run with no ground after it (sim quit airborne) is kept', P.debounceGroundBlips([[0,'ground'],[100,'cruise']]).length === 2);
T('   multi-phase blip (cruise→descent inside 10 s) also folded', P.debounceGroundBlips([[0,'ground'],[50,'cruise'],[52,'descent'],[55,'ground']]).length === 1);

// ── 2. frametime split + VRAM keep the arrival taxi ──
{
  const ft = new Array(7000).fill(1000);               // 1 frame per second, elapsed 0..6999 s
  const b = P.splitFrametimesByPhase(ft, gate, 0);
  T('2. arr_taxi bucket holds the whole rollout+taxi (6215→end)', b.arr_taxi.length === 7000 - 6215, String(b.arr_taxi.length));
  T('   no frames leak into cruise from the blip', b.cruise.length === 5000 - 2000);
  const rows = []; for (let s = 0; s < 7000; s++) { const ph = s < 800 ? 'ground' : s < 2000 ? 'climb' : s < 5000 ? 'cruise' : s < 6215 ? 'descent' : (s === 6401 ? 'cruise' : 'ground'); rows.push({ wall_ms: s * 1000, phase: ph, vram_mb: s >= 6215 ? 9000 : 8000 }); }
  const v = P.computePhaseVram(rows);
  T('   per-phase VRAM has arr_taxi, and cruise ignores the blip sample', v.arr_taxi && v.arr_taxi.vram_avg === 9000 && v.cruise.vram_peak === 8000, JSON.stringify(v.arr_taxi));
}

// ── 3. LandingTracker: real bounce vs gate flicker ──
function land(extra){ const lt = new LandingTracker(); lt.update(0,1,1,5,0); for(let t=2;t<=60;t+=2) lt.update(-300,1,0,140,t); lt.update(-300,1,1,135,61); lt.update(0,1.3,1,130,61.3);
  for (const f of extra) lt.update(...f); return lt.result(); }
T('3. gate flicker 180 s after touchdown is NOT a bounce', land([[0,1,1,0,240],[0,1,0,0,241],[0,1,1,0,242]]).bounce_count === 0);
T('   a real bounce 2 s after touchdown still counts', land([[0,1,0,120,63],[-150,1,1,115,65]]).bounce_count === 1);
T('   firmest touchdown still reported (fpm -300)', land([]).touchdown_fpm === -300);

// ── 4. fakeBounces / correctedLanding ──
{
  const tel = []; for (let s = 0; s < 7000; s++) tel.push({ wall_ms: s * 1000, phase: s < 800 ? 'ground' : s < 6215 ? 'descent' : (s === 6401 ? 'cruise' : 'ground') });
  T('4. fakeBounces finds the parked flicker', B.fakeBounces(tel) === 1);
  const tel2 = tel.map(r => Object.assign({}, r, { phase: r.wall_ms === 6401000 ? 'ground' : (r.wall_ms === 6217000 ? 'descent' : r.phase) }));
  T('   a hop 2 s after touchdown is not "fake"', B.fakeBounces(tel2) === 0);
  const sm = { settings: { landing: { bounce_count: 1, rating: 'Good' } } };
  T('   correctedLanding subtracts it, keeps the rating', B.correctedLanding(sm, { landing_fake_bounces: 1 }).bounce_count === 0 && B.correctedLanding(sm, { landing_fake_bounces: 1 }).rating === 'Good');
  T('   …and leaves a clean landing alone', B.correctedLanding(sm, {}).bounce_count === 1);
}

// ── 5. REAL flight (Dean's LOWW-LGKR) — sidecar + report surface, originals untouched ──
const S = path.join(X.APP_DATA, 'Sessions');
const dir = path.join(S, '2026-10-30', '0946_TLOD100_OLOD120');
if (fs.existsSync(path.join(dir, 'summary.json'))) {
  const hash = f => crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, f))).digest('hex');
  const before = ['summary.json', 'frametimes.csv', 'telemetry.csv'].map(hash);
  const summary = JSON.parse(fs.readFileSync(path.join(dir, 'summary.json'), 'utf8'));
  const ext = B.computeExt(dir, summary);
  const p = ext.phases, sp = summary.smoothness.phases;
  T('5. real flight: arrival taxi recovered', p.arr_taxi && p.arr_taxi.frame_count > 3000, p.arr_taxi && String(p.arr_taxi.frame_count));
  T('   the summary as captured had no arr_taxi (the bug, confirmed)', !sp.arr_taxi);
  T('   dep/climb/cruise/descent frame counts match the capture (same trim, same split)',
    ['dep_taxi','climb','cruise','descent'].every(k => p[k] && Math.abs(p[k].frame_count - sp[k].frame_count) <= sp[k].frame_count * 0.002),
    ['dep_taxi','climb','cruise','descent'].map(k => k + ' ' + (p[k] && p[k].frame_count) + '/' + sp[k].frame_count).join(' '));
  T('   arr_taxi has its own VRAM', p.arr_taxi.vram_peak > 0);
  T('   the parked flicker is identified as the fake bounce', ext.landing_fake_bounces === 1);
  T('   sidecar is stamped deblip (main.js prefers it)', ext.phase_v === B.PHASE_V);
  const ld = B.correctedLanding(summary, ext);
  const tmp = path.join(require('os').tmpdir(), 'abrp_gateblip_' + process.pid + '.html');
  const stats = Object.assign({}, summary.smoothness, { phases: p });
  let html = '';
  try { html = buildReport(summary.session_id, Object.assign({}, summary.settings, { landing: ld }), stats, summary.vram, [16,17,16], [16,16,17], dir, summary.driver_version, summary.sim_version, []); } catch (e) { html = 'ERR ' + e.message; }
  T('   SURFACE: report landing card says "no bounce"', /Landing performance[\s\S]*no bounce/.test(html), html.slice(0, 80));
  T('   SURFACE: report phase table carries an "Arrival taxi" row', /title="Arrival taxi[^"]*frames/.test(html));
  let htmlOld = '';
  try { htmlOld = buildReport(summary.session_id, summary.settings, summary.smoothness, summary.vram, [16,17,16], [16,16,17], dir, summary.driver_version, summary.sim_version, []); } catch (e) {}
  T('   …which the as-captured data could not show (before: no row, "1 bounce")', !/title="Arrival taxi[^"]*frames/.test(htmlOld) && /1 bounce/.test(htmlOld));
  const after = ['summary.json', 'frametimes.csv', 'telemetry.csv'].map(hash);
  T('   originals byte-identical (summary/frametimes/telemetry)', before.join() === after.join());
  try { fs.unlinkSync(tmp); } catch (_) {}
} else T('real flight not present — skipped', true);

process.exit(T.done() ? 1 : 0);
