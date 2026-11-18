'use strict';
// v6.33.0 Sim Profiles test flow — one test at a time, nothing silently undoes it, no duplicates.
// Runs the REAL profiles store against COPIES of Dean's sim_profiles.json + UserCfg.opt in a throwaway
// folder (his live files are hash-checked before and after), with his real flight log for verdicts.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const { createStore } = require(path.join(ROOT, 'perf', 'native', 'profiles_store.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
const UD = path.join(process.env.APPDATA || '', 'A Better Route Planner');
const UCFG = path.join(process.env.APPDATA || '', 'Microsoft Flight Simulator 2024', 'UserCfg.opt');
if (!fs.existsSync(path.join(UD, 'sim_profiles.json')) || !fs.existsSync(UCFG)) { console.log('  skip (no real profile data on this machine)\n\n0 passed, 0 failed'); process.exit(0); }
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const liveBefore = [sha(path.join(UD, 'sim_profiles.json')), sha(UCFG)];

function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simtest-'));
  fs.copyFileSync(path.join(UD, 'sim_profiles.json'), path.join(dir, 'sim_profiles.json'));
  fs.copyFileSync(UCFG, path.join(dir, 'UserCfg.opt'));
  const writeAtomic = (f, d) => { fs.writeFileSync(f + '.tmp', d); fs.renameSync(f + '.tmp', f); };
  const st = createStore({ userData: dir, usercfgPath: path.join(dir, 'UserCfg.opt'), sessionsDir: path.join(UD, 'Sessions'), isSimRunning: () => false, writeAtomic, log: () => {} });
  return { dir, st };
}
const exps = st => st.load().profiles.filter(p => p.source === 'experiment');
const block = (name, set) => 'ABRP-PROFILE v1\nname: ' + name + '\nbase: Suggested + Light shafts Ultra\nset: ' + set + '\nflights: 3\nwhy: test';

