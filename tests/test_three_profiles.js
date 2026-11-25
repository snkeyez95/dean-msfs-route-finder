'use strict';
// v6.37.0 — Sim Profiles as THREE profiles + a "flies next" dot (Dean 2026-11-24):
//   🔒 Baseline (frozen known-good) · ⭐ ABRP Suggested (Baseline + proven changes) · 🧪 Experimental (one change)
// Runs the REAL store against COPIES of Dean's sim_profiles.json + UserCfg.opt (his live files are
// hash-checked before and after) with his real flight log, and renders the REAL page from index.html.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const X = require('./lib/extract.js');
const { makeRenderer } = require('./lib/sp_render.js');
const P = require('../perf/native/profiles.js');
const { createStore } = require('../perf/native/profiles_store.js');
const T = X.runner('three profiles:');

const UD = X.APP_DATA;
const UCFG = path.join(process.env.APPDATA || '', 'Microsoft Flight Simulator 2024', 'UserCfg.opt');
if (!fs.existsSync(path.join(UD, 'sim_profiles.json')) || !fs.existsSync(UCFG)) { console.log('  skip (no real profile data on this machine)'); process.exit(0); }
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const liveBefore = [sha(path.join(UD, 'sim_profiles.json')), sha(UCFG)];
const dirs = [];
function fresh(simUp) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'three-')); dirs.push(dir);
  fs.copyFileSync(path.join(UD, 'sim_profiles.json'), path.join(dir, 'sim_profiles.json'));
  fs.copyFileSync(UCFG, path.join(dir, 'UserCfg.opt'));
  const flag = { up: !!simUp };
  const st = createStore({ userData: dir, usercfgPath: path.join(dir, 'UserCfg.opt'), sessionsDir: path.join(UD, 'Sessions'), isSimRunning: () => flag.up, log: () => {} });
  // every scenario starts with NO test running and the dot on ABRP Suggested (Dean's live file may be
  // mid-test), with the sim on ABRP Suggested — the "first open" state these checks describe
  const j = JSON.parse(fs.readFileSync(path.join(dir, 'sim_profiles.json'), 'utf8'));
  j.profiles.forEach(p => { if (p.source === 'experiment' && (p.status === 'active' || p.status === 'draft')) p.status = 'ended'; });
  if (j.baseline) {
    j.flyNext = 'suggested'; j.notice = null; j.inboxNotice = null;
    const sv = Object.assign({}, j.baseline.values); for (const a of (j.suggested && j.suggested.adds) || []) sv[a.id] = a.to;
    fs.writeFileSync(path.join(dir, 'UserCfg.opt'), P.applyToText(fs.readFileSync(path.join(dir, 'UserCfg.opt'), 'utf8'), sv).text);
  }
  fs.writeFileSync(path.join(dir, 'sim_profiles.json'), JSON.stringify(j));
  return { dir, st, flag, ucfg: path.join(dir, 'UserCfg.opt'), file: path.join(dir, 'sim_profiles.json') };
}
const sim = c => P.readProfileable(fs.readFileSync(c.ucfg, 'utf8'));
const LS = 'Graphics/VolumetricLights/Quality', CS = 'Graphics/ContactShadows/Quality', SSR = 'Graphics/SSR/Quality';
const R = makeRenderer();
const page = (L, extra) => { R.set(Object.assign({ _SP: L, _spTriOpen: null, _spShowMore: false, _spOpen: {}, _spPaste: { open: false, text: '', preview: null }, _spStart: null, _spClip: null, _spMsg: null }, extra || {})); return R.render(); };
const text = h => h.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

