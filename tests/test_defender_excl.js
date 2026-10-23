'use strict';
// v6.24.0/.1 — Windows Defender exclusions (Maintenance tab) + the "exclusions missing" launch banner.
//
// Why: spike reports pinned the biggest mid-flight hitches on MsMpEng.exe scanning the files the sim
// streams in. ABRP adds permanent exclusions and re-checks them every launch. This suite proves:
//   - the list is derived from live config (no hardcoded Steam root; Fenix only if installed),
//   - NO DUPLICATES: anything already covered (same entry or a parent folder) is skipped — proven in
//     real powershell.exe 5.1 against Dean's ACTUAL current exclusion list (dry run, nothing written),
//   - a FILE exclusion on the sim .exe is not mistaken for a PROCESS exclusion (they do different jobs),
//   - ABRP records only what it added, so Remove never touches Dean's own entries,
//   - a non-admin read is "can't verify" — NEVER "missing" (no false-alarm banner),
//   - the REAL renderer shows Dean's actual folders, with "(yours)" vs "to add".
const fs = require('fs'), path = require('path'), os = require('os'), cp = require('child_process');
const X = require('./lib/extract.js');
const T = X.runner('Defender exclusions:');
const D = require('../defender.js');
const html = X.html;

function fakeIo(files, dirs){
  const F = Object.assign({}, files), Ds = new Set((dirs || []).map(d => d.toLowerCase()));
  const key = p => Object.keys(F).find(k => k.toLowerCase() === String(p).toLowerCase());
  return { exists: p => Ds.has(String(p).toLowerCase()) || key(p) != null,
           readFile: p => { const k = key(p); if (k == null) throw new Error('ENOENT'); return F[k]; } };
}
const STEAM = 'C:\\Program Files (x86)\\Steam', LIB2 = 'D:\\SteamLibrary';
const VDF = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`;
const ACF = `"AppState"\n{\n\t"appid"\t\t"2537590"\n\t"installdir"\t\t"MSFS2024"\n}`;

// ── 1. discovery is data-driven ──
T('1. libraryfolders.vdf paths parsed', JSON.stringify(D.parseLibraryFolders(VDF)) === JSON.stringify([STEAM, LIB2]));
T('   appmanifest installdir parsed', D.parseInstallDir(ACF) === 'MSFS2024');
T('   UserCfg.opt InstalledPackagesPath parsed (packages can live on any drive)', D.parseInstalledPackagesPath('{Video\n}\nInstalledPackagesPath "F:\\MSFS Packages"\n') === 'F:\\MSFS Packages');
{
  const io = fakeIo({ [STEAM + '\\steamapps\\libraryfolders.vdf']: VDF, [LIB2 + '\\steamapps\\appmanifest_2537590.acf']: ACF }, [LIB2 + '\\steamapps\\common\\MSFS2024']);
  const f = D.findMsfs([STEAM], io);
  T('   MSFS found on a non-default library via libraryfolders.vdf', f && f.install === LIB2 + '\\steamapps\\common\\MSFS2024' && f.library === LIB2, JSON.stringify(f));
  T('   no Steam → null (never throws)', D.findMsfs(['Z:\\nope'], fakeIo({}, [])) === null);
}

// ── 2. buildTargets ──
{
  const APPDATA = 'C:\\Users\\Pilot\\AppData\\Roaming', LOCAL = 'C:\\Users\\Pilot\\AppData\\Local', UD = APPDATA + '\\A Better Route Planner';
  const sim = APPDATA + '\\Microsoft Flight Simulator 2024', AC = 'C:\\Users\\Pilot\\Documents\\MSFS\\Aircraft';
  const cfg = { communityFolder: sim + '\\Packages\\Community', folder: 'E:\\Scenery\\', aircraftFolder: '' };
  const dirs = [STEAM + '\\steamapps\\common\\MSFS2024', sim, sim + '\\Packages\\Community', 'E:\\Scenery', AC, 'F:\\Pkgs',
    'C:\\Users\\Pilot\\AppData\\LocalLow\\NVIDIA\\PerDriverVersion\\DXCache', LOCAL + '\\D3DSCache',
    STEAM + '\\steamapps\\shadercache\\2537590', UD + '\\Sessions'];
  const io = fakeIo({ [STEAM + '\\steamapps\\libraryfolders.vdf']: VDF, [STEAM + '\\steamapps\\appmanifest_2537590.acf']: ACF }, dirs);
  const t = D.buildTargets({ cfg, appData: APPDATA, localAppData: LOCAL, userData: UD, usercfgText: 'InstalledPackagesPath "F:\\Pkgs"',
    steamRoots: [STEAM], hasFenix: true, aircraftRoot: AC, io });
  const has = p => t.paths.includes(p);
  T('2. core: MSFS install, sim data, moved packages path, aircraft + scenery libraries',
    has(STEAM + '\\steamapps\\common\\MSFS2024') && has(sim) && has('F:\\Pkgs') && has(AC) && has('E:\\Scenery'), JSON.stringify(t.paths));
  T('   shader caches: NVIDIA (LocalLow), DirectX D3DSCache, Steam MSFS shadercache',
    has('C:\\Users\\Pilot\\AppData\\LocalLow\\NVIDIA\\PerDriverVersion\\DXCache') && has(LOCAL + '\\D3DSCache') && has(STEAM + '\\steamapps\\shadercache\\2537590'));
  T('   older-driver NVIDIA DXCache skipped when it doesn\'t exist', !t.paths.some(p => /Local\\NVIDIA\\DXCache$/.test(p)));
  T('   ABRP flight logs + live capture file (file included even before it exists)', has(UD + '\\Sessions') && has(UD + '\\_capture_tmp.csv'));
  T('   capture file is labelled a FILE, folders as folders', t.kinds[UD + '\\_capture_tmp.csv'] === 'file' && t.kinds[sim] === 'folder');
  T('   every target carries a plain-English reason', t.paths.every(p => t.labels[p]), JSON.stringify(t.labels));
  T('   Community dropped — inside the sim data folder already', !t.paths.some(p => /Community$/i.test(p)));
  T('   trailing slash normalized (E:\\Scenery\\ → E:\\Scenery)', has('E:\\Scenery'));
  T('   Fenix installed → sim + 6 Fenix processes', t.processes.length === 7 && t.processes[0] === 'FlightSimulator2024.exe' && t.processes.includes('FenixSystem.exe'));
  const t2 = D.buildTargets({ cfg, appData: APPDATA, steamRoots: [STEAM], hasFenix: false, io });
  T('   no Fenix → only FlightSimulator2024.exe', JSON.stringify(t2.processes) === '["FlightSimulator2024.exe"]');
  const t3 = D.buildTargets({ cfg: { folder: 'Q:\\Gone' }, appData: 'Q:\\No', steamRoots: [], hasFenix: false, io: fakeIo({}, []) });
  T('   folders that don\'t exist are never excluded', t3.paths.length === 0);
}

// ── 3. coverage = no duplicates ──
T('3. same entry (case + trailing slash) counts as covered', !!D.pathCoveredBy('C:\\MSFS', ['c:\\msfs\\']));
T('   a PARENT folder you excluded covers everything inside it', D.pathCoveredBy('C:\\MSFS\\Packages\\Community', ['C:\\MSFS']) === 'C:\\MSFS');
T('   a sibling with the same prefix does NOT count (C:\\MSFS2 vs C:\\MSFS)', !D.pathCoveredBy('C:\\MSFS2', ['C:\\MSFS']));
T('   a whole drive (C:\\) covers everything on it', D.pathCoveredBy('C:\\MSFS\\X', ['C:\\']) === 'C:\\');
T('   exact entry preferred over a parent; else the CLOSEST parent', D.pathCoveredBy('C:\\A\\B', ['C:\\', 'C:\\A\\B']) === 'C:\\A\\B' && D.pathCoveredBy('C:\\A\\B\\C', ['C:\\', 'C:\\A']) === 'C:\\A');
T('   a FILE exclusion on the .exe is NOT a process exclusion', !D.procCoveredBy('FlightSimulator2024.exe', []) &&
  D.missingFrom({ paths: [], processes: ['FlightSimulator2024.exe'] }, { paths: ['C:\\X\\FlightSimulator2024.exe'], processes: [] }).processes.length === 1);
T('   process exclusion by bare name or full path both count', !!D.procCoveredBy('FenixSystem.exe', ['fenixsystem.exe']) && !!D.procCoveredBy('FenixSystem.exe', ['C:\\Program Files\\FenixSim A320\\FenixSystem.exe']));

// ── 4. parseStatus ──
{
  const notAdmin = 'PATH|N/A: Must be an administrator to view exclusions\r\nPROC|N/A: Must be an administrator to view exclusions\r\nTAMPER|True\r\n';
  const s = D.parseStatus(notAdmin);
  T('4. non-admin read → canRead:false, empty lists (never "everything missing")', s.canRead === false && !s.paths.length && !s.processes.length);
  T('   Tamper Protection parsed', s.tamper === true);
  T('   BOM on the first line does NOT hide the sentinel', D.parseStatus('\uFEFF' + notAdmin).canRead === false);
  const s2 = D.parseStatus('\uFEFFHAVE|C:\\A\r\nADDED|D:\\B\r\nADDEDPROC|Fenix.exe\r\nREMOVED|E:\\C\r\nREMOVEDPROC|X.exe\r\nPATH|C:\\A\r\nPATH|D:\\B\r\nPROC|Fenix.exe\r\nERR|boom');
  T('   HAVE / ADDED / ADDEDPROC / REMOVED markers parsed', s2.have[0] === 'C:\\A' && s2.added.paths[0] === 'D:\\B' && s2.added.processes[0] === 'Fenix.exe' && s2.removed.paths[0] === 'E:\\C' && s2.removed.processes[0] === 'X.exe', JSON.stringify(s2));
  T('   lists + errors parsed', s2.paths.length === 2 && s2.processes[0] === 'Fenix.exe' && s2.errors[0] === 'boom');
}

// ── 5. saved record: only what ABRP added; old v6.24.0 shape is safe ──
{
  const old = D.normSaved({ applied: true, paths: ['C:\\A'], processes: ['P.exe'], ts: 1 });
  T('5. v6.24.0 saved shape → targets kept, "added" EMPTY (Remove is a safe no-op for it)', old.targets.paths[0] === 'C:\\A' && old.added.paths.length === 0 && old.added.processes.length === 0);
  const s1 = D.savedAfterApply(undefined, { paths: ['C:\\A', 'C:\\B'], processes: ['P.exe'] }, { paths: ['C:\\B'], processes: ['P.exe'] });
  T('   after apply: added = ONLY what ABRP added (C:\\A was already yours)', JSON.stringify(s1.added.paths) === '["C:\\\\B"]' && s1.added.processes[0] === 'P.exe' && s1.targets.paths.length === 2);
  const s2 = D.savedAfterApply(s1, { paths: ['C:\\A', 'C:\\B', 'C:\\C'], processes: ['P.exe'] }, { paths: ['c:\\b', 'C:\\C'], processes: [] });
  T('   re-apply merges without duplicates (case-insensitive)', s2.added.paths.length === 2 && s2.added.paths.includes('C:\\C') && s2.added.processes.length === 1, JSON.stringify(s2.added));
}

// ── 6. banner ──
{
  const saved = { applied: true, targets: { paths: ['C:\\MSFS', 'E:\\Scenery'], processes: ['FlightSimulator2024.exe', 'FenixSystem.exe'] }, added: { paths: ['E:\\Scenery'], processes: [] } };
  T('6. everything covered (incl. by a parent folder) → no banner', D.bannerState(saved, { canRead: true, paths: ['C:\\', 'E:\\Scenery'], processes: ['flightsimulator2024.exe', 'FENIXSYSTEM.EXE'] }).show === false);
  const b = D.bannerState(saved, { canRead: true, paths: ['C:\\MSFS'], processes: ['FlightSimulator2024.exe'] });
  T('   Windows update removed two → banner, "2 of 4"', b.show && b.count === 2 && b.total === 4, JSON.stringify(b));
  T('   never applied → no banner', D.bannerState({ applied: false }, { canRead: true, paths: [], processes: [] }).show === false);
  T('   can\'t read (not admin) → no banner, never a false alarm', D.bannerState(saved, { canRead: false }).show === false);
}

// ── 7. buildScript ──
{
  const t = { paths: ["C:\\Users\\O'Brien\\Scenery"], processes: ['FlightSimulator2024.exe'] };
  const ap = D.buildScript('apply', t), rm = D.buildScript('remove', t), st = D.buildScript('status');
  T('7. apply checks existing BEFORE adding (Test-PathCovered / Test-ProcCovered gate)', /Test-PathCovered/.test(ap) && /Test-ProcCovered/.test(ap) && ap.indexOf('Get-MpPreference') < ap.indexOf('Add-MpPreference'));
  T('   apply adds only the gated lists ($addP / $addR)', /Add-MpPreference -ExclusionPath \$addP/.test(ap) && /Add-MpPreference -ExclusionProcess \$addR/.test(ap));
  T('   remove uses Remove-MpPreference only', /Remove-MpPreference/.test(rm) && !/Add-MpPreference/.test(rm));
  T('   apostrophes escaped (O\'\'Brien)', ap.includes("'C:\\Users\\O''Brien\\Scenery'"));
  T('   every mode ends with a read-back', [ap, rm, st].every(s => /Get-MpPreference/.test(s)));
  T('   status never writes; no ConvertFrom-Json anywhere', !/(Add|Remove)-MpPreference/.test(st) && ![ap, rm, st].some(s => /ConvertFrom-Json/i.test(s)));
  T('   dry run never writes', !/(Add|Remove)-MpPreference/.test(D.buildScript('apply', t, { dryRun: true, mockPaths: [], mockProcs: [] })));
}

// ── 8. REAL powershell.exe 5.1 gate, seeded with Dean's ACTUAL current exclusions (dry run) ──
const DEAN_NOW = {   // from his Windows Security screenshot, 2026-10-23
  paths: ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\MSFS2024\\FlightSimulator2024.exe',
    'C:\\Users\\MultiBotPC\\AppData\\Roaming\\SayIntentionsAI\\SayIntentionsAI\\\\SayIntentionsAI.exe',
    'C:\\Program Files (x86)\\Addon Manager', 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\MSFS2024',
    'C:\\Program Files\\FenixSim A320', 'C:\\Program Files\\SayIntentions.AI'],
  procs: [],
};
if (process.platform === 'win32') {
  const t = { paths: ['C:\\Program Files (x86)\\Steam\\steamapps\\common\\MSFS2024', 'C:\\Program Files\\FenixSim A320\\bin',
    'C:\\Users\\MultiBotPC\\Documents\\MSFS\\Scenery', "C:\\Users\\O'Brien\\X", 'D:\\Games\\X'], processes: ['FlightSimulator2024.exe', 'FenixSystem.exe'] };
  const mockP = DEAN_NOW.paths.concat(['D:\\']);   // + a whole-drive exclusion
  const ps1 = path.join(os.tmpdir(), 'abrp_test_def_gate.ps1');
  fs.writeFileSync(ps1, D.buildScript('apply', t, { dryRun: true, mockPaths: mockP, mockProcs: ['C:\\Program Files\\FenixSim A320\\FenixSystem.exe'] }), 'utf8');
  const o = cp.spawnSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1], { encoding: 'utf8' });
  try { fs.unlinkSync(ps1); } catch (_) {}
  const st = D.parseStatus(o.stdout);
  T('8. PS gate ran cleanly in powershell.exe 5.1', o.status === 0 && !(o.stderr || '').trim() && !st.errors.length, (o.stderr || '').slice(0, 200));
  T('   Dean\'s existing MSFS2024 folder → HAVE (skipped, no duplicate)', st.have.includes('C:\\Program Files (x86)\\Steam\\steamapps\\common\\MSFS2024'), JSON.stringify(st.have));
  T('   subfolder of his FenixSim A320 entry → HAVE (covered by the parent)', st.have.includes('C:\\Program Files\\FenixSim A320\\bin'));
  T('   a whole-drive exclusion (D:\\) covers D:\\Games\\X → HAVE', st.have.includes('D:\\Games\\X'), JSON.stringify(st.have));
  T('   FenixSystem.exe already a process exclusion (full path) → HAVE', st.have.includes('FenixSystem.exe'));
  T('   his FlightSimulator2024.exe FILE entry does NOT block adding the PROCESS', st.added.processes.includes('FlightSimulator2024.exe'));
  T('   genuinely new folders → ADDED (incl. an apostrophe path)', st.added.paths.includes('C:\\Users\\MultiBotPC\\Documents\\MSFS\\Scenery') && st.added.paths.includes("C:\\Users\\O'Brien\\X"), JSON.stringify(st.added));
  const nm = D.missingFrom(t, { paths: mockP, processes: ['C:\\Program Files\\FenixSim A320\\FenixSystem.exe'] });
  T('   PowerShell gate and Node coverage logic agree exactly', JSON.stringify(nm.paths) === JSON.stringify(st.added.paths) && JSON.stringify(nm.processes) === JSON.stringify(st.added.processes),
    JSON.stringify(nm) + ' vs ' + JSON.stringify(st.added));
} else T('8. (not Windows — PowerShell gate skipped)', true);

// ── 9. panelModel ──
{
  const targets = { paths: ['C:\\MSFS', 'E:\\Scenery', 'C:\\UD\\_capture_tmp.csv'], processes: ['FlightSimulator2024.exe'],
    labels: { 'C:\\MSFS': 'MSFS install', 'E:\\Scenery': 'Scenery library', 'C:\\UD\\_capture_tmp.csv': 'ABRP live capture file' },
    kinds: { 'C:\\UD\\_capture_tmp.csv': 'file' } };
  const saved = { applied: true, targets, added: { paths: ['C:\\UD\\_capture_tmp.csv'], processes: ['FlightSimulator2024.exe'] } };
  const m = D.panelModel(targets, saved, { canRead: true, paths: ['C:\\', 'C:\\UD\\_capture_tmp.csv'], processes: ['FlightSimulator2024.exe'] });
  const row = v => m.rows.find(r => r.value === v);
  T('9. covered by your parent folder → ok + coveredBy', row('C:\\MSFS').state === 'ok' && row('C:\\MSFS').coveredBy === 'C:\\' && row('C:\\MSFS').by === 'you');
  T('   added by ABRP → by:"abrp"', row('C:\\UD\\_capture_tmp.csv').by === 'abrp' && row('FlightSimulator2024.exe').by === 'abrp');
  T('   not covered → missing; kind "file" kept', row('E:\\Scenery').state === 'missing' && row('C:\\UD\\_capture_tmp.csv').kind === 'file');
  T('   summary: applied + 1 missing → kind "missing", banner shows', m.kind === 'missing' && m.missing === 1 && m.banner.show === true);
  const u = D.panelModel(targets, undefined, { canRead: false });
  T('   unreadable + never applied → "unknown", every row "unknown", no banner', u.kind === 'unknown' && u.rows.every(r => r.state === 'unknown') && !u.banner.show);
}

// ── 10. REAL renderer functions (lifted from index.html) — display only ──
const sb = new Function(`
  let S={cfg:{}, _defModel:null};
  const _els={};
  const document={getElementById:id=>_els[id]||null};
  ${X.grab('esc', html)}
  ${X.grab('defenderPanelHtml', html)}
  ${X.grab('renderDefenderPanel', html)}
  ${X.grab('defenderShowBanner', html)}
  ${X.grab('_defApplyModel', html)}
  return {S,_els,defenderPanelHtml,renderDefenderPanel,defenderShowBanner,_defApplyModel};
