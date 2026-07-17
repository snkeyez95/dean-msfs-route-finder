'use strict';
// EXHAUSTIVE ATC COMBINATION MATRIX — every combination of who is online, at every phase of flight,
// over REAL geometry, asserting INVARIANTS rather than hand-written expected answers.
//   16 dep-subsets x 8 arr-subsets x 4 enroute x 4 ATIS x 10 phases = 20,480 cells per route pair.
// Two pairs (US + Europe) => ~45,000 evaluations. Runs in ~5 seconds.
//
// This is the harness that proved the v6.12.8 tier bug. Invariants, not expectations, are the point:
// nobody can hand-write 45,000 right answers, but "never recommend an offline frequency" is checkable
// on every one of them.
const X = require('./lib/extract.js');

if(!X.haveRealData()){ console.log('SKIP — needs airspace.json + airport_db.json in %APPDATA%\\A Better Route Planner'); process.exit(0); }
const sb = X.buildSandbox();
sb.setAirspace(X.loadAirspace());
const db = X.loadAirportDb();

const ROUTES = [
  { dep:'KMIA', arr:'KMCO',   // US: whole route sits inside Miami Center (KZMA); Orlando TRACON = MCO/F11
    depPos: { DEL:{cs:'MIA_DEL',f:'135.350'}, GND:{cs:'MIA_GND',f:'121.800'}, TWR:{cs:'MIA_N_TWR',f:'118.300'}, APP:{cs:'MIA_APP',f:'124.850'} },
    arrPos: { APP:{cs:'MCO_E_DEP',f:'124.800'}, TWR:{cs:'MCO_TWR',f:'124.300'}, GND:{cs:'MCO_GND',f:'121.700'} },
    ctrCover:{cs:'ZMA_CTR',f:'132.450'}, ctrGap:{cs:'ZJX_CTR',f:'127.850'},
    atisDep:{cs:'KMIA_D_ATIS',f:'119.150'}, atisArr:{cs:'KMCO_A_ATIS',f:'121.250'} },
  { dep:'LGAV', arr:'LGKR',   // Europe: no field CTAF (122.800 UNICOM), different coverage data
    depPos: { DEL:{cs:'LGAV_DEL',f:'122.100'}, GND:{cs:'LGAV_GND',f:'121.755'}, TWR:{cs:'LGAV_TWR',f:'118.625'}, APP:{cs:'LGAV_APP',f:'132.975'} },
    arrPos: { APP:{cs:'LGKR_APP',f:'119.400'}, TWR:{cs:'LGKR_TWR',f:'120.850'}, GND:{cs:'LGKR_GND',f:'121.900'} },
    ctrCover:{cs:'LGGG_CTR',f:'129.675'}, ctrGap:{cs:'LMMM_CTR',f:'128.150'},
    atisDep:{cs:'LGAV_ATIS',f:'136.275'}, atisArr:{cs:'LGKR_ATIS',f:'126.000'} },
];
const FAC = { DEL:2, GND:3, TWR:4, APP:5, CTR:6 };
const TIERS_DEP = ['DEL','GND','TWR','APP'], TIERS_ARR = ['APP','TWR','GND'];
const ENR_MODES = ['none','cover','gap','two'], ATIS_MODES = ['none','dep','arr','both'];
const subsets = arr => { const out=[]; for(let m=0;m<(1<<arr.length);m++){ const s=[]; for(let i=0;i<arr.length;i++) if(m&(1<<i)) s.push(arr[i]); out.push(s);} return out; };

