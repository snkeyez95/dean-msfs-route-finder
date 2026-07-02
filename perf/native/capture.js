'use strict';
// perf/native/capture.js — the --auto capture orchestrator (the run flow). Native replacement for the
// record loop in msfs_perf_logger.py: connect + wait for rolling -> start PresentMon+VRAM+telemetry ->
// tick the phase/movement/telemetry tracker at 1 Hz -> on sim-close stop -> movement-based tail-trim ->
// hand the raw capture to engine.fileSession (which trims/stats/phases/writes everything).
//
// ⚠ INTEGRATION MODULE: every piece it calls is individually tested, but the full path can only be
// validated with the sim running (a ~5-min gate+taxi session). This is the assembly, not new math.
const fs = require('fs'), path = require('path');
const { armAndWaitForRolling, ResilientSampler, readTitle, PhaseTracker,
        AUTO_MIN_SPEED_KT } = require('./simconnect.js');
const { VramSampler } = require('./vram.js');
const { TelemetrySampler } = require('./telemetry.js');
const { startPresentmon, stopPresentmon, findPresentmon, killStrayPresentmon, TARGET_PROCESS } = require('./presentmon.js');
const { readSettings } = require('./settings.js');
const { getDriverVersion, getSimVersion, getSimbriefRoute, normalizeAircraftTitle } = require('./sysinfo.js');
const { fileSession } = require('./engine.js');

const HEAD_TRIM_S = 5, STOP_BUFFER_S = 30, TAIL_FALLBACK_S = 60, MIN_TAIL_TRIM_S = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resolve to the end of capture: PresentMon exits on its own when MSFS closes
// (--terminate_on_proc_exit). That is the ONLY end condition — Python parity (py:3845 waits solely on
// proc.poll()). A SimConnect 'quit'/'close' mid-flight is a transient the ResilientSampler absorbs;
// treating it as capture-end filed truncated flights (deep-review finding 4).
function waitForCaptureEnd(proc, say) {
  return new Promise((resolve) => {
    let done = false, poll = null;
    const finish = (why) => { if (!done) { done = true; if (poll) clearInterval(poll); say('  Capture ended (' + why + ').'); resolve(); } };
    proc.on('exit', () => finish('sim closed — PresentMon exited'));
    proc.on('error', (e) => { say('  PresentMon process error: ' + (e && e.message)); finish('PresentMon error'); });
    poll = setInterval(() => { if (proc.exitCode !== null || proc.signalCode) finish('PresentMon gone'); }, 2000);
  });
}

async function resolveAircraft(handle, opts) {
  let title = null;
  try { title = await readTitle(handle); } catch (_) {}
  const norm = normalizeAircraftTitle(title);
  if (norm) return norm;   // a real title always wins (a stale _prep_aircraft.txt must never relabel it)
  // fallback ONLY when the title read failed entirely: the aircraft --prep-next saved before launch
  try {
    const f = path.join(opts.dataRoot, '_prep_aircraft.txt');
    if (fs.existsSync(f)) { const v = fs.readFileSync(f, 'utf8').trim(); if (v) return v; }
  } catch (_) {}
  return null;
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

  const appName = opts.appName || 'ABRP Perf';
  setStatus('armed');
  // Armed wait — the long launch timeout + self-healing reconnects live in armAndWaitForRolling
  // (Python wait_for_auto_start parity: 1800s for MSFS to appear, 90s give-up on REconnects only).
  const armed = await armAndWaitForRolling(appName, say);
  if (armed === 'no-flight') { setStatus('idle'); return { ok: false, reason: 'no-flight' }; }

  // Flight facts BEFORE starting PresentMon — Python gathers read_settings/title/SimBrief/sim_version
  // first (py:3701-3726) and only then start_presentmon + the wall anchor, so these slow calls
  // (title read ≤4s, SimBrief ≤10s, 2 PowerShell spawns) can't skew the recording baseline.
  const fresh = readSettings(opts.usercfgPath) || {};
  const settings = {
    tlod: fresh.tlod, olod: fresh.olod, upscaling: fresh.upscaling, frame_gen: fresh.frame_gen,
    target_fps: fresh.target_fps, fg_multiplier: fresh.fg_multiplier,
    texture_quality: fresh.texture_quality, usercfg_found: fresh.usercfg_found,
  };
  settings.aircraft = await resolveAircraft(armed.handle, opts);
  settings.simbrief_route = await getSimbriefRoute(opts.username);
  settings.sim_version = getSimVersion();
  const driverVersion = getDriverVersion();
  const startedAt = new Date();
  say(`  TLOD ${settings.tlod} / OLOD ${settings.olod} · ${settings.aircraft || 'aircraft n/a'}`);

  // start capture
  const proc = startPresentmon(pmPath, tmpCsv, TARGET_PROCESS);
  const vram = new VramSampler(1000); vram.start();
  const telem = new TelemetrySampler(['perf-engine', 'node']); telem.start();
  // Anchor IMMEDIATELY AFTER start_presentmon — Python sets _recording_wall_start right after the
  // spawn (py:3736 → 3759). Anchoring any earlier skews every frame-elapsed vs phase/telemetry
  // wall time by however long the metadata calls took (deep-review finding 6).
  const recordingWallStart = Date.now() / 1000;
  const tracker = new PhaseTracker(recordingWallStart);
  // Mid-recording SimConnect drops are absorbed here — they must never end the capture (finding 4).
  const sampler = new ResilientSampler(appName, armed.handle, armed.state, say);
  let lastMovingTs = null, wasAirborne = false, endedOnGround = true;
  setStatus('recording');
  say('  >> RECORDING. Closing the sim files it automatically.');

  const telemetryRows = [];
  const tick = setInterval(() => {
    const { gspeed: g, onGround: onG, alt } = sampler.latest();   // nulls when the stream is stale
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

  await waitForCaptureEnd(proc, say);

  clearInterval(tick);
  stopPresentmon(proc); vram.stop(); telem.stop(); sampler.stop();
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

module.exports = { runAutoCapture, waitForCaptureEnd, resolveAircraft, HEAD_TRIM_S };
