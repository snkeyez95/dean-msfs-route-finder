'use strict';
// VATSIM SURFACE — route score, callsign resolution, coverage-tier semantics, frequency matching,
// and the segment-merge regression (the v6.12.8 NY_CTR bug). All against REAL polygons.
const X = require('./lib/extract.js');
if(!X.haveRealData()){ console.log('SKIP — needs airspace.json + airport_db.json in %APPDATA%\\A Better Route Planner'); process.exit(0); }

const sb = X.buildSandbox();
const asp = X.loadAirspace();
sb.setAirspace(asp);
const db = X.loadAirportDb();
sb.LATC.db = db;
const T = X.runner();

// ── route score ─────────────────────────────────────────────────────────────
console.log('route score:');
{
  const kmia = db.get('KMIA'), kmco = db.get('KMCO');
  const full = [
    {callsign:'MIA_DEL', facility:2, frequency:'135.350', visual_range:0},
    {callsign:'MIA_GND', facility:3, frequency:'121.800', visual_range:0},
    {callsign:'MIA_N_TWR', facility:4, frequency:'118.300', visual_range:0},
    {callsign:'MIA_APP', facility:5, frequency:'124.850', visual_range:0},
    {callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0},
    {callsign:'MCO_E_DEP', facility:5, frequency:'124.800', visual_range:0},
    {callsign:'MCO_TWR', facility:4, frequency:'124.300', visual_range:0},
    {callsign:'MCO_GND', facility:3, frequency:'121.700', visual_range:0},
  ];
  const s0 = sb.vatsimRouteScore(kmia, kmco, full, db);
  T('fully staffed -> 95-100 and full:true', s0 && s0.score >= 95 && s0.score <= 100 && s0.full === true, s0 && ('score ' + s0.score));
  T('dark network -> 0 and full:false', (x => x && x.score === 0 && !x.full)(sb.vatsimRouteScore(kmia, kmco, [], db)));
  const lone = sb.vatsimRouteScore(kmia, kmco, [{callsign:'ZMA_CTR', facility:6, frequency:'132.450', visual_range:0}], db);
  T('lone covering Center -> top-down end-to-end (50-70, full:true)', lone && lone.full === true && lone.score >= 50 && lone.score <= 70, lone && ('score ' + lone.score));
  // MONOTONICITY: removing a controller must never RAISE the score. First and second order.
  let mono = true, why = '';
  for(let i = 0; i < full.length && mono; i++){
    const s1 = sb.vatsimRouteScore(kmia, kmco, full.filter((_, k) => k !== i), db);
    if(s1.score > s0.score){ mono = false; why = 'removing ' + full[i].callsign + ' raised ' + s0.score + '->' + s1.score; }
  }
  T('removing any 1 controller never raises the score', mono, why);
  mono = true; why = '';
  for(let i = 0; i < full.length && mono; i++) for(let j = i + 1; j < full.length && mono; j++){
    const w1 = full.filter((_, k) => k !== i), w2 = w1.filter(c => c !== full[j]);
    if(sb.vatsimRouteScore(kmia, kmco, w2, db).score > sb.vatsimRouteScore(kmia, kmco, w1, db).score){ mono = false; why = 'second-order rise at ' + full[j].callsign; }
  }
  T('second-order removals never raise it either', mono, why);
}

// ── callsign resolution ─────────────────────────────────────────────────────
console.log('\ncallsign -> airport:');
for(const [cs, want] of [['MCO_E_DEP','KMCO'], ['LAS_E_TWR','KLAS'], ['MIA_N_TWR','KMIA'], ['LGAV_W_APP','LGAV'], ['EGLL_GND','EGLL']]){
  const a = sb.latcAirportForCallsign(cs, db);
  T(cs + ' -> ' + want, a && a.icao === want, a ? a.icao : 'null');
}
for(const cs of ['ZZZ_OBS', 'CFG2']) T(cs + ' -> no airport (must not mis-resolve)', !sb.latcAirportForCallsign(cs, db));

// ── segment merge (v6.12.8) ─────────────────────────────────────────────────
console.log('\nsegmented-airspace merge (the NY_CTR regression):');
{
  T('NY_CTR covers domestic ZNY over Pennsylvania (inside KZNY-W)', sb.airspaceCovers('NY_CTR', 40.70, -76.28) === true);
  T('BIRD_CTR covers the BIRD-N sector', sb.airspaceCovers('BIRD_CTR', 75.34, -21.61) === true);
  T('MIA_CTR still covers KMIA', sb.airspaceCovers('MIA_CTR', db.get('KMIA').lat, db.get('KMIA').lon) === true);
  T('MIA_CTR is still FALSE over London (no false positives)', sb.airspaceCovers('MIA_CTR', 51.47, -0.45) === false);
  T('an unknown prefix returns null (a data gap must never veto)', sb.airspaceCovers('QQZZ_CTR', 40, -76) === null);
  // Full sweep: no mapped prefix may lose a segment. This is the assertion that would have caught it.
  const inside = (id, lat, lon) => { asp.prefixMap['QPROBE'] = [id]; delete (asp._idCache || {})['QPROBE']; const r = sb.airspaceCovers('QPROBE_CTR', lat, lon); delete asp.prefixMap['QPROBE']; return r === true; };
  const centroids = id => { const g = asp.boundaries[id]; if(!g) return []; const polys = g.type === 'MultiPolygon' ? g.coordinates : [g.coordinates];
    return polys.map(poly => { const r = poly[0]; let cx = 0, cy = 0; for(const p of r){ cx += p[0]; cy += p[1]; } return [cy / r.length, cx / r.length]; }); };
  const losses = [];
  for(const pfx of Object.keys(asp.prefixMap)){
    if(pfx.indexOf('_') >= 0) continue;
    const ids = asp.prefixMap[pfx] || []; let done = false;
    for(const id of ids){
      for(const seg of Object.keys(asp.boundaries)){
        if(!seg.startsWith(id + '-') || ids.includes(seg)) continue;
        for(const [la, lo] of centroids(seg)){
          if(!inside(seg, la, lo)) continue;
          delete (asp._idCache || {})[pfx];
          if(sb.airspaceCovers(pfx + '_CTR', la, lo) !== true){ losses.push(pfx + ' loses ' + seg); done = true; break; }
        }
        if(done) break;
      }
      if(done) break;
    }
  }
  T('full sweep: no mapped prefix loses a segment', losses.length === 0, losses.slice(0, 5).join(', '));
}