const dirs = [];
try {
  console.log('1. the running test as the page sees it');
  let { dir, st } = fresh(); dirs.push(dir);
  let L = st.list();
  const running = exps(st).find(e => e.status === 'active');
  if (!running) { console.log('  skip: no active test in your profile file right now'); }
  else {
    ok(L.test && L.test.id === running.id && L.test.name === running.name, 'list() reports the one running test (' + running.name + ')', L.test);
    ok(L.test.matches === true && L.test.off.length === 0, 'and that your sim matches it');
    ok(typeof L.test.n === 'number' && L.test.budget === (running.budget || 3), 'with flight count and budget (' + L.test.n + ' of ' + L.test.budget + ')');

    console.log('2. applying something else asks first (the "ABRP Suggested" slip)');
    let r = st.apply({ id: 'suggested' });
    ok(r.ok === false && r.needsEndTest && r.test.id === running.id, 'applying ABRP Suggested mid-test → "this ends your running test"', r);
    ok(sha(path.join(dir, 'UserCfg.opt')) === sha(UCFG), '…and nothing was written while asking');
    const keepTesting = st.list().test; ok(keepTesting && keepTesting.id === running.id, '"Keep testing" leaves the test running');
    r = st.apply({ undo: true });
    ok((r.ok === false && r.needsEndTest) || (r.ok === false && /Nothing to undo/.test(r.msg)), 'Undo mid-test asks too (or there is nothing to undo)', r);
    r = st.apply({ id: running.id });
    ok(r.ok && !r.needsEndTest, 're-applying the running test itself never asks');

    console.log('3. duplicates');
    const t0 = exps(st).length;
    r = st.experimentCreate({ text: block('Same thing again', 'Contact shadows quality = Ultra') });
    ok(running.changes.some(c => c.id === 'Graphics/ContactShadows/Quality') ? (r.duplicate === true && r.id === running.id && exps(st).length === t0) : true, 'pasting the running change again → "already running", nothing created', r);

    console.log('4. a second test while one runs');
    r = st.experimentCreate({ text: block('Reflections Ultra', 'Raymarched reflections quality = Ultra'), start: true });
    ok(r.ok === false && r.needsEndTest && exps(st).length === t0, '"Start test" on a second one asks first and creates nothing', r);
    r = st.experimentCreate({ text: block('Reflections Ultra', 'Raymarched reflections quality = Ultra') });
    ok(r.ok && r.experiment.status === 'draft' && st.list().test.id === running.id, '"Save for later" keeps it as a draft; the first test keeps running');
    const draftId = r.experiment.id;
    r = st.apply({ id: draftId });
    ok(r.ok === false && r.needsEndTest, 'starting the saved one later still asks while the first runs');

    console.log('5. ending on purpose');
    r = st.apply({ id: 'suggested', endTest: true });
    const after = exps(st).find(e => e.id === running.id);
    ok(r.ok && after.status === 'ended' && /applied/.test(after.endedBy || ''), '"End test and apply" ends the test, then applies', after && after.status);
    ok(st.list().test === null, 'no test running afterwards');
    r = st.apply({ id: draftId });
    ok(r.ok && exps(st).find(e => e.id === draftId).status === 'active' && st.list().test.id === draftId, 'with nothing running, the saved test starts without asking');
  }

  console.log('6. one-step start with no test running');
  ({ dir, st } = fresh()); dirs.push(dir);
  const s0 = st.load(); s0.profiles.forEach(p => { if (p.source === 'experiment' && p.status === 'active') p.status = 'ended'; });
  fs.writeFileSync(path.join(dir, 'sim_profiles.json'), JSON.stringify(s0));
  let r = st.experimentCreate({ text: block('Reflections Ultra', 'Raymarched reflections quality = Ultra'), start: true });
  ok(r.ok && r.started && r.experiment && st.list().test && st.list().test.name === 'Reflections Ultra', '"Start test" creates AND applies in one step', r.msg);
  ok(st.list().test.matches === true, 'sim matches the new test right after');

  console.log('7. knocked off the test (sim exit / manual change)');
  const uc = path.join(dir, 'UserCfg.opt');
  const txt = fs.readFileSync(uc, 'utf8');
  const changed = txt.replace(/(\{SSR[\s\S]*?Quality\s+)(\d+)/, (m, a) => a + '2');
  ok(changed !== txt, 'test setup: put Raymarched reflections back to High in the copied UserCfg');
  fs.writeFileSync(uc, changed);
  const t = st.list().test;
  ok(t && t.matches === false && t.off.some(o => /reflections/i.test(o.label) && /High/.test(o.now) && /Ultra/.test(o.test)), 'list() says the sim no longer matches, and which setting', t && t.off);
  r = st.apply({ id: t.id });
  ok(r.ok && st.list().test.matches === true, '"Re-apply test settings" puts it back without asking');
} catch (e) { ok(false, 'crashed: ' + e.stack); }
finally {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  ok(sha(path.join(UD, 'sim_profiles.json')) === liveBefore[0] && sha(UCFG) === liveBefore[1], 'GUARD: your live sim_profiles.json and UserCfg.opt were never touched');
}

console.log('8. page wiring');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(/h\+=_spTestBanner\(\)\+_spEndAskCard\(\)\+_spStartCard\(\)\+_spClipCard\(\);/.test(html), 'banner, end-test question, start confirmation and clipboard prompt render at the top');
ok(!/_spPaste=\{open:true,text:t,preview:null,fromClip:true\}; spPasteInput\(t\); \}/.test(html) && /_spClip=\{text:t, preview:pv\}/.test(html), 'clipboard no longer opens the edit box by itself — it offers a prompt');
ok(/_SP\.test\?'<span style="font-size:11\.5px;color:var\(--ink3\)">Available after this test<\/span>'/.test(html), 'ideas say "Available after this test" while one runs');
ok(/draft:'SAVED FOR LATER'/.test(html) && /Start test<\/button>'\+moreBtn/.test(html), 'saved tests read "Saved for later" with a Start test button');
ok(/✓ Applied to your sim/.test(html) && /End test early/.test(html) && /Keep it<\/button>/.test(html), 'running card: Applied / End test early; finished: Keep it / Revert');
ok(/if\(r&&r\.needsEndTest\)\{/.test(html) && /spUndo\(true\)/.test(html), 'Apply and Undo route through the "this ends your running test" question');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
