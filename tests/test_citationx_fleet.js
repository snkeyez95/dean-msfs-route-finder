'use strict';
// v6.21.5 SURFACE SWEEP — the Cessna Citation X as a My Fleet entry (Dean 2026-08-29: "thought we added
// a Citation X option?"). v6.21.4 only added engine RECOGNITION (a clean log label); it did NOT touch
// FLEET_DEF, so the plane never appeared in My Fleet. This adds it as a Free-Route-only aircraft next to
// the Sovereign — and, per the 777 lesson (a FLEET_DEF entry that never reached the surface), proves it
// at the SURFACE against Dean's REAL saved config, whose myFleet has NO C750 key. def:true so it shows
// CHECKED on first launch — no manual tick, since he owns and flew it.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('Citation X — My Fleet surface:');
const html = X.html;

// Dean's live config — the honest input. Fallback is shaped like his (has C680, no C750 — the case under test).
let realCfg;
try { realCfg = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'config.json'), 'utf8')); }
catch (_) { realCfg = { myFleet: { B738:true, A319:true, A320:true, A321:true, B77W:true, C680:true } }; }
const myFleet = realCfg.myFleet || {};

function sandbox(){
  const fns = ['getActiveFleet','renderFleetPanel','renderFleetChips','buildFrAcftDropdown'];
  let src = `
let S={cfg:{},acft:'all',frAcft:'',freeRouteMode:true,routeRegistry:{},routeRegistrySnapshot:{},selICAOs:new Set(),allRows:[]};
let _els={};
const document={getElementById:(id)=>(_els[id]=_els[id]||{innerHTML:'',value:'',style:{},appendChild(){},querySelectorAll(){return[];}}),querySelectorAll:()=>[]};
function esc(s){return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');}
`;
  for(const re of [/const SI_ACFT_MAP=\{[\s\S]*?\n\};/, /const SIM_LBL=\{[^\n]*\};/, /const SIM_SB=\{[^\n]*\};/,
                   /const FLEET_DEF=\[[\s\S]*?\n\];/, /const FLEET_LBL=[^\n]*;/]){
    const m = re.exec(html); if(!m) throw new Error('const not found: ' + re);
    src += m[0] + '\n';
  }
  for(const f of fns) src += X.grab(f, html) + '\n';
  src += 'return {S,_els,getActiveFleet,renderFleetPanel,renderFleetChips,buildFrAcftDropdown,FLEET_DEF,setCfg:(c)=>{S.cfg=c;}};';
  return new Function(src)();
}
const sb = sandbox();
sb.setCfg({ myFleet });

// sanity: the config under test really lacks the new key
T('sanity: saved fleet has NO C750 key (the case under test)', myFleet.C750 === undefined, JSON.stringify(Object.keys(myFleet)));

// 0. FLEET_DEF actually carries it, as a Free-Route-only Citation
const cx = sb.FLEET_DEF.find(f => f.code === 'C750');
T('0. FLEET_DEF has a C750 entry', !!cx, JSON.stringify(cx));
T('   …labeled "Citation X", family Citation, freeOnly', cx && cx.label === 'Citation X' && cx.family === 'Citation' && cx.freeOnly === true);
T('   …def:true so it needs no manual tick', cx && cx.def === true);

// 1. My Fleet panel — the exact screen Dean is looking at
sb.renderFleetPanel();
const panel = sb._els['fleet-checks-fleet'].innerHTML;
T('1. My Fleet renders a Citation X row', panel.includes('Citation X'), panel.includes('Citation X'));
T('   …with its C750 code', panel.includes('C750'));
T('   …in the CITATION group, beside the Sovereign', panel.includes('Citation Sovereign+') && panel.includes('Citation X'));
T('   …marked Free Route only (no scheduled routes)', /Citation X[\s\S]*?Free Route only/.test(panel) || panel.includes('Free Route only'));
// the checkbox for C750 must be CHECKED (def:true, no saved key) — the surface proof
const cxRow = panel.slice(panel.indexOf('C750') - 220, panel.indexOf('C750') + 40);
T('   …and its checkbox is CHECKED on first launch (no manual tick)', /checked[^>]*onchange="toggleFleet\('C750'/.test(panel), cxRow);

// 2. getActiveFleet includes it without any tick → usable immediately
const act = sb.getActiveFleet();
T('2. getActiveFleet() includes C750 with no manual tick', act.has('C750'), [...act].join(','));
T('   …and did NOT drop the existing fleet', ['A320','A321'].every(c => act.has(c)) && act.has('C680'));

// 3. Free Route picker offers it (that IS how you fly a scheduled-route-less bizjet)
sb.buildFrAcftDropdown();
const fr = (sb._els['fr-acft'] || {}).innerHTML || '';
T('3. Free Route aircraft picker offers the Citation X', fr.includes('Citation X') || fr.includes('C750'), fr.slice(0, 160));

// 4. the Sovereign is untouched (still unchecked-by-default def:false, still rendered)
const sov = sb.FLEET_DEF.find(f => f.code === 'C680');
T('4. Sovereign entry unchanged (def:false, freeOnly)', sov && sov.def === false && sov.freeOnly === true);

// ── 5. aircraftGroupForType must NOT false-match C750 → the Caravan group's GTN750 GPS mod ──
// (Dean 2026-09-02: Free Route + Citation X offered to activate "Caravan (3 pkg)". Its
// pms50-instrument-gtn750 package contains "750", which collided with the C750 ICAO code under the
// old loose-substring match. The Citation X is a marketplace plane — it should match NOTHING.)
const agft = (function(){
  let src = 'let S={acftGroups:[]};\n';
  src += /const FLEET_DEF=\[[\s\S]*?\n\];/.exec(html)[0] + '\n';
  src += /const FLEET_LBL=[^\n]*;/.exec(html)[0] + '\n';
  src += X.grab('aircraftGroupForType', html) + '\nreturn {S, aircraftGroupForType};';
  return new Function(src)();
})();
agft.S.acftGroups = [
  { id:'Caravan', label:'Caravan', packages:[
    {name:'bksq-aircraft-caravanpro'}, {name:'bksq-aircraft-caravanprovariants'}, {name:'pms50-instrument-gtn750'} ] },
  { id:'Fenix/320', label:'Fenix A320', packages:[ {name:'fnx-aircraft-320'}, {name:'fnx-aircraft-320-liveries'} ] },
  { id:'PMDG/737-800', label:'PMDG 737-800', packages:[ {name:'pmdg-aircraft-738'} ] },
];
const cxGroup = agft.aircraftGroupForType('C750');
T('5. C750 (Citation X) matches NO group — the gtn750 collision is gone', cxGroup === null, cxGroup && cxGroup.id);
T('   …A320 still matches the Fenix 320 group (real match preserved)', (agft.aircraftGroupForType('A320')||{}).id === 'Fenix/320', (agft.aircraftGroupForType('A320')||{}).id);
T('   …B738 still matches the PMDG 737-800 group', (agft.aircraftGroupForType('B738')||{}).id === 'PMDG/737-800', (agft.aircraftGroupForType('B738')||{}).id);

process.exit(T.done() ? 1 : 0);
