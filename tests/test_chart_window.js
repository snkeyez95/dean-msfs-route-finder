'use strict';
// v6.15.5 — the chart window + phase-VRAM trim window (Dean 2026-07-29: "does the VRAM drop line at
// the end tell me our capture stop and/or trim didn't close down correctly?").
//
// It did not — the frametime trim was correct. Two real defects sat behind that question:
//   1. Every telemetry-/trace-derived chart series (altitude, TLOD, traffic, VRAM, busiest-core) was
//      windowed to [0, totalMin + 0.5] — a 30-second pad past the plotted frametime end. The sim's
//      shutdown lives in exactly that pad, so the VRAM line drew the unload cliff the frametime line
//      had correctly trimmed away.
//   2. computePhaseVram averaged EVERY telemetry row, including the trimmed spawn-in and shutdown
//      samples, dragging the taxi phases' vram_avg (~400 MB on the real KPHX-KSAN flight) by an
//      amount that varies with how long the pilot idled before quitting.
// Both are checked here against the REAL modules, plus a real-session regression when one is present.
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('chart window + phase VRAM:');
const ROOT = path.resolve(__dirname, '..');
const RC = require(path.join(ROOT, 'perf/native/report_charts.js'));
const PH = require(path.join(ROOT, 'perf/native/phases.js'));
const chartsSrc = fs.readFileSync(path.join(ROOT, 'perf/native/report_charts.js'), 'utf8');
const engineSrc = fs.readFileSync(path.join(ROOT, 'perf/native/engine.js'), 'utf8');
const backfillSrc = fs.readFileSync(path.join(ROOT, 'perf/native/backfill_phases.js'), 'utf8');

// A synthetic session: 10 minutes of flight, then the sim quits. Telemetry keeps sampling through
// the teardown, so the last rows carry the VRAM unload — the exact shape of Dean's real flight.
const HEAD = 5;
function makeSession(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const rows = ['wall_ms,phase,alt_ft,vram_mb,sys_ram_pct,sys_cpu_pct,top_proc,top_proc_cpu,gspeed_kt,vatsim_traffic'];
  for (let s = 0; s <= 640; s++) {                      // 0-640 s of 1 Hz telemetry
    let phase = 'ground', alt = 20, vram = 9000, gs = 0;
    if (s > 60 && s <= 180) { phase = 'climb'; alt = (s - 60) * 100; vram = 9500; gs = 250; }
    else if (s > 180 && s <= 480) { phase = 'cruise'; alt = 12000; vram = 9600; gs = 400; }
    else if (s > 480 && s <= 570) { phase = 'descent'; alt = 12000 - (s - 480) * 100; vram = 9400; gs = 250; }
    else if (s > 570) { phase = 'ground'; alt = 20; vram = 8800; gs = s < 600 ? 15 : 0; }
    else if (s <= 60) { vram = s < HEAD ? 4000 : 8600; gs = 12; }   // spawn-in load at the head
    // The teardown unload cliff, deliberately placed INSIDE the old +0.5 min pad (x ≈ 10.25 min,
    // where totalMin = 10.0) — that is precisely the band the old window drew and the new one drops.
    if (s >= 620) vram = s >= 623 ? 1000 : 6500;
    rows.push([s * 1000, phase, alt, vram, 40, 30, 'msfs', 20, gs, ''].join(','));
  }
  fs.writeFileSync(path.join(dir, 'telemetry.csv'), rows.join('\n'));
  return RC.readTelemetry(dir);
}
const TMP = path.join(ROOT, 'tests', '_tmp_chart_window');
let tel = null;
try { tel = makeSession(TMP); } catch (e) { console.log('  (temp session failed: ' + e.message + ')'); }

// ── 1. the window rule is in the source, and the pad is gone ────────────────
console.log('the window rule:');
{
  T('no series still pads the window by +0.5 min',
    !/if\(!?x?[^\n]*totalMin \+ 0\.5\) continue;/.test(chartsSrc));
  T('a single shared inChartWindow helper defines the rule',
    /const inChartWindow = \(x, totalMin\) => x >= 0 && x <= totalMin;/.test(chartsSrc));
  const guards = (chartsSrc.match(/if\(!inChartWindow\(x, totalMin\)\) continue;/g) || []).length;
  T('all 5 telemetry/trace series use it (alt, tlod, traffic, vram, dom)', guards === 5, guards + ' guarded');
}

