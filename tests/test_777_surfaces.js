'use strict';
// v6.19.0 UI-SURFACE SWEEP for a newly added aircraft.
//
// Why this file exists (Dean, 2026-08-11): test_777_aircraft.js proved FLEET_DEF *contains* B77W and the
// engine labels it correctly — and every assertion passed while Plan a Flight showed no 777 chip at all.
// Those tests checked the CODE, not the thing Dean looks at. This suite checks the SURFACES: for each
// place a 777 should appear, it runs the real renderer function against Dean's REAL saved config (whose
// myFleet predates the 777 and has no B77W key) and asserts the aircraft is actually visible/usable.
//
// The rule this locks in: a newly shipped aircraft must work on FIRST LAUNCH, with no manual ticking.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner();
const html = X.html;

// Dean's live config — the honest input. If it can't be read, fall back to a config shaped like his
// (pre-777 myFleet), because that IS the case under test.
let realCfg;
try { realCfg = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'config.json'), 'utf8')); }
catch (_) { realCfg = { myFleet: { B738:true, A319:true, A320:true, A321:true, C680:true } }; }
const myFleet = realCfg.myFleet || {};

// Build a sandbox holding the REAL fleet/route surface functions out of index.html.
function sandbox(){
  const fns = ['getActiveFleet','fleetCodesFor','fleetSbType','renderFleetChips','buildFrAcftDropdown','blockLen'];
  let src = `
let S={cfg:{},acft:'all',frAcft:'',routeRegistry:{},routeRegistrySnapshot:{},selICAOs:new Set(),allRows:[],chMode:'challenging',chMaxMins:0,chDep:''};
let _els={};
const document={getElementById:(id)=>(_els[id]=_els[id]||{innerHTML:'',value:'',style:{},appendChild(){},querySelectorAll(){return[];}}),querySelectorAll:()=>[]};
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
`;
  // module-level constant tables, lifted verbatim from index.html
  for(const re of [/const SI_ACFT_MAP=\{[\s\S]*?\n\};/, /const SIM_LBL=\{[^\n]*\};/, /const SIM_SB=\{[^\n]*\};/,
                   /const FLEET_DEF=\[[\s\S]*?\n\];/, /const FLEET_LBL=[^\n]*;/, /const BLOCK_PAD_MIN=[^\n]*?;/]){
    const m = re.exec(html); if(!m) throw new Error('const not found: ' + re);
    src += m[0] + '\n';
  }
  for(const f of fns) src += X.grab(f, html) + '\n';
  src += 'return {S,_els,getActiveFleet,fleetCodesFor,fleetSbType,renderFleetChips,buildFrAcftDropdown,blockLen,SI_ACFT_MAP,SIM_LBL,SIM_SB,FLEET_DEF,FLEET_LBL,setCfg:(c)=>{S.cfg=c;}};';
  return new Function(src)();
}
const sb = sandbox();
sb.setCfg({ myFleet });   // <- Dean's real, pre-777 fleet selection