function phases(depA, arrA){
  const total = sb.gcDist(depA.lat, depA.lon, arrA.lat, arrA.lon);
  const line = sb.gcSamples(depA.lat, depA.lon, arrA.lat, arrA.lon, 1);
  const at = nm => { const f = Math.max(0, Math.min(1, nm/total)); const s = line[Math.round(f*(line.length-1))]; return {lat:s[0], lon:s[1]}; };
  const P = (name, p, agl, ground) => ({ name, lat:p.lat, lon:p.lon, agl, alt:agl, onGround:!!ground });
  return [
    P('ground-dep', {lat:depA.lat,lon:depA.lon}, 0, true),
    P('taxi',       {lat:depA.lat,lon:depA.lon}, 0, true),
    P('airborne-3', at(3),  1500, false),
    P('climb-8',    at(8),  6000, false),
    P('dep-25',     at(25), 20000, false),
    P('enroute',    at(total/2), 35000, false),
    P('descent',    at(total-40), 18000, false),
    P('arr-ring',   at(total-25), 10000, false),
    P('final-5',    at(total-5), 1500, false),
    P('ground-arr', {lat:arrA.lat,lon:arrA.lon}, 0, true),
  ];
}

const viol = {};
const V = (inv, cell, phase, detail) => { (viol[inv]=viol[inv]||[]).push({cell, phase, detail}); };
let cells = 0;

