'use strict';
// v6.24.0 — Windows Defender exclusions (Maintenance tab) + the "exclusions missing" launch banner.
//
// Why: spike reports pinned the biggest mid-flight hitches on MsMpEng.exe scanning sim/Fenix files.
// ABRP adds permanent Defender exclusions and re-checks them every launch. This suite proves:
//   - the exclusion list is derived from live config (no hardcoded Steam root, Fenix only if installed),
//   - a non-admin read ("N/A: Must be an administrator…") is "can't verify" — NEVER "missing",
//   - the banner only nags after you've applied them once, and only when something is really gone,
//   - the REAL renderer functions show Dean's actual MSFS path + Fenix processes on the panel.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('Defender exclusions:');
const D = require('../defender.js');
const html = X.html;

// ── fake filesystem for the target builder ──
function fakeIo(files, dirs){
  const F = Object.assign({}, files), Ds = new Set((dirs || []).map(d => d.toLowerCase()));
  return { exists: p => Ds.has(String(p).toLowerCase()) || Object.keys(F).some(k => k.toLowerCase() === String(p).toLowerCase()),
           readFile: p => { const k = Object.keys(F).find(k => k.toLowerCase() === String(p).toLowerCase()); if (k == null) throw new Error('ENOENT'); return F[k]; } };
}
const STEAM = 'C:\\Program Files (x86)\\Steam', LIB2 = 'D:\\SteamLibrary';
const VDF = `"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"D:\\\\SteamLibrary"\n\t}\n}`;
const ACF = `"AppState"\n{\n\t"appid"\t\t"2537590"\n\t"installdir"\t\t"MSFS2024"\n}`;

// ── 1. Steam discovery is data-driven (the MSFS install can live in ANY library) ──
T('1. libraryfolders.vdf paths parsed (doubled backslashes collapsed)', JSON.stringify(D.parseLibraryFolders(VDF)) === JSON.stringify([STEAM, LIB2]), JSON.stringify(D.parseLibraryFolders(VDF)));
T('   appmanifest installdir parsed', D.parseInstallDir(ACF) === 'MSFS2024');
{
  // MSFS installed on the SECOND library (D:) — a fixed root list would miss it
  const io = fakeIo({ [STEAM + '\\steamapps\\libraryfolders.vdf']: VDF, [LIB2 + '\\steamapps\\appmanifest_2537590.acf']: ACF },
                    [LIB2 + '\\steamapps\\common\\MSFS2024']);
  T('   finds MSFS on a non-default library via libraryfolders.vdf', D.findMsfsInstall([STEAM], io) === LIB2 + '\\steamapps\\common\\MSFS2024', D.findMsfsInstall([STEAM], io));
  T('   no Steam at all → null (never throws)', D.findMsfsInstall(['Z:\\nope'], fakeIo({}, [])) === null);
}

// ── 2. buildTargets: live-config derived, existing dirs only, nested dupes dropped, Fenix gated ──
{
  const APPDATA = 'C:\\Users\\Pilot\\AppData\\Roaming';
  const sim = APPDATA + '\\Microsoft Flight Simulator 2024';
  const cfg = { communityFolder: sim + '\\Packages\\Community', folder: 'E:\\Scenery\\', aircraftFolder: '' };
  const io = fakeIo({ [STEAM + '\\steamapps\\libraryfolders.vdf']: VDF, [STEAM + '\\steamapps\\appmanifest_2537590.acf']: ACF },
                    [STEAM + '\\steamapps\\common\\MSFS2024', sim, sim + '\\Packages\\Community', 'E:\\Scenery', 'C:\\Users\\Pilot\\Documents\\MSFS\\Aircraft']);
  const t = D.buildTargets({ cfg, appData: APPDATA, steamRoots: [STEAM], hasFenix: true, aircraftRoot: 'C:\\Users\\Pilot\\Documents\\MSFS\\Aircraft', io });
  T('2. includes the MSFS install, sim data folder, aircraft + scenery libraries', t.paths.length === 4 &&
    t.paths.includes(STEAM + '\\steamapps\\common\\MSFS2024') && t.paths.includes(sim) && t.paths.includes('E:\\Scenery') &&
    t.paths.includes('C:\\Users\\Pilot\\Documents\\MSFS\\Aircraft'), JSON.stringify(t.paths));
  T('   Community folder dropped — already covered by its parent sim data folder', !t.paths.some(p => /Community$/i.test(p)));
  T('   trailing slash normalized (E:\\Scenery\\ → E:\\Scenery)', t.paths.includes('E:\\Scenery'));
  T('   blank cfg.aircraftFolder still covered via the RESOLVED aircraft root', t.paths.some(p => /MSFS\\Aircraft$/.test(p)));
  T('   Fenix installed → its 6 companion processes + the sim', t.processes.length === 7 && t.processes[0] === 'FlightSimulator2024.exe' && t.processes.includes('FenixSystem.exe') && t.processes.includes('FenixDisplay.exe'), JSON.stringify(t.processes));
  const t2 = D.buildTargets({ cfg, appData: APPDATA, steamRoots: [STEAM], hasFenix: false, io });
  T('   no Fenix installed → only FlightSimulator2024.exe (nothing fleet-hardcoded)', JSON.stringify(t2.processes) === '["FlightSimulator2024.exe"]');
  const t3 = D.buildTargets({ cfg: { folder: 'Q:\\Gone' }, appData: 'Q:\\NoAppData', steamRoots: [], hasFenix: false, io: fakeIo({}, []) });
  T('   folders that don\'t exist are never excluded', t3.paths.length === 0);
}