// ── 2. no series may be drawn past the frametime end ───────────────────────
console.log('\nno series outruns the plotted frametime series:');
if (!tel) { T('synthetic session available', false); }
else {
  const totalMin = 10.0;                                 // pretend the frametime series ends at 10 min
  const series = {
    vram: RC.chartVramSeries(TMP, totalMin),
    alt: RC.chartAltitudeSeries(TMP, totalMin),
    traffic: RC.chartTrafficSeries(TMP, totalMin),
  };
  T('VRAM series exists', !!series.vram && series.vram.length > 0);
  T('VRAM never plots past totalMin', series.vram.every(([x]) => x <= totalMin),
    'last x ' + series.vram[series.vram.length - 1][0]);
  T('altitude never plots past totalMin', series.alt.every(([x]) => x <= totalMin));
  T('the teardown cliff (1000 MB) is NOT plotted', !series.vram.some(([, v]) => v <= 1000));
  T('the pre-cliff 6500 MB dip is NOT plotted either', !series.vram.some(([, v]) => v === 6500));
  T('real in-flight VRAM still is plotted', series.vram.some(([, v]) => v === 9600));
  // the old behaviour, reproduced by asking for a window 0.5 min shorter — proves the pad was the bug
  const padded = RC.chartVramSeries(TMP, totalMin + 0.5);
  T('with a +0.5 window the cliff WOULD have been drawn (the bug being fixed)',
    padded.some(([, v]) => v <= 1000));
  T('traffic column blank → series is null, not an empty plot', series.traffic === null);
}

// ── 3. phase VRAM honours the same trim window ──────────────────────────────
console.log('\nphase VRAM trim window:');
if (!tel) { T('synthetic session available', false); }
else {
  const unwindowed = PH.computePhaseVram(tel);                       // legacy behaviour (no bounds)
  const windowed = PH.computePhaseVram(tel, HEAD, HEAD + 600);       // kept frames only: 5 s → 605 s
  T('unwindowed arrival taxi is dragged down by the shutdown',
    unwindowed.arr_taxi.vram_avg < 8800, 'avg ' + unwindowed.arr_taxi.vram_avg);
  T('windowed arrival taxi reads the true gate VRAM',
    windowed.arr_taxi.vram_avg === 8800, 'avg ' + windowed.arr_taxi.vram_avg);
  T('the correction is worth hundreds of MB',
    windowed.arr_taxi.vram_avg - unwindowed.arr_taxi.vram_avg > 200,
    '+' + (windowed.arr_taxi.vram_avg - unwindowed.arr_taxi.vram_avg) + ' MB');
  T('the head window drops the spawn-in load too',
    windowed.dep_taxi.vram_avg > unwindowed.dep_taxi.vram_avg,
    unwindowed.dep_taxi.vram_avg + ' -> ' + windowed.dep_taxi.vram_avg);
  T('peaks are unchanged — an unload can only lower, never raise',
    windowed.cruise.vram_peak === unwindowed.cruise.vram_peak);
  T('airborne phases are untouched by the window',
    windowed.cruise.vram_avg === unwindowed.cruise.vram_avg && windowed.climb.vram_avg === unwindowed.climb.vram_avg);
  T('all 5 phases still resolve (boundaries come from ALL rows, not just windowed ones)',
    ['dep_taxi', 'climb', 'cruise', 'descent', 'arr_taxi'].every(k => windowed[k]));
  T('omitting the bounds keeps the old behaviour (back-compat)',
    JSON.stringify(PH.computePhaseVram(tel)) === JSON.stringify(unwindowed));
  T('an impossible window degrades to empty, it never throws',
    JSON.stringify(PH.computePhaseVram(tel, 9e9, 9e9 + 1)) === '{}');
}

