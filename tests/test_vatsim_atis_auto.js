'use strict';
// Auto-default to VATSIM ATIS (Dean 2026-07-17): when a controller is staffing a field's VATSIM
// ATIS, the card shows it automatically — no click. This locks in (a) the apply/revert flag
// management in the real functions, and (b) the decision predicate that fetchDatis uses inline.
const X = require('./lib/extract.js');
const T = X.runner('VATSIM ATIS auto-default:');

function grab(name){
  const html = X.html, i = html.indexOf('function ' + name + '(');
  if(i < 0) throw new Error('not found: ' + name);
  let d = 0, s = false;
  for(let j = i; j < html.length; j++){ if(html[j] === '{'){ d++; s = true; } else if(html[j] === '}'){ d--; if(s && d === 0) return html.slice(i, j + 1); } }
}

// ── the real applyVatsimAtis / revertVatsimAtis, with collaborators stubbed ──
let S = { datisCache:{}, _vatsimReverted:undefined };
let fetchCalls = [];
// The grabbed functions reference S / vatsimAtisData / fetchDatis as globals — inject them.
const mod = new Function(
  'S', 'vatsimAtisData', 'fetchDatis',
  grab('applyVatsimAtis') + grab('revertVatsimAtis') + '\nreturn { applyVatsimAtis, revertVatsimAtis };'
)(S, (icao) => ({ hasData:true, combined:{ text:'ATIS ' + icao } }), (...a) => fetchCalls.push(a));

// revert remembers the choice + clears the cache
mod.revertVatsimAtis('LEBL', 0, 'dep', '');
T('revert sets the session "reverted" flag', S._vatsimReverted && S._vatsimReverted.LEBL === true);
T('revert clears the cached ATIS', !S.datisCache.LEBL);
T('revert re-renders the card', fetchCalls.length === 1);

// apply clears the reverted flag + caches VATSIM
mod.applyVatsimAtis('LEBL', 0, 'dep', '');
T('apply clears the reverted flag (re-enables auto for the field)', !(S._vatsimReverted && S._vatsimReverted.LEBL));
T('apply caches a vatsim-flagged entry', !!(S.datisCache.LEBL && S.datisCache.LEBL.vatsim));

// apply is case-insensitive on the ICAO
S = Object.assign(S, { datisCache:{}, _vatsimReverted:{} });
mod.applyVatsimAtis('legg', 0, 'dep', '');   // lower-case
T('apply upper-cases the ICAO key', !!(S.datisCache.LEGG && S.datisCache.LEGG.vatsim));

// ── the decision predicate fetchDatis uses inline (mirrors the shipped condition) ──
// autoApply == autoAtis && weatherButton && !alreadyVatsim && !reverted && available
function decide({autoAtis, weatherButton, alreadyVatsim, reverted, available}){
  return !!(autoAtis && weatherButton && !alreadyVatsim && !reverted && available);
}
T('applies when enabled + staffed + fresh + not reverted', decide({autoAtis:true, weatherButton:true, alreadyVatsim:false, reverted:false, available:true}) === true);
T('does NOT apply when autoAtis is off', decide({autoAtis:false, weatherButton:true, alreadyVatsim:false, reverted:false, available:true}) === false);
T('does NOT apply when the VATSIM button feature is off', decide({autoAtis:true, weatherButton:false, alreadyVatsim:false, reverted:false, available:true}) === false);
T('does NOT re-apply when already showing VATSIM', decide({autoAtis:true, weatherButton:true, alreadyVatsim:true, reverted:false, available:true}) === false);
T('does NOT fight a manual revert', decide({autoAtis:true, weatherButton:true, alreadyVatsim:false, reverted:true, available:true}) === false);
T('does NOT apply when no controller is staffing the ATIS', decide({autoAtis:true, weatherButton:true, alreadyVatsim:false, reverted:false, available:false}) === false);

// ── the shipped condition string is actually present in fetchDatis ──
const fd = grab('fetchDatis');
T('fetchDatis gates auto-apply on autoAtis + weatherButton', /vCfg\(\)\.autoAtis && vCfg\(\)\.weatherButton/.test(fd));
T('fetchDatis skips when already vatsim or user-reverted', /!\(cur&&cur\.vatsim\) && !\(S\._vatsimReverted&&S\._vatsimReverted\[icao\]\)/.test(fd));
T('fetchDatis only auto-applies when vatsimAtisAvail is true', /if\(vatsimAtisAvail\(icao\)\)\{ const d=vatsimAtisData\(icao\)/.test(fd));
T('autoAtis defaults ON', /autoStartVpilot:false,autoAtis:true/.test(grab('vCfg')));

process.exit(T.done() ? 1 : 0);
