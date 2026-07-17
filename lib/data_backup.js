'use strict';
// Backup + restore for the ONLY ABRP data git can't hold: flight logs, settings, route database.
// Shared by the app (Maintenance tab, via main.js IPCs) and the CLI (tools/backup-data.js), so the
// two can never drift apart.
//
// GROUND RULES, enforced here rather than trusted to callers:
//   * A BACKUP only ever READS your live data. Never /MOV, never /MIR, nothing writes to %APPDATA%.
//   * Backups are ADDITIVE — nothing is ever deleted from the backup folder either. If the Archive
//     tool later gzips a flight, the backup simply keeps both. Storage is cheap; flights aren't.
//   * A RESTORE never deletes a flight that isn't in the backup, and always saves your current
//     settings to a pre-restore copy first, so a misclick is undoable.
//   * Both refuse to create the backup folder. If it's missing, the drive is probably unplugged —
//     silently making a new empty folder on C: would look like success and back up nothing.
const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const DEFAULT_DEST = 'D:\\Claude_ABRP_Log BU';

// What matters, and why. Anything not listed is regenerable and deliberately skipped: Electron
// caches, airport_db/airspace (they re-download), debug logs.
const JOBS = [
  // Sessions\CapFrameX is a DERIVED, regenerable export (the app rebuilds it from the raw
  // frametimes on demand) — a backup should hold originals, not rebuildable copies, so it's excluded
  // (Dean 2026-07-17: deleted a stale 1.6 GB of it; this stops a future re-export bloating the backup).
  { kind:'dir',  name:'Sessions',               to:'Sessions',                      why:'flight logs — the irreplaceable one', excludeDirs:['CapFrameX'] },
  { kind:'file', name:'config.json',            to:'config/config.json',            why:'settings: scenery library, fleet, SimBrief, benchmark plan' },
  { kind:'file', name:'routeRegistry.json',     to:'config/routeRegistry.json',     why:'live route database' },
  { kind:'file', name:'routeSnapshot.json',     to:'config/routeSnapshot.json',     why:'the 20,000-route permanent snapshot' },
  { kind:'file', name:'lab_state.json',         to:'config/lab_state.json',         why:'Settings A/B state' },
  { kind:'dir',  name:'nvidia_settings_backup', to:'config/nvidia_settings_backup', why:'NVIDIA control-panel backup' },
  { kind:'dir',  name:'usercfg_backups',        to:'config/usercfg_backups',        why:'MSFS UserCfg.opt backups' },
];
// Only these are worth a pre-restore safety copy: small, and the only ones a restore could
// meaningfully clobber. Flight logs are immutable once filed, so overwriting one with an identical
// copy costs nothing.
const PRE_RESTORE = ['config.json', 'routeRegistry.json', 'routeSnapshot.json', 'lab_state.json'];

