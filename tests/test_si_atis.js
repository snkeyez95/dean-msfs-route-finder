'use strict';
// SI ATIS source for Plan a Flight (v6.20.0): Dean flies SayIntentions, so the active-runway/ATIS
// overlay can come from SI's WX API instead of a VATSIM controller. This locks in (a) the source
// resolver, (b) the getWX→D-ATIS-shape mapping (active runway made extractable for BOTH sides,
// letter/time parsed from the atis text), (c) apply/revert flag+cache management, and (d) the exact
// wiring/labels shipped inside fetchDatis. Mirrors tests/test_vatsim_atis_auto.js.
const X = require('./lib/extract.js');
const T = X.runner('SI ATIS source:');

function grab(name){
  const html = X.html, i = html.indexOf('function ' + name + '(');
  if(i < 0) throw new Error('not found: ' + name);
  let d = 0, s = false;
  for(let j = i; j < html.length; j++){ if(html[j] === '{'){ d++; s = true; } else if(html[j] === '}'){ d--; if(s && d === 0) return html.slice(i, j + 1); } }
}

// ── the REAL SI functions, with S + fetchDatis injected ──
let fetchCalls = [];
let S = { cfg:{ vatsim:{}, siApiKey:'' }, siWxCache:{}, datisCache:{}, _siReverted:undefined };
const mod = new Function('S', 'fetchDatis',
  grab('vCfg') + grab('atisSourceResolved') + grab('siAtisData') + grab('siAtisAvail') +
  grab('applySiAtis') + grab('revertSiAtis') +
  '\nreturn { vCfg, atisSourceResolved, siAtisData, siAtisAvail, applySiAtis, revertSiAtis };'
)(S, (...a) => fetchCalls.push(a));

// ── (a) source resolver: SI only when a key exists; an explicit choice always wins (rule #3) ──
S.cfg.siApiKey = ''; S.cfg.vatsim.atisSource = '';
T('no key → defaults to VATSIM', mod.atisSourceResolved() === 'vatsim');
S.cfg.siApiKey = 'ABC123'; S.cfg.vatsim.atisSource = '';
T('key present → defaults to SI', mod.atisSourceResolved() === 'si');
S.cfg.vatsim.atisSource = 'vatsim';
T('explicit VATSIM wins even with a key', mod.atisSourceResolved() === 'vatsim');
S.cfg.vatsim.atisSource = 'si';
T('explicit SI wins', mod.atisSourceResolved() === 'si');

// ── (b) getWX → D-ATIS shape mapping ──
S.siWxCache.KJFK = { data:{ airport:'KJFK',
  atis:'JFK Airport Information Alpha. 1451Z. Arriving and departing runway 04L. Altimeter 3014.',
  active_runway:'04L' }, ts: Date.now() };
const d = mod.siAtisData('KJFK');
T('siAtisData returns a hasData object', !!(d && d.hasData));
T('flagged si:true', d.si === true);
T('active_runway captured on siRwy', d.siRwy === '04L');
T('runway made extractable for BOTH sides (DEP+ARR cue prepended)', /DEP RWY 04L\. ARR RWY 04L\./.test(d.combined.text));
T('real ATIS text preserved for bullets/approach', /Information Alpha/.test(d.combined.text));
T('info letter parsed from the ATIS text', d.combined.letter === 'A');
T('zulu time parsed from the ATIS text', d.combined.time === '1451Z');
T('arr and dep both point at the combined block', d.arr === d.combined && d.dep === d.combined);

// active_runway present but no atis text → still usable (cue carries the runway)
S.siWxCache.EGLL = { data:{ airport:'EGLL', atis:'', active_runway:'27R' }, ts: Date.now() };
const d2 = mod.siAtisData('EGLL');
T('runway-only entry still yields a usable ATIS', !!(d2 && d2.hasData) && /DEP RWY 27R\./.test(d2.combined.text));

// empty / missing → null (so fetchDatis falls through to real-world D-ATIS)
T('no cache → null', mod.siAtisData('ZZZZ') === null);
T('siAtisAvail false when SI has nothing', mod.siAtisAvail('ZZZZ') === false);
S.siWxCache.KEMPTY = { data:{ airport:'KEMPTY', atis:'', active_runway:'' }, ts: Date.now() };
T('empty atis + empty runway → null', mod.siAtisData('KEMPTY') === null);

// ── (c) apply / revert flag + cache management (mirror the VATSIM trio) ──
S.datisCache = {}; S._siReverted = undefined; fetchCalls = [];
mod.revertSiAtis('KJFK', 0, 'arr', '');
T('revert sets the session reverted flag', !!(S._siReverted && S._siReverted.KJFK === true));
T('revert clears the cached ATIS', !S.datisCache.KJFK);
T('revert re-renders the card', fetchCalls.length === 1);
mod.applySiAtis('KJFK', 0, 'arr', '');
T('apply clears the reverted flag', !(S._siReverted && S._siReverted.KJFK));
T('apply caches an si-flagged entry', !!(S.datisCache.KJFK && S.datisCache.KJFK.si));
S.datisCache = {}; S._siReverted = {};
mod.applySiAtis('kjfk', 0, 'arr', '');   // lower-case
T('apply upper-cases the ICAO key', !!(S.datisCache.KJFK && S.datisCache.KJFK.si));

// ── (d) the shipped wiring/labels inside fetchDatis + neighbours ──
const fd = grab('fetchDatis');
T('fetchDatis resolves the source', /_atisSrc\s*=\s*atisSourceResolved\(\)/.test(fd));
T('fetchDatis has an SI auto-apply branch gated on a key', /_atisSrc==='si' && \(S\.cfg\.siApiKey\|\|''\)\.trim\(\)/.test(fd));
T('fetchDatis auto-applies SI only when siAtisAvail', /if\(siAtisAvail\(icao\)\)\{ const d=siAtisData\(icao\)/.test(fd));
T('fetchDatis renders the SI button in SI mode', /if\(_atisSrc==='si'\) renderSiAtisBtn/.test(fd));
T('fetchDatis keeps the VATSIM path for vatsim mode', /else if\(_atisSrc==='vatsim'\)/.test(fd));
T('SI ATIS skips the stale-wind cross-check (isLive)', /const isSi=!!\(data&&data\.si\)/.test(fd) && /const isLive=isVatsim\|\|isSi/.test(fd));
T('cached SI entry skips the 5-min expiry', /cached\.vatsim\|\|cached\.si\|\|/.test(fd));
T('render labels the badge "SI ATIS"', /isSi\?'SI ATIS'/.test(fd));

T('vCfg default carries atisSource', /autoAtis:true,atisSource:''/.test(grab('vCfg')));
T('siWxFetch caches with a 10-min TTL and needs a key', /600000/.test(grab('siWxFetch')) && /S\.cfg\.siApiKey/.test(grab('siWxFetch')));

process.exit(T.done() ? 1 : 0);
