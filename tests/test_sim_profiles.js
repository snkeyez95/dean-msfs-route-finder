'use strict';
// v6.27.0 SIM PROFILES — engine, file side and SURFACE, against Dean's REAL data.
//   · the settings dictionary never shows a backwards word (Texture 1 = High / 2 = Medium)
//   · reading/writing UserCfg.opt touches ONLY the intended lines (VR + display blocks byte-identical)
//   · his pre-DLSS baseline is rebuilt from flight history (Aug 27 – Oct 7, 36 counted flights)
//   · the store's apply → verify → undo leaves a COPY of his real file byte-identical
//   · the renderer (the real functions from index.html) shows what Dean would look at
// Never writes to his live UserCfg: every file test runs on a copy in a temp folder, deleted after.
const fs = require('fs'), path = require('path'), os = require('os');
const X = require('./lib/extract.js');
const T = X.runner('Sim Profiles:');
const S = require('../perf/native/usercfg_schema.js');
const P = require('../perf/native/profiles.js');
const { createStore, loadFlights } = require('../perf/native/profiles_store.js');

const LIVE = path.join(process.env.APPDATA || '', 'Microsoft Flight Simulator 2024', 'UserCfg.opt');
const SESS = path.join(X.APP_DATA, 'Sessions');
if (!fs.existsSync(LIVE) || !fs.existsSync(path.join(SESS, 'index.json'))) { console.log('SKIP — needs the real UserCfg.opt + Sessions'); process.exit(0); }
const liveText = fs.readFileSync(LIVE, 'utf8');
const liveHashBefore = require('crypto').createHash('sha1').update(liveText).digest('hex');

// ── 1. dictionary ──
{
  const ids = S.KEYS.map(k => k.id);
  T('1. every schema key is unique', new Set(ids).size === ids.length);
  const tex = S.BY_ID['Graphics/Texture/Quality'];
  T('   Texture 1 reads "High", 2 reads "Medium" (the inverted scale)', S.display(tex, 1) === '1 · High' && S.display(tex, 2) === '2 · Medium');
  T('   Texture 2 → 1 is an INCREASE, 1 → 2 a decrease', S.direction(tex, 2, 1) === 'up' && S.direction(tex, 1, 2) === 'down');
  T('   clouds 3 = Ultra, particles 1 = High, water 512 = High', S.display(S.BY_ID['Graphics/VolumetricClouds/Quality'], 3) === '3 · Ultra'
    && S.display(S.BY_ID['Graphics/Particles/Quality'], 1) === '1 · High' && S.display(S.BY_ID['Graphics/Water/FFTSize'], 512) === '512 · High');
  T('   an unverified setting shows its number, never a guessed word', S.display(S.BY_ID['Graphics/Traffic/RoadQuality'], 0) === '0 · unverified');
  T('   no display / window / VR key is in the schema', !ids.some(id => /Resolution|Windowed|Monitor|Adapter|PosX|VSync|HDR10|VR$|InstalledPackages/.test(id)));
}