try {
  console.log('1. first open after the update: the three are set up from what you already have');
  let c = fresh();
  const preState = JSON.parse(fs.readFileSync(c.file, 'utf8'));
  const wasSetUp = !!preState.baseline;
  let L = c.st.list();
  const st0 = c.st.load();
  T('Baseline, ABRP Suggested and Experimental all present', !!(L.three && L.three.baseline && L.three.suggested && 'experimental' in L.three));
  if (!wasSetUp) {
    T('your old profile file was backed up before set-up', fs.existsSync(path.join(c.dir, 'sim_profiles.pre-v6.37.json')));
    T('Baseline = the history pick (your Aug 27 – Oct 7 setup)', /Aug 27/.test(L.three.baseline.note), L.three.baseline.note);
    T('your two kept tests carried into ABRP Suggested: Light shafts + Contact shadows Ultra',
      L.three.suggested.adds.map(a => a.id).sort().join() === [CS, LS].sort().join() && L.three.suggested.adds.every(a => a.to === 3), L.three.suggested.adds.map(a => a.id + '=' + a.to));
    T('ABRP Suggested = your sim today, so the dot starts there', L.flyNext === 'suggested' && L.inSim === 'suggested', L.flyNext + '/' + L.inSim);
    T('first status line: "Next flight flies ABRP Suggested. It’s already in your sim."', L.status.kind === 'ok' && L.status.target === 'suggested');
  } else console.log('  (your live file is already set up — set-up checks skipped)');
  { const before = sha(c.ucfg); c.st.list(); T('nothing is written to the sim file just by opening the page', sha(c.ucfg) === before); }
  const baseFrozen = JSON.stringify(st0.baseline);

  console.log('2. the dot');
  let r = c.st.flyNext({ to: 'baseline' });
  T('picking Baseline (sim closed) applies it now and says so', r.ok && /Baseline flies next/.test(r.msg) && sim(c)[LS] === st0.baseline.values[LS] && sim(c)[CS] === st0.baseline.values[CS], r.msg);
  L = c.st.list();
  T('status: flies Baseline, already in your sim', L.flyNext === 'baseline' && L.inSim === 'baseline' && L.status.kind === 'ok');
  c.flag.up = true;
  r = c.st.flyNext({ to: 'suggested' });
  L = c.st.list();
  T('picking with MSFS running waits: nothing written, status "pending"', r.ok && r.pending && sim(c)[LS] === st0.baseline.values[LS] && L.status.kind === 'pending' && L.status.target === 'suggested' && L.status.inSim === 'baseline');
  r = c.st.preflight({});
  T('pre-flight with the sim running refuses to write', r.ok === false && /MSFS is running/.test(r.line));
  c.flag.up = false;
  r = c.st.preflight({ dry: true });
  T('Launch + Capture dry run names the profile and how many settings it sets', r.ok && r.target === 'suggested' && r.changes === 2 && /ABRP Suggested · 2 settings will be set/.test(r.line), r.line);
  r = c.st.preflight({});
  T('pre-flight applies the dotted profile, verified', r.ok && sim(c)[LS] === 3 && sim(c)[CS] === 3 && /2 settings set and verified/.test(r.line), r.line);
  T('…and the status line is back to "ok"', c.st.list().status.kind === 'ok');
  r = c.st.flyNext({ to: 'experimental' });
  T('Experimental can’t be picked when no test exists', !r.ok && /no test running/i.test(r.msg));

  console.log('3. Baseline never changes');
  T('after picks and applies, the Baseline is byte-for-byte the same', JSON.stringify(c.st.load().baseline) === baseFrozen);

  console.log('4. a test, start to finish');
  const startTxt = 'ABRP-PROFILE v1\nname: Reflections Ultra\nset: Raymarched reflections quality = Ultra\nflights: 3\nwhy: test';
  r = c.st.experimentCreate({ text: startTxt, start: true });
  L = c.st.list();
  T('Start test: the test is built on ABRP Suggested and the dot moves to Experimental', r.ok && r.started && r.experiment.baseName === 'ABRP Suggested' && L.flyNext === 'experimental', r.msg);
  T('…and it’s in the sim now (sim was closed): reflections Ultra, light shafts still Ultra', sim(c)[SSR] === 3 && sim(c)[LS] === 3);
  T('status line: testing, flight 1 of 3 next', L.status.kind === 'running' && L.status.test && L.status.test.budget === 3);
  r = c.st.experimentCreate({ text: 'ABRP-PROFILE v1\nname: Clouds High\nset: Volumetric clouds quality = High\nflights: 3', start: true });
  L = c.st.list();
  T('a second test while one runs is saved as "up next" — nothing asked, first test untouched', r.ok && r.queued && L.queue.length === 1 && L.test.name === 'Reflections Ultra' && L.flyNext === 'experimental', r.msg);
  r = c.st.flyNext({ to: 'baseline' });
  L = c.st.list();
  T('a Baseline sanity flight mid-test is fine: the test keeps running', r.ok && L.test && L.test.name === 'Reflections Ultra' && L.three.experimental && sim(c)[SSR] === st0.baseline.values[SSR]);
  c.st.flyNext({ to: 'experimental' });
  const id = L.three.experimental.id;
  r = c.st.addTest({ id });
  T('Add is refused until the test has its flights', !r.ok && /needs 3 flights/.test(r.msg), r.msg);
  r = c.st.dropTest({ id });
  L = c.st.list();
  T('Drop: test closed, dot back on ABRP Suggested, sim back to it', r.ok && L.flyNext === 'suggested' && sim(c)[SSR] === L.three.suggested.values[SSR] && c.st.load().profiles.find(p => p.id === id).status === 'dropped');
  T('the up-next test is now offered to start', L.queue.length === 1 && !L.test);
  r = c.st.startTest({ id: L.queue[0].id });
  T('Start it: the queued test runs and the dot moves', r.ok && c.st.list().flyNext === 'experimental' && c.st.list().test.name === 'Clouds High', r.msg);

  console.log('5. remove a proven change from ABRP Suggested');
  c = fresh();
  c.st.list();
  r = c.st.removeAdd({ id: LS });
  L = c.st.list();
  T('Remove takes Light shafts back to the Baseline value in ABRP Suggested', r.ok && L.three.suggested.values[LS] === L.three.baseline.values[LS] && !L.three.suggested.adds.some(a => a.id === LS), r.msg);
  T('…and since Suggested flies next, the sim follows (sim closed)', sim(c)[LS] === L.three.baseline.values[LS]);

  console.log('6. changed in the sim by hand');
  c = fresh();
  c.st.list();
  fs.writeFileSync(c.ucfg, P.applyToText(fs.readFileSync(c.ucfg, 'utf8'), { 'Graphics/SSAO/Quality': 1 }).text);
  L = c.st.list();
  T('status says the sim doesn’t match what flies next, and which setting', L.status.kind === 'off' && L.status.diff.some(d => /ambient occlusion/i.test(d.label)), JSON.stringify(L.status));
  r = c.st.makeTestFromSim();
  L = c.st.list();
  T('"Make these a test" turns your in-sim change into the Experimental test', r.ok && L.three.experimental && L.three.experimental.changes.some(x => x.id === 'Graphics/SSAO/Quality') && L.status.kind === 'running', r.msg);

  console.log('7. Claude’s inbox');
  c = fresh();
  c.st.list();
  fs.mkdirSync(path.join(c.dir, 'inbox'), { recursive: true });
  fs.writeFileSync(path.join(c.dir, 'inbox', 'reflections.abrp.txt'), startTxt);
  fs.writeFileSync(path.join(c.dir, 'inbox', 'bad.txt'), 'hello, not a test');
  L = c.st.list();
  T('a test file in the inbox becomes the Experimental test by itself', L.three.experimental && L.three.experimental.name === 'Reflections Ultra' && L.flyNext === 'experimental');
  T('the file moves to inbox\\done; the unreadable one to inbox\\rejected', fs.readdirSync(path.join(c.dir, 'inbox', 'done')).length === 1 && fs.readdirSync(path.join(c.dir, 'inbox', 'rejected')).length === 1 && !fs.readdirSync(path.join(c.dir, 'inbox')).some(n => /\.txt$/.test(n)));
  T('the page gets a one-line note for each', L.inboxNotice && L.inboxNotice.items.length === 2 && L.inboxNotice.items.some(i => !i.ok));
  c.st.dismissNotice();
  T('✕ dismisses the note', !c.st.list().inboxNotice);
  fs.writeFileSync(path.join(c.dir, 'inbox', 'again.txt'), startTxt);
  L = c.st.list();
  T('the same test arriving twice creates nothing new', L.experiments.filter(e => e.name === 'Reflections Ultra').length === 1 && L.inboxNotice.items[0].duplicate);
  c.flag.up = true;
  fs.writeFileSync(path.join(c.dir, 'inbox', 'w.txt'), 'ABRP-PROFILE v1\nname: Clouds High\nset: Volumetric clouds quality = High');
  L = c.st.list();
  T('a second inbox test while one runs waits as up next', L.queue.some(q => q.name === 'Clouds High') && L.test.name === 'Reflections Ultra');
  c.flag.up = false;

  console.log('8. a test that passes / fails (judged on smoothness AND video memory)');
  T('the verdict says passed for Free / Saves / No effect only', P.experimentVerdict.toString().includes("passed: verdict === 'free' || verdict === 'saves' || verdict === 'noeffect'"));
  T('smooth but past the AutoFPS video-memory line is flagged separately', P.experimentVerdict.toString().includes('vramOnly: verdict === \'costs\' && !worse && vramOver'));
} catch (e) { T('crashed: ' + e.stack, false); }