// ── 4. both writers pass the window, and the backfill re-runs once ──────────
console.log('\nwiring:');
{
  T('engine.js windows phase VRAM to the kept frames',
    /computePhaseVram\(tel, HEAD_TRIM_S, HEAD_TRIM_S \+ keptMs \/ 1000\)/.test(engineSrc));
  T('backfill_phases.js uses the identical window',
    /computePhaseVram\(tel, HEAD, HEAD \+ keptMs \/ 1000\)/.test(backfillSrc));
  T('a VRAM_V marker exists so old sidecars recompute once',
    /const VRAM_V = 'trim-window';/.test(backfillSrc));
  T('the idempotency gate checks VRAM_V as well as TRIM_V',
    /ext\.trim_v === TRIM_V && ext\.vram_v === VRAM_V/.test(backfillSrc));
  T('computeExt stamps vram_v into the sidecar', /trim_v: TRIM_V, vram_v: VRAM_V/.test(backfillSrc));
  T('REPORT_V was bumped so every report regenerates once',
    /const REPORT_V = 'chart-window-no-pad';/.test(backfillSrc));
}

// ── 5. real-session regression (skipped when Sessions isn't present) ────────
console.log('\nreal session (skipped if unavailable):');
{
  const SESS = path.join(process.env.APPDATA || '', 'A Better Route Planner', 'Sessions');
  let dir = null;
  try {
    const idx = JSON.parse(fs.readFileSync(path.join(SESS, 'index.json'), 'utf8'));
    for (const s of (idx.sessions || []).slice().reverse()) {
      const d = path.join(SESS, String(s.folder || '').replace(/\//g, path.sep));
      if (fs.existsSync(path.join(d, 'telemetry.csv')) && fs.existsSync(path.join(d, 'frametimes.csv'))) { dir = d; break; }
    }
  } catch (_) {}
  if (!dir) { console.log('  (no logged flight with telemetry — skipped)'); }
  else {
    const rt = RC.readTelemetry(dir);
    const { ft } = RC.readChronological(path.join(dir, 'frametimes.csv'));
    const headed = PH.trimHead(ft, [], [], HEAD)[0];
    const chartFt = PH.trimChartTail(headed, rt, HEAD);
    const totalMin = RC.chartFrametimeSeries(chartFt)[2];
    const v = RC.chartVramSeries(dir, totalMin);
    T('real flight: VRAM series stays inside the plotted window',
      !!v && v.every(([x]) => x <= totalMin), 'n=' + (v ? v.length : 0) + ' totalMin=' + totalMin.toFixed(2));
    const kept = PH.trimTeardownTail(headed, [], [])[0];
    let keptMs = 0; for (const x of kept) keptMs += x;
    const w = PH.computePhaseVram(rt, HEAD, HEAD + keptMs / 1000);
    const u = PH.computePhaseVram(rt);
    // The TAIL correction is the one this fix is about: the sim's VRAM unload can only drag an
    // average DOWN, so removing those samples can only raise arrival taxi (or leave it alone).
    // The HEAD trim is not directional — spawn-in samples can sit above or below a phase's mean
    // (KSFO-KGPI: dropping them moved dep_taxi by -1 MB), so don't assert a direction there.
    T('real flight: the teardown correction only ever RAISES arrival-taxi VRAM',
      !u.arr_taxi || !w.arr_taxi || w.arr_taxi.vram_avg >= u.arr_taxi.vram_avg,
      u.arr_taxi ? (u.arr_taxi.vram_avg + ' -> ' + w.arr_taxi.vram_avg) : 'no arrival taxi');
    T('real flight: phases the window barely touches stay put (head trim only, either direction)',
      ['climb', 'cruise', 'descent'].every(k => !u[k] || !w[k] || Math.abs(w[k].vram_avg - u[k].vram_avg) <= 50),
      ['dep_taxi', 'climb', 'cruise', 'descent'].filter(k => u[k] && w[k])
        .map(k => k + ' ' + (w[k].vram_avg - u[k].vram_avg)).join(' · '));
  }
}

try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
process.exit(T.done() ? 1 : 0);