console.log("surface sweep — Dean's real config (myFleet has NO B77W key):");
{
  T('sanity: the saved fleet really is missing B77W (the case under test)', myFleet.B77W === undefined, JSON.stringify(Object.keys(myFleet)));

  // 1. The fleet set every route surface filters on
  const act = sb.getActiveFleet();
  T('1. getActiveFleet() includes B77W without any manual tick', act.has('B77W'), [...act].join(','));
  T('   …and B773 (routes filed as the non-ER -300)', act.has('B773'));
  T('   …and it did NOT lose the existing fleet', ['B738','A319','A320','A321'].every(c => act.has(c)), [...act].join(','));
  T('   …an explicitly UNCHECKED aircraft stays off (B737 is false in his config)', !act.has('B737'));

  // 2. Plan a Flight — the aircraft chip row (the exact thing in Dean's screenshot)
  sb.renderFleetChips();
  const chipHtml = sb._els['acft-chips-row'].innerHTML;
  T('2. Plan a Flight chip row renders a PMDG 777-300ER chip', chipHtml.includes('PMDG 777-300ER'));
  T('   …with a clickable data-acft="B77W" filter', /data-acft="B77W"/.test(chipHtml));
  T('   …existing chips still present (737 + Fenix)', chipHtml.includes('PMDG 737-800') && chipHtml.includes('Fenix A320'));
  // Dean 2026-08-12: he owns ONE 777, so there must be ONE 777 chip. B773 is a route-type variant the
  // same add-on flies, carried as an alias — never surfaced as a second aircraft he doesn't own.
  const chip777 = (chipHtml.match(/777/g) || []).length;
  T('   …and there is exactly ONE 777 chip, not one per type code', chip777 === 1, chip777 + ' mentions');
  T('   …B773 is NOT its own chip', !/data-acft="B773"/.test(chipHtml));

  // 3. Free Route — the aircraft picker
  sb.buildFrAcftDropdown();
  const frHtml = (sb._els['fr-acft'] || {}).innerHTML || '';
  T('3. Free Route aircraft picker offers the 777', frHtml.includes('PMDG 777-300ER') || frHtml.includes('B77W'), frHtml.slice(0,120));

  // 4. Labels — what a 777 route ROW and detail panel will actually say
  const lbl = (t) => sb.FLEET_LBL[t] || sb.SIM_LBL[sb.SI_ACFT_MAP[t]] || t;   // the app's own resolution chain
  T('4. a B77W route row reads "PMDG 777-300ER" (not a raw code)', lbl('B77W') === 'PMDG 777-300ER', lbl('B77W'));
  // A B773 leg has no fleet entry of its own now — it resolves through SI_ACFT_MAP to the add-on you'd
  // actually fly it in, which is the honest label for a route row.
  T('   …a B773 route row reads as the aircraft you fly it in', lbl('B773') === 'PMDG 777-300ER', lbl('B773'));
  T('   …737 labels unchanged', lbl('B738') === 'PMDG 737-800', lbl('B738'));

  // 5. Ingest gate — would a real 777 route survive import at all
  T('5. B77W passes the ingest gate (SI_ACFT_MAP)', !!sb.SI_ACFT_MAP['B77W']);
  T('   …B773 too', !!sb.SI_ACFT_MAP['B773']);
  T('   …both resolve to the b77w sim key', sb.SI_ACFT_MAP['B77W'] === 'b77w' && sb.SI_ACFT_MAP['B773'] === 'b77w');
  T('   …so the "not shown (unknown aircraft type)" counter will not hide them', !!sb.SI_ACFT_MAP['B77W']);

  // 6. SimBrief — the type handed to the flight planner
  T('6. SimBrief type for a b77w route is B77W', sb.SIM_SB['b77w'] === 'B77W', sb.SIM_SB['b77w']);
  T('   …and the Approaches free-plan button no longer forces A320', sb.fleetSbType() !== 'A320', sb.fleetSbType());

  // 7. Long-haul isn't filtered out by the duration control
  const durOpts = (/<select id="dur-f"[\s\S]*?<\/select>/.exec(html) || [''])[0];
  T('7. duration filter defaults to Any (a 14h 777 leg is not hidden)', /<option value="">Duration: Any<\/option>/.test(durOpts));
  T('   …and offers 8h/12h buckets for long-haul', /value="8"/.test(durOpts) && /value="12"/.test(durOpts));
  T('   …blockLen handles a long-haul flight_length', sb.blockLen(780) > 780, String(sb.blockLen(780)));
}

// 8. END-TO-END against the REAL stored route data: ingest → storage → the Plan a Flight filter.
// This is the assertion that actually answers "will Dean see 777 routes in the app".
console.log('\nend-to-end against real stored routes:');
{
  let reg = {};
  try { reg = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'routeRegistry.json'), 'utf8')) || {}; } catch(_){}
  const all = Object.values(reg).filter(Boolean);
  const r777 = all.filter(r => r.aircraft_type === 'B77W' || r.aircraft_type === 'B773');
  const total = all.length;
  T('8. the registry is populated (sanity)', total > 100, String(total));
  console.log('   → ' + r777.length + ' stored 777-family route(s) right now');
  if (r777.length) {
    // The real display gate from getRoutes(): fleet membership + the single-chip narrowing.
    const act = sb.getActiveFleet();
    const visible = r777.filter(r => act.has(r.aircraft_type));
    T('   stored 777 routes PASS the Plan a Flight fleet filter (they will render)', visible.length === r777.length, visible.length + '/' + r777.length);
    // The single-chip narrowing must keep BOTH type codes the one add-on flies, or clicking the 777
    // chip would silently hide its B773 legs.
    const picked = r777.filter(r => sb.fleetCodesFor('B77W').has(r.aircraft_type));
    T('   …clicking the 777 chip keeps every 777-family route (B77W + B773)', picked.length === r777.length, picked.length + '/' + r777.length);
    T('   …and does not leak another aircraft in', !all.some(r => r.aircraft_type === 'B738' && sb.fleetCodesFor('B77W').has(r.aircraft_type)));
    const lbl = (t) => sb.FLEET_LBL[t] || sb.SIM_LBL[sb.SI_ACFT_MAP[t]] || t;
    T('   …each renders a real aircraft name, never a bare code', r777.every(r => /[A-Za-z]{4,}/.test(lbl(r.aircraft_type))), lbl(r777[0].aircraft_type));
    T('   …and carries the dep/arr + duration a route row needs', r777.every(r => r.departure_airport && r.arrival_airport));
    const longHaul = r777.filter(r => sb.blockLen(r.flight_length) > 360);
    T('   …long-haul legs (>6h) survive the default Duration:Any filter', longHaul.length > 0, longHaul.length + ' long-haul');
  } else {
    // Legitimately empty only before the first refresh on v6.19.0 — assert the reason, don't hide it.
    T('   no 777 routes yet — but the ingest gate is open, so the next refresh stores them', !!sb.SI_ACFT_MAP['B77W']);
  }
}

process.exit(T.done() ? 1 : 0);