for(const R of ROUTES){
  const depA = db.get(R.dep), arrA = db.get(R.arr);
  const PH = phases(depA, arrA);
  sb.setS({ cfg: { vatsim:{cid:'', enabled:true}, recentSimBriefRoutes: [{dep:R.dep, arr:R.arr}] } });
  sb.LATC.db = db;

  for(const ds of subsets(TIERS_DEP)) for(const as of subsets(TIERS_ARR)) for(const em of ENR_MODES) for(const am of ATIS_MODES){
    const ctrl = [];
    for(const t of ds){ const p=R.depPos[t]; ctrl.push({callsign:p.cs, facility:FAC[t], frequency:p.f, visual_range:0}); }
    for(const t of as){ const p=R.arrPos[t]; ctrl.push({callsign:p.cs, facility:FAC[t], frequency:p.f, visual_range:0}); }
    if(em==='cover'||em==='two') ctrl.push({callsign:R.ctrCover.cs, facility:6, frequency:R.ctrCover.f, visual_range:0});
    if(em==='gap'||em==='two')   ctrl.push({callsign:R.ctrGap.cs,   facility:6, frequency:R.ctrGap.f,   visual_range:0});
    // Observer + placeholder noise in EVERY cell — Dean flies as an observer, so this must always be ignored.
    ctrl.push({callsign:'CFG2', facility:0, frequency:'199.998', visual_range:0});
    ctrl.push({callsign:'ZZZ_OBS', facility:6, frequency:'199.998', visual_range:0});
    const atis = [];
    if(am==='dep'||am==='both') atis.push({callsign:R.atisDep.cs, frequency:R.atisDep.f, atis_code:'K', text_atis:['TEST']});
    if(am==='arr'||am==='both') atis.push({callsign:R.atisArr.cs, frequency:R.atisArr.f, atis_code:'B', text_atis:['TEST']});
    sb.setFeed({controllers:ctrl, atis, pilots:[], ts:++cells});
    sb.LATC.controllers = ctrl;

    const onlineCs = new Set(ctrl.filter(c=>c.facility!==0&&c.frequency!=='199.998').map(c=>c.callsign));
    const onlineFreqs = new Set(ctrl.filter(c=>c.facility!==0&&c.frequency!=='199.998').map(c=>parseFloat(c.frequency)));
    const seq = sb.latcEnrichedSequence(depA, arrA, ctrl, db);
    const seqIdxOf = rec => seq.findIndex(x => (rec.callsign && x.callsign===rec.callsign) || (!rec.callsign && !x.callsign && x.freq!=null && Math.abs(x.freq-rec.freq)<0.005));
    const cellId = R.dep+'>'+R.arr+' dep['+ds.join(',')+'] arr['+as.join(',')+'] enr:'+em+' atis:'+am;
    let lastIdx = -1;

    for(const p of PH){
      cells++;
      let rec, rec2, nx;
      const pos = {lat:p.lat, lon:p.lon, agl:p.agl, alt:p.alt, onGround:p.onGround};
      try{
        rec  = sb.recommendFreq(pos, ctrl, db, {dep:R.dep, arr:R.arr}, false);
        rec2 = sb.recommendFreq(pos, ctrl, db, {dep:R.dep, arr:R.arr}, false);
        const snap = JSON.stringify(seq);
        nx = sb.latcNextUp(rec, seq);
        if(JSON.stringify(seq)!==snap) V('I9-mutation', cellId, p.name, 'latcNextUp mutated the cached sequence');
      }catch(e){ V('I10-throw', cellId, p.name, String(e && e.message || e)); continue; }

      // I9 — determinism
      if(JSON.stringify(rec)!==JSON.stringify(rec2)) V('I9-determinism', cellId, p.name, 'identical inputs produced different output');
      // I3 — found <=> a real controller
      if(rec.found !== !!rec.callsign) V('I3', cellId, p.name, 'found='+rec.found+' callsign='+rec.callsign);
      if(!rec.found && rec.tier!=='UNICOM' && rec.tier!=='CTAF') V('I3', cellId, p.name, 'unfound but tier '+rec.tier);
      // I1 — never an offline frequency
      if(rec.found){
        if(!onlineCs.has(rec.callsign)) V('I1', cellId, p.name, 'offline callsign '+rec.callsign);
        if(!onlineFreqs.has(rec.freq)) V('I1', cellId, p.name, 'offline freq '+rec.freq);
      } else if(!(Math.abs(rec.freq-122.8)<0.001 || rec.tier==='CTAF')){
        V('I1', cellId, p.name, 'unfound freq '+rec.freq+' tier '+rec.tier);
      }
      // I2 — genuinely covered => never UNICOM/CTAF (ground truth from the polygons themselves)
      if(!rec.found){
        let covered = null;
        for(const c of ctrl){
          if(c.facility===0||c.frequency==='199.998') continue;
          if(c.facility===6 && sb.airspaceCovers(c.callsign,p.lat,p.lon)===true){ covered=c.callsign; break; }
          if(c.facility===5 && sb.traconCovers(c.callsign,p.lat,p.lon)===true){ covered=c.callsign; break; }
        }
        if(covered) V('I2', cellId, p.name, covered+' covers this point but rec='+rec.tier);
      }
      // I6 — CTAF only in the divisions that run it (US K/P, Australia Y); elsewhere it's UNICOM
      if(rec.tier==='CTAF' && !(rec.apt && /^[KPY]/.test(rec.apt.icao))) V('I6', cellId, p.name, 'CTAF at '+(rec.apt&&rec.apt.icao));
      if(R.dep==='LGAV' && rec.tier==='CTAF') V('I6', cellId, p.name, 'CTAF tier in Greece (should be UNICOM)');
      // I7 — no departure-field tier past the departure ring
      const depFieldCs = new Set(['DEL','GND','TWR'].map(t=>R.depPos[t].cs));
      if(['dep-25','enroute','descent','arr-ring','final-5','ground-arr'].includes(p.name) && rec.found && depFieldCs.has(rec.callsign))
        V('I7', cellId, p.name, 'departure-field '+rec.callsign+' still recommended');
      // I4/I5 — next-up sanity
      if(nx){
        if(rec.callsign && nx.callsign===rec.callsign && Math.abs((nx.freq||0)-rec.freq)<0.001) V('I4', cellId, p.name, 'self-loop');
        const ok = (nx.callsign && (onlineCs.has(nx.callsign) || atis.some(a=>a.callsign===nx.callsign)))
                || (!nx.callsign && (nx.tier==='CTAF'||nx.tier==='UNICOM'));
        if(!ok) V('I4', cellId, p.name, 'next-up not online: '+JSON.stringify({cs:nx.callsign,tier:nx.tier}));
      }
      if(rec.tier==='UNICOM' && as.length && nx && nx.tier==='CTAF') V('I5', cellId, p.name, 'CTAF next-up while arrival ATC is staffed');
      // I8 — monotonic progression through the sequence
      const idx = rec.found ? seqIdxOf(rec) : -1;
      if(idx>=0){ if(idx < lastIdx) V('I8', cellId, p.name, 'sequence went backward '+lastIdx+' -> '+idx); lastIdx = idx; }
    }
  }
}

