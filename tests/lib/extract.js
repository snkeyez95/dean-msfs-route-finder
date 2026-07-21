'use strict';
// Test sandbox: pulls the REAL Live-ATC / VATSIM code out of index.html and runs it in Node with
// the REAL airspace polygons + airport database. No mocks of our own logic — only the browser
// globals it expects.
//
// Paths are derived, not hardcoded, so this works from a clean clone on any machine.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');                     // the repo
const APP_DATA = path.join(process.env.APPDATA || '', 'A Better Route Planner');   // live user data
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function sliceBetween(startMarker, endMarker){
  const i = html.indexOf(startMarker); if(i < 0) throw new Error('start marker not found: ' + startMarker);
  const j = html.indexOf(endMarker, i); if(j < 0) throw new Error('end marker not found: ' + endMarker);
  return html.slice(i, j);
}
// Pull one top-level function out of index.html by brace matching.
function grab(name, src){
  const s = src || html;
  const i = s.indexOf('function ' + name + '(');
  if(i < 0) throw new Error('fn not found: ' + name);
  let d = 0, started = false;
  for(let j = i; j < s.length; j++){
    if(s[j] === '{'){ d++; started = true; }
    else if(s[j] === '}'){ d--; if(started && d === 0) return s.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

// Two contiguous regions of index.html carry the whole Live-ATC surface. Taking them as slices
// (rather than function-by-function) keeps the module-level consts + state in scope exactly as they
// are in the app — so a test can never pass against a reconstruction that differs from production.
const sliceA = sliceBetween('function gcDist(', 'async function latcEnsureDb(');   // consts, polygons, recommendFreq, sequence, next-up, route score
const sliceB = sliceBetween('function latcOverlayToast(', 'async function latcToggle(');  // toasts, handoff prompts, overlay push

const prelude = `
'use strict';
let window = { api: {} };
let document = { getElementById: () => null };
const RLOG = () => {};
const BLOCK_PAD_MIN = 15;
let S = { cfg: { vatsim: { cid: '' }, recentSimBriefRoutes: [] } };
let _vFeed = { controllers: [], atis: [], pilots: [], ts: 1 };
const renderLiveAtc = () => {}, updateVatsimHeader = () => {};
function latcWriteStandby(){}
`;

const epilogue = `
return {
  gcDist, gcSamples, recommendFreq, latcNextUp, latcEnrichedSequence, latcFreqStack,
  latcSeqForNow, latcStackForNow, latcCheckToasts, latcPushOverlay, latcCurrentRec,
  latcAutoTarget, latcAtisFreq, latcNextHandoff, latcCoveringCtrl, vatsimRouteScore,
  latcNextUpLabel, latcNextUpNote,
  airspaceCovers, traconCovers, vgCovers, _vgAt, _vgPosFor, latcAirportForCallsign,
  latcNearestAirport, latcBriefRoute, latcRenderBrief, vatsimAtisData, vatsimAtisAvail,
  latcTierLabel, latcTermRole, latcPosLabel, latcFmt, latcPlain, LATC, LATC_TIER, vCfg,
  setAirspace: a => { _airspace = a; }, getAirspace: () => _airspace,
  setFeed: f => { _vFeed = f; }, getFeed: () => _vFeed,
  setS: s => { S = s; }, getS: () => S,
  setApi: api => { window.api = api; }
};
`;

function buildSandbox(){
  const src = prelude + grab('esc') + '\n' + grab('vCfg') + '\n' + sliceA + '\n'
    + grab('vatsimAtisData') + '\n' + grab('vatsimAtisAvail') + '\n' + sliceB + '\n' + epilogue;
  return new Function(src)();
}

// Real data. These tests are deliberately coupled to the live cache/DB — synthetic polygons would
// prove nothing about the real world (the NY_CTR segment bug only existed against real VATSpy data).
function loadAirspace(){
  const raw = JSON.parse(fs.readFileSync(path.join(APP_DATA, 'airspace.json'), 'utf8'));
  const vg = raw.vg;
  return {
    boundaries: raw.boundaries, prefixMap: raw.prefixMap, tracons: raw.tracons || {},
    vg: (vg && vg.pos && vg.air && vg.air.length) ? vg : null
  };
}
function loadAirportDb(){
  const raw = JSON.parse(fs.readFileSync(path.join(APP_DATA, 'airport_db.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : (raw.airports || raw.list || []);
  const m = new Map();
  for(const a of list) m.set(a.icao, a);
  return m;
}
function haveRealData(){
  try { return fs.existsSync(path.join(APP_DATA, 'airspace.json')) && fs.existsSync(path.join(APP_DATA, 'airport_db.json')); }
  catch(_){ return false; }
}

// Tiny assertion helper shared by every suite.
function runner(title){
  let pass = 0, fail = 0;
  const T = (name, cond, extra) => {
    if(cond){ pass++; console.log('  ok   ' + name); }
    else { fail++; console.log('  FAIL ' + name + (extra ? ' — ' + extra : '')); }
  };
  T.done = () => { console.log('\n' + pass + ' passed, ' + fail + ' failed'); return fail; };
  T.counts = () => ({ pass, fail });
  if(title) console.log(title);
  return T;
}

module.exports = { buildSandbox, loadAirspace, loadAirportDb, haveRealData, grab, sliceBetween, runner, html, ROOT, APP_DATA };
