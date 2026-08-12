'use strict';
// v6.19.0 — adding the PMDG 777-300ER as a first-class aircraft.
// The core risk this suite locks down: the benchmark config's PMDG entry matches the bare term 'pmdg',
// and the title matchers are FIRST-MATCH-WINS — so without a 777 entry placed AHEAD of it, every 777
// flight is labelled 'PMDG' (the 737's label) and pollutes the 737 baseline cells, coverage, Scenery
// z-baselines and Compare. Same trap on the SimBrief side, where it would write a 737 benchmark TLOD
// to a 777 flight. Plus: adding a 3rd benchmark aircraft must NOT blank the TLOD pick earned from the
// existing 24 flights.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner();

const sysinfo = require('../perf/native/sysinfo.js');
const prep = require('../perf/native/prep.js');
const coverage = require('../perf/native/coverage.js');

// The migrated benchmark: 777 entry sits BEFORE the generic PMDG entry.
const BENCH = { aircraft: [
  { label: 'Fenix', match: ['fenix', 'a318', 'a319', 'a320', 'a321'] },
  { label: 'PMDG 777', match: ['777', '77w'] },
  { label: 'PMDG', match: ['pmdg', '737', '738', '739'] },
], tlods: [100, 125, 150, 175], perCell: 3 };

// ── 1. Sim TITLE → label ─────────────────────────────────────────────────────
console.log('aircraft title normalization (the mis-label trap):');
{
  const n = (t) => sysinfo.normalizeAircraftTitle(t, BENCH);
  T('"PMDG 777-300ER Boeing House" → PMDG 777 (NOT the 737 label)', n('PMDG 777-300ER Boeing House') === 'PMDG 777', n('PMDG 777-300ER Boeing House'));
  T('  …a 77w-style title also lands on PMDG 777', n('PMDG 77W Air Canada') === 'PMDG 777', n('PMDG 77W Air Canada'));
  T('737 title still resolves to PMDG (unchanged)', n('PMDG 737-800 Delta') === 'PMDG', n('PMDG 737-800 Delta'));
  T('Fenix title unchanged', n('Fenix A320 IAE British Airways') === 'Fenix', n('Fenix A320 IAE British Airways'));
  // Legacy built-ins (no benchmark passed at all) must not fold the 777 into PMDG either.
  const L = (t) => sysinfo.normalizeAircraftTitle(t, null);
  T('legacy fallback (no config): 777 → PMDG 777, not PMDG', L('PMDG 777-300ER') === 'PMDG 777', L('PMDG 777-300ER'));
  T('legacy fallback: 737 → PMDG', L('PMDG 737-800') === 'PMDG', L('PMDG 737-800'));
  T('legacy fallback: Fenix → Fenix', L('Fenix A321') === 'Fenix', L('Fenix A321'));
}

// ── 2. SimBrief airframe → benchmark aircraft (the wrong-TLOD trap) ──────────
console.log('\nSimBrief airframe matching (auto-TLOD must not write a 737 value to a 777):');
{
  const m = (b) => prep.matchBenchmarkAircraft(b, BENCH);
  // The realistic blob: SimBrief airframes are commonly NAMED "PMDG 777-300ER" — contains BOTH terms.
  T('blob with BOTH "pmdg" and "777" → PMDG 777 (order protects it)', m('b77w boeing 777-300er pmdg 777-300er g-abcd') === 'PMDG 777', m('b77w boeing 777-300er pmdg 777-300er g-abcd'));
  T('a real 737 blob still → PMDG', m('b738 boeing 737-800 pmdg 737 n123ab') === 'PMDG', m('b738 boeing 737-800 pmdg 737 n123ab'));
  T('a Fenix blob still → Fenix', m('a320 airbus a320 fenix g-euuu') === 'Fenix', m('a320 airbus a320 fenix g-euuu'));
  const ns = prep.normalizeSimbriefAircraft;
  T('normalizeSimbriefAircraft: B77W → PMDG 777', ns('B77W', 'Boeing 777-300ER', 'G-ABCD') === 'PMDG 777', ns('B77W', 'Boeing 777-300ER', 'G-ABCD'));
  T('  …B738 still → PMDG', ns('B738', 'Boeing 737-800', 'N1') === 'PMDG', ns('B738', 'Boeing 737-800', 'N1'));
}

