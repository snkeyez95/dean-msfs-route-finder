'use strict';
// Settings A/B — the passive graphics snapshot + fingerprint (v6.12.0), and v6.15.8's addition of
// frame generation + the FPS target to the watched keys.
//
// WHY 6.15.8 EXISTS: frame generation and the FPS target live OUTSIDE UserCfg's {Graphics} block,
// so readAllGraphics never saw them. Dean's frame-gen-OFF flight (2026-07-31) fingerprinted
// bf731382 — byte-identical to the FG-on flight the day before. The single biggest setting change
// on the machine produced no before/after card. capture.js now folds both values into the same map
// under a 'Sim/' prefix before fingerprinting.
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('settings A/B watch list:');
const ROOT = path.resolve(__dirname, '..');
const W = require(path.join(ROOT, 'perf/native/gfx_watch.js'));
const capSrc = fs.readFileSync(path.join(ROOT, 'perf/native/capture.js'), 'utf8');

const base = {
  'Video/PrimaryScaling': 1,
  'Graphics/VolumetricClouds/Enabled': 1, 'Graphics/VolumetricClouds/Quality': 1,
  'Graphics/SSAO/Enabled': 1, 'Graphics/SSAO/Quality': 2,
  'Graphics/Shadows/Size': 1536, 'Graphics/Water/FFTSize': 512,
  'Graphics/WindShield/Quality': 1, 'Graphics/Particles/Quality': 1,
};
const sim = (fg, fps) => Object.assign({}, base, { 'Sim/FrameGeneration': fg, 'Sim/TargetFPS': fps });

// ── 1. the pre-existing contract still holds ────────────────────────────────
console.log('fingerprint basics:');
{
  T('identical settings fingerprint identically', W.fingerprint(base) === W.fingerprint(Object.assign({}, base)));
  T('a watched change moves the fingerprint',
    W.fingerprint(base) !== W.fingerprint(Object.assign({}, base, { 'Graphics/Shadows/Size': 2048 })));
  T('TLOD is deliberately NOT watched (machine-driven)',
    W.fingerprint(base) === W.fingerprint(Object.assign({}, base, { 'Graphics/Terrain/LoDFactor': 4.0 })));
  T('texture quality is NOT watched (a VRAM lever, not a candidate)',
    W.fingerprint(base) === W.fingerprint(Object.assign({}, base, { 'Graphics/Texture/Quality': 0 })));
  T('disabling a gated feature reads as Off (-1), not as a missing key',
    W.watchValues(Object.assign({}, base, { 'Graphics/SSAO/Enabled': 0 }))['Graphics/SSAO'] === -1);
  T('an enum shows the numeral beside the label so a mislabel cannot hide it',
    /^1 · /.test(W.displayValue(W.watchMeta().find(m => m.id === 'Graphics/VolumetricClouds'), 1)));
}

// ── 2. v6.15.8 — frame gen + FPS target ─────────────────────────────────────
console.log('\nframe generation + FPS target:');
{
  const on = sim('FSR FG', 30), off = sim('off', 30), cap40 = sim('FSR FG', 40);
  T('turning frame generation off changes the fingerprint',
    W.fingerprint(on) !== W.fingerprint(off), W.fingerprint(on) + ' -> ' + W.fingerprint(off));
  T('changing the FPS target changes the fingerprint', W.fingerprint(on) !== W.fingerprint(cap40));
  T('the two changes are distinguishable from each other', W.fingerprint(off) !== W.fingerprint(cap40));
  T('same settings still fingerprint the same', W.fingerprint(on) === W.fingerprint(sim('FSR FG', 30)));
  T('values stay readable on the card, not just hashed',
    W.watchValues(off)['Sim/FrameGeneration'] === 'off' && W.watchValues(cap40)['Sim/TargetFPS'] === 40);
  T('a text value renders as-is',
    W.displayValue(W.watchMeta().find(m => m.id === 'Sim/FrameGeneration'), 'FSR FG') === 'FSR FG');
  T('both appear in the legend with a readable source',
    W.watchMeta().filter(m => m.id.startsWith('Sim/')).length === 2 &&
    W.watchMeta().find(m => m.id === 'Sim/TargetFPS').key === 'Sim → TargetFPS');
  T('a flight without the keys degrades to null and still fingerprints',
    W.watchValues(base)['Sim/FrameGeneration'] === null && W.fingerprint(base) != null);
  T('capture.js folds both in before fingerprinting',
    /g\['Sim\/FrameGeneration'\] = fresh\.frame_gen/.test(capSrc) && /g\['Sim\/TargetFPS'\] = fresh\.target_fps/.test(capSrc));
  T('it only folds in values that were actually parsed',
    /if \(fresh\.frame_gen != null\)/.test(capSrc) && /if \(fresh\.target_fps != null\)/.test(capSrc));
}