// ── 3. parseStatus: the admin sentinel is "can't verify", NEVER "missing" ──
{
  // the exact text Defender returned on Dean's machine from a non-admin shell (2026-10-23)
  const notAdmin = 'PATH|N/A: Must be an administrator to view exclusions\r\nPROC|N/A: Must be an administrator to view exclusions\r\nTAMPER|True\r\n';
  const s = D.parseStatus(notAdmin);
  T('3. non-admin read → canRead:false, empty lists (not an empty "everything missing" read)', s.canRead === false && s.paths.length === 0 && s.processes.length === 0, JSON.stringify(s));
  T('   Tamper Protection parsed', s.tamper === true);
  const s2 = D.parseStatus('\uFEFF' + notAdmin);
  T('   a BOM on the first line (PS 5.1 Set-Content) does NOT hide the sentinel', s2.canRead === false, JSON.stringify(s2));
  const s3 = D.parseStatus('\uFEFFOK|paths\r\nPATH|C:\\A\r\nPATH|D:\\B\r\nPROC|FlightSimulator2024.exe\r\nTAMPER|False\r\nERR|boom');
  T('   admin read → lists parsed, BOM tolerated on the first line', s3.canRead && s3.paths.length === 2 && s3.paths[0] === 'C:\\A' && s3.processes[0] === 'FlightSimulator2024.exe', JSON.stringify(s3));
  T('   OK / ERR markers captured', s3.ok === true && s3.errors[0] === 'boom');
}

// ── 4. missingFrom / bannerState (module) ──
{
  const saved = { applied: true, paths: ['C:\\MSFS', 'E:\\Scenery'], processes: ['FlightSimulator2024.exe', 'FenixSystem.exe'] };
  const all = { canRead: true, paths: ['c:\\msfs\\', 'E:\\Scenery', 'X:\\UserOwn'], processes: ['flightsimulator2024.exe', 'FENIXSYSTEM.EXE'] };
  T('4. case + trailing-slash insensitive match → nothing missing', D.bannerState(saved, all).show === false && D.bannerState(saved, all).reason === 'all-present');
  const gone = { canRead: true, paths: ['C:\\MSFS'], processes: ['FlightSimulator2024.exe'] };
  const b = D.bannerState(saved, gone);
  T('   one path + one process gone → banner, count 2', b.show === true && b.count === 2 && b.missing.paths[0] === 'E:\\Scenery' && b.missing.processes[0] === 'FenixSystem.exe', JSON.stringify(b));
  T('   never applied → no banner even if Defender holds nothing', D.bannerState({ applied: false }, { canRead: true, paths: [], processes: [] }).show === false);
  T('   applied but can\'t read (not admin) → no banner (never a false alarm)', D.bannerState(saved, { canRead: false, paths: [], processes: [] }).show === false);
}