// ── 3. The one-time config migration in main.js ──────────────────────────────
console.log('\nbenchmark config migration (main.js):');
{
  const main = fs.readFileSync(path.join(X.ROOT, 'main.js'), 'utf8');
  T('DEFAULT_BENCHMARK carries a PMDG 777 entry', /label: 'PMDG 777', match: \['777', '77w'\]/.test(main));
  T('  …and it sits ABOVE the generic PMDG entry in the default', main.indexOf("label: 'PMDG 777'") < main.indexOf("label: 'PMDG',"));
  T('migration is one-shot (mig777Done)', /c\.mig777Done/.test(main) && /c\.mig777Done = true/.test(main));
  // Run the migration logic itself against a pre-777 config shape.
  const splice = (acs) => {                     // mirrors the main.js insert rule
    const has = acs.some(a => a && Array.isArray(a.match) && a.match.some(t => /^(777|77w)$/i.test(String(t))));
    if (has) return acs;
    const i = acs.findIndex(a => a && Array.isArray(a.match) && a.match.some(t => String(t).toLowerCase() === 'pmdg'));
    const e = { label: 'PMDG 777', match: ['777', '77w'] };
    if (i >= 0) acs.splice(i, 0, e); else acs.push(e);
    return acs;
  };
  const old = [{ label: 'Fenix', match: ['fenix', 'a320'] }, { label: 'PMDG', match: ['pmdg', '737'] }];
  const out = splice(old.map(a => ({ ...a })));
  T('old config gains the 777 entry', out.some(a => a.label === 'PMDG 777'));
  T('  …inserted BEFORE the PMDG entry', out.findIndex(a => a.label === 'PMDG 777') < out.findIndex(a => a.label === 'PMDG'));
  T('  …and the migrated array actually labels a 777 correctly', sysinfo.normalizeAircraftTitle('PMDG 777-300ER', { aircraft: out }) === 'PMDG 777');
  const twice = splice(out.map(a => ({ ...a })));
  T('re-running is idempotent (no duplicate entry)', twice.filter(a => a.label === 'PMDG 777').length === 1);
}

// ── 4. Coverage grid with 3 aircraft ─────────────────────────────────────────
console.log('\ncoverage grid (3 aircraft × 4 TLODs × 3):');
{
  const sessions = [];
  for (const ac of ['Fenix', 'PMDG']) for (const t of [100, 125, 150, 175]) for (let i = 0; i < 3; i++)
    sessions.push({ aircraft: ac, tlod: t, p99_ft_ms: 17 });
  const cov = coverage.computeCoverage(sessions, BENCH);
  // engine shape: {counts, ac_totals, gaps, total_remaining, target}
  const cells = Object.keys(cov.counts).length;
  const filled = Object.values(cov.counts).reduce((a, n) => a + Math.min(n, cov.target), 0);
  T('grid is 12 cells / 36 flights with the 777 added', cells === 12 && cells * cov.target === 36, cells + ' cells');
  T('the existing 24 cells still count as filled', filled === 24, filled);
  T('every 777 cell reads 0', [100, 125, 150, 175].every(t => cov.counts['PMDG 777|' + t] === 0));
  T('not complete — 12 flights still owed, all of them 777', cov.total_remaining === 12 && cov.gaps.every(g => g.aircraft === 'PMDG 777'), cov.total_remaining);
  const gap = coverage.nextGapForAircraft(cov, 'PMDG 777');
  T('auto-TLOD offers a 777 cell when you SimBrief a 777', gap === 100, gap);
  // A 777 flight tagged online/AutoFPS must NOT fill a benchmark cell (same quarantine as the 24).
  const cov2 = coverage.computeCoverage(sessions.concat([
    { aircraft: 'PMDG 777', tlod: 100, p99_ft_ms: 18, online_traffic: 'vatsim' },
    { aircraft: 'PMDG 777', tlod: 100, p99_ft_ms: 18, autofps_active: true },
  ]), BENCH);
  T('VATSIM/AutoFPS 777 flights do not fill cells', cov2.counts['PMDG 777|100'] === 0, cov2.counts['PMDG 777|100']);
}

