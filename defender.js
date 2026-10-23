'use strict';
// defender.js — Windows Defender exclusions for MSFS (v6.24.0, reworked v6.24.1 — Dean 2026-10-23).
//
// Why: spike reports showed MsMpEng.exe (Defender real-time scanning) causing the single biggest
// hitches on recent flights — it was scanning the files the sim streams in mid-flight. Turning
// Defender off per flight isn't possible (Tamper Protection blocks it) and isn't safe, so ABRP adds
// permanent exclusions for the folders the sim reads/writes during a flight and the sim's processes.
//
// Key distinction (v6.24.1): a FILE exclusion on FlightSimulator2024.exe only stops Defender scanning
// that one .exe. What stops the mid-flight scans is a PROCESS exclusion (files the sim opens are
// skipped) plus the DATA folders (packages, streamed scenery, rolling cache, shader caches).
//
// No duplicates: a target already covered — the same entry, or a PARENT folder the user excluded —
// is left alone. ABRP records only what it actually added, and Remove only ever touches that.
//
// PURE: no I/O of its own beyond what callers inject (exists/readFile), so it desk-tests without
// Defender or admin. main.js runs the PowerShell 5.1; all result parsing happens here in Node.
const path = require('path');

const MSFS_APPID = '2537590';
const SIM_PROCESS = 'FlightSimulator2024.exe';
// Fenix runs its avionics in separate processes (seen in Process Lasso). Only excluded when a Fenix
// aircraft package is actually installed in the user's aircraft library.
const FENIX_PROCESSES = ['Fenix.exe', 'FenixSystem.exe', 'FenixDisplay.exe', 'FenixCDU.exe',
  'Fenix.GqlGateway.exe', 'FenixBootstrapper.exe'];
// Defender answers a non-admin read with this text in place of the list.
const NOT_ADMIN_RE = /^N\/A:/i;

// Pull every library "path" out of Steam's libraryfolders.vdf (handles the doubled backslashes).
function parseLibraryFolders(vdfText) {
  const out = [];
  const re = /"path"\s+"([^"]+)"/gi;
  let m;
  while ((m = re.exec(vdfText || ''))) out.push(m[1].replace(/\\\\/g, '\\'));
  return out;
}
function parseInstallDir(acfText) {
  const m = /"installdir"\s+"([^"]+)"/i.exec(acfText || '');
  return m ? m[1] : null;
}
// MSFS can install its packages anywhere (UserCfg.opt InstalledPackagesPath).
function parseInstalledPackagesPath(usercfgText) {
  const m = /^\s*InstalledPackagesPath\s+"([^"]+)"/im.exec(usercfgText || '');
  return m ? m[1] : null;
}

// Find the MSFS 2024 Steam install. steamRoots = candidate Steam install dirs (registry SteamPath
// first). Each root's libraryfolders.vdf lists every library; the one holding the MSFS appmanifest
// gives steamapps\common\<installdir>. Returns { install, library } or null.
function findMsfs(steamRoots, io) {
  const libs = [];
  for (const root of steamRoots || []) {
    if (!root) continue;
    libs.push(root);
    const vdf = path.join(root, 'steamapps', 'libraryfolders.vdf');
    if (io.exists(vdf)) { try { libs.push(...parseLibraryFolders(io.readFile(vdf))); } catch (_) {} }
  }
  const seen = new Set();
  for (const lib of libs) {
    const k = lib.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    const acf = path.join(lib, 'steamapps', 'appmanifest_' + MSFS_APPID + '.acf');
    if (!io.exists(acf)) continue;
    let dir = null;
    try { dir = parseInstallDir(io.readFile(acf)); } catch (_) {}
    if (!dir) continue;
    const full = path.join(lib, 'steamapps', 'common', dir);
    if (io.exists(full)) return { install: full, library: lib };
  }
  return null;
}
function findMsfsInstall(steamRoots, io) { const f = findMsfs(steamRoots, io); return f ? f.install : null; }

