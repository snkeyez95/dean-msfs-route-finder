'use strict';
// DEPARTURE vs APPROACH disambiguation (Dean 2026-07-20, live at KORD). VATSIM gives DEP and APP the
// same facility code (5 → 'APP' tier); ABRP must tell them apart by callsign suffix and pick the one
// matching the leg: _DEP when departing, _APP when arriving. Bug: with both CHI_B_DEP and CHI_Z_APP
// online it recommended the _APP on a departure.
const X = require('./lib/extract.js');
const sb = X.buildSandbox();
const T = X.runner();

// ── pure helpers (no data needed) ────────────────────────────────────────────
console.log('role + label helpers:');
T("latcTermRole('CHI_B_DEP') = DEP", sb.latcTermRole('CHI_B_DEP') === 'DEP');
T("latcTermRole('CHI_Z_APP') = APP", sb.latcTermRole('CHI_Z_APP') === 'APP');
T("latcTermRole('MCO_E_DEP') = DEP", sb.latcTermRole('MCO_E_DEP') === 'DEP');
T("latcTermRole('N90_APP')   = APP", sb.latcTermRole('N90_APP') === 'APP');
T("latcTermRole('LGAV_APP')  = APP (no suffix role → APP)", sb.latcTermRole('LGAV_APP') === 'APP');
T("latcTermRole('') = APP, no throw", sb.latcTermRole('') === 'APP');
T("latcPosLabel('APP','CHI_B_DEP') = Departure", sb.latcPosLabel('APP','CHI_B_DEP') === 'Departure');
T("latcPosLabel('APP','CHI_Z_APP') = Approach", sb.latcPosLabel('APP','CHI_Z_APP') === 'Approach');
T("latcPosLabel('TWR','ORD_S_TWR') = Tower (non-terminal untouched)", sb.latcPosLabel('TWR','ORD_S_TWR') === 'Tower');
T("latcPosLabel('CTR','CHI_35_CTR') = Center", sb.latcPosLabel('CTR','CHI_35_CTR') === 'Center');

// ── next-up skips ATIS (pure, no data) ───────────────────────────────────────
console.log('\nnext-up skips ATIS (KDTW inbound):');
{
  const seqA=[
    {kind:'atc', tier:'CTR', leg:'enr', callsign:'CLE_48_CTR', freq:119.875},
    {kind:'atis', tier:'ATIS', leg:'arr', callsign:'KDTW_ATIS', freq:133.675},
    {kind:'atc', tier:'APP', leg:'arr', callsign:'DTW_F1_APP', freq:126.225},
  ];
  const nu=sb.latcNextUp({found:true, callsign:'CLE_48_CTR', freq:119.875}, seqA);
  T('Center → next-up skips the ATIS, points at Approach', nu && nu.callsign==='DTW_F1_APP', nu&&(nu.kind+':'+nu.callsign));
  T('  …flagged downroute → labelled "Later"', nu && nu.downroute===true && sb.latcNextUpLabel(nu)==='Later');

  const seqB=[
    {kind:'atc', tier:'CTR', leg:'enr', callsign:'CLE_48_CTR', freq:119.875},
    {kind:'atis', tier:'ATIS', leg:'arr', callsign:'KDTW_ATIS', freq:133.675},
    {kind:'atc', tier:'CTAF', leg:'arr', callsign:null, freq:118.450},
  ];
  const nu2=sb.latcNextUp({found:true, callsign:'CLE_48_CTR', freq:119.875}, seqB);
  T('dark arrival → skips ATIS to the CTAF/UNICOM (ATIS not lost — it is a footnote)', nu2 && nu2.tier==='CTAF' && Math.abs(nu2.freq-118.450)<0.005, nu2&&nu2.tier);

  const seqC=[
    {kind:'atc', tier:'GND', leg:'dep', callsign:'MIA_GND', freq:121.800},
    {kind:'atc', tier:'TWR', leg:'dep', callsign:'MIA_TWR', freq:118.300},
  ];
  const nu3=sb.latcNextUp({found:true, callsign:'MIA_GND', freq:121.800}, seqC);
  T('no ATIS in the way → normal next-up (Ground → Tower)', nu3 && nu3.callsign==='MIA_TWR', nu3&&nu3.callsign);
}

