'use strict';
// perf/native/presentmon.js — PresentMon capture control. Native replacement for
// start_presentmon / stop_presentmon. Spawns the bundled PresentMon-x64.exe to trace the target
// process's Present() calls into a CSV (the raw frametimes source that stats/report read).
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');

const TARGET_PROCESS = 'FlightSimulator2024.exe';
const PRESENTMON_NAMES = ['PresentMon-x64.exe', 'PresentMon.exe'];

function findPresentmon(assetDir) {
  for (const n of PRESENTMON_NAMES) {
    const p = path.join(assetDir, n);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// Start tracing. Returns the child process. --terminate_on_proc_exit stops it when the target closes;
// --stop_existing_session ensures only one ETW session (two collide). CSV is written incrementally.
function startPresentmon(pmPath, outCsv, targetProcess = TARGET_PROCESS) {
  const args = [
    '--process_name', targetProcess,
    '--output_file', outCsv,
    '--no_console_stats',
    '--stop_existing_session',
    '--terminate_on_proc_exit',
  ];
  return spawn(pmPath, args, { windowsHide: true, stdio: 'ignore' });
}

// Stop tracing. PresentMon streams the CSV, so a taskkill leaves a complete file (we lose <1s at the
// very end, which is tail-trimmed anyway). taskkill is used because Node's Windows signal delivery
// (CTRL_BREAK) to a child is unreliable across versions; taskkill is bulletproof.
function stopPresentmon(proc) {
  if (!proc || proc.exitCode !== null || proc.signalCode) return;
  try {
    spawnSync('taskkill', ['/PID', String(proc.pid), '/T'], { windowsHide: true, timeout: 8000 });
  } catch (_) {}
  // hard-stop backstop if it lingered
  try {
    if (proc.exitCode === null && !proc.killed) {
      spawnSync('taskkill', ['/F', '/PID', String(proc.pid), '/T'], { windowsHide: true, timeout: 5000 });
    }
  } catch (_) {}
}

// Kill any stray PresentMon (guards against a leftover ETW session before arming a fresh capture).
function killStrayPresentmon() {
  for (const n of PRESENTMON_NAMES) {
    try { spawnSync('taskkill', ['/F', '/IM', n, '/T'], { windowsHide: true, timeout: 5000 }); } catch (_) {}
  }
}

module.exports = { startPresentmon, stopPresentmon, findPresentmon, killStrayPresentmon, TARGET_PROCESS, PRESENTMON_NAMES };
