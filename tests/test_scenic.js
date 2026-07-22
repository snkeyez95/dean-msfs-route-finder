'use strict';
// v6.15.0 — Scenic Approaches mode: wind-gate math + CH_SCENIC data integrity (Dean 2026-07-22).
// Pulls the REAL parseWind / scenicTailwind / scenicFavor out of index.html and the CH_SCENIC array.
const X = require('./lib/extract.js');
const T = X.runner('scenic wind gate + data:');

// Build a sandbox with the real wind primitives + the scenic gate fns, over a stubbed S.metarCache.
const src =
  'const TAILWIND_MAX_KT=5; const S={metarCache:{}, chMode:"scenic"};\n' +
  X.grab('parseWind') + '\n' + X.grab('scenicTailwind') + '\n' + X.grab('scenicFavor') + '\n' +
  'return {S, parseWind, scenicTailwind, scenicFavor};';
const sb = new Function(src)();

const metar = (raw) => ({ rawOb: raw });
function favor(icao, rwy, h, raw){
  sb.S.metarCache = {}; if(raw!==null) sb.S.metarCache[icao] = metar(raw);
  return sb.scenicFavor({ icao, rwy, h });
}

// ── tailwind math ────────────────────────────────────────────────────────────
console.log('tailwind component:');
T('wind straight down the runway = full headwind (negative tailwind)',
  sb.scenicTailwind({h:344}, {dir:'344', spd:10}) === -10);
T('wind straight behind = full tailwind (+10)',
  sb.scenicTailwind({h:344}, {dir:'164', spd:10}) === 10);
T('90° crosswind = ~0 tailwind',
  Math.abs(sb.scenicTailwind({h:90}, {dir:'180', spd:15})) <= 1);
T('VRB → null (cannot judge)', sb.scenicTailwind({h:90}, {dir:'VRB', spd:10}) === null);

// ── favourability gate ───────────────────────────────────────────────────────
console.log('\nfavourability (Corfu RWY 34, h=344):');
{
  T('headwind 340@10 → fav', favor('LGKR','34',344,'LGKR 121200Z 34010KT CAVOK 20/10 Q1015').state === 'fav');
  T('opposing 160@10 (10kt tailwind) → unfav', favor('LGKR','34',344,'LGKR 121200Z 16010KT CAVOK 20/10 Q1015').state === 'unfav');
  T('light 160@04 (4kt tailwind ≤5) → fav', favor('LGKR','34',344,'LGKR 121200Z 16004KT CAVOK 20/10 Q1015').state === 'fav');
  T('160@06 (6kt tailwind >5) → unfav', favor('LGKR','34',344,'LGKR 121200Z 16006KT 9999 20/10 Q1015').state === 'unfav');
  T('calm 00000KT → fav (calm favours any runway)', favor('LGKR','34',344,'LGKR 121200Z 00000KT CAVOK 20/10 Q1015').state === 'fav');
  T('light <3kt 34002KT → fav', favor('LGKR','34',344,'LGKR 121200Z 34002KT CAVOK 20/10 Q1015').state === 'fav');
  T('VRB05KT → fav (variable, cannot argue against)', favor('LGKR','34',344,'LGKR 121200Z VRB05KT CAVOK 20/10 Q1015').state === 'fav');
  T('no METAR cached → unknown (not hidden)', favor('LGKR','34',344,null).state === 'unknown');
  T('METAR without wind token → unknown', favor('LGKR','34',344,'LGKR 121200Z CAVOK 20/10 Q1015').state === 'unknown');
  // crosswind alone should NOT hide it: 90° x-wind at 25kt = 0 tailwind → fav
  T('strong pure crosswind (254@25 vs RWY 34) → still fav (tailwind ~0)',
    favor('LGKR','34',344,'LGKR 121200Z 25425KT 9999 20/10 Q1015').state === 'fav');
}

// ── CH_SCENIC data integrity ─────────────────────────────────────────────────
console.log('\nCH_SCENIC data:');
{
  const m = X.html.match(/const CH_SCENIC=(\[[\s\S]*?\]);/);
  T('CH_SCENIC array present', !!m);
  const arr = m ? eval(m[1]) : [];
  T('has 35–40 entries', arr.length >= 35 && arr.length <= 40, 'n=' + arr.length);
  let okFields = 0, okHead = 0, dupe = 0; const seen = new Set();
  for(const e of arr){
    if(e.icao && e.rwy && typeof e.h === 'number' && e.lat != null && e.lon != null && e.scenery && e.approach) okFields++;
    const numH = parseInt(e.rwy) * 10, d = Math.abs(((numH - e.h + 360) % 360)), ang = d > 180 ? 360 - d : d;
    if(ang <= 25) okHead++;               // heading must be within 25° of runway-number×10 (typo guard)
    if(seen.has(e.icao)) dupe++; seen.add(e.icao);
  }
  T('every entry has all required fields', okFields === arr.length, okFields + '/' + arr.length);
  T('every heading within 25° of runway-number×10', okHead === arr.length, okHead + '/' + arr.length);
  T('no duplicate ICAOs', dupe === 0);
}

process.exit(T.done() ? 1 : 0);
