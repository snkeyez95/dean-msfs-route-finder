'use strict';
// v6.15.2 — sector-specific Center callsigns must use their OWN polygon, not the union of every
// '-SUFFIX' segment (Dean 2026-07-28, KEYW→TNCM). MIA_N_CTR kept "covering" him out to GMONI —
// inside KZMA-OCN (Miami Oceanic) but outside KZMA-N (Miami North) — so he was never released to
// UNICOM. The v6.12.8 merge is still right for a single-position Center (NY_CTR); only a callsign
// that NAMES a sector may narrow to it.
const X = require('./lib/extract.js');
const T = X.runner('sector-specific Center callsigns:');

if (!X.haveRealData()) { console.log('SKIP — needs airspace.json'); process.exit(0); }
const sb = X.buildSandbox();
sb.setAirspace(X.loadAirspace());
const A = sb.getAirspace();

const has = id => !!(A.boundaries && A.boundaries[id]);
T('real data has the Miami segments this depends on',
  has('KZMA') && has('KZMA-N') && has('KZMA-OCN'));

const cov = (cs, lat, lon) => sb.airspaceCovers(cs, lat, lon);

// ── Dean's actual route: Miami North should release him after DROWN ─────────
console.log('\nDean\'s KEYW→TNCM route (MIA_N_CTR):');
const inMiami = [['KEYW departure', 24.55, -81.76], ['CARNU', 24.6, -80.3], ['DROWN', 24.3, -79.2]];
const outside = [['ELLEE', 24.1, -77.9], ['MADIZ', 23.4, -75.5], ['FODED', 22.0, -72.3],
                 ['GMONI', 20.8, -69.5], ['HAGIT', 19.8, -67.5], ['TNCM', 18.04, -63.11]];
for (const [n, la, lo] of inMiami) T('  ' + n + ' → covered (he was correctly on Miami)', cov('MIA_N_CTR', la, lo) === true);
for (const [n, la, lo] of outside) T('  ' + n + ' → NOT covered (released to UNICOM)', cov('MIA_N_CTR', la, lo) === false);

// ── the specific regression: the oceanic segment must not leak in ───────────
console.log('\nthe bug itself:');
T('GMONI IS inside Miami Oceanic (so the union would wrongly cover it)',
  sb.airspaceCovers('MIA_OCN_CTR', 20.8, -69.5) === true);
T('…but MIA_N_CTR does not inherit it', cov('MIA_N_CTR', 20.8, -69.5) === false);

// ── the v6.12.8 NY_CTR fix must survive ────────────────────────────────────
console.log('\nno regression on merged (unsegmented) Centers:');
T('NY_CTR still covers Pennsylvania via the merged KZNY-W domestic segment',
  sb.airspaceCovers('NY_CTR', 41.0, -77.5) === true);
T('MIA_CTR (no sector token) still gets the full merged area at GMONI',
  sb.airspaceCovers('MIA_CTR', 20.8, -69.5) === true);

// ── unknown tokens must fall through, not blank out ────────────────────────
console.log('\nunrecognised sector tokens fall through to the merge:');
T('CHI_35_CTR (numeric token, no KZAU-35 segment) still resolves over Illinois',
  sb.airspaceCovers('CHI_35_CTR', 41.8, -88.5) === true);
T('a garbage token does not throw and still falls through',
  sb.airspaceCovers('MIA_ZZZ_CTR', 24.55, -81.76) === true);

// ── cache must not collide between sector variants ─────────────────────────
console.log('\nper-callsign cache keys (MIA_N vs MIA_OCN vs MIA):');
{
  const n1 = cov('MIA_N_CTR', 20.8, -69.5);
  const o1 = sb.airspaceCovers('MIA_OCN_CTR', 20.8, -69.5);
  const n2 = cov('MIA_N_CTR', 20.8, -69.5);       // re-read after the other variant cached
  T('MIA_N_CTR stays false after MIA_OCN_CTR was resolved (no cache bleed)', n1 === false && o1 === true && n2 === false);
}
T('unknown prefix still returns null (unchanged contract)', sb.airspaceCovers('XXX_CTR', 0, 0) === null);

process.exit(T.done() ? 1 : 0);
