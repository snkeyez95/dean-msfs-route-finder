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
}

process.exit(T.done() ? 1 : 0);
