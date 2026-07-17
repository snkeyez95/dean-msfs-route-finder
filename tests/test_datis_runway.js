'use strict';
// D-ATIS / VATSIM-ATIS runway extraction (index.html extractRunways + normAtisRwyWords).
// Locks in the parse fixes so a real ATIS wording can't silently fall back to a wind estimate.
// Pure functions; no real data needed.
const path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('D-ATIS runway extraction:');

// Slice the real functions out of index.html and run them with a controlled runway list.
function grab(name){
  const html = X.html, i = html.indexOf('function ' + name + '(');
  if(i < 0) throw new Error('not found: ' + name);
  let d = 0, s = false;
  for(let j = i; j < html.length; j++){ if(html[j] === '{'){ d++; s = true; } else if(html[j] === '}'){ d--; if(s && d === 0) return html.slice(i, j + 1); } }
}
const RWY_HDGS = {
  LEBL: [{r:'24L',h:238},{r:'24R',h:238},{r:'06L',h:58},{r:'06R',h:58},{r:'02',h:19},{r:'20',h:199}],
  KMIA: [{r:'8L',h:87},{r:'8R',h:87},{r:'9',h:92},{r:'12',h:122},{r:'26L',h:267},{r:'26R',h:267},{r:'27',h:272},{r:'30',h:302}],
  KBOS: [{r:'4L',h:41},{r:'4R',h:41},{r:'33L',h:331},{r:'33R',h:331},{r:'22L',h:221},{r:'22R',h:221},{r:'9',h:91},{r:'27',h:271}],
};
const sb = new Function('RWY_HDGS', 'S',
  grab('normAtisRwyWords') + grab('normRwy') + grab('sameRwy') + grab('getRunways') +
  grab('datisValidRwy') + grab('extractRunways') +
  '\nreturn { extractRunways, normAtisRwyWords };')(RWY_HDGS, { rwyCache:{} });
const ex = (t, icao, dir) => JSON.stringify(sb.extractRunways(t, icao, dir));

// ── the LEBL bug (Dean 2026-07-17): spelled-out side + VIS-visibility phantom cue ──
const lebl = 'THIS IS LEBL ATIS INFORMATION C. AT TIME 1500Z. RWY IN USE FOR DEPARTURES 24 LEFT.. ' +
  'AFTER DEPARTURE CONTACT NEXT AVAILABLE ATC BEFORE PASSING 2000FT. . 20010KT 160V240 VIS 10KM ' +
  'FEW030 30/25 QNH 1014HPA NOSIG. TRANSITION LEVEL 70.';
T('LEBL "DEPARTURES 24 LEFT" -> ["24L"] (was [] -> est. wind)', ex(lebl, 'LEBL', 'dep') === '["24L"]', ex(lebl, 'LEBL', 'dep'));
T('LEBL states no arrival runway -> []', ex(lebl, 'LEBL', 'arr') === '[]', ex(lebl, 'LEBL', 'arr'));

// ── spelled-out LEFT / RIGHT / CENTER / CENTRE ──
T('"ARRIVALS 06 RIGHT" -> ["06R"]', ex('ARRIVALS 06 RIGHT', 'LEBL', 'arr') === '["06R"]', ex('ARRIVALS 06 RIGHT', 'LEBL', 'arr'));
T('normAtisRwyWords maps LEFT/RIGHT/CENTER/CENTRE',
  sb.normAtisRwyWords('24 LEFT 06 RIGHT 33 CENTER 09 CENTRE') === '24L 06R 33C 09C',
  sb.normAtisRwyWords('24 LEFT 06 RIGHT 33 CENTER 09 CENTRE'));

// ── mixed arr/dep in one sentence ──
T('"ARRIVALS 24 LEFT AND DEPARTURES 24 RIGHT" -> dep ["24R"]', ex('ARRIVALS 24 LEFT AND DEPARTURES 24 RIGHT', 'LEBL', 'dep') === '["24R"]');
T('...and arr ["24L"]', ex('ARRIVALS 24 LEFT AND DEPARTURES 24 RIGHT', 'LEBL', 'arr') === '["24L"]');

// ── regressions: abbreviated forms must still work ──
T('plural "DEPG RWYS 8L, 8R" (KMIA) -> ["8L","8R"]', ex('DEPG RWYS 8L, 8R', 'KMIA', 'dep') === '["8L","8R"]', ex('DEPG RWYS 8L, 8R', 'KMIA', 'dep'));
T('compact "LDG RWY25R" normalises to "RWY 25R"', sb.normAtisRwyWords('LDG RWY25R').includes('RWY 25R'));
T('single-digit US runway "DEPARTURES 9" -> ["9"]', ex('DEPARTURES RWY 9', 'KMIA', 'dep') === '["9"]', ex('DEPARTURES RWY 9', 'KMIA', 'dep'));
T('turn-off exclusion still holds: "RWY 33R APPROVED FOR TURN OFF"', ex('DEPARTURES 22R. RWY 33R IS APPROVED FOR TURN OFF AFTER LDG', 'KBOS', 'dep') === '["22R"]', ex('DEPARTURES 22R. RWY 33R IS APPROVED FOR TURN OFF AFTER LDG', 'KBOS', 'dep'));

// ── VIS-visibility must not create a phantom arrival cue ──
T('"VIS 10KM" (visibility) does NOT count as a visual-approach arrival cue',
  ex('DEPARTURES 24 LEFT. WIND 200 VIS 10KM', 'LEBL', 'dep') === '["24L"]', ex('DEPARTURES 24 LEFT. WIND 200 VIS 10KM', 'LEBL', 'dep'));
T('"VIS APCH" IS still a visual-approach cue', ex('ARRIVALS EXPECT VIS APCH 24 LEFT', 'LEBL', 'arr') === '["24L"]', ex('ARRIVALS EXPECT VIS APCH 24 LEFT', 'LEBL', 'arr'));

// ── spelled-out normalise must not corrupt non-runway numbers ──
T('"PASSING 2000FT" is not mangled into a runway', !sb.normAtisRwyWords('BEFORE PASSING 2000FT').includes('200L'));
T('"TRANSITION LEVEL 70" leaves no runway', ex('DEPARTURES 24 LEFT. TRANSITION LEVEL 70', 'LEBL', 'dep') === '["24L"]');

process.exit(T.done() ? 1 : 0);