// ── enroute coverage GAP into arrival → UNICOM in the sequence (Dean 2026-08-04, KDTW→KDCA) ──────────
// Only Cleveland Center online, Washington Center dark. Next-up from a Center must read UNICOM (the gap),
// not jump straight to the arrival CTAF. latcEnrichedSequence takes a pre-built stack (stOpt) so this is
// pure — no polygons needed.
console.log('\nenroute gap → UNICOM before the arrival CTAF:');
{
  const kdtw={icao:'KDTW', twr:118.400}, kdca={icao:'KDCA', twr:119.100};
  // tailGap: route leaves its last Center before the field.
  const stGap={dep:[], enr:[{callsign:'CLE_CTR', freq:120.450}], arr:[], enrouteGap:true, tailGap:true};
  const seqG=sb.latcEnrichedSequence(kdtw, kdca, [], sb.LATC&&sb.LATC.db, stGap);
  const iCtr=seqG.findIndex(x=>x.callsign==='CLE_CTR');
  const iUni=seqG.findIndex(x=>x.tier==='UNICOM' && x.leg==='enr');
  const iCtaf=seqG.findIndex(x=>x.tier==='CTAF' && x.leg==='arr');
  T('sequence inserts a UNICOM enroute entry (122.800)', iUni>=0 && Math.abs(seqG[iUni].freq-122.800)<0.005, iUni);
  T('  …ordered: Center → UNICOM → arrival CTAF', iCtr>=0 && iUni>iCtr && iCtaf>iUni, iCtr+'/'+iUni+'/'+iCtaf);
  const nuG=sb.latcNextUp({found:true, callsign:'CLE_CTR', freq:120.450}, seqG);
  T('next-up from Cleveland Center = UNICOM (the gap), NOT the KDCA CTAF', nuG && nuG.tier==='UNICOM' && Math.abs(nuG.freq-122.800)<0.005, nuG&&nuG.tier);

  // No tail gap (covered all the way to the field) → no spurious UNICOM; next-up is the arrival CTAF.
  const stNoGap={dep:[], enr:[{callsign:'CLE_CTR', freq:120.450}], arr:[], enrouteGap:false, tailGap:false};
  const seqN=sb.latcEnrichedSequence(kdtw, kdca, [], sb.LATC&&sb.LATC.db, stNoGap);
  T('no tail gap → no UNICOM enroute entry injected', seqN.every(x=>!(x.tier==='UNICOM' && x.leg==='enr')));
  const nuN=sb.latcNextUp({found:true, callsign:'CLE_CTR', freq:120.450}, seqN);
  T('  …next-up stays the arrival CTAF (unchanged behavior)', nuN && nuN.tier==='CTAF', nuN&&nuN.tier);

  // Non-US uncontrolled arrival with a tail gap: arrival is also UNICOM 122.800 → must not double up.
  const lgkr={icao:'LGKR'};   // no twr → UNICOM arrival
  const stIntl={dep:[], enr:[{callsign:'LGGG_CTR', freq:129.675}], arr:[], enrouteGap:true, tailGap:true};
  const seqI=sb.latcEnrichedSequence({icao:'LGAV'}, lgkr, [], sb.LATC&&sb.LATC.db, stIntl);
  const unis=seqI.filter(x=>x.tier==='UNICOM' && Math.abs(x.freq-122.800)<0.005);
  T('non-US UNICOM arrival + gap → single UNICOM entry, no consecutive duplicate', unis.length===1, unis.length);
}

// ── DARK enroute (no Center at all) into a STAFFED arrival (Dean 2026-08-08, KDTW→KJFK) ──────────────
// v6.17.2 only handled a gap BETWEEN Centers; here NOTHING is online enroute but KJFK Approach is staffed,
// so the whole enroute is UNICOM. That stretch must be inserted AND surfaced as next-up from the dark
// departure field — the exact case that recurred (it jumped straight to KJFK Approach, skipping 122.800).
console.log('\ndark enroute (no Center) + staffed arrival → UNICOM next-up:');
{
  sb.setS({ cfg:{ vatsim:{cid:''}, recentSimBriefRoutes:[{dep:'KDTW', arr:'KJFK'}] } });
  const kdtw={icao:'KDTW', twr:118.400}, kjfk={icao:'KJFK', twr:123.900};
  const stDark={dep:[], enr:[], arr:[{tier:'APP', callsign:'JFK_APP', freq:127.400}], enrouteGap:true, tailGap:true};
  const seqD=sb.latcEnrichedSequence(kdtw, kjfk, [], sb.LATC&&sb.LATC.db, stDark);
  const iUni=seqD.findIndex(x=>x.tier==='UNICOM' && x.leg==='enr');
  const iApp=seqD.findIndex(x=>x.callsign==='JFK_APP');
  T('dark enroute + staffed arrival → UNICOM enroute entry inserted', iUni>=0 && Math.abs(seqD[iUni].freq-122.800)<0.005, iUni);
  T('  …ordered before the arrival Approach', iApp>=0 && iUni<iApp, iUni+'/'+iApp);
  const recDep={found:false, callsign:null, freq:118.400, apt:{icao:'KDTW'}};
  const nuD=sb.latcNextUp(recDep, seqD);
  T('next-up from the dark KDTW CTAF = UNICOM (the gap), NOT KJFK Approach', nuD && nuD.tier==='UNICOM' && Math.abs(nuD.freq-122.800)<0.005, nuD&&(nuD.tier+' '+nuD.freq));
  const recUni={found:false, callsign:null, freq:122.800};
  const nuU=sb.latcNextUp(recUni, seqD);
  T('  …once airborne on UNICOM, next-up advances to KJFK Approach', nuU && nuU.callsign==='JFK_APP', nuU&&nuU.callsign);
  // Fully dark (nothing online anywhere): NO UNICOM insert — the arrival-CTAF planning aid stays the path.
  const stAllDark={dep:[], enr:[], arr:[], enrouteGap:true, tailGap:true};
  const seqAD=sb.latcEnrichedSequence(kdtw, kjfk, [], sb.LATC&&sb.LATC.db, stAllDark);
  T('fully-dark route → no UNICOM enroute entry (planning-aid path preserved)', seqAD.every(x=>!(x.tier==='UNICOM' && x.leg==='enr')));
}

