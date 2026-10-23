'use strict';
// defender.js — v6.24.0 Windows Defender exclusions for MSFS (Dean 2026-10-23).
//
// Why: spike reports showed MsMpEng.exe (Defender real-time scanning) causing the single biggest
// hitches on recent flights — it was scanning sim/Fenix files mid-flight. Turning Defender off per
// flight isn't possible (Tamper Protection blocks it) and isn't safe, so ABRP adds permanent
// exclusions for the sim + aircraft + scenery folders and the sim/aircraft processes instead.
//
// PURE: no I/O of its own beyond what callers inject (exists/readFile), so it desk-tests without
// Defender or admin. main.js does the PowerShell 5.1 calls; all parsing happens here in Node
// (never ConvertFrom-Json — the PS 5.1 landmine that cost three reopen rounds).
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

// Find the MSFS 2024 Steam install folder. steamRoots = candidate Steam install dirs (registry
// SteamPath first). Each root's libraryfolders.vdf lists every library; the one holding the MSFS
// appmanifest gives steamapps\common\<installdir>.
function findMsfsInstall(steamRoots, io) {
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
    if (io.exists(full)) return full;
  }
  return null;
}

// Everything ABRP would exclude, derived from live config (rule #3 — nothing personal hardcoded).
// opts: { cfg, appData, steamRoots, hasFenix, aircraftRoot, io:{exists, readFile, canon?} }
// aircraftRoot = the RESOLVED aircraft library (cfg.aircraftFolder is often blank → ABRP's default).
function buildTargets(opts) {
  const cfg = opts.cfg || {}, io = opts.io;
  const canon = io.canon || (p => p);
  const msfsInstall = findMsfsInstall(opts.steamRoots, io);
  const cand = [
    msfsInstall,
    opts.appData ? path.join(opts.appData, 'Microsoft Flight Simulator 2024') : null,
    cfg.communityFolder,
    opts.aircraftRoot || cfg.aircraftFolder,
    cfg.folder,
  ];
  const kept = [];
  for (const p of cand) {
    if (!p || !String(p).trim()) continue;
    const n = normPath(p);
    if (!io.exists(n)) continue;
    kept.push(normPath(canon(n)));
  }
  // Drop duplicates and anything already covered by a parent folder in the list (e.g. Community
  // sits inside the MSFS data folder) — Defender path exclusions include subfolders.
  const lower = kept.map(p => p.toLowerCase());
  const paths = kept.filter((p, i) => {
    const me = lower[i];
    if (lower.indexOf(me) !== i) return false;
    return !lower.some((o, j) => j !== i && o !== me && me.startsWith(o + '\\'));
  });
  const msfsCanon = msfsInstall ? normPath(canon(msfsInstall)) : null;
  const processes = [SIM_PROCESS].concat(opts.hasFenix ? FENIX_PROCESSES : []);
  return { paths, processes, msfsInstall: msfsCanon };
}

function normPath(p) {
  let s = String(p).trim().replace(/\//g, '\\');
  while (s.length > 3 && s.endsWith('\\')) s = s.slice(0, -1);
  return s;
}

// Parse the marker lines our PowerShell emits: PATH|… PROC|… TAMPER|… ERR|… OK|…
function parseStatus(stdout) {
  const paths = [], processes = [], errors = [];
  let tamper = null, canRead = true, ok = false;
  // PS 5.1 Set-Content -Encoding UTF8 writes a BOM; left in, the first line wouldn't match and the
  // "not admin" sentinel could be missed (→ a false "everything missing" banner).
  for (const raw of String(stdout || '').replace(/^﻿/, '').split(/\r?\n/)) {
    const line = raw.replace(/^﻿/, '').trim();
    const i = line.indexOf('|');
    if (i < 0) continue;
    const k = line.slice(0, i), v = line.slice(i + 1).trim();
    if (k === 'PATH' || k === 'PROC') {
      if (!v) continue;
      if (NOT_ADMIN_RE.test(v)) { canRead = false; continue; }
      (k === 'PATH' ? paths : processes).push(v);
    } else if (k === 'TAMPER') tamper = /true/i.test(v);
    else if (k === 'ERR') errors.push(v);
    else if (k === 'OK') ok = true;
  }
  return { canRead, paths, processes, tamper, errors, ok };
}

// Which of the saved exclusions are no longer present (case/trailing-slash insensitive).
function missingFrom(saved, current) {
  const have = new Set((current.paths || []).map(p => normPath(p).toLowerCase()));
  const haveP = new Set((current.processes || []).map(p => String(p).toLowerCase()));
  return {
    paths: (saved.paths || []).filter(p => !have.has(normPath(p).toLowerCase())),
    processes: (saved.processes || []).filter(p => !haveP.has(String(p).toLowerCase())),
  };
}

// Banner decision. Only nags if the user applied exclusions before AND we could actually read them.
function bannerState(savedCfg, status) {
  if (!savedCfg || !savedCfg.applied) return { show: false, reason: 'never-applied' };
  if (!status || !status.canRead) return { show: false, reason: 'cannot-read' };
  const miss = missingFrom(savedCfg, status);
  const n = miss.paths.length + miss.processes.length;
  return n ? { show: true, count: n, missing: miss, reason: 'missing' } : { show: false, reason: 'all-present' };
}

function psq(s) { return "'" + String(s).replace(/'/g, "''") + "'"; }
function psArr(a) { return '@(' + (a || []).map(psq).join(',') + ')'; }

// PowerShell 5.1 body. mode: 'status' | 'apply' | 'remove'. Always ends with a fresh read-back so
// the caller verifies what Defender actually holds, not what we asked for.
function buildScript(mode, targets) {
  const t = targets || {};
  const lines = ["$ErrorActionPreference='Stop'"];
  if (mode === 'apply' || mode === 'remove') {
    const verb = mode === 'apply' ? 'Add-MpPreference' : 'Remove-MpPreference';
    if ((t.paths || []).length) lines.push(`try { ${verb} -ExclusionPath ${psArr(t.paths)}; 'OK|paths' } catch { 'ERR|'+$_.Exception.Message }`);
    if ((t.processes || []).length) lines.push(`try { ${verb} -ExclusionProcess ${psArr(t.processes)}; 'OK|processes' } catch { 'ERR|'+$_.Exception.Message }`);
  }
  lines.push("try { $p = Get-MpPreference; foreach($x in @($p.ExclusionPath)){ if($x){ 'PATH|'+$x } }; foreach($x in @($p.ExclusionProcess)){ if($x){ 'PROC|'+$x } } } catch { 'ERR|'+$_.Exception.Message }");
  lines.push("try { 'TAMPER|'+(Get-MpComputerStatus).IsTamperProtected } catch {}");
  return lines.join('\r\n');
}

module.exports = { buildTargets, findMsfsInstall, parseLibraryFolders, parseInstallDir, parseStatus,
  missingFrom, bannerState, buildScript, normPath, SIM_PROCESS, FENIX_PROCESSES };
