'use strict';
// Back up the ONLY ABRP data that git can't hold: your flight logs, settings, and route database.
//
//   node tools\backup-data.js          (or double-click tools\backup-data.bat)
//
// Everything else already survives a dead drive — the app, the rules, the roadmap, the tests are
// all on GitHub. This covers the rest.
//
// SAFETY, by design:
//   * The destination is HARD-LOCKED to D:\Claude_ABRP_Log BU. Dean granted access to that folder
//     and nothing else on D:. The script refuses to run against any other path.
//   * Your source data is only ever READ. No /MOV, no /MIR, nothing writes to %APPDATA%.
//   * The backup is ADDITIVE — it never deletes from the backup either. If a flight later gets
//     gzipped by the Archive tool, the backup simply keeps both copies. Storage is cheap; the logs
//     are irreplaceable.
//   * Re-running is cheap: identical files are skipped, so only new flights actually copy.
const fs = require('fs'), path = require('path'), cp = require('child_process');

const DEST_ROOT = 'D:\\Claude_ABRP_Log BU';          // the ONLY permitted destination
const SRC_ROOT  = path.join(process.env.APPDATA || '', 'A Better Route Planner');

// What matters, and why. Anything not listed here is regenerable and deliberately skipped
// (Electron caches, the airport/airspace downloads, debug logs).
const JOBS = [
  { kind:'dir',  from:'Sessions',               to:'Sessions',                      why:'your flight logs — the irreplaceable one' },
  { kind:'file', from:'config.json',            to:'config/config.json',            why:'settings: scenery library, fleet, SimBrief, benchmark plan' },
  { kind:'file', from:'routeRegistry.json',     to:'config/routeRegistry.json',     why:'live route database' },
  { kind:'file', from:'routeSnapshot.json',     to:'config/routeSnapshot.json',     why:'the 20,000-route permanent snapshot' },
  { kind:'file', from:'lab_state.json',         to:'config/lab_state.json',         why:'Settings A/B state' },
  { kind:'dir',  from:'nvidia_settings_backup', to:'config/nvidia_settings_backup', why:'your NVIDIA control-panel backup' },
  { kind:'dir',  from:'usercfg_backups',        to:'config/usercfg_backups',        why:'MSFS UserCfg.opt backups' },
];

function die(msg){ console.error('\nSTOPPED: ' + msg); process.exit(1); }
function human(bytes){
  const u = ['B','KB','MB','GB','TB']; let i = 0, n = bytes;
  while(n >= 1024 && i < u.length - 1){ n /= 1024; i++; }
  return n.toFixed(n >= 10 || i === 0 ? 0 : 1) + ' ' + u[i];
}
function dirSize(p){
  let total = 0;
  const walk = d => { let e; try { e = fs.readdirSync(d, {withFileTypes:true}); } catch(_){ return; }
    for(const f of e){ const q = path.join(d, f.name);
      if(f.isDirectory()) walk(q); else { try { total += fs.statSync(q).size; } catch(_){} } } };
  walk(p); return total;
}

// ── guards ──────────────────────────────────────────────────────────────────
if(!fs.existsSync(SRC_ROOT)) die('cannot find your ABRP data at ' + SRC_ROOT);
if(!fs.existsSync(DEST_ROOT))
  die('the backup folder does not exist:\n  ' + DEST_ROOT +
      '\nCreate it (or plug the drive in) and run this again. This script will not create folders on D:.');
{ // prove the destination really is the permitted folder, not a lookalike or a link elsewhere
  const real = fs.realpathSync(DEST_ROOT);
  if(real.toLowerCase() !== DEST_ROOT.toLowerCase())
    die('the backup folder resolves somewhere unexpected:\n  ' + DEST_ROOT + '  ->  ' + real +
        '\nRefusing to write outside the one folder I was given.');
}

console.log('ABRP data backup');
console.log('  from: ' + SRC_ROOT + '   (read only — never modified)');
console.log('  to:   ' + DEST_ROOT);
console.log('='.repeat(72));

let copiedFiles = 0, failedJobs = 0;
const t0 = Date.now();