// ── live ATC chain: state tagging (passed / current / next / upcoming) ───────────────────────────────
console.log('\nlive ATC chain — where you are in it:');
{
  const seqC=[
    {kind:'atc', tier:'TWR', leg:'dep', callsign:'DTW_TWR', freq:118.4},
    {kind:'atc', tier:'CTR', leg:'enr', callsign:'CLE_CTR', freq:120.45},
    {kind:'atc', tier:'APP', leg:'arr', callsign:'JFK_APP', freq:127.4},
    {kind:'atc', tier:'TWR', leg:'arr', callsign:'JFK_TWR', freq:119.1},
  ];
  const recOn={found:true, callsign:'CLE_CTR', freq:120.45};
  const ch=sb.latcBuildChain(seqC, recOn, sb.latcNextUp(recOn, seqC));
  T('chain covers the ATC entries', ch.length===4, ch.length);
  T('  behind you → passed', ch[0].state==='passed', ch[0].state);
  T('  where you are → current', ch[1].state==='current', ch[1].state);
  T('  the handoff you’ll take → next', ch[2].state==='next', ch[2].state);
  T('  further ahead → upcoming', ch[3].state==='upcoming', ch[3].state);
  // rec off-sequence (dark-dep CTAF): no current step; everything up to next reads passed.
  const chD=sb.latcBuildChain(seqC, {found:false, callsign:null, freq:118.9, apt:{icao:'KDTW'}},
    {callsign:'JFK_APP', freq:127.4, leg:'arr', tier:'APP', kind:'atc', downroute:true});
  T('rec off-sequence → no current step', chD.every(c=>c.state!=='current'));
  T('  the nextUp entry tagged next', chD[2].state==='next', chD[2].state);
  T('  entries before it passed', chD[0].state==='passed' && chD[1].state==='passed', chD[0].state+'/'+chD[1].state);
  // null-callsign gap entries fall back to the tier as the chip label.
  const chU=sb.latcBuildChain([{kind:'atc', tier:'UNICOM', leg:'enr', callsign:null, freq:122.8}], null, null);
  T('  UNICOM gap chip labelled from tier', chU[0].label==='UNICOM', chU[0].label);
}

// ── blink relevance: only ding for ATC ahead of the aircraft (Dean 2026-08-08) ───────────────────────
console.log('\nblink relevance — ahead, not behind:');
{
  const dep={icao:'KDTW', lat:42.21, lon:-83.35}, arr={icao:'KJFK', lat:40.64, lon:-73.78};
  const posNearArr={lat:41.0, lon:-74.5, onGround:false};   // at cruise, near the destination
  T('dep-field controller behind you at cruise → NOT relevant',
    sb.latcCtrlAheadRelevant({leg:'dep', tier:'TWR', callsign:'DTW_TWR'}, posNearArr, dep, arr)===false);
  T('arrival-field controller → always relevant',
    sb.latcCtrlAheadRelevant({leg:'arr', tier:'APP', callsign:'JFK_APP'}, posNearArr, dep, arr)===true);
  T('on the ground → nothing filtered',
    sb.latcCtrlAheadRelevant({leg:'dep', tier:'GND', callsign:'DTW_GND'}, {lat:42.21, lon:-83.35, onGround:true}, dep, arr)===true);
  T('still near the departure field → dep controller stays relevant',
    sb.latcCtrlAheadRelevant({leg:'dep', tier:'TWR', callsign:'DTW_TWR'}, {lat:42.3, lon:-83.4, onGround:false}, dep, arr)===true);
  T('no position → relevant (can’t tell what’s behind)',
    sb.latcCtrlAheadRelevant({leg:'dep', tier:'TWR'}, null, dep, arr)===true);
}