// I10 — edge battery: none of these may throw
const edges = [];
const E = (name, fn) => { try{ fn(); edges.push('ok   ' + name); }catch(e){ edges.push('THROW ' + name + ': ' + (e&&e.message||e)); V('I10-throw','edges',name,String(e&&e.message||e)); } };
const kmia = db.get('KMIA');
const g = {lat:kmia.lat, lon:kmia.lon, agl:0, alt:0, onGround:true};
E('empty feed', ()=>sb.recommendFreq(g, [], db, {dep:'KMIA',arr:'KMCO'}, false));
E('null controllers', ()=>sb.recommendFreq(g, null, db, {dep:'KMIA',arr:'KMCO'}, false));
E('no route', ()=>sb.recommendFreq(g, [], db, null, false));
E('missing airport', ()=>sb.recommendFreq(g, [], db, {dep:'XXXX',arr:'YYYY'}, false));
E('dep===arr (pattern work)', ()=>sb.recommendFreq({lat:kmia.lat,lon:kmia.lon,agl:1200,onGround:false}, [{callsign:'MIA_TWR',facility:4,frequency:'118.300',visual_range:0}], db, {dep:'KMIA',arr:'KMIA'}, false));
E('null agl/onGround', ()=>sb.recommendFreq({lat:kmia.lat,lon:kmia.lon,agl:null,onGround:null}, [{callsign:'ZMA_CTR',facility:6,frequency:'132.450',visual_range:0}], db, {dep:'KMIA',arr:'KMCO'}, false));
E('observer-only feed', ()=>sb.recommendFreq(g, [{callsign:'CFG2',facility:0,frequency:'199.998',visual_range:0}], db, {dep:'KMIA',arr:'KMCO'}, false));
E('no polygons loaded', ()=>{ const s=sb.getAirspace(); sb.setAirspace(null); try{ sb.recommendFreq(g, [{callsign:'ZMA_CTR',facility:6,frequency:'132.450',visual_range:0}], db, {dep:'KMIA',arr:'KMCO'}, false); } finally { sb.setAirspace(s); } });
E('nextUp(null seq)', ()=>sb.latcNextUp({tier:'UNICOM',freq:122.8,callsign:null,found:false}, null));
E('nextUp(null rec)', ()=>sb.latcNextUp(null, []));
E('enrichedSequence(null apts)', ()=>sb.latcEnrichedSequence(null, null, [], db));

console.log('cells evaluated: ' + cells);
const keys = Object.keys(viol).sort();
if(!keys.length) console.log('ALL INVARIANTS PASS');
for(const k of keys){
  console.log('\n== ' + k + ' — ' + viol[k].length + ' violation(s) ==');
  const seen = new Set(); let shown = 0;
  for(const v of viol[k]){
    const sig = v.detail.replace(/[\d.]+/g,'#') + v.phase;
    if(seen.has(sig)) continue; seen.add(sig);
    console.log('  [' + v.cell + ' @ ' + v.phase + '] ' + v.detail);
    if(++shown >= 6) break;
  }
}
console.log('\nedge battery:'); for(const e of edges) console.log('  ' + e);
const failed = keys.length > 0;
console.log('\n' + (failed ? 'MATRIX FAILED' : 'matrix clean') + ' — ' + cells + ' cells, ' + keys.length + ' invariant(s) violated');
process.exit(failed ? 1 : 0);