function normPath(p) {
  let s = String(p).trim().replace(/\//g, '\\');
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}
// Is `target` already handled by an existing path exclusion (same entry, or inside an excluded folder)?
// Prefers the exact entry, then the closest (longest) parent folder.
function pathCoveredBy(target, existing) {
  const t = normPath(target).toLowerCase();
  let best = null, bestLen = -1;
  for (const e of existing || []) {
    const x = normPath(e).toLowerCase();
    if (t === x) return e;
    // a drive root keeps its backslash (C:\) — don't add a second one
    if (t.startsWith(x.endsWith('\\') ? x : x + '\\') && x.length > bestLen) { best = e; bestLen = x.length; }
  }
  return best;
}
// Process exclusions may be a bare name or a full path to the .exe.
function procCoveredBy(name, existing) {
  const n = String(name).toLowerCase();
  for (const e of existing || []) {
    const x = String(e).toLowerCase();
    if (x === n || x.endsWith('\\' + n)) return e;
  }
  return null;
}

// Everything ABRP would exclude, derived from live config (rule #3 — nothing personal hardcoded).
// opts: { cfg, appData, localAppData, userData, usercfgText, steamRoots, hasFenix, aircraftRoot,
//         io:{exists, readFile, canon?} }
// Returns { paths[], processes[], labels{path→why}, msfsInstall }.
function buildTargets(opts) {
  const cfg = opts.cfg || {}, io = opts.io;
  const canon = io.canon || (p => p);
  const msfs = findMsfs(opts.steamRoots, io);
  const simData = opts.appData ? path.join(opts.appData, 'Microsoft Flight Simulator 2024') : null;
  const localLow = opts.localAppData ? path.join(path.dirname(opts.localAppData), 'LocalLow') : null;
  // [path, why, mustExist]
  const cand = [
    [msfs && msfs.install, 'MSFS install'],
    [simData, 'MSFS data — packages, streamed scenery, rolling cache, WASM'],
    [parseInstalledPackagesPath(opts.usercfgText), 'MSFS packages'],
    [cfg.communityFolder, 'Community folder'],
    [opts.aircraftRoot || cfg.aircraftFolder, 'Aircraft library'],
    [cfg.folder, 'Scenery library'],
    [localLow && path.join(localLow, 'NVIDIA', 'PerDriverVersion', 'DXCache'), 'GPU shader cache (NVIDIA)'],
    [opts.localAppData && path.join(opts.localAppData, 'NVIDIA', 'DXCache'), 'GPU shader cache (NVIDIA, older drivers)'],
    [opts.localAppData && path.join(opts.localAppData, 'D3DSCache'), 'GPU shader cache (DirectX)'],
    [msfs && path.join(msfs.library, 'steamapps', 'shadercache', MSFS_APPID), 'GPU shader cache (Steam, MSFS)'],
    [opts.userData && path.join(opts.userData, 'Sessions'), 'ABRP flight logs'],
    // Exists only while a capture is recording — PresentMon appends to it all flight.
    [opts.userData && path.join(opts.userData, '_capture_tmp.csv'), 'ABRP live capture file', false, 'file'],
  ];
  const kept = [], why = [], kindOf = [];
  for (const [p, label, mustExist, kind] of cand) {
    if (!p || !String(p).trim()) continue;
    const n = normPath(p);
    if (mustExist !== false && !io.exists(n)) continue;
    kept.push(normPath(io.exists(n) ? canon(n) : n));
    why.push(label);
    kindOf.push(kind || 'folder');
  }
  // Drop duplicates and anything already inside another target folder (e.g. Community sits inside the
  // MSFS data folder) — Defender path exclusions include subfolders.
  const lower = kept.map(p => p.toLowerCase());
  const paths = [], labels = {}, kinds = {};
  kept.forEach((p, i) => {
    const me = lower[i];
    if (lower.indexOf(me) !== i) return;
    if (lower.some((o, j) => j !== i && o !== me && me.startsWith(o + '\\'))) return;
    paths.push(p); labels[p] = why[i]; kinds[p] = kindOf[i];
  });
  const processes = [SIM_PROCESS].concat(opts.hasFenix ? FENIX_PROCESSES : []);
  return { paths, processes, labels, kinds, msfsInstall: msfs ? normPath(canon(msfs.install)) : null };
}

// Parse the marker lines our PowerShell emits:
//   PATH|… PROC|… (current Defender lists)  HAVE|… (target already covered — skipped)
//   ADDED|… ADDEDPROC|… (ABRP added it)  REMOVED|… REMOVEDPROC|…  TAMPER|…  ERR|…
function parseStatus(stdout) {
  const paths = [], processes = [], errors = [], have = [];
  const added = { paths: [], processes: [] }, removed = { paths: [], processes: [] };
  let tamper = null, canRead = true;
  // PS 5.1 Set-Content -Encoding UTF8 writes a BOM; left in, the first line wouldn't match and the
  // "not admin" sentinel could be missed (→ a false "everything missing" banner).
  for (const raw of String(stdout || '').replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.replace(/^\uFEFF/, '').trim();
    const i = line.indexOf('|');
    if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1).trim();
    if (!v) continue;
    if (k === 'PATH' || k === 'PROC') {
      if (NOT_ADMIN_RE.test(v)) { canRead = false; continue; }
      (k === 'PATH' ? paths : processes).push(v);
    } else if (k === 'HAVE') have.push(v);
    else if (k === 'ADDED') added.paths.push(v);
    else if (k === 'ADDEDPROC') added.processes.push(v);
    else if (k === 'REMOVED') removed.paths.push(v);
    else if (k === 'REMOVEDPROC') removed.processes.push(v);
    else if (k === 'TAMPER') tamper = /true/i.test(v);
    else if (k === 'ERR') errors.push(v);
  }
  return { canRead, paths, processes, tamper, errors, have, added, removed };
}