for(const j of JOBS){
  const src = path.join(SRC_ROOT, j.from);
  const dst = path.join(DEST_ROOT, j.to.replace(/\//g, '\\'));
  if(!fs.existsSync(src)){ console.log('  skip   ' + j.from.padEnd(24) + '(not present)'); continue; }

  if(j.kind === 'file'){
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    const s = fs.statSync(src);
    let same = false;
    try { const d = fs.statSync(dst); same = (d.size === s.size && Math.abs(d.mtimeMs - s.mtimeMs) < 2000); } catch(_){}
    if(same){ console.log('  same   ' + j.from.padEnd(24) + human(s.size).padStart(8) + '   ' + j.why); continue; }
    fs.copyFileSync(src, dst);
    fs.utimesSync(dst, s.atime, s.mtime);
    copiedFiles++;
    console.log('  COPIED ' + j.from.padEnd(24) + human(s.size).padStart(8) + '   ' + j.why);
    continue;
  }

  // Directories: robocopy. /E all subdirs, /R:2 /W:2 short retries, /NFL /NDL quiet, /NP no progress spam.
  // Deliberately NO /MIR and NO /MOV — nothing is ever deleted or moved.
  const before = dirSize(src);
  process.stdout.write('  ...    ' + j.from.padEnd(24) + human(before).padStart(8) + '   ' + j.why + '\r');
  const r = cp.spawnSync('robocopy', [src, dst, '/E', '/R:2', '/W:2', '/NFL', '/NDL', '/NP', '/NJH', '/NJS'],
    { encoding: 'utf8', windowsHide: true, timeout: 3600000 });
  // robocopy exit codes: 0-7 = success (0 nothing to do, 1 files copied, 2 extras, 4 mismatches...).
  // 8+ = real failure. A naive "status !== 0" check would call a good copy a failure.
  const code = r.status == null ? -1 : r.status;
  if(code >= 8 || code < 0){
    failedJobs++;
    console.log('  FAILED ' + j.from.padEnd(24) + ' robocopy exit ' + code + '  ' + ((r.stderr || '').trim().slice(0, 120)));
  } else {
    const after = dirSize(dst);
    console.log('  ok     ' + j.from.padEnd(24) + human(after).padStart(8) + '   ' + j.why +
                (code === 0 ? '  (already current)' : '  (updated)'));
  }
}

// ── a restore note, so future-you knows what this pile is ───────────────────
const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
let flights = 0;
try { flights = fs.readdirSync(path.join(DEST_ROOT, 'Sessions')).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)).length; } catch(_){}
fs.writeFileSync(path.join(DEST_ROOT, 'READ ME - how to restore.txt'),
`ABRP BACKUP — what this is and how to get it back
==================================================
Last updated: ${stamp}
Flight-log days backed up: ${flights}

WHAT'S IN HERE
  Sessions\\   Every performance capture (flight logs). Irreplaceable — this is
               the only copy outside your C: drive.
  config\\     Settings, route database, NVIDIA + MSFS config backups.

WHAT'S *NOT* IN HERE (because it doesn't need to be)
  The app itself, the source code, the rules, the roadmap, and the tests all
  live on GitHub:  https://github.com/snkeyez95/dean-msfs-route-finder
  The installer is under that repo's "Releases".
  Airport + airspace data re-downloads itself on first run.

HOW TO RESTORE ONTO A FRESH WINDOWS INSTALL
  1. Install the app from the GitHub Releases page above. Run it once, then close it.
  2. Copy this folder's contents back:
       Sessions\\        ->  %APPDATA%\\A Better Route Planner\\Sessions\\
       config\\*.json    ->  %APPDATA%\\A Better Route Planner\\
       config\\nvidia_settings_backup\\ and config\\usercfg_backups\\
                        ->  %APPDATA%\\A Better Route Planner\\
     (Paste %APPDATA% into the File Explorer address bar to get there.)
  3. Start the app. Your flights, settings, and routes are back.

TO REFRESH THIS BACKUP
  Double-click tools\\backup-data.bat in the project folder
  (C:\\Users\\MultiBotPC\\Desktop\\DeanMSFS_v2), or run:
      node tools\\backup-data.js
  It only copies what changed, so it's quick after the first run.

This backup is additive: it never deletes anything from here, and it never
modifies your live data on C:.
`);

const secs = ((Date.now() - t0) / 1000).toFixed(0);
console.log('='.repeat(72));
console.log(failedJobs ? (failedJobs + ' job(s) FAILED — see above') : 'backup complete');
console.log('  ' + human(dirSize(DEST_ROOT)) + ' at ' + DEST_ROOT + '   (' + secs + 's)');
console.log('  restore instructions written to "READ ME - how to restore.txt"');
process.exit(failedJobs ? 1 : 0);