// ── 5. Renderer constants + helpers ──────────────────────────────────────────
console.log('\nfleet + route wiring (index.html):');
{
  const html = X.html;
  const sb = new Function(X.grab('getActiveFleet', html) + '\n' + X.grab('fleetSbType', html) + '\n' + X.grab('aircraftGroupForType', html) + `
    return {getActiveFleet, fleetSbType, aircraftGroupForType, setS:(x)=>{S=x;}, setFL:(x)=>{FLEET_LBL=x;}, setFD:(x)=>{FLEET_DEF=x;}, setSB:(x)=>{SIM_SB=x;}};
  `.replace(/^/, 'let S={cfg:{}},FLEET_DEF=[],FLEET_LBL={},SIM_SB={};\n'))();

  // consts are declared at module scope in index.html — read them out of the source directly
  const gc = (name) => { const m = new RegExp('const ' + name + '=([\\s\\S]*?);\\n', 'm').exec(html); return m ? m[1] : ''; };
  T('FLEET_DEF has the B77W entry', /\{code:'B77W',label:'PMDG 777-300ER',family:'777', def:true/.test(html));
  // One aircraft = one fleet entry. B773 rides along as an alias, never a second chip (Dean 2026-08-12).
  T('  …B773 is an ALIAS of it, not a separate fleet entry', /alias:\['B773'\]/.test(html) && !/\{code:'B773'/.test(html));
  // v6.19.0 fix: a newly shipped aircraft must be live on FIRST LAUNCH. That needs def:true AND
  // getActiveFleet honouring the same missing-key fallback the Settings checkbox uses — otherwise the
  // box renders ticked while every route surface filters the aircraft out (Dean's empty 777 chip row).
  T('  …def:true so it is live on first launch, no manual tick', /code:'B77W'[^}]*def:true/.test(html));
  T('  …and getActiveFleet falls back to def for a MISSING key (matches the checkbox)',
    /fleet\[f\.code\]!==undefined\?fleet\[f\.code\]:f\.def/.test(html));
  T('SI_ACFT_MAP (the ingest gate) maps B77W + B773', /'B77W':'b77w','B773':'b77w'/.test(html));
  T('SIM_LBL/SIM_SB carry the b77w key', /"b77w":"PMDG 777-300ER"/.test(html) && /"b77w":"B77W"/.test(html));
  T('duration filter offers long-haul buckets', /<option value="8">Under 8h<\/option>/.test(html) && /<option value="12">Under 12h<\/option>/.test(html));
  T('no hardcoded a320 SimBrief type left in Approaches', !/const sbType=SIM_SB\['a320'\]/.test(html));

  // aircraftGroupForType against the REAL post-move group layout
  const groups = [
    { id: 'Fenix/319_321', label: '319_321', packages: [{ name: 'fnx-aircraft-319-321' }, { name: 'fnx-aircraft-319-liveries' }] },
    { id: 'Fenix/320', label: '320', packages: [{ name: 'fnx-aircraft-320' }, { name: 'fnx-aircraft-320-liveries' }] },
    { id: 'PMDG/737-800', label: '737-800', packages: [{ name: 'pmdg-aircraft-738' }, { name: 'pmdg-aircraft-738-liveries' }, { name: 'xbaw-soundset-737' }] },
    { id: 'PMDG/777-300ER', label: '777-300ER', packages: [{ name: 'pmdg-aircraft-77w' }, { name: 'pmdg-aircraft-77w-liveries' }] },
  ];
  sb.setS({ cfg: {}, acftGroups: groups });
  sb.setFL({ B77W: 'PMDG 777-300ER', B738: 'PMDG 737-800', A320: 'Fenix A320', A319: 'Fenix A319' });
  const g = (t) => { const r = sb.aircraftGroupForType(t); return r ? r.id : null; };
  T('B77W → the 777 group (its folder is "77w" — only the group id carries 777)', g('B77W') === 'PMDG/777-300ER', g('B77W'));
  T('B738 → the 737 group (unchanged)', g('B738') === 'PMDG/737-800', g('B738'));
  T('A320 → the Fenix 320 group (unchanged)', g('A320') === 'Fenix/320', g('A320'));
  T('A319 → the Fenix 319/321 group (unchanged)', g('A319') === 'Fenix/319_321', g('A319'));

  // fleetSbType: the free-plan button follows My Fleet instead of always saying A320
  sb.setFD([{ code: 'B738', def: true }, { code: 'B77W', def: false }]);
  sb.setSB({ a320: 'A320' });
  sb.setS({ cfg: { myFleet: { B738: false, B77W: true } }, acftGroups: groups });
  T('free-plan SimBrief type follows the checked fleet', sb.fleetSbType() === 'B77W', sb.fleetSbType());
  // Empty myFleet → getActiveFleet falls back to the def:true set, so the type follows that.
  sb.setS({ cfg: { myFleet: {} }, acftGroups: groups });
  T('  …empty fleet falls back to the default aircraft, not a stray A320', sb.fleetSbType() === 'B738', sb.fleetSbType());
  // Only when NOTHING is selectable at all does the old A320 constant remain as a last resort.
  sb.setFD([{ code: 'B77W', def: false }]);
  sb.setS({ cfg: { myFleet: { B77W: false } }, acftGroups: groups });
  T('  …and A320 remains the last-resort fallback', sb.fleetSbType() === 'A320', sb.fleetSbType());
}

// ── 6. Baseline must survive a new aircraft with zero flights ────────────────
console.log('\nbaseline resilience (a new 3rd aircraft must not blank the pick):');
{
  const html = X.html;
  const src = 'let S={cfg:{}};\n' + X.grab('_cmpMean', html) + '\n' + X.grab('_maxN', html) + '\n'
    + "let _BL={AC:['Fenix','PMDG'],TL:[100,125,150,175],VRAM_CAP:12288,LIM:{cons:99,stut:0.1,vramPct:0.90},KNEE_MS:1.0,PER_CELL:3};\n"
    + X.grab('_blApplyCfg', html) + '\n' + X.grab('_blCompute', html) + '\n'
    + 'return {_blCompute, setS:(x)=>{S=x;}, getBL:()=>_BL};';
  const sb = new Function(src)();

  // Dean's real logged flights — the honest input for "does the pick move?"
  const idx = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'Sessions', 'index.json'), 'utf8'));
  const flights = (idx.sessions || []).map(s => ({
    aircraft: s.aircraft, tlod: s.tlod, p99_ft_ms: s.p99_ft_ms, stutter_pct: s.stutter_pct,
    consistency_pct: s.consistency_pct, peak_vram_mb: s.peak_vram_mb, driver_version: s.driver_version,
    sim_version: s.sim_version, total_vram_mb: 12288, excluded: s.excluded,
    online_traffic: s.online_traffic || 'offline', autofps_active: s.autofps_active, experiment: s.experiment,
  }));

  const TWO = { aircraft: [{ label: 'Fenix', match: [] }, { label: 'PMDG', match: [] }], tlods: [100, 125, 150, 175], perCell: 3 };
  const THREE = { aircraft: [{ label: 'Fenix', match: [] }, { label: 'PMDG 777', match: [] }, { label: 'PMDG', match: [] }], tlods: [100, 125, 150, 175], perCell: 3 };

  sb.setS({ cfg: { benchmark: TWO } });
  const before = sb._blCompute(flights);
  sb.setS({ cfg: { benchmark: THREE } });
  const after = sb._blCompute(flights);

  T('the 24-flight baseline currently picks a TLOD', before.balanced != null, String(before.balanced));
  T('adding the 777 does NOT blank it', after.balanced != null, String(after.balanced));
  T('  …and the pick is UNCHANGED (byte-identical on real data)', after.balanced === before.balanced, before.balanced + ' -> ' + after.balanced);
  T('  …smoothest + best-visuals unchanged too', after.smoothest === before.smoothest && after.bestVis === before.bestVis);
  T('coverage total grows to 36', after.coverage.total === 36, after.coverage.total);
  T('  …filled count is unchanged (no 777 flights exist)', after.coverage.filled === before.coverage.filled, before.coverage.filled + ' -> ' + after.coverage.filled);
  T('the 777 has no per-aircraft cells yet', [100, 125, 150, 175].every(t => !after.perAc['PMDG 777'][t]));

  // A 777 flight, once flown offline at a grid TLOD, DOES join the blend.
  const withOne = flights.concat([{ aircraft: 'PMDG 777', tlod: 125, p99_ft_ms: 30, stutter_pct: 0.02,
    consistency_pct: 99.9, peak_vram_mb: 11000, driver_version: before.modalDrv, total_vram_mb: 12288,
    online_traffic: 'offline' }]);
  const w = sb._blCompute(withOne);
  T('a real offline 777 flight fills its cell', !!w.perAc['PMDG 777'][125], JSON.stringify(w.perAc['PMDG 777'][125]));
  T('  …and its worse p99 flows into the TLOD-125 blend (worst-of)', w.prof[125].p99 >= 30, w.prof[125] && w.prof[125].p99);
}

process.exit(T.done() ? 1 : 0);
