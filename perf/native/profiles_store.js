'use strict';
// perf/native/profiles_store.js — v6.27.0 SIM PROFILES: the file side (Node only, no Electron).
// main.js's profiles-* IPCs are thin wrappers around createStore(), so the test suite runs the EXACT
// code the app runs — against a COPY of the real UserCfg.opt and the real flight history.
//
// Storage: <userData>/sim_profiles.json  { v:1, profiles:[…], lastApply:{profileId,name,ts,prevValues} }
// Apply:   refuse while MSFS runs → backup (usercfg_backups/) → atomic write → re-read + verify every
//          key → on mismatch put the original back → keep an automatic "Before …" backup profile.
const fs = require('fs'), path = require('path');
const P = require('./profiles.js');
const SCHEMA = require('./usercfg_schema.js');
const { backupUsercfg } = require('./prep.js');

const SAFETY_KEEP = 3;

function _atomic(file, data) {
  const tmp = file + '.tmp-' + process.pid;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

// One record per logged flight that carries a graphics snapshot (2026-07-16 onward).
function loadFlights(sessionsDir) {
  let idx; try { idx = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'index.json'), 'utf8')); } catch (_) { return []; }
  const out = [];
  for (const s of (idx.sessions || [])) {
    let sj = null; try { sj = JSON.parse(fs.readFileSync(path.join(sessionsDir, s.folder, 'summary.json'), 'utf8')); } catch (_) {}
    const st = sj && sj.settings; if (!st || !st.graphics) continue;
    let felt = s.perceptible_count != null ? s.perceptible_count : null;
    const tm = sj.smoothness && sj.smoothness.trim_method;
    if (tm !== 'brake' && tm !== 'movement') {        // the teardown-corrected count lives in the sidecar
      try { const ext = JSON.parse(fs.readFileSync(path.join(sessionsDir, s.folder, 'phases_ext.json'), 'utf8'));
        if (ext && ext.perceptible_count != null) felt = ext.perceptible_count; } catch (_) {}
    }
    const midflight = /mid-flight session/i.test(st.notes || '');
    out.push({ session_id: s.session_id, timestamp: s.timestamp, aircraft: s.aircraft, p99: s.p99_ft_ms, felt,
      dur: s.duration_seconds || (sj.smoothness && sj.smoothness.duration_seconds) || null,
      vram: s.peak_vram_mb, vramTotal: sj.vram && sj.vram.total_vram_mb, sim: s.sim_version,
      excluded: !!(s.excluded || midflight || st.experiment || st.manual_capture), settings: st });
  }
  return out;
}

