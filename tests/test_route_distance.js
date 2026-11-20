'use strict';
// v6.34.0: route distance is the true great-circle nautical miles from airport coordinates, not
// SayIntentions' "distance_nm" (which is statute miles: 1.152× great-circle on ~4,000 routes).
// Runs the REAL routeNm / gcDist / AI table out of index.html against Dean's real registry + airport DB.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grab(name) { const i = html.indexOf('function ' + name + '('); const st = html.lastIndexOf('\n', i) + 1; let d = 0, s = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { d++; s = true; } else if (html[j] === '}') { d--; if (s && !d) return html.slice(st, j + 1); } } }
const stmt = n => { const i = html.indexOf('const ' + n + '='); let d = 0; for (let j = i; j < html.length; j++) { const c = html[j]; if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; else if (c === ';' && !d) return html.slice(i, j + 1); } };
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
const make = db => new Function('LATC', stmt('AI') + '\n' + stmt('SI_STATUTE_TO_NM') + '\nlet _rnmCache=new Map(), _rnmDb=null;\n' + ['gcDist', '_latcDb', '_aptLL', 'routeNm'].map(grab).join('\n') + '\nreturn {routeNm, gcDist};')({ db });

console.log('1. the rule');
{
  const F = make(new Map([['KORD', { icao: 'KORD', lat: 41.9786, lon: -87.9048 }], ['KBNA', { icao: 'KBNA', lat: 36.1245, lon: -86.6782 }]]));
  ok(F.routeNm({ departure_airport: 'KORD', arrival_airport: 'KBNA', distance_nm: 410 }) === 356, 'KORD→KBNA: 356 nm from coordinates (SI said 410)');
  ok(F.routeNm({ departure_airport: 'ZZZZ', arrival_airport: 'YYYY', distance_nm: 410 }) === 356, 'no coordinates → SI figure ÷ 1.1508 (410 → 356)');
  ok(F.routeNm({ departure_airport: 'QQQQ', arrival_airport: 'XXXX' }) === null, 'nothing known → no distance (shows —)');
  ok(F.routeNm(null) === null, 'no route → null');
  const G = make(null);
  ok(G.routeNm({ departure_airport: 'EGLL', arrival_airport: 'EGKK', distance_nm: 99 }) === Math.round(G.gcDist(51.477, -0.461, 51.148, -0.190)), 'before the full airport DB loads, the built-in airport list is used');
}
console.log('2. wiring');
ok(!/distance_nm\?Math\.round\(r\.distance_nm\)/.test(html) && (html.match(/routeNm\(r\)!=null\?routeNm\(r\)\+' nm'/g) || []).length === 3, 'every route card shows routeNm (Plan a Flight, Free Route, Scenic)');
ok((html.match(/if\(srt==='dist'\)return\(routeNm\(a\)\|\|0\)-\(routeNm\(b\)\|\|0\);/g) || []).length === 2, 'both "sort by distance" use the true distance');
ok(/routeNm\(r\)!=null\?routeNm\(r\)\+'nm':''/.test(html) && /route&&routeNm\(route\)!=null/.test(html) && /sort\(\(a,b\)=>\(routeNm\(a\)\|\|0\)-\(routeNm\(b\)\|\|0\)\)/.test(html), 'CSV export, Trip Planner and the scenic route list use it too');
ok(/if\(!LATC\.db&&!LATC\.dbLoading\) latcEnsureDb\(\)\.then/.test(html), 'opening Plan a Flight loads the full airport database, then re-renders');

console.log('3. real data (read-only)');
const UD = path.join(process.env.APPDATA || '', 'A Better Route Planner');
if (fs.existsSync(path.join(UD, 'airport_db.json')) && fs.existsSync(path.join(UD, 'routeRegistry.json'))) {
  const dbj = JSON.parse(fs.readFileSync(path.join(UD, 'airport_db.json'), 'utf8'));
  const db = new Map((Array.isArray(dbj) ? dbj : Object.values(dbj)).map(a => [a.icao, a]));
  const F = make(db);
  const R = Object.values(JSON.parse(fs.readFileSync(path.join(UD, 'routeRegistry.json'), 'utf8')));
  const withCoords = R.filter(r => db.has(r.departure_airport) && db.has(r.arrival_airport));
  ok(withCoords.length / R.length > 0.98, 'coordinates for ' + (100 * withCoords.length / R.length).toFixed(1) + '% of ' + R.length + ' routes');
  const ratios = withCoords.filter(r => +r.distance_nm > 0).map(r => +r.distance_nm / F.routeNm(r)).filter(x => isFinite(x)).sort((a, b) => a - b);
  const med = ratios[Math.floor(ratios.length / 2)];
  ok(Math.abs(med - 1.1508) < 0.01, 'SI distance ÷ true distance = ' + med.toFixed(3) + ' (statute→nautical is 1.1508) — confirms the fix');
  const pick = (d, a) => R.find(r => r.departure_airport === d && r.arrival_airport === a);
  const kca = pick('KCLE', 'KATL'); if (kca) ok(Math.abs(F.routeNm(kca) - 483) <= 2, 'KCLE→KATL now ' + F.routeNm(kca) + ' nm (SI showed ' + kca.distance_nm + ')');
  const all = R.map(F.routeNm); ok(all.filter(x => x == null).length < 10, 'almost every route gets a distance (' + all.filter(x => x != null).length + ' of ' + R.length + ')');
} else console.log('  skip real data');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