// Which wanted exclusions aren't covered by anything Defender currently holds.
function missingFrom(want, current) {
  const cp = (current && current.paths) || [], cr = (current && current.processes) || [];
  return {
    paths: ((want && want.paths) || []).filter(p => !pathCoveredBy(p, cp)),
    processes: ((want && want.processes) || []).filter(p => !procCoveredBy(p, cr)),
  };
}

// Normalise the saved config block (v6.24.0 stored {applied, paths, processes}; nothing was ever
// applied with it, so it carries no "added" record — Remove therefore stays a safe no-op for it).
function normSaved(saved) {
  if (!saved || !saved.applied) return { applied: false };
  const targets = saved.targets || { paths: saved.paths || [], processes: saved.processes || [] };
  const added = saved.added || { paths: [], processes: [] };
  return { applied: true, targets, added, ts: saved.ts || null };
}

// Banner decision. Only nags if the user applied exclusions before AND we could actually read them.
function bannerState(saved, status) {
  const s = normSaved(saved);
  if (!s.applied) return { show: false, reason: 'never-applied' };
  if (!status || !status.canRead) return { show: false, reason: 'cannot-read' };
  const miss = missingFrom(s.targets, status);
  const n = miss.paths.length + miss.processes.length;
  const total = s.targets.paths.length + s.targets.processes.length;
  return n ? { show: true, count: n, total, missing: miss, reason: 'missing' } : { show: false, reason: 'all-present' };
}

// What to save after an apply: the full target list (for the banner) + the union of everything ABRP
// has ever added and that is still not removed (for Remove).
function savedAfterApply(prev, targets, added) {
  const p = normSaved(prev);
  const uniq = a => a.filter((x, i) => a.findIndex(y => String(y).toLowerCase() === String(x).toLowerCase()) === i);
  return {
    applied: true,
    targets: { paths: targets.paths.slice(), processes: targets.processes.slice() },
    added: {
      paths: uniq(((p.added && p.added.paths) || []).concat(added.paths || [])),
      processes: uniq(((p.added && p.added.processes) || []).concat(added.processes || [])),
    },
    ts: Date.now(),
  };
}

// Everything the Maintenance panel shows, decided here (the renderer only formats it).
// Each row: { kind:'folder'|'file'|'process', value, label, state:'ok'|'missing'|'unknown', by:'abrp'|'you'|null, coveredBy }
function panelModel(targets, saved, status) {
  const t = targets || { paths: [], processes: [], labels: {} }, s = normSaved(saved);
  const canRead = !!(status && status.canRead);
  const addedP = new Set(((s.added && s.added.paths) || []).map(p => normPath(p).toLowerCase()));
  const addedR = new Set(((s.added && s.added.processes) || []).map(p => String(p).toLowerCase()));
  const rows = [];
  const push = (kind, value, label, hit, mine) => rows.push({
    kind, value, label,
    state: !canRead ? 'unknown' : (hit ? 'ok' : 'missing'),
    by: !canRead || !hit ? null : (mine ? 'abrp' : 'you'),
    coveredBy: hit && normPath(hit).toLowerCase() !== normPath(value).toLowerCase() ? hit : null,
  });
  for (const p of t.paths || []) {
    const hit = canRead ? pathCoveredBy(p, status.paths) : null;
    const mine = !!hit && addedP.has(normPath(hit).toLowerCase());
    push((t.kinds && t.kinds[p]) || 'folder', p, (t.labels && t.labels[p]) || '', hit, mine);
  }
  for (const p of t.processes || []) {
    const hit = canRead ? procCoveredBy(p, status.processes) : null;
    const mine = !!hit && addedR.has(String(hit).toLowerCase());
    push('process', p, p === SIM_PROCESS ? 'MSFS (files the sim opens)' : 'Fenix avionics', hit, mine);
  }
  const missing = rows.filter(r => r.state === 'missing').length;
  const kind = !canRead ? (s.applied ? 'applied-unverified' : 'unknown')
    : missing === 0 ? 'all-present' : (s.applied ? 'missing' : 'not-applied');
  return { kind, total: rows.length, missing, applied: s.applied, ts: s.ts || null, rows,
    banner: bannerState(saved, status) };
}

function psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function psArr(a) { return '@(' + (a || []).map(psq).join(',') + ')'; }

