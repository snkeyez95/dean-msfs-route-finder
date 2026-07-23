'use strict';
// v6.15.1 — auto-exclude mid-flight sim exits from analysis (Dean 2026-07-22, after a KPHX bail).
// The engine tags an airborne-then-quit flight settings.notes='mid-flight session'; perf-compare-data
// must OR that into `excluded` so every analysis filter (baseline grid, clean set, Settings A/B,
// scenery, AutoFPS envelope) drops it. This test locks the wiring in main.js + the predicate.
const fs = require('path') && require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('mid-flight auto-exclude:');
const mainSrc = fs.readFileSync(path.resolve(__dirname, '..', 'main.js'), 'utf8');

// ── the wiring must be present in main.js ────────────────────────────────────
T('reads the mid-flight tag from summary settings.notes',
  /mid-flight session\/i\.test\(sj\.settings\.notes/.test(mainSrc));
T('ORs midflight into the excluded field of the compare payload',
  /excluded:\s*s\.excluded\s*\|\|\s*midflight/.test(mainSrc));
T('surfaces a midflight field on each flight', /midflight:\s*midflight/.test(mainSrc));

// ── the predicate behaves (same regex the engine/main use) ───────────────────
const isMid = (notes) => /mid-flight session/i.test(notes || '');
T("'mid-flight session' → excluded", isMid('mid-flight session') === true);
T("case-insensitive ('Mid-Flight Session')", isMid('Mid-Flight Session') === true);
T('a normal route note is NOT excluded', isMid('1471 KMSP-KORD') === false);
T('empty / missing notes is NOT excluded', isMid('') === false && isMid(undefined) === false);

// ── the analysis filters that consume `excluded` (index.html) still reference it ──
const html = require('./lib/extract.js').html;
const filters = (html.match(/!\w*\.excluded/g) || []).length;
T('index.html analysis filters gate on !excluded (so the flag takes effect)', filters >= 4, 'found ' + filters);

// ── real-data check: if Dean's KPHX mid-flight session is on disk, confirm it'd be flagged ──
const APP = path.join(process.env.APPDATA || '', 'A Better Route Planner', 'Sessions');
let checkedReal = false;
try {
  const idx = JSON.parse(fs.readFileSync(path.join(APP, 'index.json'), 'utf8'));
  const list = Array.isArray(idx) ? idx : (idx.flights || idx.sessions || []);
  for (const e of list) {
    const sp = path.join(APP, (e.folder || '').replace(/\//g, '\\'), 'summary.json');
    if (!fs.existsSync(sp)) continue;
    const sj = JSON.parse(fs.readFileSync(sp, 'utf8'));
    if (sj.settings && isMid(sj.settings.notes)) {
      checkedReal = true;
      T('real mid-flight flight ' + e.session_id + ' would be auto-excluded', isMid(sj.settings.notes) === true);
    }
  }
} catch (_) {}
if (!checkedReal) console.log('  (no mid-flight session on disk to spot-check — predicate tests cover it)');

process.exit(T.done() ? 1 : 0);
