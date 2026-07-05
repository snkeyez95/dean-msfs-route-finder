'use strict';
// Phase 8a coverage parity: run the Node coverage port over the live index.json, diff vs _ref_cov.json
// (real Python). Run `python _ref_cov.py` first. Dev-only, read-only.
const fs = require('fs'), path = require('path');
const { computeCoverage, nextGapForAircraft, COVERAGE_AIRCRAFT } = require('./coverage.js');

const sdir = path.join(process.env.APPDATA, 'A Better Route Planner', 'Sessions');
const idx = JSON.parse(fs.readFileSync(path.join(sdir, 'index.json'), 'utf8'));
const ref = JSON.parse(fs.readFileSync(path.join(__dirname, '_ref_cov.json'), 'utf8'));

const cov = computeCoverage(idx.sessions || []);
const diffs = [];

const fmt = g => g.aircraft + ' ' + g.tlod + ' (short ' + g.short + ', count ' + g.count + ')';
const ng = cov.gaps.map(fmt), pg = ref.gaps.map(fmt);
if(JSON.stringify(ng) !== JSON.stringify(pg)) diffs.push('gaps differ:\n  node: ' + ng.join(' | ') + '\n  py:   ' + pg.join(' | '));
if(cov.total_remaining !== ref.total_remaining) diffs.push('total_remaining: node=' + cov.total_remaining + ' py=' + ref.total_remaining);
for(const ac of COVERAGE_AIRCRAFT){ const n = nextGapForAircraft(cov, ac), p = ref.next_gap[ac]; if(n !== p) diffs.push('next_gap[' + ac + ']: node=' + n + ' py=' + p); }
for(const k of Object.keys(ref.counts)){ if(cov.counts[k] !== ref.counts[k]) diffs.push('count[' + k + ']: node=' + cov.counts[k] + ' py=' + ref.counts[k]); }

console.log('gaps (node):    ' + ng.join(' | '));
console.log('next_gap (node):', COVERAGE_AIRCRAFT.reduce((o, ac) => { o[ac] = nextGapForAircraft(cov, ac); return o; }, {}));
console.log('total_remaining:', cov.total_remaining);
console.log(diffs.length ? ('\nCOVERAGE PARITY FAIL:\n' + diffs.join('\n')) : '\nCOVERAGE PARITY PASS — gaps, counts, totals, and next_gap all match Python.');
