'use strict';
// perf/native/lab.js — the SETTINGS LAB (Phase 9). Generalizes auto-TLOD into a one-variable-per-
// flight experiment scheduler: pre-launch it either applies the next queued experiment value to
// UserCfg.opt (backup + readback-verified, same discipline as prep.js) or restores pure baseline
// config for a control flight. Alternation and per-experiment counts are DERIVED FROM THE INDEX
// (tagged flights are the source of truth — no fragile state machine): last flight tagged →
// next is a control; otherwise the first experiment with fewer than N_PER_EXPERIMENT flown flights
// runs. lab_state.json holds only the baseline snapshot (captured at first activation) + a log.
// The byte-proven TLOD/OLOD writer in settings.js is deliberately NOT touched.
const fs = require('fs'), path = require('path');
const { backupUsercfg } = require('./prep.js');

const N_PER_EXPERIMENT = 2;   // Dean 2026-07-06: 2 flights per setting, verdicts marked preliminary

// Curated queue — one variable each, with the metric that judges it. testValue chosen against
// Dean's actual current values (verified 2026-07-06). 'lod' format = percent -> /100 float.
const EXPERIMENTS = [
  { id: 'clouds-quality-up', label: 'Volumetric clouds Quality 1→2', section: 'VolumetricClouds', key: 'Quality',
    format: 'int', testValue: 2, dir: 'up', hypothesis: 'Free visuals: GPU has headroom, so smoothness should NOT change (watch VRAM + gpu-bound%)' },
  // (airport-services experiment REJECTED by Dean's review 2026-07-06: his services are already at
  // minimum (-1/variety 0), and payware airports bake their own clutter outside this slider anyway)
  { id: 'precache-down', label: 'Off-screen terrain pre-caching Ultra→Low', section: 'OffscreenTerrainPreCaching', key: 'Quality',
    format: 'int', testValue: 1, dir: 'down', hypothesis: 'Dean runs this at MAX (3): the sim constantly pre-loads terrain for views you are not looking at — a known main-thread cost. Expect smoother frametimes; trade = brief scenery pop when swinging external cameras' },
  { id: 'glass-refresh-down', label: 'Glass cockpit refresh 2→1', section: 'GlassCockpitsRefreshRate', key: 'Quality',
    format: 'int', testValue: 1, dir: 'down', hypothesis: 'Cheaper avionics refresh frees main thread on PMDG/Fenix (ground + overall p99 down)' },
  { id: 'olod-down', label: 'Objects LOD 120→100', section: 'ObjectsLoD', key: 'LoDFactor',
    format: 'lod', testValue: 100, dir: 'down', hypothesis: 'Fewer object LODs juggled over photogrammetry cities (ground/descent stutter down)' },
  // UP-variants (Dean 2026-07-06: test both directions where both carry a real question). Downs run
  // first (stutter relief is the priority); ups answer "is raising this free on my idle GPU / what
  // does prettier cost?". Deliberately one-directional: clouds-down (CPU-bound rig — reducing GPU
  // work can't buy smoothness) and precache-up (already at max 3).
  { id: 'glass-refresh-up', label: 'Glass cockpit refresh 2→3 (max)', section: 'GlassCockpitsRefreshRate', key: 'Quality',
    format: 'int', testValue: 3, dir: 'up', hypothesis: 'Is maxing avionics fluidity FREE? If smoothness is unchanged, keep it maxed' },
  { id: 'olod-up', label: 'Objects LOD 120→150', section: 'ObjectsLoD', key: 'LoDFactor',
    format: 'lod', testValue: 150, dir: 'up', hypothesis: 'What does prettier objects COST? Quantifies the ground/VRAM price of +30 OLOD (sibling of the TLOD study)' },
  // Photogrammetry lives OUTSIDE UserCfg.opt (data settings) — manual: Dean toggles it in-sim and
  // marks the next flight from the Lab panel; tagging/verdicts work the same, no auto write/restore.
  { id: 'photogrammetry-off', label: 'Photogrammetry OFF (manual toggle in sim)', manual: true, dir: 'down',
    hypothesis: 'City-mesh streaming off = smoother departure/approach at PG cities (ground/descent stutter + VRAM down)' },
];

