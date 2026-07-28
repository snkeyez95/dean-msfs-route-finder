'use strict';
// v6.15.4 — dashboard world map (Dean 2026-07-28: "dots not in the right place", horizontal streaks).
// Two invariants, both checked against the REAL world-atlas data and the REAL source:
//   1. No path segment may jump more than half the map width. A ring wrapping past ±180° used to be
//      joined with 'L', streaking a bar across the whole map (Russia y≈35-47, Fiji y≈201 at a full
//      720px, Antarctica y≈329-340). 8 such segments existed before the split.
//   2. The dot projection in index.html must stay IDENTICAL to the path projection in main.js.
//      They are computed independently at W=720/H=340; any drift lands dots in the ocean.
//      (See the standing rule: never change H or the viewBox.)
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('dashboard world map:');
const ROOT = path.resolve(__dirname, '..');
const mainSrc = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
const htmlSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

const W = 720, H = 340;

// ── 1. projection parity (the desync rule) ──────────────────────────────────
console.log('projection parity (main.js paths vs index.html dots):');
{
  const mW = /const W = 720, H = 340;/.test(mainSrc);
  const hW = /const W=720,H=340;/.test(htmlSrc);
  T('main.js uses W=720 H=340', mW);
  T('index.html uses W=720 H=340', hW);
  T('main.js px/py are the documented equirectangular formulas',
    /px = lon => \(lon \+ 180\) \/ 360 \* W/.test(mainSrc) && /py = lat => \(90 - lat\) \/ 180 \* H/.test(mainSrc));
  T('index.html px/py match exactly',
    /px=lon=>\(\(lon\+180\)\/360\*W\)/.test(htmlSrc) && /py=lat=>\(\(90-lat\)\/180\*H\)/.test(htmlSrc));
  T('the SVG viewBox is still 0 0 720 340 (never change this)',
    /viewBox="0 0 720 340"/.test(htmlSrc));
}

// ── 2. no antimeridian tearing in the generated paths ───────────────────────
console.log('\nantimeridian split (real world-atlas data):');
let paths = null;
try {
  const topojson = require('topojson-client');
  const world = require('world-atlas/land-50m.json');
  const px = lon => (lon + 180) / 360 * W, py = lat => (90 - lat) / 180 * H;
  // the REAL ringsToPath, lifted from main.js so the test can never drift from the shipped code
  const body = mainSrc.slice(mainSrc.indexOf('const ringsToPath'), mainSrc.indexOf('const land = topojson.feature'));
  const ringsToPath = new Function('px', 'py', 'W', body + '; return ringsToPath;')(px, py, W);
  const land = topojson.feature(world, world.objects.land);
  paths = [];
  const g = x => { if (!x) return; if (x.type === 'Polygon') paths.push(ringsToPath(x.coordinates));
    else if (x.type === 'MultiPolygon') x.coordinates.forEach(p => paths.push(ringsToPath(p))); };
  if (land.type === 'FeatureCollection') land.features.forEach(f => g(f.geometry)); else g(land.geometry);
} catch (e) { console.log('  (world-atlas unavailable: ' + e.message + ')'); }

if (!paths) { T('world map data available', false, 'install world-atlas/topojson-client'); }
else {
  T('paths generated', paths.length > 1000, paths.length + ' paths');
  // Walk every subpath: consecutive drawn points must never jump more than half the map.
  let tears = 0, worst = 0;
  for (const d of paths) {
    for (const sub of d.split('M').slice(1)) {
      const pts = sub.replace(/Z$/, '').split('L').map(s => parseFloat(s.split(',')[0])).filter(n => !isNaN(n));
      for (let i = 1; i < pts.length; i++) {
        const dx = Math.abs(pts[i] - pts[i - 1]);
        if (dx > W / 2) { tears++; if (dx > worst) worst = dx; }
      }
    }
  }
  T('ZERO segments jump more than half the map width (was 8)', tears === 0, tears + ' tears, worst ' + worst.toFixed(0) + 'px');
  T('every subpath is closed', paths.every(d => d === '' || d.endsWith('Z')));
  T('all coordinates land inside the viewBox', (() => {
    for (const d of paths) for (const m of d.matchAll(/(-?\d+\.?\d*),(-?\d+\.?\d*)/g)) {
      const x = +m[1], y = +m[2];
      if (x < -0.5 || x > W + 0.5 || y < -0.5 || y > H + 0.5) return false;
    } return true; })());
}

// ── 3. dot guard rejects unusable coordinates ───────────────────────────────
console.log('\ndot coordinate guard:');
{
  const guard = (lat, lon) =>
    !(typeof lat !== 'number' || typeof lon !== 'number' || !isFinite(lat) || !isFinite(lon)
      || lat < -90 || lat > 90 || lon < -180 || lon > 180);
  T('a real airport plots (KEYW)', guard(24.556, -81.759) === true);
  T('lon 0 / lat 0 is accepted as a real coordinate', guard(0, 0) === true);
  T('a half-resolved airport (lat only) is skipped — used to draw cx="NaN"', guard(51.5, undefined) === false);
  T('NaN is skipped', guard(NaN, 10) === false);
  T('out-of-range is skipped', guard(120, 10) === false && guard(10, 999) === false);
  T('index.html uses the hardened numeric guard',
    /typeof lat!=='number'\|\|typeof lon!=='number'\|\|!isFinite\(lat\)\|\|!isFinite\(lon\)/.test(htmlSrc));
}

process.exit(T.done() ? 1 : 0);