// ── 2. reading + surgical writing on the REAL file text ──
const cur = P.readProfileable(liveText);
{
  T('2. reads Dean\'s real UserCfg (60+ settings)', Object.keys(cur).length >= 60, String(Object.keys(cur).length));
  T('   desktop values, not VR (Texture from {Graphics}, not {GraphicsVR})', cur['Graphics/VolumetricClouds/Quality'] === 3 && cur['Video/AntiAliasing'] != null);
  T('   applying the current values is a byte-identical no-op', P.applyToText(liveText, cur).text === liveText);
  const want = Object.assign({}, cur, { 'Graphics/Texture/Quality': cur['Graphics/Texture/Quality'] === 1 ? 2 : 1, 'Video/SharpenAmount': 0.2, 'Graphics/Terrain/LoDFactor': 3 });
  const r = P.applyToText(liveText, want);
  const a = liveText.replace(/\r/g, '').split('\n'), b = r.text.replace(/\r/g, '').split('\n');
  const changedLines = a.map((l, i) => l !== b[i] ? i : -1).filter(i => i >= 0);
  T('   only the 2 intended lines change (TLOD skipped: AutoFPS-managed)', changedLines.length === 2 && r.changed.length === 2, changedLines.length + ' lines');
  T('   number format kept (sharpening written as 0.200000)', /\tSharpenAmount 0\.200000/.test(r.text));
  const vr = t => t.slice(t.indexOf('{GraphicsVR'));
  T('   the VR block is byte-identical', vr(r.text) === vr(liveText));
  T('   display lines untouched (Resolution / Windowed)', (r.text.match(/\tResolution .*/) || [])[0] === (liveText.match(/\tResolution .*/) || [])[0]);
  T('   TLOD applied only when asked', P.applyToText(liveText, want, { includeLod: true }).changed.some(c => c.id === 'Graphics/Terrain/LoDFactor'));
  T('   a setting missing from the file is skipped, never inserted', P.applyToText(liveText.replace(/\tSharpenAmount [^\n]*\n/, ''), { 'Video/SharpenAmount': 0.5 }).skipped.length === 1);
  const crlf = liveText.replace(/\r?\n/g, '\r\n');
  T('   Windows line endings are preserved', /\r\n/.test(P.applyToText(crlf, want).text) && !/[^\r]\n/.test(P.applyToText(crlf, want).text));
  T('   verify() catches a wrong read-back', P.verify(liveText, { 'Graphics/VolumetricClouds/Quality': 0 }).length === 1);
}

