'use strict';
// v6.12.8 — the four audit fixes, locked in so they can't silently regress:
//   1 boundary-graze alert storm gated on a real network change  (see also test_alerts.js A1)
//   2 airspaceCovers merges '-SUFFIX' segments for MAPPED prefixes (NY_CTR over Pennsylvania)
//   3 honest tier (UNICOM vs CTAF) + next-up from a dark departure field ("Later: ...")
//   4 toast-created overlay self-closes when Live mode is off (main.js, static check)
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
if(!X.haveRealData()){ console.log('SKIP — needs airspace.json + airport_db.json in %APPDATA%\\A Better Route Planner'); process.exit(0); }

const sb = X.buildSandbox();
sb.setAirspace(X.loadAirspace());
const db = X.loadAirportDb();
sb.LATC.db = db;
const T = X.runner();

console.log('#3 — tier honesty + next-up from a dark field:');
{
  const kmia = db.get('KMIA'), kmco = db.get('KMCO'), lgav = db.get('LGAV'), lgkr = db.get('LGKR');
  sb.setS({cfg:{vatsim:{cid:'', enabled:true}, recentSimBriefRoutes:[{dep:'LGAV', arr:'LGKR'}]}});
  sb.setFeed({controllers:[], atis:[], pilots:[], ts:801}); sb.LATC.controllers = [];
  const rEU = sb.recommendFreq({lat:lgav.lat, lon:lgav.lon, agl:0, onGround:true}, [], db, {dep:'LGAV', arr:'LGKR'}, false);
  T('dark European field -> tier UNICOM (not the CTAF lie), 122.800', rEU.tier === 'UNICOM' && Math.abs(rEU.freq - 122.8) < 0.001 && rEU.label === 'UNICOM', JSON.stringify({t:rEU.tier, f:rEU.freq}));

  sb.setS({cfg:{vatsim:{cid:'', enabled:true}, recentSimBriefRoutes:[{dep:'KMIA', arr:'KMCO'}]}});
  const rUS = sb.recommendFreq({lat:kmia.lat, lon:kmia.lon, agl:0, onGround:true}, [], db, {dep:'KMIA', arr:'KMCO'}, false);
  T('dark US field -> tier CTAF (a real field CTAF)', rUS.tier === 'CTAF' && Math.abs(rUS.freq - 118.3) < 0.001);

  // Dean's exact miss: dark KMIA gate, KMCO staffed -> must offer the arrival's ATC as "Later"
  const ctrl = [{callsign:'MCO_E_DEP', facility:5, frequency:'124.800', visual_range:0},
                {callsign:'MCO_TWR', facility:4, frequency:'124.300', visual_range:0}];
  sb.setFeed({controllers:ctrl, atis:[], pilots:[], ts:802}); sb.LATC.controllers = ctrl;
  const rec = sb.recommendFreq({lat:kmia.lat, lon:kmia.lon, agl:0, onGround:true}, ctrl, db, {dep:'KMIA', arr:'KMCO'}, false);
  const nx = sb.latcNextUp(rec, sb.latcEnrichedSequence(kmia, kmco, ctrl, db));
  T('dark dep gate + staffed arrival -> next-up = MCO_E_DEP (was silent)', !!(nx && nx.callsign === 'MCO_E_DEP'), JSON.stringify(nx));
  T('...flagged downroute so the UI says "Later", not "Next up"', !!(nx && nx.downroute === true));
  T('...and labelled "Later"', sb.latcNextUpLabel(nx) === 'Later');
  T('...noEnr flags that nothing is staffed enroute', !!(nx && nx.noEnr === true));

  sb.setS({cfg:{vatsim:{cid:'', enabled:true}, recentSimBriefRoutes:[{dep:'LGAV', arr:'LGKR'}]}});
  const c2 = [{callsign:'LGKR_TWR', facility:4, frequency:'120.850', visual_range:0}];
  sb.setFeed({controllers:c2, atis:[], pilots:[], ts:803}); sb.LATC.controllers = c2;
  const r2 = sb.recommendFreq({lat:lgav.lat, lon:lgav.lon, agl:0, onGround:true}, c2, db, {dep:'LGAV', arr:'LGKR'}, false);
  const n2 = sb.latcNextUp(r2, sb.latcEnrichedSequence(lgav, lgkr, c2, db));
  T('same from a dark European gate -> Later: LGKR_TWR', !!(n2 && n2.callsign === 'LGKR_TWR' && n2.downroute === true), JSON.stringify(n2));

  sb.setS({cfg:{vatsim:{cid:'', enabled:true}, recentSimBriefRoutes:[{dep:'KMIA', arr:'KMCO'}]}});
  sb.setFeed({controllers:[], atis:[], pilots:[], ts:804}); sb.LATC.controllers = [];
  const rArr = sb.recommendFreq({lat:kmco.lat, lon:kmco.lon, agl:0, onGround:true}, [], db, {dep:'KMIA', arr:'KMCO'}, false);
  const nArr = sb.latcNextUp(rArr, sb.latcEnrichedSequence(kmia, kmco, [], db));
  T('on the dark arrival CTAF -> no self-loop back to the same freq', !(nArr && Math.abs((nArr.freq || 0) - rArr.freq) < 0.005), JSON.stringify(nArr));

  const mid = sb.gcSamples(kmia.lat, kmia.lon, kmco.lat, kmco.lon, 1)[80];
  const rEnr = sb.recommendFreq({lat:mid[0], lon:mid[1], agl:35000, onGround:false}, [], db, {dep:'KMIA', arr:'KMCO'}, false);
  const nEnr = sb.latcNextUp(rEnr, sb.latcEnrichedSequence(kmia, kmco, [], db));
  T('enroute UNICOM + dark network -> the CTAF planning aid still fires (v6.12.7 kept)',
    !!(nEnr && nEnr.tier === 'CTAF' && Math.abs(nEnr.freq - 118.45) < 0.001 && nEnr.downroute === false), JSON.stringify(nEnr));
}

console.log('\n#4 — a toast with Live mode OFF must not strand the overlay (main.js):');
{
  const main = fs.readFileSync(path.join(X.ROOT, 'main.js'), 'utf8');
  T('ownership flag exists', /let _overlayWanted=false, _overlayTempTimer=null;/.test(main));
  T('overlay-show claims ownership + cancels any pending teardown', /_overlayWanted=true; clearTimeout\(_overlayTempTimer\);/.test(main));
  T('overlay-toast arms a self-close ONLY when unowned', /if\(!_overlayWanted\)\{/.test(main));
  T('teardown re-checks ownership + destruction before closing', /if\(!_overlayWanted && overlayWin && !overlayWin\.isDestroyed\(\)\)\{ overlayWin\.close\(\); overlayWin=null; \}/.test(main));
  T('overlay-hide releases ownership', /ipcMain\.handle\('overlay-hide', \(\) => \{ _overlayWanted=false; clearTimeout\(_overlayTempTimer\);/.test(main));
}

console.log('\n(#1 graze storm + #2 segment merge are covered by test_alerts.js A1 and test_vatsim_surface.js)');
process.exit(T.done() ? 1 : 0);