console.log('9. SURFACE: the page Dean sees (real renderer, his real data)');
try {
  const c = fresh();
  let L = c.st.list(), h = page(L), t = text(h);
  T('one status line at the top', /id="sp-status" data-state="ok"/.test(h) && /Next flight flies ⭐ ABRP Suggested \. It’s already in your sim\./.test(t), t.slice(0, 160));
  T('three cards, in order: Baseline → ABRP Suggested → Experimental', /data-who="baseline"[\s\S]*data-who="suggested"[\s\S]*data-who="experimental"/.test(h));
  const card = w => h.slice(h.indexOf('data-who="' + w + '"'), h.indexOf('data-who="', h.indexOf('data-who="' + w + '"') + 20) > 0 ? h.indexOf('data-who="', h.indexOf('data-who="' + w + '"') + 20) : undefined);
  T('the dot: ABRP Suggested says FLIES NEXT (filled), the others "Fly this next"', /aria-checked="true"[\s\S]{0,900}FLIES NEXT/.test(card('suggested')) && /Fly this next/.test(card('baseline')));
  T('✓ IN YOUR SIM sits on ABRP Suggested only', card('suggested').includes('✓ IN YOUR SIM') && !card('baseline').includes('✓ IN YOUR SIM'));
  T('ABRP Suggested says what it adds: "Baseline + Light shafts Ultra + Contact shadows Ultra"', /Baseline \+ Light shafts Ultra \+ Contact shadows Ultra/.test(text(card('suggested'))), text(card('suggested')).slice(0, 200));
  T('every card leads with felt stutters, P99 and peak video memory vs the 96% line', ['baseline', 'suggested'].every(w => /Felt stutters[\s\S]*P99 frametime[\s\S]*Peak video memory[\s\S]*96%/.test(text(card(w)))));
  T('Baseline says it never changes and carries the update check', /Never changes/.test(text(card('baseline'))) && /sp-check/.test(card('baseline')));
  T('Experimental is empty and can’t be picked', /Empty\. Start a test/.test(text(card('experimental'))) && /data-who="experimental"[\s\S]{0,400}disabled/.test(card('experimental')));
  T('one next-test idea with Start test; more is folded', /🧪 Next test/.test(t) && /Raymarched reflections Ultra/.test(t) && />Start test</.test(h));
  T('everything else is folded under "More"', /▸ More/.test(t) && !/Test history/.test(t) && !/Other saved setups/.test(t));
  const hm = page(L, { _spShowMore: true }), tm = text(hm);
  T('More opens Test history (with the old kept tests) and Other saved setups', /Test history/.test(tm) && /ADDED TO ABRP SUGGESTED/.test(tm) && /Other saved setups/.test(tm) && /Rebuild from flight history/.test(tm));
  const hd = text(page(L, { _spTriOpen: 'suggested' }));
  T('Details on ABRP Suggested lists each added change with its test result and a Remove button', /What it adds to Baseline/.test(hd) && /Light shafts quality 2 · High → 3 · Ultra/.test(hd) && /FREE UPGRADE|NO EFFECT/.test(hd) && /Remove/.test(hd));
  T('colour-blind safe: the selected card says FLIES NEXT in words, not only an orange border', /FLIES NEXT/.test(t));
  // v6.37.1 fixes
  T('v6.37.1: cards show the AutoFPS band the flights were flown with (e.g. "AutoFPS TLOD 50–200")', /AutoFPS TLOD \d+–\d+/.test(text(card('suggested'))), text(card('suggested')).match(/AutoFPS[^·]*/));
  const pr = (L.proposals && L.proposals.proposals || [])[0];
  if (pr) {
    const hs = page(L, { _spStart: { kind: 'proposal', pid: pr.id, text: pr.text, preview: c.st.experimentPreview({ text: pr.text }) } });
    T('v6.37.1: while the Start test confirmation is open, only ONE Start test button is on screen', (hs.match(/>Start test</g) || []).length === 1 && /↑ Confirm above/.test(hs), (hs.match(/>Start test</g) || []).length);
  }
  // the other states, same renderer
  c.st.flyNext({ to: 'baseline' }); c.flag.up = true; c.st.flyNext({ to: 'suggested' });
  t = text(page(c.st.list()));
  T('pending: "Next flight flies ⭐ ABRP Suggested. Your sim is still on 🔒 Baseline."', /Next flight flies ⭐ ABRP Suggested \. Your sim is still on 🔒 Baseline \./.test(t), t.slice(0, 200));
  c.flag.up = false;
  c.st.preflight({});
  fs.writeFileSync(c.ucfg, P.applyToText(fs.readFileSync(c.ucfg, 'utf8'), { 'Graphics/SSAO/Quality': 1 }).text);
  h = page(c.st.list()); t = text(h);
  T('off: says the sim doesn’t match, names the setting, offers Put it back + Make these a test', /data-state="off"/.test(h) && /Ambient occlusion/i.test(t) && /Put it back now/.test(t) && /Make these a test/.test(t), t.slice(0, 260));
  c.st.makeTestFromSim();
  h = page(c.st.list()); t = text(h);
  T('running: "Testing … flight 1 of 3 next" and Experimental FLIES NEXT', /data-state="running"/.test(h) && /flight 1 of 3 next/.test(t) && /data-who="experimental"[\s\S]{0,1500}FLIES NEXT/.test(h), t.slice(0, 220));
  // a finished test, synthesized from the running one (the real verdict needs real flights)
  const L2 = c.st.list(), e = L2.experiments.find(x => x.status === 'active');
  const fin = r => Object.assign({}, L2, { status: { kind: 'decide', test: Object.assign({}, L2.test, { done: true }) }, experiments: L2.experiments.map(x => x.id === e.id ? Object.assign({}, x, { result: Object.assign({}, x.result, r) }) : x) });
  t = text(page(fin({ done: true, passed: true, verdict: 'noeffect', sentence: 'No measurable effect.' })));
  T('decide (passed): "Test passed" with Add to ABRP Suggested / Drop', /Test passed/.test(t) && /Add to ABRP Suggested/.test(t) && /Drop/.test(t));
  t = text(page(fin({ done: true, passed: false, vramOnly: true, verdict: 'costs', sentence: 'x' })));
  T('decide (VRAM): "Costs video-memory headroom", no Add button', /Costs video-memory headroom/.test(t) && !/Add to ABRP Suggested/.test(t));
  t = text(page(fin({ done: true, passed: false, verdict: 'costs', sentence: 'Measurably rougher.' })));
  T('decide (rougher): "Test didn’t pass", only Drop', /Test didn’t pass/.test(t) && !/Add to ABRP Suggested/.test(t));
} catch (e) { T('surface crashed: ' + e.stack, false); }