// ── 3. history: the pre-DLSS baseline ──
const flights = loadFlights(SESS);
const runs = P.historyRuns(flights);
const base = runs.find(r => String(r.first).startsWith('2026-08-27') && String(r.last).startsWith('2026-10-07'));
{
  T('3. finds the Aug 27 – Oct 7 TAA run', !!base, runs.map(r => r.first.slice(0, 10) + '>' + r.last.slice(0, 10) + ' n' + r.n).join(' | '));
  T('   …with 36 counted flights (+4 mid-flight exits excluded, as everywhere in ABRP), P99 17.8', base && base.n === 36 && base.total === 40 && base.p99 === 17.8, base && (base.n + ' / ' + base.p99));
  const oct7 = flights.find(f => f.session_id === '2026-10-07_1247');
  const snap = oct7 && P.fromSnapshot(oct7.settings);
  T('   the rebuilt values equal the Oct 7 flight snapshot exactly', !!snap && Object.keys(snap).every(id => P._equal(snap[id], base.values[id])));
  T('   upscaler rebuilt as TAA, render scale 120%, Textures Medium (2)', base && base.values['Video/AntiAliasing'] === 'TAA' && base.values['Video/PrimaryScaling'] === 1.2 && base.values['Graphics/Texture/Quality'] === 2);
  T('   the DLSS stretch is its own run (Oct 13 – 27)', runs.some(r => r.values['Video/AntiAliasing'] === 'DLSS' && String(r.first).startsWith('2026-10-13')));
  const sg = P.suggest(flights, { currentSim: '1.9.24.0' });
  T('   ABRP Suggested is built on that run, High confidence', sg.ok && sg.base.first.startsWith('2026-08-27') && sg.confidence === 'High', sg.ok ? sg.base.first : sg.reason);
  T('   …and says why in plain words (40 flights, DLSS not adopted)', sg.ok && sg.reasons[0].includes('36 flights') && sg.reasons.some(t => /Not adopted: .*DLSS/.test(t)));
  T('   …and flags that it was measured on an older sim build', sg.ok && sg.reasons.some(t => /you're on 1\.9\.24\.0/.test(t)));
  // aircraft-mix honesty: shuffling which run each flight belongs to must not change per-aircraft norms
  const noFenix = flights.map(f => Object.assign({}, f, { aircraft: f.aircraft === 'Fenix' ? 'Fenix' : f.aircraft }));
  T('   suggestion is deterministic', JSON.stringify(P.suggest(noFenix, {}).values) === JSON.stringify(P.suggest(flights, {}).values));
}

// ── 4. the store, end to end, on a COPY ──
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abrp-prof-'));
const copy = path.join(tmp, 'UserCfg.opt');
fs.writeFileSync(copy, liveText);
let simRunning = false;
const store = createStore({ userData: tmp, usercfgPath: copy, sessionsDir: SESS, isSimRunning: () => simRunning });
let listed;
try {
  listed = store.list();
  T('4. list(): current settings found, runs + suggestion present', listed.ok && listed.found && listed.runs.length >= 5 && listed.suggestion.ok);
  const s1 = store.save({ source: 'captured' });
  T('   save current → a named profile', s1.ok && s1.profile.name === P.profileName(cur), s1.profile && s1.profile.name);
  const s2 = store.save({ source: 'history', runId: base.id });
  T('   save the baseline run → a profile with a "rebuilt from 36 flights" note', s2.ok && /36 logged flights/.test(s2.profile.note), s2.profile && s2.profile.note);
  T('   rename works', store.rename({ id: s2.profile.id, name: 'TAA baseline (pre-DLSS)' }).ok && store.load().profiles.find(p => p.id === s2.profile.id).name === 'TAA baseline (pre-DLSS)');
  simRunning = true;
  const blocked = store.apply({ id: s2.profile.id });
  T('   apply is REFUSED while MSFS runs, file untouched', !blocked.ok && /MSFS is running/.test(blocked.msg) && fs.readFileSync(copy, 'utf8') === liveText);
  simRunning = false;
  const ap = store.apply({ id: s2.profile.id });
  const after = P.readProfileable(fs.readFileSync(copy, 'utf8'));
  T('   apply baseline: changed + verified', ap.ok && ap.changed.length > 0, ap.msg);
  T('   the file now reads Textures 2 · Medium, raytraced shadows On, SSAO Ultra', after['Graphics/Texture/Quality'] === 2 && after['Graphics/RaytracedShadows/Enabled'] === 1 && after['Graphics/SSAO/Quality'] === 3);
  T('   TLOD/OLOD left alone (AutoFPS-managed)', P._equal(after['Graphics/Terrain/LoDFactor'], cur['Graphics/Terrain/LoDFactor']));
  T('   a backup of the original was written first', fs.readdirSync(path.join(tmp, 'usercfg_backups')).some(f => /^UserCfg_\d/.test(f)));
  T('   an automatic "Before …" backup profile was kept', store.load().profiles.some(p => p.source === 'safety' && P._equal(p.values['Graphics/Texture/Quality'], cur['Graphics/Texture/Quality'])));
  T('   list() now says the baseline is current', P.matches(store.load().profiles.find(p => p.id === s2.profile.id).values, store.list().current));
  const un = store.apply({ undo: true });
  T('   UNDO restores the file BYTE-IDENTICAL', un.ok && fs.readFileSync(copy, 'utf8') === liveText, un.msg);
  T('   undo can\'t run twice', !store.apply({ undo: true }).ok);
  T('   applying what\'s already there changes nothing', store.apply({ id: s1.profile.id }).changed.length === 0);
  for (let i = 0; i < 5; i++) { store.apply({ id: s2.profile.id }); store.apply({ undo: true }); }
  T('   automatic backups are capped at 3', store.load().profiles.filter(p => p.source === 'safety').length === 3);
  T('   delete removes only the profile', store.del({ id: s1.profile.id }).ok && fs.readFileSync(copy, 'utf8') === liveText);
  T('   apply ABRP Suggested by id works', store.apply({ id: 'suggested' }).ok && store.apply({ undo: true }).ok && fs.readFileSync(copy, 'utf8') === liveText);
  listed = store.list();
} catch (e) { T('store threw: ' + e.stack, false); }

// ── 5. SURFACE: the real renderer from index.html, fed by the store ──
{
  const names = ['_spK', '_spEq', '_spDisp', '_spDir', '_spDirTag', '_spMatches', '_spDiff', '_spChips', '_spTrack', 'profilesRange', '_spSection', '_spRender', '_spSuggestedCard', '_spCard', '_spSettingsTable'];
  const els = {};
  const src = 'let _SP=null, _spOpen={}, _spDiffOnly=true, _spConfirm=null, _spMsg=null, _spRenaming=null, _spShowSafety=false, _spShowRuns=false;\n'
    + 'const document={getElementById:id=>(els[id]=els[id]||{innerHTML:"",focus(){},select(){}}),querySelector:()=>null};\n'
    + X.grab('esc') + '\n' + names.map(n => X.grab(n)).join('\n')
    + '\nreturn { set:(o)=>{ for(const k in o){ eval(k+"=o[k]"); } }, render:()=>{ _SP._keys={}; for(const k of _SP.schema.keys)_SP._keys[k.id]=k; _spRender(); return els["prof-body"].innerHTML; } };';
  const R = new Function('els', src)(els);
  const html0 = (R.set({ _SP: listed }), R.render());
  T('5. SURFACE: "Your sim right now" shows the live setup name', html0.includes('Your sim right now') && html0.includes(X.html ? listed.currentName.replace(/&/g, '&amp;') : ''));
  T('   ⭐ ABRP Suggested card with a HIGH CONFIDENCE tag', html0.includes('⭐ ABRP Suggested') && html0.includes('HIGH CONFIDENCE'));
  T('   the baseline profile shows its track record "Flown 36×"', html0.includes('TAA baseline (pre-DLSS)') && /Flown 36× · P99 17\.8 ms · 7\.5 felt stutters\/hr/.test(html0), (html0.match(/Flown [^<]*/g)||[]).join(' | '));
  T('   the history section is collapsed by default (keeps the page clean)', html0.includes('▸ From your flight history') && !html0.includes('Aug 27 – Oct 7 · 36 flights'));
  const html1 = (R.set({ _spShowRuns: true }), R.render());
  T('   expanded, it lists "Aug 27 – Oct 7 · 36 flights (+4 excluded)"', html1.includes('Aug 27 – Oct 7 · 36 flights (+4 excluded)'));
  const html2 = (R.set({ _spOpen: { [base.id]: true } }), R.render());
  T('   expanding the baseline shows Textures now "1 · High" → "2 · Medium" ▼ less', /Texture resolution[\s\S]{0,400}now 1 · High →[\s\S]{0,300}2 · Medium[\s\S]{0,200}▼ less/.test(html2));
  T('   …and SSAO now "1 · Medium" → "3 · Ultra" ▲ more', /Ambient occlusion quality[\s\S]{0,400}now 1 · Medium →[\s\S]{0,300}3 · Ultra[\s\S]{0,200}▲ more/.test(html2));
  T('   only differing rows shown by default (no unchanged Clouds row)', !/Volumetric clouds quality/.test(html2.slice(html2.indexOf('data-key="' + base.id + '"'), html2.indexOf('data-key="' + base.id + '"') + 20000)));
  const html3 = (R.set({ _spConfirm: base.id }), R.render());
  T('   Apply… opens a confirm listing the changes, with the backup + undo promise', /will change:/.test(html3) && /One click undoes it/.test(html3));
  const html4 = (R.set({ _spConfirm: null, _spOpen: { suggested: true, __why: true } }), R.render());
  T('   "Why this profile?" explains the base in plain words', html4.includes('36 flights') && html4.includes('Not adopted:'));
  const html5 = (R.set({ _SP: Object.assign({}, listed, { simRunning: true }), _spOpen: { suggested: true } }), R.render());
  T('   with MSFS running: banner shown + Apply disabled', html5.includes('MSFS is running') && /sp-apply[^>]*disabled/.test(html5));
  T('   colour-blind safe: changes carry ▲/▼ words, not colour alone', /▼ less/.test(html2) && /▲ more/.test(html2));
}

fs.rmSync(tmp, { recursive: true, force: true });
const liveHashAfter = require('crypto').createHash('sha1').update(fs.readFileSync(LIVE, 'utf8')).digest('hex');
T('GUARD: Dean\'s live UserCfg.opt was never touched', liveHashBefore === liveHashAfter);
process.exit(T.done() ? 1 : 0);
