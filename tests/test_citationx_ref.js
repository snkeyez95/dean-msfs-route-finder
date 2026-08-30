'use strict';
// Citation X (MSFS in-sim light jet, Dean 2026-08-29): recognized as a REFERENCE aircraft — labeled so
// its flights group under one name, but NOT in the benchmark grid, so (a) it's excluded from the
// baseline and (b) auto-TLOD treats it as coverage-complete instead of the misleading "SimBrief
// aircraft not recognized" prompt Dean hit before Launch + Capture. Mirrors the Citation Sovereign.
const X = require('./lib/extract.js');
const T = X.runner('Citation X reference aircraft:');
const sysinfo = require('../perf/native/sysinfo.js');
const prep = require('../perf/native/prep.js');
const coverage = require('../perf/native/coverage.js');

// Dean's real benchmark (no Citation of any kind — his two heavies + the 777).
const BENCH = { aircraft: [
  { label: 'Fenix', match: ['fenix', 'a318', 'a319', 'a320', 'a321'] },
  { label: 'PMDG 777', match: ['777', '77w'] },
  { label: 'PMDG', match: ['pmdg', '737', '738', '739'] },
], tlods: [100, 125, 150, 175], perCell: 3 };
const LABELS = BENCH.aircraft.map(a => a.label);

// ── 1. Sim TITLE → 'Citation X' (the real logged title was "Citation X Winglets") ──
const n = (t) => sysinfo.normalizeAircraftTitle(t, BENCH);
T('"Citation X Winglets" → Citation X', n('Citation X Winglets') === 'Citation X', n('Citation X Winglets'));
T('"Cessna Citation X" → Citation X', n('Cessna Citation X') === 'Citation X', n('Cessna Citation X'));
T('legacy fallback (no benchmark): still Citation X', sysinfo.normalizeAircraftTitle('Citation X Winglets', null) === 'Citation X');
T('the label is NOT a benchmark grid label (⇒ reference, excluded from baseline)', !LABELS.includes('Citation X'));

// ── 2. must NOT steal the Sovereign (or any heavy) ──
T('Citation Sovereign still resolves to the Sovereign, not Citation X', n('Cessna Citation Sovereign') === 'Citation Sovereign+', n('Cessna Citation Sovereign'));
T('Fenix unchanged', n('Fenix A320 IAE') === 'Fenix');
T('PMDG 737 unchanged', n('PMDG 737-800 Delta') === 'PMDG');

// ── 3. SimBrief airframe (C750) → recognized, but not a benchmark match ──
T('normalizeSimbriefAircraft("C750") → Citation X', prep.normalizeSimbriefAircraft('C750') === 'Citation X', prep.normalizeSimbriefAircraft('C750'));
T('normalizeSimbriefAircraft from the title also lands on Citation X', prep.normalizeSimbriefAircraft('Citation X Winglets') === 'Citation X');
T('matchBenchmarkAircraft("... Citation X C750 ...", BENCH) → null (not benchmarked)', prep.matchBenchmarkAircraft('Cessna Citation X C750', BENCH) === null, prep.matchBenchmarkAircraft('Cessna Citation X C750', BENCH));
T('Sovereign SimBrief code unaffected (c680 → Sovereign)', prep.normalizeSimbriefAircraft('C680') === 'Citation Sovereign+');

// ── 4. the warning kill: a recognized non-grid aircraft yields NO coverage gap → prep-next
//        returns reason 'coverage-complete' (falls through silently), not 'no-simbrief' ──
const cov = coverage.computeCoverage([], BENCH);
T('nextGapForAircraft(cov, "Citation X") → null (no grid cells ⇒ coverage-complete path)', coverage.nextGapForAircraft(cov, 'Citation X') == null, coverage.nextGapForAircraft(cov, 'Citation X'));
T('a real grid aircraft still HAS a gap (sanity: Fenix returns a TLOD)', coverage.nextGapForAircraft(cov, 'Fenix') != null, coverage.nextGapForAircraft(cov, 'Fenix'));

process.exit(T.done() ? 1 : 0);