console.log('10. Launch + Capture wiring');
{
  const lc = X.grab('launchAndCapture');
  T('dry pre-flight first, named in the one launch dialog', /profilesPreflight\(\{dry:true\}\)/.test(lc) && /'Graphics: '\+gfx\.line/.test(lc));
  T('the dialog offers Launch · Fly 🔒 Baseline instead · Cancel', /label:'Launch'/.test(lc) && /Fly 🔒 Baseline instead/.test(lc) && /abrpChoice\(msg,btns\)/.test(lc));
  T('the profile goes in BEFORE auto-TLOD and before MSFS starts', lc.indexOf('profilesPreflight(choice') < lc.indexOf('perfPrepNext') && lc.indexOf('perfPrepNext') < lc.indexOf('launchMsfs'));
  T('the summary toast says what was applied', /gfxRes\.line/.test(lc));
  T('v6.37.1: the benchmark TLOD step only shows for aircraft whose benchmark has cells left', /perfBenchComplete\(\)/.test(lc) && /else if\(benchOpen\.length\) steps\.push\('Set a benchmark TLOD only if your SimBrief aircraft is the '\+benchOpen\.join/.test(lc));
  T('v6.37.1: step 1 says "already set, nothing to change" when the profile is already in the sim', /gfx\.changes\?'Put that profile in your sim[^']*':'Keep that profile in your sim \(already set, nothing to change\)'/.test(lc));
  const { computeCoverage } = require('../perf/native/coverage.js');
  const mainSrc = fs.readFileSync(path.join(X.ROOT, 'main.js'), 'utf8');
  T('v6.37.1: perf-bench-complete uses the same coverage model as auto-TLOD and names the open aircraft', /ipcMain\.handle\('perf-bench-complete'[\s\S]{0,500}computeCoverage\(sessions, benchCfg\(\)\)[\s\S]{0,300}open/.test(mainSrc));
  let sess = []; try { sess = JSON.parse(fs.readFileSync(path.join(UD, 'Sessions', 'index.json'), 'utf8')).sessions; } catch (_) {}
  let bench = null; try { bench = JSON.parse(fs.readFileSync(path.join(UD, 'config.json'), 'utf8')).benchmark; } catch (_) {}
  const cov = computeCoverage(sess, bench && bench.aircraft ? bench : undefined);
  const open = [...new Set(cov.gaps.map(g => g.aircraft))];
  T('v6.37.1: on your real flights Fenix + PMDG 737 are complete, so the step only names what is open (' + (open.join(', ') || 'nothing') + ')', !open.includes('Fenix') && !open.includes('PMDG'), open);
}

for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
T('GUARD: your live sim_profiles.json and UserCfg.opt were never touched', sha(path.join(UD, 'sim_profiles.json')) === liveBefore[0] && sha(UCFG) === liveBefore[1]);
process.exit(T.done() ? 1 : 0);
