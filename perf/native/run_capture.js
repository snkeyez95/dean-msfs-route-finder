'use strict';
// perf/native/run_capture.js — PRODUCTION entry for the native --auto capture, spawned DETACHED by
// main.js (via Electron-as-node) so it survives closing ABRP mid-flight, exactly like the old
// perf-engine.exe --auto did. All config comes from env so main.js controls paths:
//   MSFS_PERF_ROOT     writable data root (Sessions, _capture_tmp.csv, capture_status.json)
//   ABRP_SESSIONS_DIR  where flights file (defaults to <root>/Sessions)
//   ABRP_ASSET_DIR     read-only assets (PresentMon-x64.exe)   — defaults to perf/
//   ABRP_USERCFG       UserCfg.opt path
//   ABRP_SIMBRIEF_USER SimBrief username
const fs = require('fs'), path = require('path');
const { runAutoCapture } = require('./capture.js');

const DATA_ROOT = process.env.MSFS_PERF_ROOT || path.join(process.env.APPDATA, 'A Better Route Planner');
const statusFile = path.join(DATA_ROOT, 'capture_status.json');
const writeStatus = (s) => { try { fs.writeFileSync(statusFile, JSON.stringify({ state: s, pid: process.pid })); } catch (_) {} };
const clearStatus = () => { try { fs.unlinkSync(statusFile); } catch (_) {} };

// Session log — the detached process runs stdio:'ignore', so this file is the ONLY visibility into a
// production capture (the Python engine wrote msfs_perf_logger.log; this is its native counterpart).
// Fresh each session, like the Python log.
const logFile = path.join(DATA_ROOT, 'native_capture.log');
try { fs.writeFileSync(logFile, '=== ABRP native capture · ' + new Date().toISOString() + ' · pid ' + process.pid + ' ===\r\n'); } catch (_) {}
const logLine = (m) => { try { fs.appendFileSync(logFile, new Date().toISOString().slice(11, 19) + ' ' + m + '\r\n'); } catch (_) {} };

runAutoCapture({
  assetDir: process.env.ABRP_ASSET_DIR || path.join(__dirname, '..'),
  dataRoot: DATA_ROOT,
  sessionsDir: process.env.ABRP_SESSIONS_DIR || path.join(DATA_ROOT, 'Sessions'),
  usercfgPath: process.env.ABRP_USERCFG || path.join(process.env.APPDATA, 'Microsoft Flight Simulator 2024', 'UserCfg.opt'),
  username: process.env.ABRP_SIMBRIEF_USER || 'snkeyez95',
  appName: 'ABRP Native Perf',
  log: (m) => { console.log(m); logLine(m); },
  status: (s) => { writeStatus(s); logLine('[status] ' + s); },
})
  .then((r) => { logLine('DONE: ' + JSON.stringify(r)); clearStatus(); process.exit(r && r.ok ? 0 : 0); })
  .catch((e) => { logLine('FATAL: ' + (e && e.stack || e)); clearStatus(); process.exit(1); });