function createStore(o) {
  const file = () => path.join(o.userData, 'sim_profiles.json');
  const ucfg = () => o.usercfgPath;
  const log = o.log || (() => {});
  const simUp = () => { try { return !!(o.isSimRunning && o.isSimRunning()); } catch (_) { return false; } };
  const write = o.writeAtomic || _atomic;
  const flights = () => loadFlights(o.sessionsDir || path.join(o.userData, 'Sessions'));
  const newId = () => 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

  function load() {
    try { const j = JSON.parse(fs.readFileSync(file(), 'utf8')); if (j && Array.isArray(j.profiles)) return j; } catch (_) {}
    return { v: 1, profiles: [], lastApply: null };
  }
  function save(st) { write(file(), JSON.stringify(st, null, 2)); }
  // The suggestion fills never-logged settings from your newest saved profile (automatic backups
  // excluded — they hold whatever was there, including test settings).
  function buildSuggestion(fl, extra) {
    const prof = load().profiles.filter(p => p.source !== 'safety' && p.source !== 'suggested').slice().reverse();
    return P.suggest(fl, Object.assign({ profiles: prof }, extra || {}));
  }
  function current() { try { return P.readProfileable(fs.readFileSync(ucfg(), 'utf8')); } catch (_) { return null; } }

  function list() {
    const st = load(), fl = flights(), cur = current();
    const runs = P.historyRuns(fl).map(r => Object.assign({}, r, { flights: undefined }));
    const latestSim = (fl[fl.length - 1] || {}).sim || null;
    const suggestion = buildSuggestion(fl, { currentSim: latestSim });
    delete suggestion.runs;
    return { ok: true, found: !!cur, current: cur, currentName: cur ? P.profileName(cur) : null,
      profiles: st.profiles.map(p => Object.assign({}, p, { track: P.trackRecord(p.values, fl) })),
      runs, suggestion, simRunning: simUp(), schema: SCHEMA.schemaMeta(),
      lastApply: st.lastApply ? { profileId: st.lastApply.profileId, name: st.lastApply.name, ts: st.lastApply.ts } : null };
  }

  // a = {source:'captured'|'history'|'suggested'|'copy', runId?, id?, name?, note?}
  function saveProfile(a) {
    a = a || {};
    const st = load();
    let values = null, source = a.source || 'captured', note = a.note || '';
    if (source === 'captured') values = current();
    else if (source === 'history') {
      const run = P.historyRuns(flights()).find(r => r.id === a.runId);
      if (run) { values = run.values; note = note || ('Rebuilt from ' + run.n + ' logged flight' + (run.n === 1 ? '' : 's') + ', ' + P.fmtRange(run.first, run.last) + '.'); }
    } else if (source === 'suggested') {
      const sg = buildSuggestion(flights()); if (sg.ok) { values = sg.values; note = note || ('ABRP Suggested as of ' + new Date().toLocaleDateString('en-US') + ' (based on your ' + P.fmtRange(sg.base.first, sg.base.last) + ' setup).'); }
    } else if (source === 'copy') {
      const src = st.profiles.find(p => p.id === a.id); if (src) { values = src.values; note = src.note; }
    }
    if (!values || !Object.keys(values).length) return { ok: false, msg: 'Nothing to save: those settings could not be read.' };
    let name = (a.name || (source === 'suggested' ? 'ABRP Suggested · ' + P.profileName(values) : P.profileName(values))).slice(0, 80);
    if (source === 'history' && !a.name) {           // same-looking setups recur — the dates tell them apart
      const run = P.historyRuns(flights()).find(r => r.id === a.runId);
      if (run) name = (P.profileName(values) + ' (' + P.fmtRange(run.first, run.last) + ')').slice(0, 80);
    }
    if (source === 'copy') name =(st.profiles.find(p => p.id === a.id).name + ' (copy)').slice(0, 80);
    const p = { id: newId(), name, source, created: new Date().toISOString(), values, note };
    st.profiles.push(p); save(st);
    log('[PROFILES] saved "' + p.name + '" (' + source + ', ' + Object.keys(values).length + ' settings)');
    return { ok: true, profile: p };
  }
  function rename(a) {
    const st = load(), p = st.profiles.find(x => x.id === (a && a.id));
    if (!p || !a.name || !String(a.name).trim()) return { ok: false };
    p.name = String(a.name).trim().slice(0, 80); save(st); return { ok: true };
  }
  function del(a) {
    const st = load(), n = st.profiles.length;
    st.profiles = st.profiles.filter(x => x.id !== (a && a.id)); save(st);
    return { ok: st.profiles.length < n };
  }

  // a = {id: profileId | 'suggested' | 'run-…', includeLod?, undo?}
  function apply(a) {
    a = a || {};
    if (simUp()) return { ok: false, msg: 'MSFS is running. Close the sim first: it only reads its settings at launch and overwrites them when it exits.' };
    const st = load();
    let values = null, name = '';
    if (a.undo) {
      if (!st.lastApply || !st.lastApply.prevValues) return { ok: false, msg: 'Nothing to undo.' };
      values = st.lastApply.prevValues; name = 'your settings from before "' + st.lastApply.name + '"';
    } else if (a.id === 'suggested') { const sg = buildSuggestion(flights()); if (sg.ok) { values = sg.values; name = 'ABRP Suggested'; } }
    else if (/^run-/.test(a.id || '')) { const r = P.historyRuns(flights()).find(x => x.id === a.id); if (r) { values = r.values; name = r.name; } }
    else { const p = st.profiles.find(x => x.id === a.id); if (p) { values = p.values; name = p.name; } }
    if (!values) return { ok: false, msg: 'Profile not found.' };
    const before = fs.readFileSync(ucfg(), 'utf8');
    const prev = P.readProfileable(before);
    const lod = !!(a.includeLod || a.undo);       // undo restores LOD too — exactly what was there
    const r = P.applyToText(before, values, { includeLod: lod });
    if (!r.changed.length) return { ok: true, changed: [], skipped: r.skipped, msg: 'Your sim already matches ' + name + '. Nothing changed.' };
    const backup = backupUsercfg(ucfg(), path.join(o.userData, 'usercfg_backups'));
    write(ucfg(), r.text);
    const bad = P.verify(fs.readFileSync(ucfg(), 'utf8'), values, { includeLod: lod });
    if (bad.length) {                               // never leave a half-applied file behind
      write(ucfg(), before);
      log('[PROFILES] verify failed, original restored: ' + JSON.stringify(bad).slice(0, 300));
      return { ok: false, msg: 'The sim file did not read back as written, so ABRP put the original back. Nothing changed.' };
    }
    if (!a.undo) {
      const when = new Date().toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      st.profiles.push({ id: newId(), name: 'Before "' + name + '" · ' + when, source: 'safety', created: new Date().toISOString(),
        values: prev, note: 'Saved automatically before applying ' + name + '.' });
      const safeties = st.profiles.filter(p => p.source === 'safety');
      if (safeties.length > SAFETY_KEEP) {
        const drop = new Set(safeties.slice(0, safeties.length - SAFETY_KEEP).map(p => p.id));
        st.profiles = st.profiles.filter(p => !drop.has(p.id));
      }
      st.lastApply = { profileId: a.id, name, ts: new Date().toISOString(), prevValues: prev };
    } else st.lastApply = null;
    save(st);
    const n = r.changed.length;
    log('[PROFILES] ' + (a.undo ? 'undo' : 'applied "' + name + '"') + ': ' + n + ' change(s), verified; backup ' + path.basename(backup));
    return { ok: true, changed: r.changed, skipped: r.skipped, backup: path.basename(backup),
      msg: (a.undo ? 'Undone. Restored ' : 'Applied ' + name + ': ') + n + ' setting' + (n === 1 ? '' : 's') + (a.undo ? ' to how they were.' : ' changed and verified. Launch MSFS to fly with it.') };
  }
  return { list, save: saveProfile, rename, del, apply, load, current };
}

module.exports = { createStore, loadFlights, SAFETY_KEEP };