function human(bytes){
  const u = ['B','KB','MB','GB','TB']; let i = 0, n = bytes || 0;
  while(n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function dirSize(p){
  let total = 0, files = 0;
  const walk = d => { let e; try { e = fs.readdirSync(d, {withFileTypes:true}); } catch(_){ return; }
    for(const f of e){ const q = path.join(d, f.name);
      if(f.isDirectory()) walk(q); else { try { total += fs.statSync(q).size; files++; } catch(_){} } } };
  walk(p); return { bytes: total, files };
}
function sameFile(a, b){
  try { const x = fs.statSync(a), y = fs.statSync(b); return x.size === y.size && Math.abs(x.mtimeMs - y.mtimeMs) < 2000; }
  catch(_){ return false; }
}
function countFlightDays(sessionsDir){
  try { return fs.readdirSync(sessionsDir).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).length; } catch(_){ return 0; }
}
// robocopy exit codes: 0-7 are SUCCESS (0 nothing to do, 1 copied, 2 extras, 4 mismatched...).
// 8+ is a real failure. A naive status!==0 check calls a perfectly good copy a failure.
function roboCopy(src, dst, timeoutMs, excludeDirs){
  // /XD excludes subfolders by name (e.g. CapFrameX) — used to skip regenerable derived exports.
  const xd = (excludeDirs && excludeDirs.length) ? ['/XD'].concat(excludeDirs) : [];
  const r = cp.spawnSync('robocopy', [src, dst, '/E', '/R:2', '/W:2', '/NFL', '/NDL', '/NP', '/NJH', '/NJS'].concat(xd),
    { encoding:'utf8', windowsHide:true, timeout: timeoutMs || 3600000 });
  const code = r.status == null ? -1 : r.status;
  return { ok: code >= 0 && code < 8, code, changed: code >= 1 && code < 8, err: (r.stderr || '').trim().slice(0, 200) };
}
// The destination must be a real, existing folder that resolves to itself — not a link pointing
// somewhere we were never given permission to touch.
function checkDest(destRoot, { mustExist }){
  if(!destRoot) return { ok:false, error:'no backup folder set' };
  if(!fs.existsSync(destRoot)){
    return mustExist
      ? { ok:false, error:'backup folder not found:\n' + destRoot + '\nIs the drive connected?' }
      : { ok:false, error:'backup folder not found:\n' + destRoot + '\nCreate it (or pick another) and try again — this never creates folders on its own, because an empty new folder would look like a working backup while holding nothing.' };
  }
  try {
    const real = fs.realpathSync(destRoot);
    if(real.toLowerCase() !== path.resolve(destRoot).toLowerCase())
      return { ok:false, error:'the backup folder resolves somewhere unexpected:\n' + destRoot + '  ->  ' + real };
  } catch(e){ return { ok:false, error:'cannot read the backup folder: ' + e.message }; }
  return { ok:true };
}

// ── STATUS — for the Maintenance panel's "where you stand" line ─────────────
function backupStatus(appDir, destRoot){
  const dest = destRoot || DEFAULT_DEST;
  const reachable = fs.existsSync(dest);
  const s = reachable ? dirSize(path.join(dest, 'Sessions')) : { bytes:0, files:0 };
  const live = dirSize(path.join(appDir, 'Sessions'));
  return {
    dest, reachable,
    backedUpFlights: reachable ? countFlightDays(path.join(dest, 'Sessions')) : 0,
    liveFlights: countFlightDays(path.join(appDir, 'Sessions')),
    backedUpBytes: s.bytes, backedUpFiles: s.files,
    liveBytes: live.bytes, liveFiles: live.files,
    behind: Math.max(0, live.files - s.files),          // rough "not yet copied" signal for the UI
    humanBackedUp: human(s.bytes), humanLive: human(live.bytes)
  };
}

// ── BACKUP — app data -> backup folder. Read-only on the source. ────────────
function backupData(appDir, destRoot, log){
  const dest = destRoot || DEFAULT_DEST;
  const say = log || (() => {});
  const chk = checkDest(dest, { mustExist:false });
  if(!chk.ok) return { ok:false, error: chk.error };
  if(!fs.existsSync(appDir)) return { ok:false, error:'cannot find your ABRP data at ' + appDir };

  const t0 = Date.now();
  let copied = 0, failed = [];
  for(const j of JOBS){
    const src = path.join(appDir, j.name);
    const dst = path.join(dest, j.to.replace(/\//g, path.sep));
    if(!fs.existsSync(src)){ say('skip   ' + j.name + ' (not present)'); continue; }
    if(j.kind === 'file'){
      try {
        fs.mkdirSync(path.dirname(dst), { recursive:true });
        if(sameFile(src, dst)){ say('same   ' + j.name); continue; }
        const st = fs.statSync(src);
        fs.copyFileSync(src, dst);
        fs.utimesSync(dst, st.atime, st.mtime);
        copied++; say('copied ' + j.name + '  ' + human(st.size));
      } catch(e){ failed.push(j.name + ': ' + e.message); say('FAILED ' + j.name + ': ' + e.message); }
      continue;
    }
    const r = roboCopy(src, dst, null, j.excludeDirs);
    if(!r.ok){ failed.push(j.name + ': robocopy exit ' + r.code + ' ' + r.err); say('FAILED ' + j.name + ' (exit ' + r.code + ')'); }
    else { if(r.changed) copied++; say('ok     ' + j.name + (r.changed ? ' (updated)' : ' (already current)')); }
  }
  writeRestoreNote(dest);
  const total = dirSize(dest);
  return {
    ok: failed.length === 0, errors: failed, dest,
    changed: copied > 0, seconds: Math.round((Date.now() - t0) / 1000),
    bytes: total.bytes, files: total.files, human: human(total.bytes),
    flights: countFlightDays(path.join(dest, 'Sessions'))
  };
}

// ── RESTORE — backup folder -> app data. The one dangerous direction. ───────
// dryRun:true returns a preview of exactly what would change, for the confirm dialog.
function restoreData(appDir, destRoot, opts){
  const o = opts || {};
  const dest = destRoot || DEFAULT_DEST;
  const chk = checkDest(dest, { mustExist:true });
  if(!chk.ok) return { ok:false, error: chk.error };
  if(!fs.existsSync(path.join(dest, 'Sessions')) && !fs.existsSync(path.join(dest, 'config')))
    return { ok:false, error:'that folder does not look like an ABRP backup (no Sessions or config inside):\n' + dest };

  // Preview: what lands, what gets written over.
  const preview = { addFiles:0, overwriteFiles:0, addBytes:0, settingsOverwritten:[], flightsInBackup:countFlightDays(path.join(dest, 'Sessions')), flightsLive:countFlightDays(path.join(appDir, 'Sessions')) };
  const walkCompare = (from, to) => {
    let e; try { e = fs.readdirSync(from, {withFileTypes:true}); } catch(_){ return; }
    for(const f of e){
      const a = path.join(from, f.name), b = path.join(to, f.name);
      if(f.isDirectory()){ walkCompare(a, b); continue; }
      let sz = 0; try { sz = fs.statSync(a).size; } catch(_){}
      if(!fs.existsSync(b)){ preview.addFiles++; preview.addBytes += sz; }
      else if(!sameFile(a, b)) preview.overwriteFiles++;
    }
  };
  if(fs.existsSync(path.join(dest, 'Sessions'))) walkCompare(path.join(dest, 'Sessions'), path.join(appDir, 'Sessions'));
  for(const f of PRE_RESTORE){
    const a = path.join(dest, 'config', f), b = path.join(appDir, f);
    if(fs.existsSync(a) && fs.existsSync(b) && !sameFile(a, b)) preview.settingsOverwritten.push(f);
    else if(fs.existsSync(a) && !fs.existsSync(b)){ preview.addFiles++; }
  }
  preview.humanAdd = human(preview.addBytes);
  if(o.dryRun) return { ok:true, preview, dest };

  // Do it. Settings first: save the current ones somewhere recoverable BEFORE overwriting.
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const safety = path.join(appDir, '_pre_restore_' + stamp);
  const saved = [];
  try {
    fs.mkdirSync(safety, { recursive:true });
    for(const f of PRE_RESTORE){
      const cur = path.join(appDir, f);
      if(fs.existsSync(cur)){ fs.copyFileSync(cur, path.join(safety, f)); saved.push(f); }
    }
  } catch(e){ return { ok:false, error:'could not save a pre-restore copy of your current settings, so nothing was changed: ' + e.message }; }

  const failed = [];
  // Flight logs: additive only. Never deletes a flight that isn't in the backup.
  if(fs.existsSync(path.join(dest, 'Sessions'))){
    const r = roboCopy(path.join(dest, 'Sessions'), path.join(appDir, 'Sessions'));
    if(!r.ok) failed.push('Sessions: robocopy exit ' + r.code + ' ' + r.err);
  }
  for(const f of PRE_RESTORE){
    const a = path.join(dest, 'config', f);
    if(!fs.existsSync(a)) continue;
    try { const st = fs.statSync(a); fs.copyFileSync(a, path.join(appDir, f)); fs.utimesSync(path.join(appDir, f), st.atime, st.mtime); }
    catch(e){ failed.push(f + ': ' + e.message); }
  }
  for(const d of ['nvidia_settings_backup', 'usercfg_backups']){
    const a = path.join(dest, 'config', d);
    if(!fs.existsSync(a)) continue;
    const r = roboCopy(a, path.join(appDir, d));
    if(!r.ok) failed.push(d + ': robocopy exit ' + r.code);
  }
  return {
    ok: failed.length === 0, errors: failed, preview, dest,
    safetyCopy: saved.length ? safety : null, savedFiles: saved,
    flights: countFlightDays(path.join(appDir, 'Sessions'))
  };
}

// A note in the backup folder so the pile explains itself years from now.
function writeRestoreNote(dest){
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const flights = countFlightDays(path.join(dest, 'Sessions'));
  try {
    fs.writeFileSync(path.join(dest, 'READ ME - how to restore.txt'),
`ABRP BACKUP — what this is and how to get it back
==================================================
Last updated: ${stamp}
Flight-log days backed up: ${flights}

WHAT'S IN HERE
  Sessions\\   Every performance capture (flight logs). Irreplaceable — the only
               copy outside your C: drive.
  config\\     Settings, route database, NVIDIA + MSFS config backups.

WHAT'S NOT IN HERE (because it doesn't need to be)
  The app, its source, the rules, the roadmap and the tests all live on GitHub:
    https://github.com/snkeyez95/dean-msfs-route-finder
  The installer is under that repo's "Releases".
  Airport + airspace data re-downloads itself on first run.

HOW TO RESTORE ONTO A FRESH WINDOWS INSTALL
  Easy way:
    1. Install the app from the GitHub Releases page above.
    2. Open it -> Maintenance -> Backup & Restore -> Restore from backup.
    3. Done. Flights, settings and routes are back.
  Manual way (if the app won't start):
    Sessions\\      ->  %APPDATA%\\A Better Route Planner\\Sessions\\
    config\\*.json  ->  %APPDATA%\\A Better Route Planner\\
    config\\nvidia_settings_backup\\ and config\\usercfg_backups\\
                   ->  %APPDATA%\\A Better Route Planner\\
    (Paste %APPDATA% into the File Explorer address bar to get there.)

TO REFRESH THIS BACKUP
  The app does it automatically after each flight.
  Or: Maintenance -> Backup & Restore -> Back up now.
  Or, without the app: node tools\\backup-data.js  in the project folder.

This backup is additive: nothing here is ever deleted, and your live data on C:
is only ever read.
`);
  } catch(_){}
}

module.exports = { backupData, restoreData, backupStatus, backupHuman: human, DEFAULT_DEST, JOBS };
