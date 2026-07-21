'use strict';
// v6.14.0 — configurable route cap + rotation + snapshot backfill (Dean 2026-07-21).
// Pulls the REAL routeCap / pruneRegistry / backfillFromSnapshot out of index.html via grab().
const X = require('./lib/extract.js');
const T = X.runner('route cap / rotation / backfill:');

const src = X.grab('routeCap') + '\n' + X.grab('pruneRegistry') + '\n' + X.grab('backfillFromSnapshot');
function mk(S){
  const f = new Function('S', 'RLOG', '"use strict";' + src + '\nreturn {routeCap, pruneRegistry, backfillFromSnapshot};');
  return f(S, () => {});
}
// Deterministic seedable rand (LCG) so rotation tests are reproducible.
function lcg(seed){ let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

const NOW = new Date().toISOString();
const daysAgo = d => new Date(Date.now() - d * 86400000).toISOString();
function route(id, opts){
  opts = opts || {};
  return { id, departure_airport: opts.dep || 'KMIA', arrival_airport: opts.arr || 'KMCO',
    last_seen: opts.last_seen || NOW, first_seen: opts.last_seen || NOW, times_seen: 1 };
}
function freshS(reg, snap, cfg){
  return { cfg: cfg || {}, routeRegistry: reg || {}, routeRegistrySnapshot: snap || {},
    allRows: [{ icao: 'KMIA', method: 'auto' }, { icao: 'KMCO', method: 'auto' }] };
}

// ── routeCap clamping ────────────────────────────────────────────────────────
{
  const S = freshS(); const m = mk(S);
  T('default = 5000 when cfg.maxRoutes absent', m.routeCap() === 5000);
  S.cfg.maxRoutes = 8000; T('honors cfg value 8000', m.routeCap() === 8000);
  S.cfg.maxRoutes = 100;  T('clamps low → 500', m.routeCap() === 500);
  S.cfg.maxRoutes = 50000; T('clamps high → 20000', m.routeCap() === 20000);
  S.cfg.maxRoutes = 'garbage'; T('non-numeric → 5000', m.routeCap() === 5000);
}

// ── cap prune: older days evict first, protection holds ──────────────────────
{
  const reg = {};
  for(let i = 0; i < 30; i++) reg['old' + i] = route('old' + i, { last_seen: daysAgo(5) });
  for(let i = 0; i < 30; i++) reg['new' + i] = route('new' + i, { last_seen: NOW });
  const S = freshS(reg, {}, { maxRoutes: 500 });   // cap 500 → no cap prune at 60 routes
  const m = mk(S);
  m.pruneRegistry(lcg(1));
  T('under cap → nothing pruned', Object.keys(S.routeRegistry).length === 60);

  // The cap itself (clamp floor is 500, so test with 600 routes at cap 500):
  const reg2 = {};
  for(let i = 0; i < 300; i++) reg2['o' + i] = route('o' + i, { last_seen: daysAgo(3) });
  for(let i = 0; i < 300; i++) reg2['n' + i] = route('n' + i, { last_seen: NOW });
  const S2 = freshS(reg2, {}, { maxRoutes: 500 });
  const m2 = mk(S2);
  m2.pruneRegistry(lcg(2));
  const keys2 = Object.keys(S2.routeRegistry);
  T('cap prune trims to exactly the cap', keys2.length === 500);
  T('ALL of the newer day survives (older day evicts first)', keys2.filter(k => k.startsWith('n')).length === 300);
  T('evictions came only from the older day', keys2.filter(k => k.startsWith('o')).length === 200);
}

// ── protected pairs shielded from the cap prune ──────────────────────────────
{
  const reg = {};
  for(let i = 0; i < 600; i++) reg['r' + i] = route('r' + i, { last_seen: daysAgo(3) });
  reg['prot'] = route('prot', { last_seen: daysAgo(30), dep: 'KFLL', arr: 'MMUN' });   // old AND over the 21d cutoff
  const S = freshS(reg, {}, { maxRoutes: 500, recentSimBriefRoutes: [{ dep: 'MMUN', arr: 'KFLL' }] });
  const m = mk(S);
  m.pruneRegistry(lcg(3));
  T('SimBriefed pair survives the 21-day prune AND the cap prune (order-insensitive)', !!S.routeRegistry['prot']);
}

// ── rotation: same-day ties shuffle; different seeds → different survivors ───
{
  function run(seed){
    const reg = {};
    for(let i = 0; i < 1000; i++) reg['r' + i] = route('r' + i, { last_seen: NOW });
    const S = freshS(reg, {}, { maxRoutes: 500 });
    mk(S).pruneRegistry(lcg(seed));
    return new Set(Object.keys(S.routeRegistry));
  }
  const a = run(11), b = run(22), a2 = run(11);
  T('rotation: two different seeds keep DIFFERENT sets', [...a].some(k => !b.has(k)));
  const sameCount = [...a].filter(k => a2.has(k)).length;
  T('rotation: same seed → identical set (deterministic/injectable)', sameCount === 500 && a2.size === 500);
}

// ── backfill from snapshot ───────────────────────────────────────────────────
{
  const reg = {}; for(let i = 0; i < 100; i++) reg['have' + i] = route('have' + i);
  const snap = {};
  for(const k of Object.keys(reg)) snap[k] = { ...reg[k] };            // overlap — must not duplicate
  for(let i = 0; i < 300; i++) snap['extra' + i] = route('extra' + i); // in-library candidates
  for(let i = 0; i < 50; i++)  snap['far' + i] = route('far' + i, { dep: 'EGLL', arr: 'LFPG' }); // not in library
  const S = freshS(reg, snap, { maxRoutes: 500 });
  const m = mk(S);
  const added = m.backfillFromSnapshot(lcg(7));
  const n = Object.keys(S.routeRegistry).length;
  T('adds only missing in-library routes (300 of them)', added === 300, 'added=' + added);
  T('registry = 100 existing + 300 backfilled', n === 400, 'n=' + n);
  T('library filter excluded the EGLL-LFPG routes', !Object.keys(S.routeRegistry).some(k => k.startsWith('far')));
  // copies, not references:
  S.routeRegistry['extra0'] && (S.routeRegistry['extra0'].times_seen = 999);
  T('backfilled entries are COPIES (snapshot untouched)', snap['extra0'].times_seen === 1);
  T('re-running backfill adds nothing (idempotent at exhausted snapshot)', m.backfillFromSnapshot(lcg(8)) === 0);
}

// ── backfill stops exactly at the cap, prefers newer days ────────────────────
{
  const snap = {};
  for(let i = 0; i < 400; i++) snap['fresh' + i] = route('fresh' + i, { last_seen: NOW });
  for(let i = 0; i < 400; i++) snap['stale' + i] = route('stale' + i, { last_seen: daysAgo(10) });
  const S = freshS({}, snap, { maxRoutes: 500 });
  const m = mk(S);
  const added = m.backfillFromSnapshot(lcg(9));
  const keys = Object.keys(S.routeRegistry);
  T('stops exactly at the cap', added === 500 && keys.length === 500);
  T('newest day fills first (all 400 fresh in, stale fills the rest)',
    keys.filter(k => k.startsWith('fresh')).length === 400 && keys.filter(k => k.startsWith('stale')).length === 100);
}

process.exit(T.done() ? 1 : 0);