// ── generalized surgical UserCfg editor (modeled on settings.js writeSettingsText) ──────────────
function _gfxSplit(text) {
  const t = text.replace(/\r\n/g, '\n');
  const gi = t.indexOf('{Graphics\n') >= 0 ? t.indexOf('{Graphics\n') : t.search(/\{Graphics\b(?!VR)/);
  if (gi < 0) return null;
  const vi = t.indexOf('{GraphicsVR', gi);
  const end = vi > gi ? vi : t.length;
  return { head: t.slice(0, gi), gfx: t.slice(gi, end), tail: t.slice(end) };
}
function _fmt(value, format) { return format === 'lod' ? (value / 100.0).toFixed(6) : String(Math.trunc(value)); }
function _keyRe(section, key) { return new RegExp('(\\{' + section + '\\b[\\s\\S]*?' + key + '\\s+)(-?[0-9.]+)', 'i'); }

function readKeyInBlock(text, section, key) {
  const p = _gfxSplit(text);
  if (!p) return null;
  const m = p.gfx.match(_keyRe(section, key));
  return m ? parseFloat(m[2]) : null;
}
function writeKeyInBlock(text, section, key, value, format) {
  const p = _gfxSplit(text);
  if (!p) return { ok: false, reason: 'no {Graphics} section' };
  let n = 0;
  const gfx = p.gfx.replace(_keyRe(section, key), (m, g1) => { n++; return g1 + _fmt(value, format); });
  if (n !== 1) return { ok: false, reason: '{' + section + '} ' + key + ' matched ' + n + ' times (need 1)' };
  return { ok: true, text: p.head + gfx + p.tail };
}

// value as the SIM stores it -> value as the registry expresses it (lod keys are percent-based)
function _toRegistryUnits(raw, format) { return raw == null ? null : (format === 'lod' ? Math.round(raw * 100) : raw); }

// ── state (baseline snapshot only — counts/alternation derive from the index) ───────────────────
function statePath(dataRoot) { return path.join(dataRoot, 'lab_state.json'); }
function pendingPath(dataRoot) { return path.join(dataRoot, '_lab_pending.json'); }
function loadState(dataRoot) {
  try { return JSON.parse(fs.readFileSync(statePath(dataRoot), 'utf8')); } catch (_) { return { baseline: null, log: [] }; }
}
function saveState(dataRoot, st) {
  try { st.log = (st.log || []).slice(-40); fs.writeFileSync(statePath(dataRoot), JSON.stringify(st, null, 2)); } catch (_) {}
}
function snapshotBaseline(text) {
  const snap = {};
  for (const e of EXPERIMENTS) {
    if (e.manual) continue;
    snap[e.id] = _toRegistryUnits(readKeyInBlock(text, e.section, e.key), e.format);
  }
  return snap;
}
function countFlown(sessions, id) { return (sessions || []).filter(s => s.experiment === id).length; }
function lastFlightTagged(sessions) { const l = (sessions || [])[(sessions || []).length - 1]; return !!(l && l.experiment); }
function nextExperiment(sessions) { return EXPERIMENTS.find(e => !e.manual && countFlown(sessions, e.id) < N_PER_EXPERIMENT) || null; }

// Restore every auto key to its baseline-snapshot value. Only writes when a value differs.
function restoreBaseline(usercfgPath, backupDir, st) {
  if (!st.baseline) return { restored: 0 };
  let text = fs.readFileSync(usercfgPath, 'utf8');
  let restored = 0, backedUp = false;
  for (const e of EXPERIMENTS) {
    if (e.manual || st.baseline[e.id] == null) continue;
    const cur = _toRegistryUnits(readKeyInBlock(text, e.section, e.key), e.format);
    if (cur === st.baseline[e.id]) continue;
    const w = writeKeyInBlock(text, e.section, e.key, st.baseline[e.id], e.format);
    if (!w.ok) continue;
    if (!backedUp) { try { backupUsercfg(usercfgPath, backupDir); } catch (_) {} backedUp = true; }
    text = w.text; restored++;
  }
  if (restored) fs.writeFileSync(usercfgPath, text);
  return { restored };
}

// The pre-launch decision. sessions = index.json sessions array. Returns what it did so the UI can
// announce it exactly like auto-TLOD's "Set TLOD X for <aircraft>".
function labNext(sessions, opts) {
  const { usercfgPath, backupDir, dataRoot } = opts;
  const st = loadState(dataRoot);
  if (!fs.existsSync(usercfgPath)) return { ok: false, mode: 'error', msg: 'UserCfg.opt not found' };
  let text = fs.readFileSync(usercfgPath, 'utf8');

  // first activation: freeze the baseline snapshot from CURRENT values
  if (!st.baseline) { st.baseline = snapshotBaseline(text); st.log.push({ t: Date.now(), a: 'snapshot', v: st.baseline }); }

  // a pending marker from an armed-but-never-flown launch must never leak into this flight
  try { fs.unlinkSync(pendingPath(dataRoot)); } catch (_) {}

  // reference aircraft never runs an experiment (mirrors the benchmark's Citation exclusion)
  const isRef = opts.aircraft && !/^(Fenix|PMDG)$/i.test(opts.aircraft);

  if (lastFlightTagged(sessions) || isRef) {                       // CONTROL flight
    const r = restoreBaseline(usercfgPath, backupDir, st);
    st.log.push({ t: Date.now(), a: 'control', restored: r.restored });
    saveState(dataRoot, st);
    return { ok: true, mode: 'control', restored: r.restored,
      msg: 'CONTROL flight — baseline config' + (r.restored ? ' (' + r.restored + ' setting(s) restored)' : '') };
  }

  const exp = nextExperiment(sessions);
  if (!exp) {                                                      // queue complete
    const r = restoreBaseline(usercfgPath, backupDir, st);
    saveState(dataRoot, st);
    return { ok: true, mode: 'complete', restored: r.restored, msg: 'Lab queue complete — baseline config restored. Review verdicts.' };
  }

  // drift guard: Dean may have changed a setting in-sim since the snapshot — adopt the new value
  const curBase = _toRegistryUnits(readKeyInBlock(text, exp.section, exp.key), exp.format);
  // (curBase === testValue means a prior lab write never got restored — do NOT adopt that as baseline)
  if (curBase != null && curBase !== st.baseline[exp.id] && curBase !== exp.testValue) {
    st.baseline[exp.id] = curBase; st.log.push({ t: Date.now(), a: 'drift-resnapshot', id: exp.id, v: curBase });
  }

  // make sure everything ELSE is at baseline before this experiment (one variable at a time)
  restoreBaseline(usercfgPath, backupDir, st);
  text = fs.readFileSync(usercfgPath, 'utf8');

  const w = writeKeyInBlock(text, exp.section, exp.key, exp.testValue, exp.format);
  if (!w.ok) { saveState(dataRoot, st); return { ok: false, mode: 'error', msg: 'write failed: ' + w.reason }; }
  try { backupUsercfg(usercfgPath, backupDir); } catch (_) {}
  fs.writeFileSync(usercfgPath, w.text);
  const verify = _toRegistryUnits(readKeyInBlock(fs.readFileSync(usercfgPath, 'utf8'), exp.section, exp.key), exp.format);
  if (verify !== (exp.format === 'lod' ? exp.testValue : Math.trunc(exp.testValue))) {
    return { ok: false, mode: 'error', msg: 'readback verify failed for ' + exp.id };
  }
  try { fs.writeFileSync(pendingPath(dataRoot), JSON.stringify({ id: exp.id, section: exp.section, key: exp.key, value: exp.testValue })); } catch (_) {}
  st.log.push({ t: Date.now(), a: 'experiment', id: exp.id, v: exp.testValue });
  saveState(dataRoot, st);
  const n = countFlown(sessions, exp.id);
  return { ok: true, mode: 'experiment', id: exp.id, label: exp.label, hypothesis: exp.hypothesis,
    flight: (n + 1) + '/' + N_PER_EXPERIMENT, msg: 'EXPERIMENT ' + exp.label + ' (flight ' + (n + 1) + ' of ' + N_PER_EXPERIMENT + ')' };
}

// Manual experiments (photogrammetry): tag the NEXT flight without touching UserCfg.
function labMarkManual(dataRoot, id) {
  const exp = EXPERIMENTS.find(e => e.id === id && e.manual);
  if (!exp) return { ok: false, msg: 'unknown manual experiment' };
  try { fs.writeFileSync(pendingPath(dataRoot), JSON.stringify({ id: exp.id, manual: true })); } catch (e) { return { ok: false, msg: e.message }; }
  return { ok: true, msg: 'Next flight will be tagged: ' + exp.label };
}

// Disable / un-check: restore everything, clear pending.
function labDisable(dataRoot, usercfgPath, backupDir) {
  const st = loadState(dataRoot);
  try { fs.unlinkSync(pendingPath(dataRoot)); } catch (_) {}
  const r = st.baseline ? restoreBaseline(usercfgPath, backupDir, st) : { restored: 0 };
  st.log.push({ t: Date.now(), a: 'disable', restored: r.restored });
  saveState(dataRoot, st);
  return { ok: true, restored: r.restored };
}

// UI status: queue with per-experiment counts + what the next launch would do.
function labStatus(sessions, dataRoot) {
  const st = loadState(dataRoot);
  const queue = EXPERIMENTS.map(e => ({ id: e.id, label: e.label, manual: !!e.manual, hypothesis: e.hypothesis,
    done: countFlown(sessions, e.id), need: e.manual ? null : N_PER_EXPERIMENT }));
  let next;
  try { next = JSON.parse(fs.readFileSync(pendingPath(dataRoot), 'utf8')); } catch (_) { next = null; }
  const nx = lastFlightTagged(sessions) ? { mode: 'control' }
    : (nextExperiment(sessions) ? { mode: 'experiment', id: nextExperiment(sessions).id, label: nextExperiment(sessions).label } : { mode: 'complete' });
  return { ok: true, queue, next: nx, pending: next, hasBaseline: !!st.baseline, adoptions: st.adoptions || {} };
}

// "Apply this setting" — adopt a winning finding permanently: write the test value AND make it the
// new baseline (so control flights / disable keep it). The pre-adoption value is remembered in the
// adoption record so Un-apply can put it back exactly. Same backup + readback discipline as labNext.
function applyFinding(dataRoot, usercfgPath, backupDir, id, undo) {
  const exp = EXPERIMENTS.find(e => e.id === id && !e.manual);
  if (!exp) return { ok: false, msg: 'unknown or manual experiment — manual settings are toggled in the sim' };
  const st = loadState(dataRoot);
  st.adoptions = st.adoptions || {};
  if (!fs.existsSync(usercfgPath)) return { ok: false, msg: 'UserCfg.opt not found' };
  const text = fs.readFileSync(usercfgPath, 'utf8');
  let target;
  if (undo) {
    const ad = st.adoptions[id];
    if (!ad) return { ok: false, msg: 'nothing adopted for ' + id };
    target = ad.prev;
  } else {
    target = exp.testValue;
  }
  if (target == null) return { ok: false, msg: 'no value to write' };
  const w = writeKeyInBlock(text, exp.section, exp.key, target, exp.format);
  if (!w.ok) return { ok: false, msg: 'write failed: ' + w.reason };
  try { backupUsercfg(usercfgPath, backupDir); } catch (_) {}
  fs.writeFileSync(usercfgPath, w.text);
  const verify = _toRegistryUnits(readKeyInBlock(fs.readFileSync(usercfgPath, 'utf8'), exp.section, exp.key), exp.format);
  if (verify !== Math.trunc(target)) return { ok: false, msg: 'readback verify failed' };
  if (undo) {
    st.baseline && (st.baseline[id] = st.adoptions[id].prev);
    st.log.push({ t: Date.now(), a: 'unadopt', id, v: target });
    delete st.adoptions[id];
  } else {
    const prev = st.baseline ? st.baseline[id] : _toRegistryUnits(readKeyInBlock(text, exp.section, exp.key), exp.format);
    st.adoptions[id] = { value: target, prev, ts: Date.now() };
    if (st.baseline) st.baseline[id] = target;
    st.log.push({ t: Date.now(), a: 'adopt', id, v: target });
  }
  saveState(dataRoot, st);
  return { ok: true, value: target, msg: (undo ? 'Restored ' : 'Applied ') + exp.label.split('→')[0].trim() + ' = ' + target };
}

module.exports = { EXPERIMENTS, N_PER_EXPERIMENT, labNext, labStatus, labMarkManual, labDisable, applyFinding,
  readKeyInBlock, writeKeyInBlock, snapshotBaseline, restoreBaseline, pendingPath };
