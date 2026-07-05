'use strict';
// Phase 8a — native port of the coverage model (msfs_perf_logger.py:2552 compute_coverage, 2577
// next_gap_for_aircraft, consts 106-108). Drives the benchmark tracker + auto-TLOD (--prep-next).
// PORT, not a reimplementation — must match Python exactly (validated by _parity_cov.js).
const COVERAGE_TLODS = [100, 125, 150, 175];
const COVERAGE_AIRCRAFT = ["Fenix", "PMDG"];
const COVERAGE_TARGET_PER_CELL = 3;

function computeCoverage(sessions){
  const counts = {};
  for(const ac of COVERAGE_AIRCRAFT) for(const t of COVERAGE_TLODS) counts[ac + '|' + t] = 0;
  for(const s of (sessions || [])){
    const ac = s.aircraft, t = s.tlod;
    if(COVERAGE_AIRCRAFT.includes(ac) && COVERAGE_TLODS.includes(t) && s.p99_ft_ms != null) counts[ac + '|' + t]++;
  }
  const acTotals = {};
  for(const ac of COVERAGE_AIRCRAFT){ let sum = 0; for(const t of COVERAGE_TLODS) sum += counts[ac + '|' + t]; acTotals[ac] = sum; }
  const gaps = [];
  for(const ac of COVERAGE_AIRCRAFT) for(const t of COVERAGE_TLODS){
    const short = COVERAGE_TARGET_PER_CELL - counts[ac + '|' + t];
    if(short > 0) gaps.push({ aircraft: ac, tlod: t, count: counts[ac + '|' + t], short });
  }
  // Python key: (-short, ac_totals[ac], tlod) — most-short first, then fewer-total aircraft, then lower TLOD.
  gaps.sort((a, b) => (b.short - a.short) || (acTotals[a.aircraft] - acTotals[b.aircraft]) || (a.tlod - b.tlod));
  let rem = 0; for(const g of gaps) rem += g.short;
  return { counts, ac_totals: acTotals, gaps, total_remaining: rem, target: COVERAGE_TARGET_PER_CELL };
}

function nextGapForAircraft(coverage, aircraft){
  const cands = coverage.gaps.filter(g => g.aircraft === aircraft);
  if(!cands.length) return null;
  cands.sort((a, b) => (b.short - a.short) || (a.tlod - b.tlod));
  return cands[0].tlod;
}

module.exports = { computeCoverage, nextGapForAircraft, COVERAGE_TLODS, COVERAGE_AIRCRAFT, COVERAGE_TARGET_PER_CELL };
