'use strict';
// v6.29.1: scenery folder → ICAO matching. "inibuilds-airport-egka-shoreham" matched EHAM (from inside
// "shorEHAM") because the substring scan ran before the "token after the word airport" rule.
// Runs the REAL exICAO from index.html.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const stmt = n => {
  let i = html.indexOf('const ' + n + '='); if (i < 0) i = html.indexOf('const ' + n + ' =');
  if (i < 0) throw new Error('const ' + n);
  let d = 0;
  for (let j = i; j < html.length; j++) { const c = html[j]; if ('{[('.includes(c)) d++; else if ('}])'.includes(c)) d--; else if (c === ';' && d === 0) return html.slice(i, j + 1); }
};
function grab(n) {
  const i = html.indexOf('function ' + n + '('); let d = 0, s = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { d++; s = true; } else if (html[j] === '}') { d--; if (s && !d) return html.slice(i, j + 1); } }
}
const code = ['AI', 'IS', 'CM', 'AIRPORT_KW', 'ICAO_RE', 'COMMON4'].map(stmt).join('\n') + '\n' + ['isNoise', 'isPlausibleICAO', 'exICAO'].map(grab).join('\n');
const exICAO = new Function('S', code + '\nreturn exICAO;')({ cfg: {} });

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };

ok(exICAO('inibuilds-airport-egka-shoreham')[0] === 'EGKA', 'Shoreham → EGKA (not EHAM from "shorEHAM")', exICAO('inibuilds-airport-egka-shoreham'));
ok(exICAO('flytampa-airport-eham-amsterdam')[0] === 'EHAM', 'Amsterdam still → EHAM');
ok(exICAO('drzewieckidesign-airport-eetn-tallinn')[0] === 'EETN', 'token after "airport" → auto');
ok(exICAO('inibuilds-airport-egll-heathrow')[0] === 'EGLL', 'EGLL still matched');
ok(exICAO('lvfr-airport-lemd-madrid-barajas')[0] === 'LEMD', 'LEMD still matched');

// Real library: no two DIFFERENT folders may share an ICAO unless they genuinely are the same airport,
// and Shoreham must not be EHAM.
const cfgPath = path.join(process.env.APPDATA || '', 'A Better Route Planner', 'config.json');
if (fs.existsSync(cfgPath)) {
  const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const rows = (cfg.savedRows || []).map(r => ({ folder: r.folder, icao: (cfg.manualOverrides || {})[r.folder] || exICAO(r.folder)[0] }));
  const by = {}; for (const r of rows) if (r.icao) (by[r.icao] = by[r.icao] || []).push(r.folder);
  const shared = Object.entries(by).filter(([, l]) => l.length > 1);
  ok(!shared.some(([ic, l]) => ic === 'EHAM' && l.some(f => /egka|shoreham/i.test(f))), 'real library: Shoreham no longer shares EHAM');
  console.log('  info real folders sharing an ICAO: ' + (shared.map(([ic, l]) => ic + ' (' + l.join(' | ') + ')').join('; ') || 'none'));
} else console.log('  skip real library (no config)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