// ── against real polygons: the actual pick ───────────────────────────────────
if(!X.haveRealData()){ console.log('\n(pick tests skipped — needs airspace.json + airport_db.json)'); process.exit(T.done() ? 1 : 0); }
sb.setAirspace(X.loadAirspace());
const db = X.loadAirportDb();
sb.LATC.db = db;
const kmia = db.get('KMIA'), kmco = db.get('KMCO');

// Both a DEPARTURE and an APPROACH position online at BOTH ends (facility 5). Names use the airport
// prefix so they geo-resolve, and sit inside the field's TRACON polygon so both genuinely "cover".
const both = [
  {callsign:'MIA_DEP', facility:5, frequency:'125.500', visual_range:0},
  {callsign:'MIA_APP', facility:5, frequency:'124.850', visual_range:0},
  {callsign:'MCO_DEP', facility:5, frequency:'124.800', visual_range:0},
  {callsign:'MCO_APP', facility:5, frequency:'121.100', visual_range:0},
];

console.log('\nfrequency stack (briefing/sequence):');
{
  const st = sb.latcFreqStack(kmia, kmco, both, db);
  const depApp = st.dep.filter(x => x.tier === 'APP');
  const arrApp = st.arr.filter(x => x.tier === 'APP');
  T('dep field terminal = the _DEP position (MIA_DEP), _APP dropped',
    depApp.length === 1 && depApp[0].callsign === 'MIA_DEP', depApp.map(x=>x.callsign).join(','));
  T('arr field terminal = the _APP position (MCO_APP), _DEP dropped',
    arrApp.length === 1 && arrApp[0].callsign === 'MCO_APP', arrApp.map(x=>x.callsign).join(','));
}

console.log('\nlive recommendation:');
{
  // Climbing out of KMIA — departure leg. Expect the _DEP position.
  const depPos = {lat:kmia.lat, lon:kmia.lon, agl:6000, alt:6000, onGround:false};
  const rDep = sb.recommendFreq(depPos, both, db, {dep:'KMIA', arr:'KMCO'}, false);
  T('departing KMIA → recommends MIA_DEP (not MIA_APP)', rDep.found && rDep.callsign === 'MIA_DEP', rDep.callsign);
  T('  …labelled "Departure"', rDep.label === 'Departure', rDep.label);

  // Descending into KMCO — arrival leg. Expect the _APP position.
  const arrPos = {lat:kmco.lat, lon:kmco.lon, agl:6000, alt:6000, onGround:false};
  const rArr = sb.recommendFreq(arrPos, both, db, {dep:'KMIA', arr:'KMCO'}, false);
  T('arriving KMCO → recommends MCO_APP (not MCO_DEP)', rArr.found && rArr.callsign === 'MCO_APP', rArr.callsign);
  T('  …labelled "Approach"', rArr.label === 'Approach', rArr.label);

  // Fallback: only an _APP online at the dep field → still recommended (a lone approach works top-down).
  const only = [{callsign:'MIA_APP', facility:5, frequency:'124.850', visual_range:0}];
  const rFb = sb.recommendFreq(depPos, only, db, {dep:'KMIA', arr:'KMCO'}, false);
  T('lone _APP at dep field → still picked (graceful fallback)', rFb.found && rFb.callsign === 'MIA_APP', rFb.callsign);

  // ARRIVAL DESCENT (Dean 2026-07-20, KDTW): tuned to Center, now inside the arrival TRACON. The active-
  // radio "floor" must NOT pin you to Center — it should let you descend Center → Approach. (Bug: the
  // floor only moved the rec FORWARD in tier, which is right on climb-out but blocks the arrival descent.)
  T('sanity — ZMA_CTR covers KMCO (scenario is valid)', sb.airspaceCovers('ZMA_CTR', kmco.lat, kmco.lon) === true);
  const onCtr = {lat:kmco.lat, lon:kmco.lon, agl:9000, alt:9000, onGround:false, comActiveMhz:132.450};
  const ctrApp = [
    {callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0},
    {callsign:'MCO_APP', facility:5, frequency:'121.100', visual_range:0},
  ];
  const rDesc = sb.recommendFreq(onCtr, ctrApp, db, {dep:'KMIA', arr:'KMCO'}, false);
  T('descending into KMCO on Center, inside Approach airspace → advances to MCO_APP (not stuck on Center)', rDesc.found && rDesc.callsign === 'MCO_APP', rDesc.callsign);
}

process.exit(T.done() ? 1 : 0);