// PowerShell 5.1 body.
//   mode 'status' — read only.
//   mode 'apply'  — add ONLY targets not already covered (same entry or a parent folder), emit
//                   HAVE|/ADDED|/ADDEDPROC| so ABRP knows exactly what it added.
//   mode 'remove' — remove exactly the given list (the caller passes only what ABRP added).
// opts.dryRun + opts.mockPaths/mockProcs: test hook — uses the given lists instead of Defender and
// never writes, so the real gate logic can be exercised in powershell.exe without admin.
// Every mode ends with a fresh read-back so the caller verifies what Defender actually holds.
function buildScript(mode, targets, opts) {
  const t = targets || {}, o = opts || {};
  const L = ["$ErrorActionPreference='Stop'"];
  const read = o.dryRun
    ? `$ep = ${psArr(o.mockPaths)}; $er = ${psArr(o.mockProcs)}`
    : "$mp = Get-MpPreference; $ep = @($mp.ExclusionPath | Where-Object { $_ -and $_ -notmatch '^N/A:' }); $er = @($mp.ExclusionProcess | Where-Object { $_ -and $_ -notmatch '^N/A:' })";
  if (mode === 'apply') {
    L.push(read);
    L.push("function Get-NormPath([string]$p){ $s = $p.Trim().Replace('/','\\'); while($s.Length -gt 3 -and $s.EndsWith('\\')){ $s = $s.Substring(0, $s.Length-1) }; return $s }");
    L.push("function Test-PathCovered([string]$t){ $n = Get-NormPath $t; foreach($e in $ep){ $x = Get-NormPath $e; $pre = $x; if(-not $pre.EndsWith('\\')){ $pre = $x + '\\' }; if($n -ieq $x -or $n.StartsWith($pre, [StringComparison]::OrdinalIgnoreCase)){ return $true } }; return $false }");
    L.push("function Test-ProcCovered([string]$t){ foreach($e in $er){ if($e -ieq $t -or $e.EndsWith('\\' + $t, [StringComparison]::OrdinalIgnoreCase)){ return $true } }; return $false }");
    L.push(`$addP = @(); foreach($t in ${psArr(t.paths)}){ if(Test-PathCovered $t){ 'HAVE|' + $t } else { $addP += $t } }`);
    L.push(`$addR = @(); foreach($t in ${psArr(t.processes)}){ if(Test-ProcCovered $t){ 'HAVE|' + $t } else { $addR += $t } }`);
    if (o.dryRun) {
      L.push("foreach($x in $addP){ 'ADDED|' + $x }; foreach($x in $addR){ 'ADDEDPROC|' + $x }");
    } else {
      L.push("if($addP.Count){ try { Add-MpPreference -ExclusionPath $addP; foreach($x in $addP){ 'ADDED|' + $x } } catch { 'ERR|' + $_.Exception.Message } }");
      L.push("if($addR.Count){ try { Add-MpPreference -ExclusionProcess $addR; foreach($x in $addR){ 'ADDEDPROC|' + $x } } catch { 'ERR|' + $_.Exception.Message } }");
    }
  } else if (mode === 'remove' && !o.dryRun) {
    if ((t.paths || []).length) L.push(`try { Remove-MpPreference -ExclusionPath ${psArr(t.paths)}; foreach($x in ${psArr(t.paths)}){ 'REMOVED|' + $x } } catch { 'ERR|' + $_.Exception.Message }`);
    if ((t.processes || []).length) L.push(`try { Remove-MpPreference -ExclusionProcess ${psArr(t.processes)}; foreach($x in ${psArr(t.processes)}){ 'REMOVEDPROC|' + $x } } catch { 'ERR|' + $_.Exception.Message }`);
  }
  if (o.dryRun) {
    L.push("foreach($x in $ep){ 'PATH|' + $x }; foreach($x in $er){ 'PROC|' + $x }");
  } else {
    L.push("try { $p = Get-MpPreference; foreach($x in @($p.ExclusionPath)){ if($x){ 'PATH|' + $x } }; foreach($x in @($p.ExclusionProcess)){ if($x){ 'PROC|' + $x } } } catch { 'ERR|' + $_.Exception.Message }");
    L.push("try { 'TAMPER|' + (Get-MpComputerStatus).IsTamperProtected } catch {}");
  }
  return L.join('\r\n');
}

module.exports = { buildTargets, findMsfs, findMsfsInstall, parseLibraryFolders, parseInstallDir,
  parseInstalledPackagesPath, parseStatus, missingFrom, pathCoveredBy, procCoveredBy, normSaved,
  bannerState, savedAfterApply, panelModel, buildScript, normPath, SIM_PROCESS, FENIX_PROCESSES };
