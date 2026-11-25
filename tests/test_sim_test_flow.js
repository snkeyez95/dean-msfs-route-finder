'use strict';
// Sim Profiles test flow — one test at a time, nothing silently undoes it, no duplicates.
// v6.33.0 asked "this ends your running test?" before anything else was applied. v6.37.0 replaces that
// question with the "flies next" dot: flying Baseline or ABRP Suggested mid-test is normal (only flights
// on the test count), a second test waits as "up next", and nothing ever ends a test except Add / Drop.
// Runs the REAL store against COPIES of Dean's sim_profiles.json + UserCfg.opt (live files hash-checked).
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const ROOT = path.resolve(__dirname, '..');
const { createStore } = require(path.join(ROOT, 'perf', 'native', 'profiles_store.js'));
const P = require(path.join(ROOT, 'perf', 'native', 'profiles.js'));
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
const UD = path.join(process.env.APPDATA || '', 'A Better Route Planner');
const UCFG = path.join(process.env.APPDATA || '', 'Microsoft Flight Simulator 2024', 'UserCfg.opt');
if (!fs.existsSync(path.join(UD, 'sim_profiles.json')) || !fs.existsSync(UCFG)) { console.log('  skip (no real profile data on this machine)\n\n0 passed, 0 failed'); process.exit(0); }
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const liveBefore = [sha(path.join(UD, 'sim_profiles.json')), sha(UCFG)];

const dirs = [];
function fresh() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'simtest-')); dirs.push(dir);
  fs.copyFileSync(path.join(UD, 'sim_profiles.json'), path.join(dir, 'sim_profiles.json'));
  fs.copyFileSync(UCFG, path.join(dir, 'UserCfg.opt'));
  const st = createStore({ userData: dir, usercfgPath: path.join(dir, 'UserCfg.opt'), sessionsDir: path.join(UD, 'Sessions'), isSimRunning: () => false, log: () => {} });
  // start every scenario with no test running
  const s0 = st.load(); s0.profiles.forEach(p => { if (p.source === 'experiment' && (p.status === 'active' || p.status === 'draft')) p.status = 'ended'; });
  fs.writeFileSync(path.join(dir, 'sim_profiles.json'), JSON.stringify(s0));
  st.list();
  return { dir, st, uc: path.join(dir, 'UserCfg.opt') };
}
const block = (name, set) => 'ABRP-PROFILE v1\nname: ' + name + '\nset: ' + set + '\nflights: 3\nwhy: test';
const exps = st => st.load().profiles.filter(p => p.source === 'experiment');

try {
  console.log('1. starting a test');
  let { st, uc } = fresh();
  let r = st.experimentCreate({ text: block('Reflections Ultra', 'Raymarched reflections quality = Ultra'), start: true });
  let L = st.list();
  ok(r.ok && r.started && L.test && L.test.name === 'Reflections Ultra', '"Start test" creates AND starts it in one step', r.msg);
  ok(L.test.matches === true && L.flyNext === 'experimental', 'the sim matches the test and the dot is on Experimental');

  console.log('2. nothing silently ends it');
  r = st.apply({ id: 'suggested' });
  L = st.list();
  ok(r.ok && L.test && L.test.name === 'Reflections Ultra' && L.flyNext === 'suggested', 'picking ABRP Suggested mid-test keeps the test (the old "ABRP Suggested" slip can’t happen)');
  r = st.apply({ undo: true });
  ok(r.ok && st.list().test && st.list().test.name === 'Reflections Ultra', 'Undo mid-test keeps the test too');
  r = st.apply({ id: 'experimental' });
  ok(r.ok && st.list().status.kind === 'running', 'picking Experimental again puts the test back in the sim');

  console.log('3. duplicates');
  const n0 = exps(st).length;
  r = st.experimentCreate({ text: block('Same thing again', 'Raymarched reflections quality = Ultra') });
  ok(r.duplicate === true && exps(st).length === n0, 'pasting the running change again → "already running", nothing created', r);

  console.log('4. a second test while one runs');
  r = st.experimentCreate({ text: block('Clouds High', 'Volumetric clouds quality = High'), start: true });
  L = st.list();
  ok(r.ok && r.queued && L.queue.length === 1 && L.test.name === 'Reflections Ultra', '"Start test" on a second one saves it as up next — no question, first test keeps running', r.msg);
  r = st.startTest({ id: L.queue[0].id });
  ok(!r.ok && /still running/.test(r.msg), 'starting the up-next one early is refused while the first runs', r.msg);

  console.log('5. ending on purpose');
  const runId = L.three.experimental.id;
  r = st.dropTest({ id: runId });
  L = st.list();
  ok(r.ok && exps(st).find(e => e.id === runId).status === 'dropped' && !L.test && L.flyNext === 'suggested', 'Drop ends the test and hands the dot back to ABRP Suggested');
  r = st.startTest({ id: L.queue[0].id });
  ok(r.ok && st.list().test.name === 'Clouds High', 'with nothing running, the up-next test starts');

  console.log('6. knocked off the test (sim exit / manual change)');
  ({ st, uc } = fresh());
  st.experimentCreate({ text: block('Reflections Ultra', 'Raymarched reflections quality = Ultra'), start: true });
  const txt = fs.readFileSync(uc, 'utf8');
  fs.writeFileSync(uc, P.applyToText(txt, { 'Graphics/SSR/Quality': 2 }).text);
  L = st.list();
  ok(L.test && L.test.matches === false && L.status.kind === 'pending' && L.status.inSim === 'suggested', 'the page says Experimental flies next but the sim is on ABRP Suggested', L.status);
  ok(L.test.off.some(o => /reflections/i.test(o.label) && /High/.test(o.now) && /Ultra/.test(o.test)), '…and which setting is off', L.test.off);
  r = st.flyNext({ to: 'experimental' });
  ok(r.ok && st.list().test.matches === true, '"Switch now" puts the test back');
} catch (e) { ok(false, 'crashed: ' + e.stack); }
finally {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  ok(sha(path.join(UD, 'sim_profiles.json')) === liveBefore[0] && sha(UCFG) === liveBefore[1], 'GUARD: your live sim_profiles.json and UserCfg.opt were never touched');
}

console.log('7. page wiring');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
ok(/h\+=_spStatus\(\)\+_spNotices\(\)\+_spStartCard\(\)\+_spClipCard\(\);/.test(html), 'status line, notes, start confirmation and clipboard prompt render at the top');
ok(!/function _spTestBanner|function _spEndAskCard|needsEndTest/.test(html), 'the old "this ends your running test" question is gone from the page');
ok(/_spClip=\{text:t, preview:pv\}/.test(html), 'the clipboard still offers a prompt, never opens the edit box by itself');
ok(/draft:'UP NEXT'/.test(html) && /Starts after the current test/.test(html), 'a waiting test reads "UP NEXT"');
ok(/Add to ABRP Suggested<\/button>/.test(html) && /End test \(drop it\)/.test(html), 'test cards: Add to ABRP Suggested / Drop, End test (drop it)');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
