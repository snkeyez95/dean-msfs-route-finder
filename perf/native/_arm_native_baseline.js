'use strict';
// _arm_native_baseline.js — a REAL baseline gap flight with the native engine: auto-TLOD (prep-next)
// THEN capture, all native. Run this while MSFS is on the MAIN MENU so the TLOD it sets applies when
// you load the flight. Files to Sessions_NATIVE_TEST (Claude verifies it, then merges into the real
// benchmark once confirmed — so your live 24-flight data is never touched by an unproven capture).
// Run elevated (PresentMon needs admin).
const path = require('path'), fs = require('fs');
const { prepNext } = require('./prep.js');
const { runAutoCapture } = require('./capture.js');

const DATA_ROOT = path.join(process.env.APPDATA, 'A Better Route Planner');
const USERNAME = 'snkeyez95';
const USERCFG = path.join(process.env.APPDATA, 'Microsoft Flight Simulator 2024', 'UserCfg.opt');

(async () => {
  console.log('============================================================');
  console.log('  ABRP NATIVE BASELINE FLIGHT  (auto-TLOD + capture)');
  console.log('============================================================');
  console.log('  Run this while MSFS is on the MAIN MENU.');
  console.log('');

  // 1) auto-TLOD — pick + write the gap TLOD for the SimBrief aircraft (same model as the tracker)
  let sessions = [];
  try { sessions = JSON.parse(fs.readFileSync(path.join(DATA_ROOT, 'Sessions', 'index.json'), 'utf8')).sessions || []; } catch (_) {}
  try {
    const r = await prepNext(sessions, { username: USERNAME, usercfgPath: USERCFG, backupDir: path.join(DATA_ROOT, 'usercfg_backups') });
    console.log('  AUTO-TLOD: ' + (r.msg || ''));
    if (r.aircraft) { try { fs.writeFileSync(path.join(DATA_ROOT, '_prep_aircraft.txt'), r.aircraft); } catch (_) {} }  // fresh fallback note
  } catch (e) { console.log('  AUTO-TLOD failed (' + e.message + ') — TLOD unchanged; continuing to capture.'); }

  console.log('');
  console.log('  >> Now LOAD your flight in MSFS (it will use the TLOD just set).');
  console.log('  >> Taxi to start recording; land + close the sim to file.');
  console.log('');

  // 2) capture the flight -> the safe test folder (Claude merges to real Sessions after verifying)
  const res = await runAutoCapture({
    assetDir: path.join(__dirname, '..'), dataRoot: DATA_ROOT,
    sessionsDir: path.join(DATA_ROOT, 'Sessions_NATIVE_TEST'),
    usercfgPath: USERCFG, username: USERNAME, appName: 'ABRP Native Baseline',
    log: (m) => console.log(m), status: (s) => console.log('  [status] ' + s),
  }).catch((e) => ({ ok: false, error: e && e.message }));

  console.log('');
  console.log('  RESULT: ' + JSON.stringify(res));
  console.log('  Tell Claude what this window showed. Press Ctrl+C to close.');
})();
