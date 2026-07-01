'use strict';
// perf/native/_arm_native.js — GATE-TEST launcher for the native capture. Runs the full native --auto
// flow IN PARALLEL with the untouched Python app, writing to a SEPARATE test Sessions dir so it never
// touches real flight data. Run elevated (PresentMon needs admin). Usage: node _arm_native.js
const path = require('path');
const { runAutoCapture } = require('./capture.js');

const DATA_ROOT = path.join(process.env.APPDATA, 'A Better Route Planner');
const opts = {
  assetDir: path.join(__dirname, '..'),                         // perf/  — has PresentMon-x64.exe
  dataRoot: DATA_ROOT,                                          // _capture_tmp.csv + _prep_aircraft.txt live here
  sessionsDir: path.join(DATA_ROOT, 'Sessions_NATIVE_TEST'),    // SEPARATE — real Sessions untouched
  usercfgPath: path.join(process.env.APPDATA, 'Microsoft Flight Simulator 2024', 'UserCfg.opt'),
  username: 'snkeyez95',
  appName: 'ABRP Native Perf (test)',
  log: (m) => console.log(m),
  status: (s) => console.log('  [status] ' + s),
};

console.log('============================================================');
console.log('  ABRP NATIVE CAPTURE — GATE TEST');
console.log('============================================================');
console.log('  Output -> ' + opts.sessionsDir);
console.log('  (your real Sessions folder is NOT touched)');
console.log('');
console.log('  1) This window should say "Connected." once MSFS is reachable.');
console.log('  2) Load into a flight; when you taxi/push back a few feet it says "Rolling — starting capture".');
console.log('  3) Close the sim (or land + park) to stop + file.');
console.log('');

runAutoCapture(opts)
  .then((r) => {
    console.log('');
    console.log('  RESULT: ' + JSON.stringify(r));
    console.log('  Tell Claude what this window showed. Press Ctrl+C to close.');
  })
  .catch((e) => { console.log('  ERROR: ' + (e && e.message)); });
