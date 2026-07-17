'use strict';
// ALERT / NOTIFICATION STRESS — drives the real latcCheckToasts + latcPushOverlay chain exactly as
// latcPoll does, as a SEQUENCE of 5s polls. Single-cell tests can't catch alert storms; only a poll
// sequence can. This is the harness that caught the v6.12.8 boundary-graze chime storm.
const X = require('./lib/extract.js');
if(!X.haveRealData()){ console.log('SKIP — needs airspace.json + airport_db.json in %APPDATA%\\A Better Route Planner'); process.exit(0); }

const sb = X.buildSandbox();
sb.setAirspace(X.loadAirspace());
const db = X.loadAirportDb();
sb.LATC.db = db;
const T = X.runner();

let pushes = [], toasts = [];
sb.setApi({ overlayState: p => pushes.push(p), overlayToast: t => toasts.push(t), saveConfig: () => {} });

const kmia = db.get('KMIA'), kmco = db.get('KMCO');
const samples = sb.gcSamples(kmia.lat, kmia.lon, kmco.lat, kmco.lon, 1);

function reset(route){
  pushes = []; toasts = [];
  sb.LATC.status = 'live';
  sb.LATC._lastStableKey = undefined; sb.LATC._pendKey = null; sb.LATC._pendCount = 0;
  sb.LATC._prevFound = undefined; sb.LATC._prevNetKey = undefined; sb.LATC._lastCtrl = undefined;
  sb.LATC._handoffKey = null; sb.LATC._fieldMode = undefined;
  sb.LATC._seqCache = null; sb.LATC._stackCache = null;
  sb.setS({ cfg: { vatsim:{cid:'', enabled:true}, recentSimBriefRoutes: [route || {dep:'KMIA', arr:'KMCO'}] } });
}
function poll(pos, ctrl, ts){
  sb.LATC.pos = pos; sb.LATC.controllers = ctrl;
  sb.setFeed({ controllers: ctrl, atis: [], pilots: [], ts });
  sb.latcCheckToasts(); sb.latcPushOverlay();
}
const alerts = () => pushes.filter(p => p.isNewRec).length;

// Find a REAL TRACON boundary crossing on the route — synthetic geometry wouldn't reproduce the bug.
let edgeIn = null, edgeOut = null;
for(let i = 1; i < samples.length; i++){
  const a = sb.traconCovers('MCO_E_DEP', samples[i-1][0], samples[i-1][1]);
  const b = sb.traconCovers('MCO_E_DEP', samples[i][0], samples[i][1]);
  if(a === false && b === true){ edgeOut = samples[i-1]; edgeIn = samples[i]; break; }
}
if(!edgeIn){ console.log('SKIP — could not locate the MCO TRACON edge in the loaded polygons'); process.exit(0); }
const inP  = {lat:edgeIn[0],  lon:edgeIn[1],  agl:20000, alt:20000, onGround:false};
const outP = {lat:edgeOut[0], lon:edgeOut[1], agl:20000, alt:20000, onGround:false};
const mid  = samples[Math.round(samples.length/2)];
const cruise = {lat:mid[0], lon:mid[1], agl:35000, alt:35000, onGround:false, gs:450};

