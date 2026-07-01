'use strict';
// perf/native/capture.js — the --auto capture orchestrator (the run flow). Native replacement for the
// record loop in msfs_perf_logger.py: connect + wait for rolling -> start PresentMon+VRAM+telemetry ->
// tick the phase/movement/telemetry tracker at 1 Hz -> on sim-close stop -> movement-based tail-trim ->
// hand the raw capture to engine.fileSession (which trims/stats/phases/writes everything).
//
// ⚠ INTEGRATION MODULE: every piece it calls is individually tested, but the full path can only be
// validated with the sim running (a ~5-min gate+taxi session). This is the assembly, not new math.
const fs = require('fs'), path = require('path');
const { openWithRetry, attachSampler, readTitle, PhaseTracker, isRolling,
        AUTO_CONFIRM_SECONDS, AUTO_GIVEUP_SECONDS, AUTO_MIN_SPEED_KT } = require('./simconnect.js');
const { VramSampler } = require('./vram.js');
const { TelemetrySampler } = require('./telemetry.js');
const { startPresentmon, stopPresentmon, findPresentmon, killStrayPresentmon, TARGET_PROCESS } = require('./presentmon.js');
const { readSettings } = require('./settings.js');
const { getDriverVersion, getSimVersion, getSimbriefRoute, normalizeAircraftTitle } = require('./sysinfo.js');
const { fileSession } = require('./engine.js');

const HEAD_TRIM_S = 5, STOP_BUFFER_S = 30, TAIL_FALLBACK_S = 60, MIN_TAIL_TRIM_S = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Wait until ground-roll is confirmed for AUTO_CONFIRM_SECONDS (reads the live `state` from attachSampler).
function waitForRolling(state, say) {
  return new Promise((resolve) => {
    let confirmedSince = null;
    const iv = setInterval(() => {
      if (isRolling(state.gspeed, state.onGround, state.alt)) {
        if (confirmedSince == null) confirmedSince = Date.now() / 1000;
        else if (Date.now() / 1000 - confirmedSince >= AUTO_CONFIRM_SECONDS) {
          clearInterval(iv); say(`  Rolling (${(state.gspeed || 0).toFixed(1)} kt) — starting capture now.`); resolve();
        }
      } else confirmedSince = null;
    }, 1000);
  });
}

// Resolve to the end of capture: PresentMon exits on its own when MSFS closes (--terminate_on_proc_exit),
// or the SimConnect connection quits/closes and can't be re-established.
function waitForCaptureEnd(proc, handle, say) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (why) => { if (!done) { done = true; say('  Capture ended (' + why + ').'); resolve(); } };
    proc.on('exit', () => finish('sim closed / PresentMon exited'));
    handle.on('quit', () => finish('sim quit'));
    handle.on('close', () => finish('connection closed'));
    const poll = setInterval(() => { if (proc.exitCode !== null || proc.signalCode) { clearInterval(poll); finish('PresentMon gone'); } }, 2000);
  });
}

async function resolveAircraft(handle, opts) {
  let title = null;
  try { title = await readTitle(handle); } catch (_) {}
  const norm = normalizeAircraftTitle(title);
  if (norm === 'Fenix' || norm === 'PMDG') return norm;
  // fallback: the aircraft --prep-next saved before launch
  try {
    const f = path.join(opts.dataRoot, '_prep_aircraft.txt');
    if (fs.existsSync(f)) { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v; }
  } catch (_) {}
  return norm || null;
}