`)();
T('10. renderer holds NO coverage logic of its own (single source = defender.js)', !/function (defenderMissing|defenderBannerState|_defNorm)\(/.test(html));

let realCfg = null;
try { realCfg = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'config.json'), 'utf8')); } catch (_) {}
if (realCfg) {
  const aircraftRoot = realCfg.aircraftFolder || path.join(os.homedir(), 'Documents', 'MSFS', 'Aircraft');
  let hasFenix = false; try { hasFenix = fs.readdirSync(aircraftRoot, { recursive: true }).some(n => /fnx-aircraft-/i.test(String(n))); } catch (_) {}
  const roots = [];
  try { const r = cp.spawnSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' }); const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(r.stdout || ''); if (m) roots.push(m[1].trim().replace(/\//g, '\\')); } catch (_) {}
  roots.push('C:\\Program Files (x86)\\Steam');
  let usercfgText = ''; try { usercfgText = fs.readFileSync(path.join(process.env.APPDATA, 'Microsoft Flight Simulator 2024', 'UserCfg.opt'), 'utf8'); } catch (_) {}
  const targets = D.buildTargets({ cfg: realCfg, appData: process.env.APPDATA, localAppData: process.env.LOCALAPPDATA, userData: X.APP_DATA,
    usercfgText, steamRoots: roots, hasFenix, aircraftRoot,
    io: { exists: p => fs.existsSync(p), readFile: p => fs.readFileSync(p, 'utf8'), canon: p => { try { return fs.realpathSync.native(p); } catch (_) { return p; } } } });
  const els = sb._els;
  els['defender-status'] = { innerHTML: '' }; els['defender-list'] = { innerHTML: '' };
  els['defender-banner'] = { style: { display: 'none' } }; els['defender-msg'] = { textContent: '' };
  // Dean today: never applied via ABRP, admin read shows his real current list
  sb._defApplyModel({ model: D.panelModel(targets, undefined, { canRead: true, paths: DEAN_NOW.paths, processes: [] }) });
  const list = els['defender-list'].innerHTML, status = els['defender-status'].innerHTML;
  T('    real panel: his MSFS2024 install shows ✓ (yours) — not re-added', /&#10003; folder&nbsp; C:\\Program Files \(x86\)\\Steam\\steamapps\\common\\MSFS2024 [^<]*<span[^>]*>&mdash; MSFS install<\/span> <span[^>]*>\(yours\)/.test(list), list.slice(0, 400));
  T('    real panel: MSFS data folder + Scenery + Aircraft show "to add"', /&#10007; <b>to add<\/b> folder&nbsp; C:\\Users\\MultiBotPC\\AppData\\Roaming\\Microsoft Flight Simulator 2024/.test(list) && /to add<\/b> folder&nbsp; [^<]*MSFS\\Scenery/.test(list) && /to add<\/b> folder&nbsp; [^<]*MSFS\\Aircraft/.test(list));
  T('    real panel: shader caches + ABRP logs listed with reasons', /GPU shader cache \(NVIDIA\)/.test(list) && /GPU shader cache \(DirectX\)/.test(list) && /ABRP flight logs/.test(list));
  T('    real panel: capture file shown as a FILE', /file&nbsp;&nbsp;&nbsp; [^<]*_capture_tmp\.csv/.test(list));
  T('    real panel: Fenix processes listed (Fenix installed)', hasFenix ? /process FenixSystem\.exe/.test(list) && /process FenixDisplay\.exe/.test(list) : true);
  T('    real status line: "N of M to add … no duplicates"', /of \d+ to add\. Anything you already have is skipped/.test(status), status);
  T('    no banner before he has applied', els['defender-banner'].style.display === 'none');
  // after apply, a Windows update strips the data-folder entry
  const saved = D.savedAfterApply(undefined, targets, D.missingFrom(targets, { paths: DEAN_NOW.paths, processes: [] }));
  const afterAll = { canRead: true, paths: DEAN_NOW.paths.concat(saved.added.paths), processes: saved.added.processes };
  sb._defApplyModel({ model: D.panelModel(targets, saved, afterAll) });
  T('    after apply → "All N exclusions are in place", banner hidden', /All \d+ exclusions are in place/.test(els['defender-status'].innerHTML) && els['defender-banner'].style.display === 'none');
  T('    rows ABRP added say "(added by ABRP)"; his own say "(yours)"', /\(added by ABRP\)/.test(els['defender-list'].innerHTML) && /\(yours\)/.test(els['defender-list'].innerHTML));
  const stripped = { canRead: true, paths: afterAll.paths.filter(p => !/Roaming\\Microsoft Flight Simulator 2024$/.test(p)), processes: afterAll.processes };
  sb._defApplyModel({ model: D.panelModel(targets, saved, stripped) });
  T('    Windows update removes one → amber banner with words + icon, "1 of N"', els['defender-banner'].style.display === 'flex' && /⚠/.test(els['defender-msg'].textContent) && /missing \(1 of \d+\)/.test(els['defender-msg'].textContent), els['defender-msg'].textContent);
  sb._defApplyModel({ model: D.panelModel(targets, saved, { canRead: false }) });
  T('    can\'t read at launch → banner hidden (no false alarm)', els['defender-banner'].style.display === 'none');
  T('    Remove would only target what ABRP added — none of his own entries', !saved.added.paths.some(p => DEAN_NOW.paths.some(d => D.normPath(d).toLowerCase() === D.normPath(p).toLowerCase())));
} else T('10. (real config not readable — surface checks skipped)', true);

// ── 11. wiring ──
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const maint = html.slice(html.indexOf('id="pane-maintenance"'), html.indexOf('<!-- ── MY FLEET'));
T('11. Defender panel lives in the Maintenance tab', /Windows Defender Exclusions/.test(maint) && /id="defender-status"/.test(maint) && /onclick="defenderApplyUi\(false\)"/.test(maint));
T('    amber banner element exists with Re-apply', /id="defender-banner"/.test(html) && /onclick="defenderApplyUi\(true\)"/.test(html));
T('    launch check runs at boot, next to the version watcher', /checkMaintenanceVersions\(\);\s*\/\/[^\n]*\n\s*checkDefenderExclusions\(\);/.test(html));
for (const [ch, fn] of [['defender-targets', 'defenderTargets'], ['defender-status', 'defenderStatus'], ['defender-change', 'defenderChange']])
  T('    IPC ' + ch + ' handled in main + bridged in preload', main.includes(`ipcMain.handle('${ch}'`) && new RegExp(fn + ':\\s*\\(').test(pre) && pre.includes(`'${ch}'`));
T('    remove uses ONLY the recorded "added" list', /const work = isRemove \? \(prev\.added/.test(main));
T('    launch status read never prompts UAC', /defenderStatus\(\{elevate:false,saved:S\.cfg\.defenderExcl\}\)/.test(html));
T('    main passes LOCALAPPDATA, USER_DATA and UserCfg.opt into the target builder', /localAppData: process\.env\.LOCALAPPDATA, userData: USER_DATA, usercfgText/.test(main));
T('    defender.js ships in the installer', !/"!defender/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')));

process.exit(T.done() ? 1 : 0);
