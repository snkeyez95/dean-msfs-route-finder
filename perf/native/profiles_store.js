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
    const sm = sj.smoothness || {};
    // taxi stutter = the rougher end (v6.3.8 5-phase split; older flights keep it in the sidecar)
    let ph = sm.phases || {};
    if (!ph.arr_taxi && !ph.dep_taxi) { try { ph = JSON.parse(fs.readFileSync(path.join(sessionsDir, s.folder, 'phases_ext.json'), 'utf8')).phases || {}; } catch (_) {} }
    const ts = [ph.dep_taxi, ph.arr_taxi].map(p => p && p.stutter_pct).filter(v => v != null);
    const ac = st.autofps_cfg;
    out.push({ session_id: s.session_id, timestamp: s.timestamp, aircraft: s.aircraft, p99: s.p99_ft_ms, felt,
      dur: s.duration_seconds || sm.duration_seconds || null,
      vram: s.peak_vram_mb, vramTotal: sj.vram && sj.vram.total_vram_mb, sim: s.sim_version,
      gpu: sm.avg_gpu_busy_ms != null ? sm.avg_gpu_busy_ms : null, cpuBound: sm.cpu_bound_pct != null ? sm.cpu_bound_pct : null,
      taxiStut: ts.length ? Math.max(...ts) : null,
      afps: st.autofps_active ? (ac ? ac.min + '–' + ac.max : 'on') : 'off', traffic: st.online_traffic || 'offline',
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
    const prof = load().profiles.filter(p => p.source !== 'safety' && p.source !== 'suggested' && p.source !== 'experiment').slice().reverse();
    return P.suggest(fl, Object.assign({ profiles: prof }, extra || {}));
  }
  function current() { try { return P.readProfileable(fs.readFileSync(ucfg(), 'utf8')); } catch (_) { return null; } }

  // ── experiment helpers ──
  const isUserProfile = p => p && p.source !== 'safety' && p.source !== 'experiment';
  const vramPct = (values, fl) => { const t = P.trackRecord(values, fl); return t && t.vram && t.vramTotal ? t.vram / t.vramTotal : null; };
  // Resolve an experiment's base. No name → the profile your sim matches now (else ABRP Suggested if it
  // matches, else your current settings). 'ABRP Suggested' / 'current' / any saved profile's name.
  function resolveBaseFn(fl, cur, sg) {
    const st = load();
    return name => {
      const n = String(name || '').trim().toLowerCase();
      const mk = (id, nm, values) => ({ id, name: nm, values: Object.assign({}, values), vramPct: vramPct(values, fl) });
      if (!n) {
        const m = st.profiles.filter(isUserProfile).reverse().find(p => cur && P.matches(p.values, cur));
        if (m) return mk(m.id, m.name, m.values);
        if (sg && sg.ok && cur && P.matches(sg.values, cur)) return mk('suggested', 'ABRP Suggested', sg.values);
        return cur ? mk('current', 'Your settings when the experiment was created', cur) : null;
      }
      if (n === 'abrp suggested' || n === 'suggested') return sg && sg.ok ? mk('suggested', 'ABRP Suggested', sg.values) : null;
      if (n === 'current') return cur ? mk('current', 'Your settings when the experiment was created', cur) : null;
      const p = st.profiles.filter(isUserProfile).reverse().find(x => x.name.toLowerCase() === n);
      return p ? mk(p.id, p.name, p.values) : null;
    };
  }
  function experimentsWithVerdicts(st, fl) {
    return st.profiles.filter(p => p.source === 'experiment').map(e => {
      const v = P.experimentVerdict(e, fl);
      return Object.assign({}, e, { result: v, resultsText: P.experimentResultsText(e, v), text: P.toChangeText(e) });
    });
  }
  // Reminders: a finished test waiting for Keep/Revert, or an active test you've stopped flying.
  function nudgesFor(exps, fl) {
    const out = [];
    for (const e of exps) {
      if (e.status !== 'active') continue;
      if (e.result.done) { out.push({ id: e.id, kind: 'finished', text: 'Experiment "' + e.name + '" has its ' + e.result.budget + ' flights: ' + e.result.sentence + ' Keep it or revert?' }); continue; }
      const since = fl.filter(f => !f.excluded && e.applied && f.timestamp > e.applied.slice(0, 19));
      const last2 = since.slice(-2), match = f => { const v = P.fromSnapshot(f.settings); return v && P.matches(e.values, v); };
      if (last2.length === 2 && !last2.some(match)) out.push({ id: e.id, kind: 'drift', text: 'Your last 2 flights weren\'t on experiment "' + e.name + '". Still testing? Apply it again, or end it.' });
    }
    return out;
  }

  function list() {
    const st = load(), fl = flights(), cur = current();
    const runs = P.historyRuns(fl).map(r => Object.assign({}, r, { flights: undefined }));
    const latestSim = (fl[fl.length - 1] || {}).sim || null;
    const suggestion = buildSuggestion(fl, { currentSim: latestSim });
    delete suggestion.runs;
    const exps = experimentsWithVerdicts(st, fl);
    const base = resolveBaseFn(fl, cur, suggestion)(null);
    const proposals = P.proposeExperiments(fl, cur, { experiments: exps.map(e => Object.assign({ verdict: e.verdict || e.result.verdict }, e)), baseName: base ? (base.id === 'current' ? 'current' : base.name) : '' });
    return { ok: true, found: !!cur, current: cur, currentName: cur ? P.profileName(cur) : null,
      profiles: st.profiles.filter(p => p.source !== 'experiment').map(p => Object.assign({}, p, { track: P.trackRecord(p.values, fl), text: P.toChangeText(p) })),
      experiments: exps, proposals, nudges: nudgesFor(exps, fl), defaultBase: base ? { id: base.id, name: base.name } : null,
      runs, suggestion, simRunning: simUp(), schema: SCHEMA.schemaMeta(),
      lastApply: st.lastApply ? { profileId: st.lastApply.profileId, name: st.lastApply.name, ts: st.lastApply.ts } : null };
  }

  // ── 🧪 experiments ──
  // Preview a pasted block (nothing saved).
  function experimentPreview(a) {
    const fl = flights(), cur = current(), sg = buildSuggestion(fl);
    return P.parseChangeText(a && a.text, { resolveBase: resolveBaseFn(fl, cur, sg) });
  }
  // Create from pasted text ({text}) or one of ABRP's proposals ({proposalId}). Never applies.
  function experimentCreate(a) {
    a = a || {};
    let text = a.text;
    if (a.proposalId) {
      const l = list(); const p = (l.proposals.proposals || []).find(x => x.id === a.proposalId);
      if (!p) return { ok: false, msg: 'That suggestion is no longer available — the page will refresh.' };
      text = p.text;
    }
    const r = experimentPreview({ text });
    if (!r.ok) return { ok: false, msg: r.errors.join(' '), parse: r };
    const st = load();
    if (r.kind === 'profile') {                      // a full profile pasted back in ("Copy as text")
      const values = {}; for (const c of r.changes) values[c.id] = c.to;
      const p = { id: newId(), name: r.name.slice(0, 80), source: 'imported', created: new Date().toISOString(), values, note: r.why || 'Imported from text.' };
      st.profiles.push(p); save(st); log('[PROFILES] imported profile "' + p.name + '"');
      return { ok: true, profile: p, kind: 'profile' };
    }
    const changes = r.changes.filter(c => !c.same).map(c => ({ id: c.id, from: c.from, to: c.to }));
    const values = Object.assign({}, r.base.values); for (const c of changes) values[c.id] = c.to;
    const e = { id: newId(), name: r.name.slice(0, 80), source: 'experiment', status: 'draft', created: new Date().toISOString(),
      baseId: r.base.id, baseName: r.base.name, baseValues: r.base.values, values, changes, budget: r.budget, why: r.why, warnings: r.warnings };
    st.profiles.push(e); save(st);
    log('[PROFILES] experiment created "' + e.name + '" on base "' + e.baseName + '": ' + changes.map(c => c.id + ' ' + c.from + '->' + c.to).join(', '));
    return { ok: true, experiment: e, kind: 'experiment' };
  }
  // Keep → fold the change into the base profile (or save a new profile if the base was ABRP
  // Suggested / your current settings). Revert → apply the base. End → just close it.
  function experimentFinish(a) {
    a = a || {};
    const st = load(), e = st.profiles.find(p => p.id === a.id && p.source === 'experiment');
    if (!e) return { ok: false, msg: 'Experiment not found.' };
    const v = P.experimentVerdict(e, flights());
    if (a.action === 'revert') {
      const r = applyValues(e.baseValues, e.baseName, e.baseId, {});
      if (!r.ok) return r;
      const st2 = load(), e2 = st2.profiles.find(p => p.id === e.id);
      Object.assign(e2, { status: 'reverted', verdict: v.verdict, finished: new Date().toISOString(), finalN: v.n }); save(st2);
      const n = (r.changed || []).length;
      return Object.assign(r, { msg: 'Reverted "' + e.name + '". Your sim is back on ' + e.baseName + (n ? ' (' + n + ' setting' + (n === 1 ? '' : 's') + ' changed and verified).' : ' (it already matched).') });
    }
    let msg;
    if (a.action === 'keep') {
      const base = st.profiles.find(p => p.id === e.baseId && isUserProfile(p));
      const stamp = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const what = e.changes.map(c => SCHEMA.BY_ID[c.id].label + ' ' + SCHEMA.display(SCHEMA.BY_ID[c.id], c.to)).join('; ');
      if (base) {
        for (const c of e.changes) base.values[c.id] = c.to;
        base.note = ((base.note ? base.note + ' ' : '') + stamp + ': kept experiment "' + e.name + '" (' + what + ', verdict ' + v.verdict + ').').slice(0, 600);
        msg = 'Kept: "' + base.name + '" now includes ' + what + '.';
      } else {
        const p = { id: newId(), name: (e.baseName === 'ABRP Suggested' ? 'Suggested + ' : '') + e.name, source: 'kept', created: new Date().toISOString(),
          values: Object.assign({}, e.values), note: 'From experiment "' + e.name + '" on ' + e.baseName + ' (verdict ' + v.verdict + ', ' + v.n + ' flights).' };
        st.profiles.push(p);
        msg = 'Kept: saved as the profile "' + p.name + '".';
      }
      Object.assign(e, { status: 'kept', verdict: v.verdict, finished: new Date().toISOString(), finalN: v.n });
    } else {
      Object.assign(e, { status: 'ended', verdict: v.verdict, finished: new Date().toISOString(), finalN: v.n });
      msg = 'Ended "' + e.name + '". Your sim settings were not changed.';
    }
    save(st); log('[PROFILES] experiment ' + e.status + ' "' + e.name + '" (' + v.verdict + ', ' + v.n + ' flights)');
    return { ok: true, msg };
  }
  function exportText(a) {
    const l = list();
    if (a && a.id === 'suggested') return { ok: !!l.suggestion.ok, text: P.toChangeText({ name: 'ABRP Suggested', values: l.suggestion.values, why: 'ABRP Suggested, based on your ' + P.fmtRange(l.suggestion.base.first, l.suggestion.base.last) + ' setup.' }) };
    const p = l.profiles.concat(l.experiments).find(x => x.id === (a && a.id));
    return p ? { ok: true, text: P.toChangeText(p) } : { ok: false };
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
    const st = load();
    let values = null, name = '';
    if (a.undo) {
      if (!st.lastApply || !st.lastApply.prevValues) return { ok: false, msg: 'Nothing to undo.' };
      values = st.lastApply.prevValues; name = 'your settings from before "' + st.lastApply.name + '"';
    } else if (a.id === 'suggested') { const sg = buildSuggestion(flights()); if (sg.ok) { values = sg.values; name = 'ABRP Suggested'; } }
    else if (/^run-/.test(a.id || '')) { const r = P.historyRuns(flights()).find(x => x.id === a.id); if (r) { values = r.values; name = r.name; } }
    else { const p = st.profiles.find(x => x.id === a.id); if (p) { values = p.values; name = p.name; } }
    if (!values) return { ok: false, msg: 'Profile not found.' };
    const r = applyValues(values, name, a.id, a);
    // applying an experiment starts it (draft → active); re-applying an active one is fine
    if (r.ok && !a.undo) {
      const st2 = load(), e = st2.profiles.find(p => p.id === a.id && p.source === 'experiment');
      if (e && (e.status === 'draft' || e.status === 'active')) { e.status = 'active'; e.applied = e.applied || new Date().toISOString(); save(st2); r.msg += ' Experiment started: fly ' + e.budget + ' flights and ABRP will judge it.'; }
    }
    return r;
  }
  function applyValues(values, name, id, a) {
    a = a || {};
    if (simUp()) return { ok: false, msg: 'MSFS is running. Close the sim first: it only reads its settings at launch and overwrites them when it exits.' };
    const st = load();
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
      st.lastApply = { profileId: id, name, ts: new Date().toISOString(), prevValues: prev };
    } else st.lastApply = null;
    save(st);
    const n = r.changed.length;
    log('[PROFILES] ' + (a.undo ? 'undo' : 'applied "' + name + '"') + ': ' + n + ' change(s), verified; backup ' + path.basename(backup));
    return { ok: true, changed: r.changed, skipped: r.skipped, backup: path.basename(backup),
      msg: (a.undo ? 'Undone. Restored ' : 'Applied ' + name + ': ') + n + ' setting' + (n === 1 ? '' : 's') + (a.undo ? ' to how they were.' : ' changed and verified. Launch MSFS to fly with it.') };
  }
  return { list, save: saveProfile, rename, del, apply, load, current, experimentPreview, experimentCreate, experimentFinish, exportText };
}

module.exports = { createStore, loadFlights, SAFETY_KEEP };