// ── 2b. v6.15.9 — the two checkbox rows from the free-visuals push ──────────
console.log('\nraytraced shadows + displacement mapping:');
{
  const off = Object.assign({}, base, { 'Graphics/RaytracedShadows/Enabled': 0, 'Graphics/DisplacementMapping/Enabled': 0 });
  const rt  = Object.assign({}, off, { 'Graphics/RaytracedShadows/Enabled': 1 });
  const dm  = Object.assign({}, off, { 'Graphics/DisplacementMapping/Enabled': 1 });
  T('enabling raytraced shadows changes the fingerprint', W.fingerprint(off) !== W.fingerprint(rt));
  T('enabling displacement mapping changes the fingerprint', W.fingerprint(off) !== W.fingerprint(dm));
  T('the two are distinguishable from each other', W.fingerprint(rt) !== W.fingerprint(dm));
  T('values read as the raw 0/1, not as a gated -1',
    W.watchValues(off)['Graphics/RaytracedShadows'] === 0 && W.watchValues(rt)['Graphics/RaytracedShadows'] === 1);
  T('they label as On/Off on the card',
    W.displayValue(W.watchMeta().find(m => m.id === 'Graphics/RaytracedShadows'), 1) === '1 · On' &&
    W.displayValue(W.watchMeta().find(m => m.id === 'Graphics/DisplacementMapping'), 0) === '0 · Off');
  T('both appear in the legend',
    W.watchMeta().filter(m => /RaytracedShadows|DisplacementMapping/.test(m.id)).length === 2);
  T('a flight predating the keys degrades to null without throwing',
    W.watchValues(base)['Graphics/RaytracedShadows'] === null && W.fingerprint(base) != null);
}

// ── 3. the real flights that exposed the blind spot ────────────────────────
console.log('\nreal data (skipped if unavailable):');
{
  const S = path.join(process.env.APPDATA || '', 'A Better Route Planner', 'Sessions');
  const read = p => { try { return JSON.parse(fs.readFileSync(path.join(S, p, 'summary.json'), 'utf8')); } catch (_) { return null; } };
  const A = read('2026-07-30/2027_TLOD125_OLOD120');     // FG on
  const B = read('2026-07-31/1013_TLOD125_OLOD120');     // FG off — the experiment
  if (!A || !B) { console.log('  (the two reference flights are not on this machine — skipped)'); }
  else {
    T('the two flights really did fingerprint identically before the fix',
      A.settings.gfx_fp === B.settings.gfx_fp, A.settings.gfx_fp + ' / ' + B.settings.gfx_fp);
    T('their frame-gen settings really did differ',
      A.settings.frame_gen === 'FSR FG' && B.settings.frame_gen === 'off');
    const mk = s => {
      const g = Object.assign({}, s.settings.graphics);
      if (s.settings.frame_gen != null) g['Sim/FrameGeneration'] = s.settings.frame_gen;
      if (s.settings.target_fps != null) g['Sim/TargetFPS'] = s.settings.target_fps;
      return g;
    };
    T('with the new watch list they fingerprint DIFFERENTLY',
      W.fingerprint(mk(A)) !== W.fingerprint(mk(B)), W.fingerprint(mk(A)) + ' vs ' + W.fingerprint(mk(B)));
    T('and the change reads plainly on the card',
      W.watchValues(mk(A))['Sim/FrameGeneration'] === 'FSR FG' && W.watchValues(mk(B))['Sim/FrameGeneration'] === 'off');
  }
}

process.exit(T.done() ? 1 : 0);
