'use strict';
// Backup & Restore (v6.13.0) — the shared lib/data_backup.js, against a temp sandbox so it never
// touches real data. Proves: read-only backup, additive restore, the destination guard, the
// pre-restore safety copy, and the incremental "same file" skip.
const fs = require('fs'), path = require('path'), os = require('os');
const X = require('./lib/extract.js');
const B = require(path.join(X.ROOT, 'lib', 'data_backup.js'));
const T = X.runner('backup & restore:');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abrp-bk-'));
const APP = path.join(tmp, 'app'), DEST = path.join(tmp, 'dest');
function reset(){
  fs.rmSync(tmp, {recursive:true, force:true});
  fs.mkdirSync(path.join(APP, 'Sessions', '2026-01-01', 'flightA'), {recursive:true});
  fs.writeFileSync(path.join(APP, 'Sessions', '2026-01-01', 'flightA', 'summary.json'), '{"flight":"A"}');
  fs.writeFileSync(path.join(APP, 'Sessions', '2026-01-01', 'flightA', 'frametimes.csv'), 'x'.repeat(5000));
  fs.writeFileSync(path.join(APP, 'config.json'), '{"setting":1}');
  fs.writeFileSync(path.join(APP, 'routeRegistry.json'), '{"routes":1}');
  fs.mkdirSync(DEST, {recursive:true});
}
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch(_){ return null; } };

// ── destination guard ───────────────────────────────────────────────────────
reset();
{
  const r = B.backupData(APP, path.join(tmp, 'does-not-exist'), () => {});
  T('backup refuses a non-existent destination (no silent empty folder)', !r.ok && /not found/.test(r.error), r.error);
  T('...and does NOT create it', !fs.existsSync(path.join(tmp, 'does-not-exist')));
  const rr = B.restoreData(path.join(tmp, 'nope-app'), path.join(tmp, 'nope-dest'), {dryRun:true});
  T('restore refuses a missing backup folder', !rr.ok, rr.error);
}

// ── a clean backup, read-only on source ─────────────────────────────────────
reset();
{
  const before = JSON.stringify(fs.readdirSync(path.join(APP, 'Sessions', '2026-01-01', 'flightA')).sort());
  const r = B.backupData(APP, DEST, () => {});
  T('backup succeeds', r.ok, r.error || (r.errors||[]).join('; '));
  T('flight logs copied', read(path.join(DEST, 'Sessions', '2026-01-01', 'flightA', 'summary.json')) === '{"flight":"A"}');
  T('settings copied under config/', read(path.join(DEST, 'config', 'config.json')) === '{"setting":1}');
  T('restore note written', fs.existsSync(path.join(DEST, 'READ ME - how to restore.txt')));
  const after = JSON.stringify(fs.readdirSync(path.join(APP, 'Sessions', '2026-01-01', 'flightA')).sort());
  T('SOURCE untouched by the backup (read-only)', before === after);
}

// ── incremental: a second run copies nothing new ────────────────────────────
{
  const r2 = B.backupData(APP, DEST, () => {});
  T('second backup run reports no changes', r2.ok && r2.changed === false, 'changed=' + (r2 && r2.changed));
  // now add a new flight -> it should pick up exactly that
  fs.mkdirSync(path.join(APP, 'Sessions', '2026-01-02', 'flightB'), {recursive:true});
  fs.writeFileSync(path.join(APP, 'Sessions', '2026-01-02', 'flightB', 'summary.json'), '{"flight":"B"}');
  const r3 = B.backupData(APP, DEST, () => {});
  T('a new flight is picked up on the next run', r3.ok && r3.changed === true);
  T('the new flight is in the backup', read(path.join(DEST, 'Sessions', '2026-01-02', 'flightB', 'summary.json')) === '{"flight":"B"}');
}

// ── CapFrameX (regenerable derived export) is excluded ──────────────────────
reset();
{
  fs.mkdirSync(path.join(APP, 'Sessions', 'CapFrameX'), {recursive:true});
  fs.writeFileSync(path.join(APP, 'Sessions', 'CapFrameX', '2026-01-01_flightA.csv'), 'x'.repeat(9000));
  const r = B.backupData(APP, DEST, () => {});
  T('backup succeeds with a CapFrameX folder present', r.ok, r.error);
  T('CapFrameX is NOT copied to the backup (regenerable duplicate)', !fs.existsSync(path.join(DEST, 'Sessions', 'CapFrameX')));
  T('real flight logs are still copied', read(path.join(DEST, 'Sessions', '2026-01-01', 'flightA', 'summary.json')) === '{"flight":"A"}');
}

// ── status reflects reality ─────────────────────────────────────────────────
reset();
B.backupData(APP, DEST, () => {});
fs.mkdirSync(path.join(APP, 'Sessions', '2026-01-02', 'flightB'), {recursive:true});
fs.writeFileSync(path.join(APP, 'Sessions', '2026-01-02', 'flightB', 'summary.json'), '{"flight":"B"}');
B.backupData(APP, DEST, () => {});
{
  const st = B.backupStatus(APP, DEST);
  T('status: destination reachable', st.reachable === true);
  T('status: counts both flight days', st.backedUpFlights === 2, st.backedUpFlights + '');
}

// ── restore preview + additive restore + safety copy ────────────────────────
reset();
{
  B.backupData(APP, DEST, () => {});                 // backup holds flightA + config{setting:1}
  // now the LIVE data diverges: delete flightA, change the setting
  fs.rmSync(path.join(APP, 'Sessions', '2026-01-01'), {recursive:true, force:true});
  fs.writeFileSync(path.join(APP, 'config.json'), '{"setting":999}');
  // add a live-only flight the backup does NOT have — restore must NOT delete it
  fs.mkdirSync(path.join(APP, 'Sessions', '2026-02-02', 'flightC'), {recursive:true});
  fs.writeFileSync(path.join(APP, 'Sessions', '2026-02-02', 'flightC', 'summary.json'), '{"flight":"C"}');

  const pv = B.restoreData(APP, DEST, {dryRun:true});
  T('preview: sees the flight to re-add', pv.ok && pv.preview.addFiles >= 2, JSON.stringify(pv.preview));
  T('preview: flags the settings overwrite', pv.preview.settingsOverwritten.includes('config.json'));

  const r = B.restoreData(APP, DEST, {});
  T('restore succeeds', r.ok, r.error || (r.errors||[]).join('; '));
  T('the deleted flight is back', read(path.join(APP, 'Sessions', '2026-01-01', 'flightA', 'summary.json')) === '{"flight":"A"}');
  T('the settings file was restored', read(path.join(APP, 'config.json')) === '{"setting":1}');
  T('the live-only flight was NOT deleted (additive restore)', read(path.join(APP, 'Sessions', '2026-02-02', 'flightC', 'summary.json')) === '{"flight":"C"}');
  T('a pre-restore safety copy of the old settings exists', r.safetyCopy && read(path.join(r.safetyCopy, 'config.json')) === '{"setting":999}', r.safetyCopy);
}

fs.rmSync(tmp, {recursive:true, force:true});
process.exit(T.done() ? 1 : 0);