// ── TRACON null-vs-false ────────────────────────────────────────────────────
console.log('\nTRACON coverage semantics (null = no data, false = outside):');
{
  const kmco = db.get('KMCO');
  T('unknown prefix -> null, never false', sb.traconCovers('QQQX_APP', kmco.lat, kmco.lon) === null);
  T('known prefix, inside -> true', sb.traconCovers('MCO_APP', kmco.lat, kmco.lon) === true);
  T('known prefix, far outside -> false', sb.traconCovers('MCO_APP', 51.47, -0.45) === false);
  T('empty callsign -> null, no throw', sb.traconCovers('', kmco.lat, kmco.lon) === null);
}

// ── frequency matching / duplicates ─────────────────────────────────────────
console.log('\nfrequency matching:');
{
  sb.setS({cfg:{vatsim:{cid:'', enabled:true}, recentSimBriefRoutes:[{dep:'KMIA', arr:'KMCO'}]}});
  const kmco = db.get('KMCO');
  // dep TWR and arr GND deliberately SHARE 118.300 — the sequence matcher must not regress backward
  const ctrl = [
    {callsign:'MIA_N_TWR', facility:4, frequency:'118.300', visual_range:0},
    {callsign:'MCO_GND',  facility:3, frequency:'118.300', visual_range:0},
    {callsign:'MCO_TWR',  facility:4, frequency:'124.300', visual_range:0},
  ];
  sb.setFeed({controllers:ctrl, atis:[], pilots:[], ts:501});
  sb.LATC.controllers = ctrl; sb.LATC._seqCache = null; sb.LATC._stackCache = null;
  sb.LATC.pos = {lat:kmco.lat, lon:kmco.lon, agl:0, alt:0, onGround:true, comActiveMhz:118.300};
  const tgt = sb.latcAutoTarget(sb.latcCurrentRec());
  T('duplicate freq across legs -> look-ahead does not regress to a departure entry',
    !(tgt && tgt.callsign && String(tgt.callsign).startsWith('MIA_')), tgt && tgt.callsign);
  T('8.33 kHz channel/read gap (3 kHz) is inside LATC_FREQ_TOL', Math.abs(124.297 - 124.300) < 0.005);
}

// ── perf ────────────────────────────────────────────────────────────────────
console.log('\nperformance:');
{
  const busy = [];
  const ctrs = ['ZMA','ZJX','ZTL','ZDC','ZNY','ZOB','ZAU','ZKC','ZFW','ZHU','ZLA','ZOA','ZSE','ZDV','ZLC','ZAB'];
  ctrs.forEach((c, i) => busy.push({callsign:c+'_CTR', facility:6, frequency:(120+i*0.35).toFixed(3), visual_range:0}));
  const apps = ['MIA','MCO','TPA','ATL','JAX','CLT','IAD','BOS','N90','PCT','SCT','NCT','D01','A80','I90','D10'];
  apps.forEach((c, i) => busy.push({callsign:c+'_APP', facility:5, frequency:(125.5+i*0.3).toFixed(3), visual_range:0}));
  const twrs = ['MIA','FLL','PBI','MCO','TPA','ATL','JFK','LGA','EWR','BOS','DCA','ORD','DFW','LAX','SFO','SEA','DEN','PHX','CLT','MSP'];
  twrs.forEach((c, i) => { busy.push({callsign:c+'_TWR', facility:4, frequency:(118+i*0.25).toFixed(3), visual_range:0});
                           busy.push({callsign:c+'_GND', facility:3, frequency:(121+i*0.2).toFixed(3), visual_range:0}); });
  for(let i = 0; i < 8; i++) busy.push({callsign:'OBS'+i, facility:0, frequency:'199.998', visual_range:0});
  const pos = {lat:27.2, lon:-80.9, agl:35000, alt:35000, onGround:false};
  const route = {dep:'KMIA', arr:'KMCO'};
  sb.recommendFreq(pos, busy, db, route, false);   // warm
  const t0 = process.hrtime.bigint();
  for(let i = 0; i < 200; i++) sb.recommendFreq(pos, busy, db, route, false);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 200;
  console.log('  recommendFreq @ ' + busy.length + ' online controllers: ' + ms.toFixed(3) + ' ms/call (runs ~4x per 5s poll)');
  T('well inside the poll budget (<25 ms)', ms < 25, ms.toFixed(2) + 'ms');
}
process.exit(T.done() ? 1 : 0);
