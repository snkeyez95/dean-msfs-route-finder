'use strict';
// v6.28.0 SIM PROFILES · 🧪 EXPERIMENTS — the paste format, the verdict, ABRP's proposals, the full
// lifecycle (create → apply → fly → verdict → keep / revert) and the page Dean sees.
// Everything that writes runs on a COPY of his real UserCfg.opt and a throwaway Sessions folder of
// synthetic flights; his live sim file is hash-checked at the end.
const fs = require('fs'), path = require('path'), os = require('os'), crypto = require('crypto');
const X = require('./lib/extract.js');
const T = X.runner('Sim Profiles · Experiments:');
const S = require('../perf/native/usercfg_schema.js');
const P = require('../perf/native/profiles.js');
const { createStore, loadFlights } = require('../perf/native/profiles_store.js');

const LIVE = path.join(process.env.APPDATA || '', 'Microsoft Flight Simulator 2024', 'UserCfg.opt');
if (!fs.existsSync(LIVE)) { console.log('SKIP — needs the real UserCfg.opt'); process.exit(0); }
const liveText = fs.readFileSync(LIVE, 'utf8');
const hash = t => crypto.createHash('sha1').update(t).digest('hex');
const liveHash = hash(liveText);
const cur = P.readProfileable(liveText);
// fixed start state: Dean's real file with light shafts / contact shadows / reflections at High
const startText = P.applyToText(liveText, { 'Graphics/VolumetricLights/Quality': 2, 'Graphics/ContactShadows/Quality': 2, 'Graphics/SSR/Quality': 2,
  'Graphics/WindShield/Quality': 2, 'Graphics/SSAO/Quality': 3, 'Graphics/VolumetricClouds/Quality': 3, 'Graphics/Texture/Quality': 2 }).text;
const start = P.readProfileable(startText);
const baseOf = vals => ({ id: 'b1', name: 'My base', values: Object.assign({}, vals), vramPct: 0.93 });