// ── 5. buildScript: right cmdlets, safe quoting, always a read-back ──
{
  const t = { paths: ["C:\\Users\\O'Brien\\Scenery"], processes: ['FlightSimulator2024.exe'] };
  const ap = D.buildScript('apply', t), rm = D.buildScript('remove', t), st = D.buildScript('status');
  T('5. apply uses Add-MpPreference for paths AND processes', /Add-MpPreference -ExclusionPath @\(/.test(ap) && /Add-MpPreference -ExclusionProcess @\(/.test(ap));
  T('   remove uses Remove-MpPreference', /Remove-MpPreference -ExclusionPath/.test(rm) && !/Add-MpPreference/.test(rm));
  T('   apostrophes escaped PowerShell-style (O\'\'Brien)', ap.includes("'C:\\Users\\O''Brien\\Scenery'"));
  T('   every mode ends with a Get-MpPreference read-back (verify, don\'t assume)', [ap, rm, st].every(s => /Get-MpPreference/.test(s)));
  T('   status mode never writes', !/(Add|Remove)-MpPreference/.test(st));
  T('   no ConvertFrom-Json anywhere (PS 5.1 rule — Node parses)', ![ap, rm, st].some(s => /ConvertFrom-Json/i.test(s)));
}

// ── 6. REAL renderer functions (lifted from index.html) ──
const sb = new Function(`
  let S={cfg:{}, _defTargets:null, _defStatus:null};
  const _els={};
  const document={getElementById:id=>_els[id]||null};
  ${X.grab('esc', html)}
  ${X.grab('_defNorm', html)}
  ${X.grab('defenderMissing', html)}
  ${X.grab('defenderBannerState', html)}
  ${X.grab('defenderPanelHtml', html)}
  ${X.grab('renderDefenderPanel', html)}
  ${X.grab('defenderShowBanner', html)}
  return {S,_els,defenderMissing,defenderBannerState,defenderPanelHtml,renderDefenderPanel,defenderShowBanner};
`)();
{
  // parity: renderer copy agrees with the module on every case above
  const saved = { applied: true, paths: ['C:\\MSFS', 'E:\\Scenery'], processes: ['FlightSimulator2024.exe', 'FenixSystem.exe'] };
  const cases = [
    { canRead: true, paths: ['c:\\msfs\\', 'E:\\Scenery'], processes: ['flightsimulator2024.exe', 'FENIXSYSTEM.EXE'] },
    { canRead: true, paths: ['C:\\MSFS'], processes: ['FlightSimulator2024.exe'] },
    { canRead: false, paths: [], processes: [] },
  ];
  T('6. renderer banner logic matches defender.js on all cases', cases.every(c => JSON.stringify(sb.defenderBannerState(saved, c)) .replace(/,"total":\d+/, '') === JSON.stringify(D.bannerState(saved, c))),
    cases.map(c => JSON.stringify(sb.defenderBannerState(saved, c))).join(' / '));
  T('   never-applied → no banner (renderer)', sb.defenderBannerState(undefined, cases[1]).show === false);
}

// ── 7. SURFACE against Dean's real machine + config ──
let realCfg = null;
try { realCfg = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'config.json'), 'utf8')); } catch (_) {}
if (realCfg) {
  const os = require('os'), cp = require('child_process');
  const aircraftRoot = realCfg.aircraftFolder || path.join(os.homedir(), 'Documents', 'MSFS', 'Aircraft');
  let hasFenix = false; try { hasFenix = fs.readdirSync(aircraftRoot, { recursive: true }).some(n => /fnx-aircraft-/i.test(String(n))); } catch (_) {}
  const roots = [];
  try { const r = cp.spawnSync('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { encoding: 'utf8' }); const m = /SteamPath\s+REG_SZ\s+(.+)/i.exec(r.stdout || ''); if (m) roots.push(m[1].trim().replace(/\//g, '\\')); } catch (_) {}
  roots.push('C:\\Program Files (x86)\\Steam');
  const targets = D.buildTargets({ cfg: realCfg, appData: process.env.APPDATA, steamRoots: roots, hasFenix, aircraftRoot,
    io: { exists: p => fs.existsSync(p), readFile: p => fs.readFileSync(p, 'utf8'), canon: p => { try { return fs.realpathSync.native(p); } catch (_) { return p; } } } });
  // what the panel shows on Dean's machine today (non-admin read, nothing applied yet)
  sb._els['defender-status'] = { innerHTML: '' }; sb._els['defender-list'] = { innerHTML: '' };
  sb.S._defTargets = targets; sb.S.cfg = { defenderExcl: undefined }; sb.S._defStatus = { canRead: false, paths: [], processes: [] };
  sb.renderDefenderPanel();
  const list = sb._els['defender-list'].innerHTML, status = sb._els['defender-status'].innerHTML;
  T('7. panel lists Dean\'s real MSFS install folder', targets.msfsInstall && list.includes(targets.msfsInstall.replace(/&/g, '&amp;')), targets.msfsInstall);
  T('   panel lists his scenery library + aircraft library', list.includes('MSFS\\Scenery') && list.includes('MSFS\\Aircraft'), list.slice(0, 300));
  T('   panel lists the Fenix processes (Fenix is installed)', hasFenix ? (list.includes('FenixSystem.exe') && list.includes('FenixDisplay.exe')) : true);
  T('   status reads "Not applied yet" — not a fake ✓, not a fake ⚠', /Not applied yet/.test(status) && !/&#9888;/.test(status), status);
  // after applying: everything present → ✓ line, no banner
  const full = { canRead: true, paths: targets.paths.slice(), processes: targets.processes.slice() };
  sb.S.cfg = { defenderExcl: { applied: true, paths: targets.paths, processes: targets.processes, ts: Date.now() } };
  sb.S._defStatus = full; sb.renderDefenderPanel();
  T('   all present → "All N exclusions are in place"', new RegExp('All ' + (targets.paths.length + targets.processes.length) + ' exclusions are in place').test(sb._els['defender-status'].innerHTML), sb._els['defender-status'].innerHTML);
  // the banner element itself
  const ban = { style: { display: 'none' } }, msg = { textContent: '' };
  sb._els['defender-banner'] = ban; sb._els['defender-msg'] = msg;
  sb.defenderShowBanner(full);
  T('   banner stays hidden when everything is there', ban.style.display === 'none');
  const afterUpdate = { canRead: true, paths: targets.paths.slice(1), processes: targets.processes.slice() };
  sb.defenderShowBanner(afterUpdate);
  T('   a Windows update removes one → banner SHOWS with words + icon (not colour alone)', ban.style.display === 'flex' && /⚠/.test(msg.textContent) && /missing \(1 of /.test(msg.textContent), msg.textContent);
  sb.S._defStatus = afterUpdate; sb.renderDefenderPanel();
  T('   panel marks the removed folder "missing"', /&#10007; missing folder/.test(sb._els['defender-list'].innerHTML));
  sb.defenderShowBanner({ canRead: false });
  T('   can\'t read at launch (not admin) → banner hidden, no false alarm', ban.style.display === 'none');
} else {
  T('7. (real config not readable — surface checks skipped)', true);
}

// ── 8. wiring: the DOM, boot call, IPC + preload names line up ──
const main = fs.readFileSync(path.join(__dirname, '..', 'main.js'), 'utf8');
const pre = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
const maint = html.slice(html.indexOf('id="pane-maintenance"'), html.indexOf('<!-- ── MY FLEET'));
T('8. Defender panel lives in the Maintenance tab', /Windows Defender Exclusions/.test(maint) && /id="defender-status"/.test(maint) && /onclick="defenderApplyUi\(false\)"/.test(maint));
T('   amber banner element exists beside the maintenance banner', /id="defender-banner"/.test(html) && /onclick="defenderApplyUi\(true\)"/.test(html));
T('   launch check runs at boot, next to the version watcher', /checkMaintenanceVersions\(\);\s*\/\/[^\n]*\n\s*checkDefenderExclusions\(\);/.test(html));
for (const [ch, fn] of [['defender-targets', 'defenderTargets'], ['defender-status', 'defenderStatus'], ['defender-change', 'defenderChange']])
  T('   IPC ' + ch + ' handled in main + bridged in preload', main.includes(`ipcMain.handle('${ch}'`) && new RegExp(fn + ':\\s*\\(').test(pre) && pre.includes(`'${ch}'`));
T('   remove only touches the list ABRP saved (never user exclusions)', /action === 'remove' \? \{ paths:\(saved && saved\.paths\)/.test(main));
T('   launch status read never prompts UAC', /defenderStatus\(\{elevate:false\}\)/.test(html));
T('   defender.js ships in the installer (not excluded by build.files)', !/"!defender/.test(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8')));

process.exit(T.done() ? 1 : 0);