// Full --auto capture. opts: {assetDir, dataRoot, sessionsDir, usercfgPath, username, appName, log, status}
async function runAutoCapture(opts) {
  const say = opts.log || (m => console.log(m));
  const setStatus = opts.status || (() => {});
  const pmPath = findPresentmon(opts.assetDir);
  if (!pmPath) { say('  PresentMon not found in ' + opts.assetDir); return { ok: false, reason: 'no-presentmon' }; }
  const tmpCsv = path.join(opts.dataRoot, '_capture_tmp.csv');
  try { fs.unlinkSync(tmpCsv); } catch (_) {}

  killStrayPresentmon();                       // one capture path only

  setStatus('armed');
  const conn = await openWithRetry(opts.appName || 'ABRP Perf', AUTO_GIVEUP_SECONDS, say);
  if (conn === 'no-flight') { setStatus('idle'); return { ok: false, reason: 'no-flight' }; }
  const handle = conn.handle;

  const recordingWallStart = Date.now() / 1000;
  const tracker = new PhaseTracker(recordingWallStart);
  const state = attachSampler(handle, null);   // live {gspeed,onGround,alt}; we drive the tracker in the tick
  let lastMovingTs = null, wasAirborne = false, endedOnGround = true;

  await waitForRolling(state, say);

  // flight facts (sim is loaded now)
  const fresh = readSettings(opts.usercfgPath) || {};
  const settings = {
    tlod: fresh.tlod, olod: fresh.olod, upscaling: fresh.upscaling, frame_gen: fresh.frame_gen,
    target_fps: fresh.target_fps, fg_multiplier: fresh.fg_multiplier,
    texture_quality: fresh.texture_quality, usercfg_found: fresh.usercfg_found,
  };
  settings.aircraft = await resolveAircraft(handle, opts);
  settings.simbrief_route = await getSimbriefRoute(opts.username);
  settings.sim_version = getSimVersion();
  const driverVersion = getDriverVersion();
  const startedAt = new Date();
  say(`  TLOD ${settings.tlod} / OLOD ${settings.olod} · ${settings.aircraft || 'aircraft n/a'}`);

  // start capture
  const proc = startPresentmon(pmPath, tmpCsv, TARGET_PROCESS);
  const vram = new VramSampler(1000); vram.start();
  const telem = new TelemetrySampler(['perf-engine', 'node']); telem.start();
  setStatus('recording');
  say('  >> RECORDING. Closing the sim files it automatically.');

  const telemetryRows = [];
  const tick = setInterval(() => {
    const g = state.gspeed, onG = state.onGround, alt = state.alt;
    if (g != null && g > AUTO_MIN_SPEED_KT) lastMovingTs = Date.now() / 1000;
    if (onG != null) { if (!onG) wasAirborne = true; endedOnGround = !!onG; }
    const phase = tracker.update(onG, alt, Date.now() / 1000);
    const [sCpu, sRam, tProc, tCpu] = telem.latest();
    const v = vram.latest();
    telemetryRows.push([
      Math.round((Date.now() / 1000 - recordingWallStart) * 1000),
      phase || '',
      alt != null ? Math.round(alt) : '',
      v != null ? v : '',
      sRam != null ? sRam.toFixed(1) : '',
      sCpu != null ? sCpu.toFixed(1) : '',
      tProc || '',
      tCpu != null ? tCpu.toFixed(1) : '',
    ]);
  }, 1000);

  await waitForCaptureEnd(proc, handle, say);

  clearInterval(tick);
  stopPresentmon(proc); vram.stop(); telem.stop();
  try { handle.close(); } catch (_) {}
  await sleep(1000);                            // CSV flush grace

  if (!fs.existsSync(tmpCsv) || fs.statSync(tmpCsv).size < 1024) {
    say('  No usable capture (was MSFS in a flight?). Nothing filed.'); setStatus('idle');
    return { ok: false, reason: 'empty' };
  }

  // movement-based tail-trim (post-landing junk)
  let trimS;
  if (lastMovingTs != null) {
    const lastElapsed = lastMovingTs - recordingWallStart;
    const totalElapsed = Date.now() / 1000 - recordingWallStart;
    trimS = Math.max(MIN_TAIL_TRIM_S, totalElapsed - lastElapsed - STOP_BUFFER_S);
  } else trimS = TAIL_FALLBACK_S;

  if (wasAirborne && !endedOnGround) settings.notes = 'mid-flight session';

  const sessionDir = fileSession({
    rawCsvPath: tmpCsv, settings, vram: vram.summarize(), startedAt,
    telemetryRows, phaseLog: tracker.phaseLog, recordingWallStart,   // absolute times; split subtracts it
    stopTrimS: Math.round(trimS * 10) / 10, driverVersion, simVersion: settings.sim_version,
    sessionsDir: opts.sessionsDir,
  });

  try { fs.unlinkSync(tmpCsv); } catch (_) {}
  setStatus('idle');
  say('  Filed: ' + sessionDir);
  return { ok: true, sessionDir };
}

module.exports = { runAutoCapture, waitForRolling, resolveAircraft, HEAD_TRIM_S };