// ── 1. paste format ──
{
  const ctx = { resolveBase: () => baseOf(start) };
  const ok = P.parseChangeText('ABRP-PROFILE v1\nname: Light shafts Ultra\nbase: My base\nset: Light shafts = Ultra\nflights: 4\nwhy: GPU headroom', ctx);
  T('1. a simple block parses: 1 change, budget 4, why kept', ok.ok && ok.changes.length === 1 && ok.changes[0].id === 'Graphics/VolumetricLights/Quality' && ok.changes[0].to === 3 && ok.budget === 4 && ok.why === 'GPU headroom', JSON.stringify(ok.errors));
  T('   …and knows it is a step UP from High', ok.changes[0].from === 2 && ok.changes[0].dir === 'up');
  const forms = P.parseChangeText('ABRP-PROFILE v1\nset: Graphics/SSR/Quality = 3\nset: anti-aliasing = TAA\nset: NVIDIA Reflex low latency = On+Boost\nset: Render scaling = 110%\nset: AMD FidelityFX sharpening = 40\nset: Frame rate multiplier = 2X', ctx);
  const v = Object.fromEntries(forms.changes.map(c => [c.id, c.to]));
  T('   raw ids, in-sim words, %, sharpening "40", "2X" all understood', forms.ok && v['Graphics/SSR/Quality'] === 3 && v['Video/AntiAliasing'] === 'TAA' && v['Video/Reflex'] === 'BOOST' && v['Video/PrimaryScaling'] === 1.1 && v['Video/SharpenAmount'] === 0.4 && v['Video/NBFramesToGenerate'] === 1, JSON.stringify(forms.errors));
  const dof = P.parseChangeText('ABRP-PROFILE v1\nset: Depth of field = Medium', ctx);
  T('   "Depth of field = Medium" sets the on flag AND the quality (one in-sim row)', dof.ok && dof.changes.some(c => c.id === 'Graphics/DOF/Enabled' && c.to === 1) && dof.changes.some(c => c.id === 'Graphics/DOF/Quality' && c.to === 1) && !dof.warnings.some(w => /at once/.test(w)));
  const bad = P.parseChangeText('ABRP-PROFILE v1\nset: Bogus thing = 3\nset: Windshield effects = Ultra\nset: Terrain level of detail (TLOD) = 200\nset: Resolution = 4K\nset: Light shafts = Extreme\nhello there', ctx);
  T('   rejects: unknown setting, above the sim\'s max, TLOD, display keys, bad value, junk line', !bad.ok && bad.errors.length === 7 && /No "set:" lines/.test(bad.errors.join()), bad.errors.join(' | '));
  T('   …each with a plain reason', /Unknown setting "Bogus/.test(bad.errors.join()) && /tops out at 2 · High/.test(bad.errors.join()) && /AutoFPS/.test(bad.errors.join()) && /options: Low, Medium, High, Ultra/.test(bad.errors.join()));
  T('   no header → refused', !P.parseChangeText('set: Light shafts = Ultra', ctx).ok);
  T('   nothing different from the base → refused ("nothing to test")', !P.parseChangeText('ABRP-PROFILE v1\nset: Light shafts = High', ctx).ok);
  const two = P.parseChangeText('ABRP-PROFILE v1\nset: Light shafts = Ultra\nset: Contact shadows = Ultra', ctx);
  T('   two changes → allowed, with a "won\'t know which" warning', two.ok && two.warnings.some(w => /2 settings change at once/.test(w)));
  const tex = P.parseChangeText('ABRP-PROFILE v1\nset: Texture resolution = High', ctx);
  T('   raising a video-memory setting on a base already at 93% → warning', tex.ok && tex.warnings.some(w => /video memory/.test(w) && /93%/.test(w)));
  T('   an unknown base name → refused with a clear message', /No profile named "Nope"/.test(P.parseChangeText('ABRP-PROFILE v1\nbase: Nope\nset: Light shafts = Ultra', { resolveBase: () => null }).errors.join()));
  T('   name is generated when missing ("Light shafts Ultra")', ok.name === 'Light shafts Ultra' && P.parseChangeText('ABRP-PROFILE v1\nset: Light shafts = Ultra', ctx).name === 'Light shafts Ultra');
}

// ── 2. text round-trips ──
{
  const full = P.toChangeText({ name: 'Mine', values: cur });
  const back = P.parseChangeText(full, {});
  const got = Object.fromEntries(back.changes.map(c => [c.id, c.to]));
  T('2. a full profile → text → back is IDENTICAL on every setting (Dean\'s real values)', back.ok && back.kind === 'profile' && Object.keys(cur).filter(id => !S.BY_ID[id].lod).every(id => P._equal(cur[id], got[id])));
  T('   the text uses the sim\'s words ("Ultra", "On+Boost"), not bare numbers', /set: Volumetric clouds quality = (Ultra|High|Medium|Low)/.test(full) && /set: NVIDIA Reflex low latency = On/.test(full));
  const exText = P.toChangeText({ name: 'Light shafts Ultra', baseName: 'My base', changes: [{ id: 'Graphics/VolumetricLights/Quality', from: 2, to: 3 }], budget: 3, why: 'x' });
  T('   an experiment exports as base + change only', exText.split('\n').filter(l => l.startsWith('set:')).length === 1 && /base: My base/.test(exText) && /Light shafts quality = Ultra/.test(exText));
}

// ── 3. the verdict (synthetic flights, per-aircraft fair) ──
const BASE_V = { 'Graphics/VolumetricLights/Quality': 2, 'Graphics/SSR/Quality': 2 };
const EXP_V = { 'Graphics/VolumetricLights/Quality': 3, 'Graphics/SSR/Quality': 2 };
let t0 = Date.parse('2026-12-01T10:00:00Z');
const fl = (vals, o) => Object.assign({ session_id: 's' + (t0 += 3600e3), timestamp: new Date(t0).toISOString().slice(0, 19), aircraft: 'Fenix', p99: 17.6, felt: 8, dur: 3600, vram: 11000, vramTotal: 12288, gpu: 10, cpuBound: 85, sim: '1.9.24.0', afps: '50–200', traffic: 'offline', taxiStut: 0.2, excluded: false, settings: { graphics: Object.assign({}, vals) } }, o || {});
{
  const exp = { values: EXP_V, baseValues: BASE_V, budget: 3 };
  const base = [fl(BASE_V, { felt: 6 }), fl(BASE_V, { felt: 9 }), fl(BASE_V, { felt: 8, p99: 17.8 }), fl(BASE_V, { felt: 7, p99: 17.5 })];
  T('3. under 2 experiment flights → COLLECTING with a count', P.experimentVerdict(exp, base.concat([fl(EXP_V)])).verdict === 'collecting' && /1 of 3/.test(P.experimentVerdict(exp, base.concat([fl(EXP_V)])).sentence));
  const same = P.experimentVerdict(exp, base.concat([fl(EXP_V, { felt: 7 }), fl(EXP_V, { felt: 8 }), fl(EXP_V, { felt: 8 })]));
  T('   same smoothness → NO EFFECT, and done at the budget', same.verdict === 'noeffect' && same.done && same.n === 3, same.verdict);
  const free = P.experimentVerdict(exp, base.concat([fl(EXP_V, { felt: 7, gpu: 12 }), fl(EXP_V, { felt: 8, gpu: 12.5 }), fl(EXP_V, { felt: 8, gpu: 12 })]));
  T('   GPU busier, smoothness held → FREE UPGRADE', free.verdict === 'free', free.verdict);
  const cost = P.experimentVerdict(exp, base.concat([fl(EXP_V, { felt: 30, p99: 21 }), fl(EXP_V, { felt: 28, p99: 20.5 }), fl(EXP_V, { felt: 32, p99: 21.2 })]));
  T('   clearly rougher → COSTS', cost.verdict === 'costs' && cost.rows.some(r => r.k === 'felt' && r.within === false), cost.verdict);
  // a heavy aircraft that is rough EVERYWHERE flies the experiment side: it must not read as a cost
  const heavyElsewhere = [fl({ 'Graphics/VolumetricLights/Quality': 1 }, { aircraft: 'PMDG 777', felt: 30, p99: 21 }), fl({ 'Graphics/VolumetricLights/Quality': 1 }, { aircraft: 'PMDG 777', felt: 32, p99: 21.3 }), fl({ 'Graphics/VolumetricLights/Quality': 1 }, { aircraft: 'PMDG 777', felt: 29, p99: 20.8 })];
  const mix = P.experimentVerdict(exp, heavyElsewhere.concat(base, [fl(EXP_V, { aircraft: 'PMDG 777', felt: 31, p99: 21 }), fl(EXP_V, { aircraft: 'PMDG 777', felt: 30, p99: 21.1 }), fl(EXP_V, { aircraft: 'PMDG 777', felt: 30, p99: 21 })]));
  T('   a heavier plane on the experiment side can\'t fake a cost (per-aircraft scoring)', mix.verdict !== 'costs', mix.verdict + ' ' + JSON.stringify(mix.rows.map(r => r.k + ':' + r.delta.toFixed(2))));
  const vr = P.experimentVerdict(exp, base.concat([fl(EXP_V, { vram: 12100 }), fl(EXP_V, { vram: 12150 }), fl(EXP_V, { vram: 12120 })]));
  T('   video memory past 96% → COSTS even if smooth', vr.verdict === 'costs' && /video memory/.test(vr.sentence));
  const notes = P.experimentVerdict(exp, base.concat([fl(EXP_V, { afps: '250–400', sim: '1.9.30.0' }), fl(EXP_V, { afps: '250–400', sim: '1.9.30.0' })]));
  T('   honesty notes: AutoFPS range and sim version changed between sides', notes.notes.some(n => /AutoFPS range differs/.test(n)) && notes.notes.some(n => /Sim version differs/.test(n)));
  T('   excluded flights never count', P.experimentVerdict(exp, base.concat([fl(EXP_V, { excluded: true }), fl(EXP_V, { excluded: true })])).n === 0);
  const txt = P.experimentResultsText({ name: 'Light shafts Ultra', baseName: 'My base', changes: [{ id: 'Graphics/VolumetricLights/Quality', from: 2, to: 3 }], status: 'active' }, cost);
  T('   "Copy results for Claude" is a compact, complete block', /^ABRP-EXPERIMENT-RESULTS v1/.test(txt) && /verdict: COSTS/.test(txt) && /Light shafts quality 2 · High → 3 · Ultra/.test(txt) && /BEYOND noise/.test(txt) && txt.split('\n').length < 16);
}

// ── 4. ABRP's own proposals ──
{
  const real = loadFlights(path.join(X.APP_DATA, 'Sessions'));
  const pr = P.proposeExperiments(real, start, { baseName: 'ABRP Suggested' });
  T('4. on Dean\'s real flights: GPU headroom found, proposals made', pr.ok && pr.proposals.length >= 1 && pr.gpu < pr.budgetMs * 0.6, pr.reason || (pr.gpu + ' ms'));
  T('   every proposal = one GPU-cost, confirmed setting, one step up', pr.proposals.every(p => p.changes.length === 1 && S.BY_ID[p.changes[0].id].cost === 'gpu' && S.BY_ID[p.changes[0].id].calib === 'confirmed' && p.changes[0].to > p.changes[0].from));
  T('   …never above the sim\'s max (windshield is already at High = top)', !pr.proposals.some(p => p.changes[0].id === 'Graphics/WindShield/Quality'));
  T('   …and never a video-memory setting (textures)', !pr.proposals.some(p => S.BY_ID[p.changes[0].id].cost === 'vram'));
  T('   first proposal is Light shafts Ultra, with text Dean can paste', pr.proposals[0].name === 'Light shafts Ultra' && /^ABRP-PROFILE v1/.test(pr.proposals[0].text) && P.parseChangeText(pr.proposals[0].text, { resolveBase: () => baseOf(start) }).ok);
  const busy = real.slice(-10).map(f => Object.assign({}, f, { gpu: 28 }));
  T('   a GPU-bound rig gets NO proposals, with the reason', P.proposeExperiments(busy, start).proposals.length === 0 && /no clear headroom/.test(P.proposeExperiments(busy, start).reason));
  const after = P.proposeExperiments(real, start, { experiments: [{ status: 'active', changes: [{ id: 'Graphics/VolumetricLights/Quality' }] }, { status: 'reverted', verdict: 'costs', finished: new Date().toISOString(), changes: [{ id: 'Graphics/ContactShadows/Quality' }] }] });
  T('   skips a setting already under test, and one that just cost you', !after.proposals.some(p => /VolumetricLights|ContactShadows/.test(p.changes[0].id)));
}

// ── 5. the whole lifecycle through the store (copy of the real file + synthetic flight logs) ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abrp-exp-'));
const ucfg = path.join(tmp, 'UserCfg.opt'), sess = path.join(tmp, 'Sessions');
fs.writeFileSync(ucfg, startText); fs.mkdirSync(sess);
const index = { sessions: [] };
function logFlight(values, o) {
  const f = fl(values, o); const folder = 'f_' + index.sessions.length;
  fs.mkdirSync(path.join(sess, folder));
  fs.writeFileSync(path.join(sess, folder, 'summary.json'), JSON.stringify({ settings: { graphics: values, autofps_active: true, autofps_cfg: { min: 50, max: 200 } },
    smoothness: { trim_method: 'movement', duration_seconds: f.dur, avg_gpu_busy_ms: f.gpu, cpu_bound_pct: 85, phases: { arr_taxi: { stutter_pct: 0.2 } } }, vram: { total_vram_mb: 12288 } }));
  index.sessions.push({ session_id: f.session_id, timestamp: f.timestamp, aircraft: f.aircraft, p99_ft_ms: f.p99, perceptible_count: f.felt, duration_seconds: f.dur, peak_vram_mb: f.vram, sim_version: f.sim, folder });
  fs.writeFileSync(path.join(sess, 'index.json'), JSON.stringify(index));
}
let simUp = false;
const store = createStore({ userData: tmp, usercfgPath: ucfg, sessionsDir: sess, isSimRunning: () => simUp });
try {
  for (let i = 0; i < 4; i++) logFlight(start, { felt: 6 + i });
  const saved = store.save({ source: 'captured', name: 'My base' });
  T('5. base profile saved from the sim', saved.ok);
  const pv = store.experimentPreview({ text: 'ABRP-PROFILE v1\nset: Light shafts = Ultra' });
  T('   preview with no base line uses the profile your sim matches ("My base")', pv.ok && pv.base.name === 'My base');
  const before = fs.readFileSync(ucfg, 'utf8');
  const c = store.experimentCreate({ text: 'ABRP-PROFILE v1\nname: Shafts test\nbase: My base\nset: Light shafts = Ultra\nflights: 3' });
  T('   create: saved as a DRAFT experiment, sim file untouched', c.ok && c.experiment.status === 'draft' && fs.readFileSync(ucfg, 'utf8') === before);
  const id = c.experiment.id;
  T('   experiment = base + ONLY the change', P.diff(start, c.experiment.values).length === 1 && P.diff(start, c.experiment.values)[0].id === 'Graphics/VolumetricLights/Quality');
  T('   experiments stay out of "My profiles" and out of ABRP Suggested\'s sources', !store.list().profiles.some(p => p.id === id) && store.list().experiments.some(e => e.id === id));
  simUp = true; T('   apply refused while MSFS runs', !store.apply({ id }).ok); simUp = false;
  const ap = store.apply({ id });
  const afterApply = fs.readFileSync(ucfg, 'utf8');
  const lineDiff = before.split('\n').filter((l, i) => l !== afterApply.split('\n')[i]);
  T('   apply: exactly ONE line of the sim file changes (Light shafts → 3)', ap.ok && lineDiff.length === 1 && /\tQuality 2/.test(lineDiff[0]) && P.readProfileable(afterApply)['Graphics/VolumetricLights/Quality'] === 3, lineDiff.join('|'));
  T('   …and the experiment is now ACTIVE, with a "fly 3 flights" message', store.load().profiles.find(p => p.id === id).status === 'active' && /fly 3 flights/.test(ap.msg));
  const expVals = P.readProfileable(afterApply);
  logFlight(expVals, { felt: 7, gpu: 12 });
  let l = store.list(), e = l.experiments.find(x => x.id === id);
  T('   after 1 flight: TESTING, collecting 1 of 3, no reminder yet', e.result.verdict === 'collecting' && e.result.n === 1 && !l.nudges.length);
  logFlight(expVals, { felt: 8, gpu: 12.4 }); logFlight(expVals, { felt: 8, gpu: 12.1 });
  l = store.list(); e = l.experiments.find(x => x.id === id);
  T('   after 3 flights: verdict FREE UPGRADE (GPU took the work)', e.result.verdict === 'free' && e.result.done, e.result.verdict);
  T('   …and a "Keep it or revert?" reminder appears', l.nudges.length === 1 && l.nudges[0].kind === 'finished' && /Keep it or revert/.test(l.nudges[0].text));
  T('   proposals no longer offer Light shafts (it\'s under test)', !(l.proposals.proposals || []).some(p => /VolumetricLights/.test(p.changes[0].id)));
  const keep = store.experimentFinish({ id, action: 'keep' });
  const baseNow = store.load().profiles.find(p => p.id === saved.profile.id);
  T('   KEEP folds the change into "My base" and notes it', keep.ok && baseNow.values['Graphics/VolumetricLights/Quality'] === 3 && /kept experiment "Shafts test"/.test(baseNow.note));
  T('   …experiment marked kept with its verdict; reminder gone', store.load().profiles.find(p => p.id === id).status === 'kept' && store.list().nudges.length === 0);
  // second experiment → revert
  const c2 = store.experimentCreate({ text: 'ABRP-PROFILE v1\nname: Reflections test\nbase: My base\nset: Raymarched reflections = Ultra' });
  store.apply({ id: c2.experiment.id });
  const rv = store.experimentFinish({ id: c2.experiment.id, action: 'revert' });
  T('   REVERT applies the base again (reflections back to High) and offers Undo', rv.ok && P.readProfileable(fs.readFileSync(ucfg, 'utf8'))['Graphics/SSR/Quality'] === 2 && store.load().profiles.find(p => p.id === c2.experiment.id).status === 'reverted');
  // drift reminder
  const c3 = store.experimentCreate({ text: 'ABRP-PROFILE v1\nbase: My base\nset: Contact shadows = Ultra' });
  store.apply({ id: c3.experiment.id });
  const baseVals = store.load().profiles.find(p => p.id === saved.profile.id).values;
  logFlight(baseVals, {}); logFlight(baseVals, {});
  T('   flew 2 flights OFF an active experiment → "Still testing?" reminder', store.list().nudges.some(n => n.kind === 'drift' && /Still testing/.test(n.text)));
  T('   END closes it without touching the sim file', (() => { const b = fs.readFileSync(ucfg, 'utf8'); const r = store.experimentFinish({ id: c3.experiment.id, action: 'end' }); return r.ok && fs.readFileSync(ucfg, 'utf8') === b; })());
  // import a full profile from text
  const exportT = store.exportText({ id: saved.profile.id });
  const imp = store.experimentCreate({ text: exportT.text.replace('name: My base', 'name: Imported copy') });
  T('   "Copy as text" → paste back recreates the profile exactly', imp.ok && imp.kind === 'profile' && P.diff(baseVals, imp.profile.values).length === 0);
  // proposals → one click
  const l2 = store.list();
  const pid = (l2.proposals.proposals || [])[0];
  const fromProp = pid && store.experimentCreate({ proposalId: pid.id });
  T('   "Start experiment" on a proposal creates it in one click', !!fromProp && fromProp.ok && fromProp.experiment.changes.length === 1);
} catch (e) { T('store lifecycle threw: ' + e.stack, false); }

// ── 6. SURFACE: the page Dean sees ──
{
  const listed = store.list();
  const names = ['_spK', '_spEq', '_spDisp', '_spDir', '_spDirTag', '_spMatches', '_spDiff', '_spChips', '_spTrack', 'profilesRange', '_spSection', '_spRender', '_spSuggestedCard', '_spCard', '_spSettingsTable', '_spExperimentsSection', '_spExpCard', '_spPastePanel'];
  const els = {};
  const src = 'let _SP=null, _spOpen={}, _spDiffOnly=true, _spConfirm=null, _spMsg=null, _spRenaming=null, _spShowSafety=false, _spShowRuns=false;\n'
    + 'let _spPaste={open:false,text:"",preview:null}, _spShowFinished=false;\n'
    + 'const document={getElementById:id=>(els[id]=els[id]||{innerHTML:"",focus(){},select(){}}),querySelector:()=>null};\n'
    + X.html.match(/const _LABV=\{[\s\S]*?\n\};/)[0] + '\n' + X.html.match(/const _SP_EXP_STATUS=[^\n]*/)[0] + '\n'
    + X.grab('esc') + '\n' + names.map(n => X.grab(n)).join('\n')
    + '\nreturn { set:(o)=>{ for(const k in o){ eval(k+"=o[k]"); } }, render:()=>{ _SP._keys={}; for(const k of _SP.schema.keys)_SP._keys[k.id]=k; _spRender(); return els["prof-body"].innerHTML; } };';
  const R = new Function('els', src)(els);
  const h0 = (R.set({ _SP: listed }), R.render());
  T('6. SURFACE: a 🧪 Experiments section with "＋ New experiment"', h0.includes('🧪 Experiments') && h0.includes('＋ New experiment'));
  // by the end of the lifecycle run every proposal has been used up; show the list with Dean's real headroom
  const realPr = P.proposeExperiments(loadFlights(path.join(X.APP_DATA, 'Sessions')), start, { baseName: 'ABRP Suggested' });
  const hp = (R.set({ _SP: Object.assign({}, listed, { proposals: realPr }) }), R.render()); R.set({ _SP: listed });
  T('   with Dean\'s real GPU headroom, "Suggested experiments" lists Light shafts Ultra + Start experiment', /Suggested experiments/.test(hp) && /Light shafts Ultra/.test(hp) && hp.includes('Start experiment'));
  T('   the new draft shows READY TO APPLY on its base', /READY TO APPLY/.test(h0));
  const h1 = (R.set({ _spShowFinished: true }), R.render());
  T('   finished experiments listed with KEPT / REVERTED / ENDED + verdict word', /KEPT/.test(h1) && /REVERTED/.test(h1) && /ENDED/.test(h1) && /FREE UPGRADE/.test(h1));
  const kept = listed.experiments.find(e => e.status === 'kept');
  const h2 = (R.set({ _spOpen: { [kept.id]: true } }), R.render());
  T('   an opened experiment shows its measured rows and the plain verdict', /Felt stutters \(vs your usual\)/.test(h2) && /GPU busy per frame/.test(h2) && /Free upgrade/.test(h2));
  T('   …with "Copy results for Claude" and "Copy as text"', h2.includes('Copy results for Claude') && h2.includes('Copy as text'));
  const pv = store.experimentPreview({ text: 'ABRP-PROFILE v1\nset: Light shafts = Extreme\nset: Contact shadows = Ultra' });
  const h3 = (R.set({ _spPaste: { open: true, text: 'x', preview: pv } }), R.render());
  T('   the paste box shows the error in plain words and keeps Save disabled', /✕ &quot;Extreme&quot; is not a value for Light shafts quality/.test(h3) && /sp-paste-save[^>]*disabled/.test(h3), (h3.match(/✕[^<]*/) || [''])[0]);
  const pv2 = store.experimentPreview({ text: 'ABRP-PROFILE v1\nname: Shadow test\nset: Shadow maps = 2048' });
  const h4 = (R.set({ _spPaste: { open: true, text: 'x', preview: pv2 } }), R.render());
  T('   a good paste previews "Shadow maps 1536 → 2048 ▲ more" and enables Save', /Shadow maps: 1536 → <b>2048<\/b>/.test(h4) && /▲ more/.test(h4) && !/sp-paste-save[^>]*disabled/.test(h4));
}

fs.rmSync(tmp, { recursive: true, force: true });
T('GUARD: Dean\'s live UserCfg.opt was never touched', hash(fs.readFileSync(LIVE, 'utf8')) === liveHash);
process.exit(T.done() ? 1 : 0);