console.log('A1 — boundary graze must not alert-storm (the v6.12.8 regression):');
{
  reset();
  const ctrl = [{callsign:'MCO_E_DEP', facility:5, frequency:'124.800', visual_range:0}];
  poll(inP, ctrl, 1); poll(inP, ctrl, 1);            // settle inside
  const before = alerts();
  for(let i = 0; i < 10; i++) poll(i % 2 ? inP : outP, ctrl, 1);   // oscillate across the real edge
  T('10 boundary-flip polls on a FIXED network -> 0 alerts', alerts() - before === 0, (alerts()-before) + ' alerts');
}
console.log('\nA1b — controller<->controller graze stays debounced:');
{
  reset();
  const ctrl = [{callsign:'MCO_E_DEP', facility:5, frequency:'124.800', visual_range:0},
                {callsign:'ZMA_CTR',   facility:6, frequency:'132.450', visual_range:0}];
  poll(inP, ctrl, 2); poll(inP, ctrl, 2);
  const before = alerts();
  for(let i = 0; i < 10; i++) poll(i % 2 ? inP : outP, ctrl, 2);
  T('alternating APP/CTR coverage -> 0 alerts', alerts() - before === 0, (alerts()-before) + '');
}
console.log('\nA2 — "new controller online" fires on NETWORK change only, never on movement:');
{
  reset();
  const ctrl = [{callsign:'MIA_N_TWR', facility:4, frequency:'118.300', visual_range:0},
                {callsign:'MCO_E_DEP', facility:5, frequency:'124.800', visual_range:0}];
  const before = toasts.filter(t => t.type === 'newController').length;
  for(let i = 0; i <= 20; i++){
    const s = samples[Math.round(i/20*(samples.length-1))];
    poll({lat:s[0], lon:s[1], agl: (i===0||i===20)?0:20000, alt:20000, onGround: i===0||i===20}, ctrl, 3);
  }
  T('whole flight, fixed network -> 0 newController toasts', toasts.filter(t=>t.type==='newController').length - before === 0);
  poll(cruise, ctrl.concat([{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0}]), 4);
  T('a genuine sign-on -> exactly 1 toast', toasts.filter(t=>t.type==='newController').length - before === 1);
}
console.log('\nA3 — a genuine sign-off alerts INSTANTLY (no debounce):');
{
  reset();
  const ctr = [{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0}];
  poll(cruise, ctr, 5); poll(cruise, ctr, 5);
  const before = alerts();
  poll(cruise, [], 6);
  T('covering Center signs off -> alert on the FIRST poll', alerts() - before === 1, (alerts()-before) + '');
}
console.log('\nA3b — a genuine sign-on from UNICOM alerts INSTANTLY:');
{
  reset();
  poll(cruise, [], 7); poll(cruise, [], 7);
  const before = alerts();
  poll(cruise, [{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0}], 8);
  T('UNICOM -> Center comes online -> alert on the FIRST poll', alerts() - before === 1, (alerts()-before) + '');
}
console.log('\nA4 — controller-to-controller change holds 2 polls:');
{
  reset();
  const A = [{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0}];
  const B = [{callsign:'ZMA_2_CTR', facility:6, frequency:'133.775', visual_range:0}];
  poll(cruise, A, 9); poll(cruise, A, 9);
  const before = alerts();
  poll(cruise, B, 10);
  T('poll 1 of the change: no alert yet', alerts() - before === 0, (alerts()-before) + '');
  poll(cruise, B, 10);
  T('poll 2 of the change: exactly 1 alert', alerts() - before === 1, (alerts()-before) + '');
}
console.log('\nA6 — cold start must not storm:');
{
  reset();
  poll({lat:kmia.lat, lon:kmia.lon, agl:0, alt:0, onGround:true}, [{callsign:'MIA_N_TWR', facility:4, frequency:'118.300', visual_range:0}], 11);
  T('first poll of a session: no alert', alerts() === 0, alerts() + '');
  T('first poll of a session: no newController toast', toasts.filter(t=>t.type==='newController').length === 0);
}
console.log('\nA7 — handoff prompt fires once per upcoming controller:');
{
  reset();
  const ctrl = [{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0},
                {callsign:'MCO_E_DEP', facility:5, frequency:'124.800', visual_range:0}];
  for(let i = 0; i < samples.length - 5; i++){
    const s = samples[i];
    poll({lat:s[0], lon:s[1], agl:30000, alt:30000, onGround:false, gs:450}, ctrl, 12);
  }
  const n = toasts.filter(t=>t.type==='handoff').length;
  T('handoff toast fired', n >= 1, n + '');
  T('...exactly once for MCO_E_DEP (no repeats)', n === 1, n + ' toasts');
}
console.log('\nA8 — every toast type respects its toggle:');
{
  reset();
  const S0 = sb.getS();
  S0.cfg.vatsim = { enabled:true, cid:'', overlay:{enabled:true, freqChange:false, newController:false, handoff:false}, sound:{freqChange:false} };
  sb.setS(S0);
  const ctrl = [{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0}];
  poll(cruise, ctrl, 13); poll(cruise, ctrl, 13);
  T('sanity: state is actually flowing to the overlay', pushes.filter(p=>p.live).length > 0);
  poll(cruise, ctrl.concat([{callsign:'ZJX_CTR', facility:6, frequency:'127.850', visual_range:0}]), 14);
  T('newController OFF -> no toast on a real sign-on', toasts.filter(t=>t.type==='newController').length === 0);
  T('pop OFF -> every push carries pop:false', pushes.every(p => !p.live || p.pop === false));
  T('sound OFF -> every push carries sound:false', pushes.every(p => !p.live || p.sound === false));
  toasts = [];
  S0.cfg.vatsim.overlay = { enabled:false, newController:true, handoff:true, freqChange:true };
  sb.setS(S0);
  sb.LATC._lastCtrl = new Set(['ZMA_CTR']);
  poll(cruise, ctrl.concat([{callsign:'ZJX_CTR', facility:6, frequency:'127.850', visual_range:0}]), 15);
  T('overlay master OFF -> zero toasts', toasts.length === 0, toasts.length + '');
}
process.exit(T.done() ? 1 : 0);
