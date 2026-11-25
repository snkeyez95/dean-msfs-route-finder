'use strict';
// perf/native/profiles_store.js — v6.27.0 SIM PROFILES: the file side (Node only, no Electron).
// main.js's profiles-* IPCs are thin wrappers around createStore(), so the test suite runs the EXACT
// code the app runs — against a COPY of the real UserCfg.opt and the real flight history.
//
// Storage: <userData>/sim_profiles.json  { v:1, profiles:[…], lastApply:{profileId,name,ts,prevValues},
//          baseline:{values,created,note}, suggested:{adds:[…]}, flyNext, notice, inboxNotice }   (v6.37.0)
// Apply:   refuse while MSFS runs → backup (usercfg_backups/) → atomic write → re-read + verify every
//          key → on mismatch put the original back → keep an automatic "Before …" backup profile.
//
// v6.37.0 — THREE PROFILES (Dean's model):
//   🔒 Baseline       the known-good. Frozen: no code path changes it after it's set up.
//   ⭐ ABRP Suggested  Baseline + only the changes a test proved (Dean adds each one with one click).
//   🧪 Experimental   ABRP Suggested + the ONE change under test (the active experiment).
// flyNext ('baseline'|'suggested'|'experimental') is the dot on the page: what Launch + Capture loads.
// Claude's tests arrive through <userData>/inbox/*.txt (same ABRP-PROFILE text as a paste).
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
  const out = [], taxiPool = [];
  for (const s of (idx.sessions || [])) {
    let sj = null; try { sj = JSON.parse(fs.readFileSync(path.join(sessionsDir, s.folder, 'summary.json'), 'utf8')); } catch (_) {}
    const st = sj && sj.settings; if (!st) continue;
    // v6.36.0: every flight's taxi stutter per airport END goes into the pool that experiment
    // verdicts judge against — including flights from before graphics snapshots existed.
    const ends = _taxiEnds(s, sj, sessionsDir);
    const excl = !!(s.excluded || /mid-flight session/i.test(st.notes || '') || st.experiment || st.manual_capture);
    if (!excl) for (const e of ends) taxiPool.push({ sid: s.session_id, aircraft: s.aircraft, icao: e.icao, end: e.end, stut: e.stut });
    if (!st.graphics) continue;
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
      taxiStut: ts.length ? Math.max(...ts) : null, taxiEnds: ends,
      afps: st.autofps_active ? (ac ? ac.min + '–' + ac.max : 'on') : 'off', traffic: st.online_traffic || 'offline',
      excluded: !!(s.excluded || midflight || st.experiment || st.manual_capture), settings: st });
  }
  out.taxiPool = taxiPool;      // rides on the array so every existing caller passes it through untouched
  return out;
}
function _taxiEnds(s, sj, sessionsDir) {
  let ph = (sj.smoothness && sj.smoothness.phases) || {};
  if (!ph.arr_taxi && !ph.dep_taxi) { try { ph = JSON.parse(fs.readFileSync(path.join(sessionsDir, s.folder, 'phases_ext.json'), 'utf8')).phases || {}; } catch (_) {} }
  const st = sj.settings || {}, out = [];
  for (const [end, k, ic] of [['dep', 'dep_taxi', s.dep_icao || st.dep_icao], ['arr', 'arr_taxi', s.arr_icao || st.arr_icao]]) {
    const v = ph[k] && ph[k].stutter_pct;
    if (ic && v != null) out.push({ end, icao: ic, stut: v });
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
  // Resolve an experiment's base. v6.37.0: no name / 'ABRP Suggested' → the stored ABRP Suggested
  // (Baseline + proven adds); 'Baseline' → the Baseline. Older stores (before set-up) keep the old rules:
  // the profile your sim matches now, else the history suggestion, else your current settings.
  function resolveBaseFn(fl, cur, sg) {
    const st = load();
    return name => {
      const n = String(name || '').trim().toLowerCase();
      const mk = (id, nm, values) => ({ id, name: nm, values: Object.assign({}, values), vramPct: vramPct(values, fl) });
      if (st.baseline) {
        if (!n || n === 'abrp suggested' || n === 'suggested' || /^suggested \+/.test(n)) return mk('suggested', 'ABRP Suggested', suggestedValues(st));
        if (n === 'baseline') return mk('baseline', 'Baseline', st.baseline.values);
      }
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
  // Reminder (menu badge): a finished test waiting for Add / Drop. v6.37.0: flying Baseline or ABRP
  // Suggested mid-test is normal now (only flights on the test count), so there's no "drifted" nudge.
  function nudgesFor(exps) {
    const out = [];
    for (const e of exps) {
      if (e.status !== 'active' || !e.result.done) continue;
      out.push({ id: e.id, kind: 'finished', text: 'Test "' + e.name + '" has its ' + e.result.budget + ' flights: ' + e.result.sentence });
    }
    return out;
  }

  // v6.33.0 — the ONE running test (newest applied active experiment), with what the page needs to say
  // where you are: flight n of budget, finished, and whether the sim still matches it (a sim exit, an Undo
  // or another profile can knock it off). null when no test is running.
  function activeTest(st) {
    const a = st.profiles.filter(p => p.source === 'experiment' && p.status === 'active');
    a.sort((x, y) => String(y.applied || y.created).localeCompare(String(x.applied || x.created)));
    return a[0] || null;
  }
  function testSummary(exps, cur) {
    const a = exps.filter(e => e.status === 'active').sort((x, y) => String(y.applied || y.created).localeCompare(String(x.applied || x.created)));
    const e = a[0]; if (!e) return null;
    const r = e.result || {};
    const off = cur ? Object.keys(e.values).filter(k => { const key = SCHEMA.BY_ID[k]; return key && !key.lod && (k in cur) && !P.matches({ [k]: e.values[k] }, { [k]: cur[k] }); })
      .map(k => { const key = SCHEMA.BY_ID[k]; return { id: k, label: key.label, now: SCHEMA.display(key, cur[k]), test: SCHEMA.display(key, e.values[k]) }; }) : [];
    return { id: e.id, name: e.name, baseName: e.baseName, n: Math.min(r.n || 0, r.budget || e.budget || 3), budget: r.budget || e.budget || 3,
      done: !!r.done, verdict: r.verdict || null, sentence: r.sentence || '', matches: !!cur && off.length === 0, off, others: a.length - 1 };
  }

  // ── v6.37.0 · Baseline · ABRP Suggested · Experimental ─────────────────────────────────────────
  const LABEL = { baseline: 'Baseline', suggested: 'ABRP Suggested', experimental: 'Experimental' };
  function suggestedValues(st) {
    if (!st.baseline) return null;
    const v = Object.assign({}, st.baseline.values);
    for (const a of (st.suggested && st.suggested.adds) || []) v[a.id] = a.to;
    return v;
  }
  function targetValues(st, who) {
    if (who === 'baseline') return st.baseline ? st.baseline.values : null;
    if (who === 'suggested') return suggestedValues(st);
    if (who === 'experimental') { const t = activeTest(st); return t ? t.values : null; }
    return null;
  }
  // First open after the update: freeze today's ABRP Suggested (the history pick) as the Baseline, carry
  // every test you already kept into ABRP Suggested, and put the dot on whatever your sim matches.
  function migrate(st, fl, cur) {
    if (st.baseline) return false;
    const sg = buildSuggestion(fl);
    const base = sg.ok ? sg.values : cur;
    if (!base) return false;
    try { if (fs.existsSync(file())) fs.copyFileSync(file(), path.join(o.userData, 'sim_profiles.pre-v6.37.json')); } catch (_) {}
    st.baseline = { values: Object.assign({}, base), created: new Date().toISOString(),
      note: sg.ok ? ('Your ' + P.fmtRange(sg.base.first, sg.base.last) + ' setup: ' + sg.base.n + ' flights, P99 ' + sg.base.p99 + ' ms, ' + sg.base.feltHr + ' felt stutters/hr.')
                  : 'Your settings when Sim Profiles first set up your Baseline.' };
    const adds = [];
    const kept = st.profiles.filter(p => p.source === 'experiment' && p.status === 'kept')
      .sort((a, b) => String(a.finished || '').localeCompare(String(b.finished || '')));
    for (const e of kept) {
      const v = P.experimentVerdict(e, fl);
      for (const c of e.changes || []) {
        if (P._equal(base[c.id], c.to)) continue;
        const rec = { id: c.id, from: base[c.id], to: c.to, name: e.name, expId: e.id, verdict: v.verdict, n: v.n, added: e.finished || new Date().toISOString() };
        const i = adds.findIndex(x => x.id === c.id); if (i >= 0) adds[i] = rec; else adds.push(rec);
      }
    }
    st.suggested = { adds };
    const sv = suggestedValues(st), act = activeTest(st);
    st.flyNext = act && cur && P.matches(act.values, cur) ? 'experimental'
      : cur && P.matches(sv, cur) ? 'suggested' : cur && P.matches(base, cur) ? 'baseline' : 'suggested';
    log('[PROFILES] v6.37.0 set up: Baseline frozen (' + Object.keys(base).length + ' settings), ABRP Suggested +' + adds.length + ', flies next: ' + st.flyNext);
    return true;
  }
  // Load + one-time set-up + the automatic dot move (a test that has all its flights hands the dot back
  // to ABRP Suggested, with a note saying so). Everything below starts here.
  function ready() {
    const st = load(), fl = flights(), cur = current();
    let dirty = migrate(st, fl, cur);
    if (st.baseline) {
      if (!LABEL[st.flyNext]) { st.flyNext = 'suggested'; dirty = true; }
      if (st.flyNext === 'experimental') {
        const t = activeTest(st);
        if (!t) { st.flyNext = 'suggested'; dirty = true; }
        else if (P.experimentVerdict(t, fl).done) {
          st.flyNext = 'suggested'; dirty = true;
          st.notice = { ts: new Date().toISOString(), text: 'Test “' + t.name + '” has all its flights, so your next flight flies ABRP Suggested again.' };
        }
      }
    }
    if (dirty) save(st);
    return { st, fl, cur };
  }
  // Which of the three your sim is on right now (the selected one wins a tie).
  function inSimOf(st, cur) {
    if (!cur || !st.baseline) return null;
    for (const w of [st.flyNext, 'experimental', 'suggested', 'baseline']) { const v = targetValues(st, w); if (v && P.matches(v, cur)) return w; }
    return null;
  }
  function diffLines(fromVals, toVals) {
    return P.diff(fromVals || {}, toVals || {}).map(d => { const k = SCHEMA.BY_ID[d.id]; return { id: d.id, label: k.label, now: SCHEMA.display(k, d.from), want: SCHEMA.display(k, d.to) }; });
  }
  // The one line at the top of the page: where you are, and what (if anything) needs you.
  function statusFor(st, cur, test) {
    if (!cur) return { kind: 'nosim' };
    if (!st.baseline) return { kind: 'setup' };
    if (test && test.done) return { kind: 'decide', test };
    const target = st.flyNext, tv = targetValues(st, target), inSim = inSimOf(st, cur);
    if (tv && P.matches(tv, cur)) return { kind: target === 'experimental' ? 'running' : 'ok', target, test };
    if (inSim) return { kind: 'pending', target, inSim, test };
    const other = st.profiles.filter(isUserProfile).reverse().find(p => P.matches(p.values, cur));
    return { kind: 'off', target, test, other: other ? other.name : null, diff: diffLines(cur, tv) };
  }
  // Apply one of the three to the sim file (sim must be closed). Marks a test as started when it's the test.
  function applyTarget(st, who) {
    const values = targetValues(st, who);
    if (!values) return { ok: false, msg: who === 'experimental' ? 'There is no test to fly. Start one first.' : 'Not set up yet.' };
    const t = who === 'experimental' ? activeTest(st) : null;
    const r = applyValues(values, t ? LABEL[who] + ' (' + t.name + ')' : LABEL[who], who, {});
    if (r.ok && t) { const s2 = load(), e = s2.profiles.find(p => p.id === t.id); if (e && !e.applied) { e.applied = new Date().toISOString(); save(s2); } }
    return r;
  }
  // The dot. Picking one with the sim closed applies it straight away; with the sim running it waits.
  function flyNext(a) {
    const who = a && a.to;
    const { st } = ready();
    if (!LABEL[who]) return { ok: false, msg: 'Unknown profile.' };
    if (!st.baseline) return { ok: false, msg: 'Your Baseline isn\'t set up yet.' };
    if (who === 'experimental' && !activeTest(st)) return { ok: false, msg: 'There is no test running. Start one from the ideas below first.' };
    st.flyNext = who; st.notice = null; save(st);
    log('[PROFILES] flies next: ' + who);
    if (simUp()) return { ok: true, pending: true, msg: LABEL[who] + ' flies next. MSFS is running, so it applies at your next Launch + Capture (or pick it again once the sim is closed).' };
    const r = applyTarget(load(), who);
    if (r.ok) r.msg = LABEL[who] + ' flies next. ' + ((r.changed || []).length ? r.changed.length + ' setting' + (r.changed.length === 1 ? '' : 's') + ' changed and verified.' : 'Your sim already matched it.');
    return r;
  }
  // A test that passed (smoother or no cost, and under AutoFPS's video-memory line) joins ABRP Suggested.
  function addTest(a) {
    const { st, fl } = ready();
    const e = st.profiles.find(p => p.id === (a && a.id) && p.source === 'experiment');
    if (!e || !st.baseline) return { ok: false, msg: 'Test not found.' };
    const v = P.experimentVerdict(e, fl);
    if (!v.done) return { ok: false, msg: 'This test needs ' + v.budget + ' flights before it can be judged (' + v.n + ' so far).' };
    if (!v.passed) return { ok: false, msg: 'This test didn\'t pass (' + v.verdict + '), so it can\'t join ABRP Suggested.' };
    st.suggested = st.suggested || { adds: [] };
    for (const c of e.changes || []) {
      const rec = { id: c.id, from: st.baseline.values[c.id], to: c.to, name: e.name, expId: e.id, verdict: v.verdict, n: v.n, added: new Date().toISOString() };
      const i = st.suggested.adds.findIndex(x => x.id === c.id);
      if (P._equal(st.baseline.values[c.id], c.to)) { if (i >= 0) st.suggested.adds.splice(i, 1); }
      else if (i >= 0) st.suggested.adds[i] = rec; else st.suggested.adds.push(rec);
    }
    Object.assign(e, { status: 'kept', verdict: v.verdict, finished: new Date().toISOString(), finalN: v.n });
    st.flyNext = 'suggested'; st.notice = null; save(st);
    log('[PROFILES] added test "' + e.name + '" to ABRP Suggested (' + v.verdict + ', ' + v.n + ' flights)');
    return Object.assign(afterChange(), { msg: 'Added ' + e.name + ' to ABRP Suggested. It flies next.' });
  }
  function dropTest(a) {
    const { st, fl } = ready();
    const e = st.profiles.find(p => p.id === (a && a.id) && p.source === 'experiment');
    if (!e) return { ok: false, msg: 'Test not found.' };
    const v = P.experimentVerdict(e, fl);
    Object.assign(e, { status: 'dropped', verdict: v.verdict, finished: new Date().toISOString(), finalN: v.n });
    if (st.flyNext === 'experimental') st.flyNext = 'suggested';
    st.notice = null; save(st);
    log('[PROFILES] dropped test "' + e.name + '" (' + v.verdict + ', ' + v.n + ' flights)');
    return Object.assign(afterChange(), { msg: 'Dropped ' + e.name + '. ABRP Suggested flies next.' });
  }
  // Take a proven change back out of ABRP Suggested (it returns to the Baseline's value).
  function removeAdd(a) {
    const { st } = ready();
    const adds = (st.suggested && st.suggested.adds) || [], i = adds.findIndex(x => x.id === (a && a.id));
    if (i < 0) return { ok: false, msg: 'That change isn\'t in ABRP Suggested.' };
    const gone = adds.splice(i, 1)[0]; save(st);
    log('[PROFILES] removed ' + gone.id + ' from ABRP Suggested');
    return Object.assign(afterChange(), { msg: 'Removed ' + SCHEMA.BY_ID[gone.id].label + ' ' + SCHEMA.display(SCHEMA.BY_ID[gone.id], gone.to) + ' from ABRP Suggested.' });
  }
  // After ABRP Suggested changes: if it's the one flying next and the sim is closed, put it in the sim now.
  function afterChange() {
    const st = load();
    if (st.flyNext !== 'suggested' || simUp()) return { ok: true, pending: simUp() };
    const r = applyTarget(st, 'suggested');
    return { ok: r.ok, changed: r.changed, applyMsg: r.msg };
  }
  // "Make these a test": settings you changed in-sim become the Experimental test (base ABRP Suggested).
  function makeTestFromSim() {
    const { st, cur } = ready();
    if (!st.baseline || !cur) return { ok: false, msg: 'Not set up yet.' };
    if (activeTest(st)) return { ok: false, msg: 'A test is already running. Finish or drop it first.' };
    const changes = P.diff(suggestedValues(st), cur).map(d => ({ id: d.id, from: d.from, to: d.to }));
    if (!changes.length) return { ok: false, msg: 'Your sim matches ABRP Suggested: there is nothing new to test.' };
    const name = changes.length === 1 ? SCHEMA.BY_ID[changes[0].id].label.replace(/ quality$/i, '') + ' ' + SCHEMA.display(SCHEMA.BY_ID[changes[0].id], changes[0].to).split(' · ').pop() : 'Your in-sim changes';
    const text = P.toChangeText({ name, baseName: 'ABRP Suggested', changes, budget: 3, why: 'Changed in the sim on ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + '.' });
    return experimentCreate({ text, start: true });
  }
  // Start a saved ("up next") test.
  function startTest(a) {
    const st = load(), e = st.profiles.find(p => p.id === (a && a.id) && p.source === 'experiment');
    if (!e) return { ok: false, msg: 'Test not found.' };
    const run = activeTest(st);
    if (run && run.id !== e.id) return { ok: false, msg: '“' + run.name + '” is still running. This one starts after you add or drop it.' };
    e.status = 'active'; st.flyNext = 'experimental'; st.notice = null; save(st);
    if (simUp()) return { ok: true, pending: true, msg: 'Test started: ' + e.name + '. It applies at your next Launch + Capture.' };
    const r = applyTarget(load(), 'experimental');
    if (r.ok) r.msg = 'Test started: ' + e.name + '. Fly ' + (e.budget || 3) + ' flights and ABRP will judge it.';
    return r;
  }
  function dismissNotice() { const st = load(); st.notice = null; if (st.inboxNotice) st.inboxNotice.seen = true; save(st); return { ok: true }; }

  // ── 📥 inbox: Claude drops an ABRP-PROFILE text file in <userData>/inbox; ABRP picks it up ──
  function importInbox() {
    const dir = path.join(o.userData, 'inbox'), out = [];
    let names = [];
    try { fs.mkdirSync(dir, { recursive: true }); names = fs.readdirSync(dir).filter(n => /\.(txt|abrp)$/i.test(n) && fs.statSync(path.join(dir, n)).isFile()); } catch (_) { return out; }
    if (!names.length) return out;
    const move = (n, sub) => { try { fs.mkdirSync(path.join(dir, sub), { recursive: true }); fs.renameSync(path.join(dir, n), path.join(dir, sub, new Date().toISOString().replace(/[:.]/g, '-') + '_' + n)); } catch (_) {} };
    for (const n of names.sort()) {
      let text = ''; try { text = fs.readFileSync(path.join(dir, n), 'utf8'); } catch (_) { continue; }
      const busy = !!activeTest(load());
      const r = experimentCreate({ text, start: !busy, fromInbox: true });
      if (r.ok && r.kind === 'experiment') {
        move(n, 'done');
        out.push({ file: n, ok: true, name: r.experiment.name, queued: busy });
      } else if (r.duplicate) {
        move(n, 'done'); out.push({ file: n, ok: true, name: n, duplicate: true, msg: r.msg });
      } else {
        move(n, 'rejected'); out.push({ file: n, ok: false, msg: r.msg || 'Not a test ABRP could read.' });
      }
    }
    const st = load(), last = out[out.length - 1];
    st.inboxNotice = { ts: new Date().toISOString(), items: out, seen: false };
    save(st);
    log('[PROFILES] inbox: ' + out.map(x => (x.ok ? 'ok ' : 'rejected ') + (x.name || x.file)).join('; '));
    return out;
  }

  // ── Launch + Capture pre-flight: put the selected profile in the sim before MSFS starts ──
  // a = {dry?:true, to?:'baseline'|…}   dry → only says what it would do (for the launch dialog).
  function preflight(a) {
    a = a || {};
    const imported = importInbox();          // also on the dry run, so the launch dialog names the right test
    let { st, fl, cur } = ready();
    if (!st.baseline) return { ok: true, skipped: true, line: 'Sim Profiles isn\'t set up yet: your settings are left as they are.' };
    if (a.to && LABEL[a.to] && !(a.to === 'experimental' && !activeTest(st))) { st.flyNext = a.to; save(st); st = load(); }
    const who = st.flyNext, values = targetValues(st, who), t = who === 'experimental' ? activeTest(st) : null;
    const v = t ? P.experimentVerdict(t, fl) : null;
    const name = LABEL[who] + (t ? ' — ' + t.name + ' (test flight ' + Math.min((v.n || 0) + 1, v.budget) + ' of ' + v.budget + ')' : '');
    const changes = cur && values ? P.diff(cur, values) : [];
    const plan = { ok: true, target: who, name, icon: who === 'baseline' ? '🔒' : who === 'suggested' ? '⭐' : '🧪', changes: changes.length, imported };
    if (a.dry) return Object.assign(plan, { line: plan.icon + ' ' + name + (changes.length ? ' · ' + changes.length + ' setting' + (changes.length === 1 ? '' : 's') + ' will be set' : ' · already in your sim') });
    if (!changes.length) return Object.assign(plan, { line: plan.icon + ' ' + name + ' · already in your sim' });
    if (simUp()) return Object.assign(plan, { ok: false, line: 'Graphics: MSFS is running, so ' + LABEL[who] + ' could not be applied.' });
    const r = applyTarget(st, who);
    return Object.assign(plan, { ok: r.ok, line: r.ok ? (plan.icon + ' ' + name + ' · ' + r.changed.length + ' setting' + (r.changed.length === 1 ? '' : 's') + ' set and verified') : ('Graphics: ' + r.msg) });
  }

  function list() {
    const { fl } = ready(); importInbox();
    const st = load(), cur = current();
    const runs = P.historyRuns(fl).map(r => Object.assign({}, r, { flights: undefined }));
    const latestSim = (fl[fl.length - 1] || {}).sim || null;
    const suggestion = buildSuggestion(fl, { currentSim: latestSim });
    delete suggestion.runs;
    const exps = experimentsWithVerdicts(st, fl);
    const base = resolveBaseFn(fl, cur, suggestion)(null);
    const sv = suggestedValues(st);
    // test ideas step up from ABRP Suggested (what you fly), not from whatever the sim happens to hold
    const proposals = P.proposeExperiments(fl, sv || cur, { experiments: exps.map(e => Object.assign({ verdict: e.verdict || e.result.verdict }, e)), baseName: base ? (base.id === 'current' ? 'current' : base.name) : '' });
    const test = testSummary(exps, cur);
    const lbl = c => { const k = SCHEMA.BY_ID[c.id]; return { label: k.label, fromText: SCHEMA.display(k, c.from), toText: SCHEMA.display(k, c.to) }; };
    const act = activeTest(st);
    const three = st.baseline ? {
      baseline: { values: st.baseline.values, created: st.baseline.created, note: st.baseline.note, track: P.trackRecord(st.baseline.values, fl), check: P.baselineCheck(st.baseline.values, fl) },
      suggested: { values: sv, adds: ((st.suggested && st.suggested.adds) || []).map(a => Object.assign({}, a, lbl(a))), track: P.trackRecord(sv, fl) },
      experimental: act ? { id: act.id, name: act.name, values: act.values, changes: (act.changes || []).map(c => Object.assign({}, c, lbl(c))), track: P.trackRecord(act.values, fl) } : null
    } : null;
    return { ok: true, found: !!cur, current: cur, currentName: cur ? P.profileName(cur) : null, test,
      three, flyNext: st.flyNext || null, inSim: inSimOf(st, cur), status: statusFor(st, cur, test),
      notice: st.notice || null, inboxNotice: st.inboxNotice && !st.inboxNotice.seen ? st.inboxNotice : null,
      queue: exps.filter(e => e.status === 'draft').map(e => ({ id: e.id, name: e.name })),
      profiles: st.profiles.filter(p => p.source !== 'experiment').map(p => Object.assign({}, p, { track: P.trackRecord(p.values, fl), text: P.toChangeText(p) })),
      experiments: exps, proposals, nudges: nudgesFor(exps), defaultBase: base ? { id: base.id, name: base.name } : null,
      runs, suggestion, simRunning: simUp(), schema: SCHEMA.schemaMeta(), vramCap: P.VRAM_CAP,
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
    // v6.33.0: the same change as a test that's already running or saved → point at it, don't copy it
    const sig = cs => cs.map(c => c.id + '=' + JSON.stringify(c.to)).sort().join('|');
    const dup = st.profiles.find(p => p.source === 'experiment' && (p.status === 'active' || p.status === 'draft') && sig(p.changes || []) === sig(changes));
    if (dup) return { ok: false, duplicate: true, id: dup.id, status: dup.status, msg: '"' + dup.name + '" is already ' + (dup.status === 'active' ? 'running' : 'saved') + '. Nothing new was created.' };
    if (!changes.length) return { ok: false, msg: 'ABRP Suggested already has every setting in that block, so there is nothing to test.' };
    // v6.37.0: one test at a time. A second one waits as "up next" — nothing to answer, nothing undone.
    const running = activeTest(st);
    const values = Object.assign({}, r.base.values); for (const c of changes) values[c.id] = c.to;
    const e = { id: newId(), name: r.name.slice(0, 80), source: 'experiment', status: 'draft', created: new Date().toISOString(),
      baseId: r.base.id, baseName: r.base.name, baseValues: r.base.values, values, changes, budget: r.budget, why: r.why, warnings: r.warnings,
      from: a.fromInbox ? 'inbox' : 'page' };
    st.profiles.push(e); save(st);
    log('[PROFILES] experiment created "' + e.name + '" on base "' + e.baseName + '": ' + changes.map(c => c.id + ' ' + c.from + '->' + c.to).join(', '));
    if (a.start && running) return { ok: true, experiment: e, kind: 'experiment', started: false, queued: true,
      msg: 'Saved “' + e.name + '” as up next. It starts when you add or drop “' + running.name + '”.' };
    if (a.start) {                                   // "Start test" = create + the dot moves to Experimental
      const sr = startTest({ id: e.id });
      return Object.assign(sr, { experiment: e, kind: 'experiment', started: sr.ok });
    }
    return { ok: true, experiment: e, kind: 'experiment' };
  }
  // Keep → fold the change into the base profile (or save a new profile if the base was ABRP
  // Suggested / your current settings). Revert → apply the base. End → just close it.
  function experimentFinish(a) {
    a = a || {};
    const st = load(), e = st.profiles.find(p => p.id === a.id && p.source === 'experiment');
    if (!e) return { ok: false, msg: 'Experiment not found.' };
    // v6.37.0: a finished test is either added to ABRP Suggested or dropped (end / revert = drop)
    if (st.baseline) return a.action === 'keep' || a.action === 'add' ? addTest({ id: e.id }) : dropTest({ id: e.id });
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
    if (a && l.three && l.three[a.id] && l.three[a.id].values) {
      const t = l.three[a.id];
      return { ok: true, text: P.toChangeText({ name: { baseline: 'Baseline', suggested: 'ABRP Suggested', experimental: 'Experimental' }[a.id], values: t.values, why: a.id === 'suggested' ? 'Baseline + ' + (t.adds.map(x => x.name).join(' + ') || 'nothing yet') + '.' : (t.note || '') }) };
    }
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
    } else if (a.id === 'suggested' || a.id === 'baseline' || a.id === 'experimental') {
      if (st.baseline) return flyNext({ to: a.id });   // v6.37.0: one of the three = pick its dot
      if (a.id === 'suggested') { const sg = buildSuggestion(flights()); if (sg.ok) { values = sg.values; name = 'ABRP Suggested'; } }
    }
    else if (/^run-/.test(a.id || '')) { const r = P.historyRuns(flights()).find(x => x.id === a.id); if (r) { values = r.values; name = r.name; } }
    else {
      const p = st.profiles.find(x => x.id === a.id);
      if (p && p.source === 'experiment') return startTest({ id: p.id });   // a test starts through the dot
      if (p) { values = p.values; name = p.name; }
    }
    if (!values) return { ok: false, msg: 'Profile not found.' };
    // v6.37.0: applying another saved setup (or Undo) never ends a running test — flights flown on
    // something else simply don't count toward it.
    return applyValues(values, name, a.id, a);
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
  return { list, save: saveProfile, rename, del, apply, load, current, experimentPreview, experimentCreate, experimentFinish, exportText,
    flyNext, addTest, dropTest, removeAdd, makeTestFromSim, startTest, dismissNotice, importInbox, preflight };
}

module.exports = { createStore, loadFlights, SAFETY_KEEP };
