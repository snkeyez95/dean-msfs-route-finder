'use strict';
// Phase 8a — native port of the coverage model (msfs_perf_logger.py:2552 compute_coverage, 2577
// next_gap_for_aircraft, consts 106-108). Drives the benchmark tracker + auto-TLOD (--prep-next).
// PORT, not a reimplementation — must match Python exactly (validated by _parity_cov.js).
const COVERAGE_TLODS = [100, 125, 150, 175];
const COVERAGE_AIRCRAFT = ["Fenix", "PMDG"];
const COVERAGE_TARGET_PER_CELL = 3;

// Phase 10: the grid is user-configurable (config.benchmark). Omitting `grid` keeps today's
// hardcoded Fenix/PMDG × 100-175 × 3 exactly (byte-compat with the Python-proven output).
// grid = { aircraft: [{label,match}...] or [labels], tlods: [...], perCell: n }
function gridOf(grid){
  const ac = (grid && Array.isArray(grid.aircraft) && grid.aircraft.length)
    ? grid.aircraft.map(a => (a && a.label) ? a.label : a).filter(Boolean) : COVERAGE_AIRCRAFT;
  const tl = (grid && Array.isArray(grid.tlods) && grid.tlods.length) ? grid.tlods : COVERAGE_TLODS;
  const per = (grid && grid.perCell > 0) ? Math.trunc(grid.perCell) : COVERAGE_TARGET_PER_CELL;
  return { ac, tl, per };
}

function computeCoverage(sessions, grid){
  const { ac: ACL, tl: TLL, per: TARGET } = gridOf(grid);
  const counts = {};
  for(const ac of ACL) for(const t of TLL) counts[ac + '|' + t] = 0;
  for(const s of (sessions || [])){
    const ac = s.aircraft, t = s.tlod;
    if(ACL.includes(ac) && TLL.includes(t) && s.p99_ft_ms != null) counts[ac + '|' + t]++;
  }
  const acTotals = {};
  for(const ac of ACL){ let sum = 0; for(const t of TLL) sum += counts[ac + '|' + t]; acTotals[ac] = sum; }
  const gaps = [];
  for(const ac of ACL) for(const t of TLL){
    const short = TARGET - counts[ac + '|' + t];
    if(short > 0) gaps.push({ aircraft: ac, tlod: t, count: counts[ac + '|' + t], short });
  }
  // Python key: (-short, ac_totals[ac], tlod) — most-short first, then fewer-total aircraft, then lower TLOD.
  gaps.sort((a, b) => (b.short - a.short) || (acTotals[a.aircraft] - acTotals[b.aircraft]) || (a.tlod - b.tlod));
  let rem = 0; for(const g of gaps) rem += g.short;
  return { counts, ac_totals: acTotals, gaps, total_remaining: rem, target: TARGET };
}

function nextGapForAircraft(coverage, aircraft){
  const cands = coverage.gaps.filter(g => g.aircraft === aircraft);
  if(!cands.length) return null;
  cands.sort((a, b) => (b.short - a.short) || (a.tlod - b.tlod));
  return cands[0].tlod;
}

module.exports = { computeCoverage, nextGapForAircraft, gridOf, COVERAGE_TLODS, COVERAGE_AIRCRAFT, COVERAGE_TARGET_PER_CELL };
