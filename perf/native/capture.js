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
        AUTO_MIN_SPEED_KT, AUTO_GIVEUP_SECONDS } = require('./simconnect.js');
const { VramSampler } = require('./vram.js');
const { TelemetrySampler } = require('./telemetry.js');
const { startPresentmon, stopPresentmon, findPresentmon, killStrayPresentmon, TARGET_PROCESS } = require('./presentmon.js');
const { readSettings } = require('./settings.js');
const { getDriverVersion, getSimVersion, getSimbriefRoute, normalizeAircraftTitle, vatsimConnected } = require('./sysinfo.js');
const { fileSession } = require('./engine.js');

const HEAD_TRIM_S = 5, STOP_BUFFER_S = 30, TAIL_FALLBACK_S = 60, MIN_TAIL_TRIM_S = 5;
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Resolve to the end of capture: PresentMon exits on its own when MSFS closes
// (--terminate_on_proc_exit). That is the ONLY end condition — Python parity (py:3845 waits solely on
// proc.poll()). A SimConnect 'quit'/'close' mid-flight is a transient the ResilientSampler absorbs;
// treating it as capture-end filed truncated flights (deep-review finding 4).
function waitForCaptureEnd(proc, sampler, say) {
  return new Promise((resolve) => {
    let done = false, poll = null;
    const finish = (why) => { if (!done) { done = true; if (poll) clearInterval(poll); say('  Capture ended (' + why + ').'); resolve(); } };
    proc.on('exit', () => finish('sim closed — PresentMon exited'));
    proc.on('error', (e) => { say('  PresentMon process error: ' + (e && e.message)); finish('PresentMon error'); });
    poll = setInterval(() => {
      if (proc.exitCode !== null || proc.signalCode) return finish('PresentMon gone');
      // BACKSTOP (2026-07-02 hang): PresentMon's --terminate_on_proc_exit failed once in the wild,
      // leaving it — and this wait — running forever after the sim closed. SimConnect connectability
      // is ground truth: sustained unreachability with the reconnect loop failing = sim closed, so
      // end the capture ourselves (the caller stops PresentMon right after).
      if (sampler && sampler.unreachableFor() >= AUTO_GIVEUP_SECONDS)
        finish('sim closed — SimConnect unreachable ' + AUTO_GIVEUP_SECONDS + 's; stopping PresentMon');
    }, 2000);
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
  // SETTINGS LAB tag: consume the pending marker written by labNext at launch time. Consumed HERE
  // (at actual capture start) so an armed-but-never-flown launch can never tag a later flight.
  try {
    const lp = path.join(opts.dataRoot, '_lab_pending.json');
    if (fs.existsSync(lp)) {
      const marker = JSON.parse(fs.readFileSync(lp, 'utf8'));
      if (marker && marker.id) { settings.experiment = marker.id; settings.experiment_detail = marker; }
      fs.unlinkSync(lp);
      say('  LAB: this flight is tagged experiment "' + settings.experiment + '"');
    }
  } catch (_) {}
  // Flight-context tags (v6.9.0): ONE one-shot process probe at RECORDING start — not at arm/spawn
  // time, because vPilot/BeyondATC/AutoFPS are often launched after ABRP arms the capture. vPilot →
  // online_traffic:'vatsim', BeyondATC → 'batc' (both → 'vatsim+batc'); AutoFPS → autofps_active=true
  // (the long-planned tag the baseline/scenery views already READ — this finally writes it). Post-
  // benchmark Dean flies however he likes; these tags keep the baseline/drift math apples-to-apples
  // and give Compare an "online traffic on vs off" dimension.
  try {
    const out = require('child_process').spawnSync('tasklist', ['/NH'], { encoding: 'utf8', timeout: 15000 }).stdout || '';
    const low = out.toLowerCase();
    const vpilotRunning = low.includes('vpilot'), batc = low.includes('beyondatc');
    if (low.includes('autofps')) settings.autofps_active = true;
    // vPilot running ≠ on VATSIM (Dean 2026-07-10: left open as a companion but never connected). If a
    // CID is set, CONFIRM the connection via the live datafeed; the tag is dropped ONLY when the feed
    // positively says NOT connected. No CID / feed unreachable → fall back to process-presence (best-
    // effort; err toward tagging so an unconfirmed online flight can't silently pollute the baseline).
    let vatsim = false;
    if (vpilotRunning) {
      const conn = await vatsimConnected(process.env.ABRP_VATSIM_CID);   // true / false / null
      vatsim = (conn === false) ? false : true;
      if (conn === false) say('  CONTEXT: vPilot running but CID not connected to VATSIM → NOT tagged online');
    }
    if (vatsim || batc) settings.online_traffic = (vatsim && batc) ? 'vatsim+batc' : (vatsim ? 'vatsim' : 'batc');
    if (settings.online_traffic || settings.autofps_active)
      say('  CONTEXT: ' + [settings.online_traffic, settings.autofps_active ? 'AutoFPS' : null].filter(Boolean).join(' + '));
  } catch (_) {}
  settings.simbrief_route = await getSimbriefRoute(opts.username);
  // Scenery attribution (v6.3.8): split the route into dep/arr ICAO and flag each against the user's
  // 3rd-party library (ABRP_THIRDPARTY_ICAOS, passed by main.js the same way as ABRP_BENCHMARK).
  try {
    const m = /([A-Z]{3,4})-([A-Z]{3,4})/.exec(String(settings.simbrief_route || '').toUpperCase());
    if (m) { settings.dep_icao = m[1]; settings.arr_icao = m[2]; }
    let tp = null; try { tp = JSON.parse(process.env.ABRP_THIRDPARTY_ICAOS || ''); } catch (_) {}
    if (Array.isArray(tp) && (settings.dep_icao || settings.arr_icao)) {
      const set = new Set(tp.map(x => String(x).toUpperCase()));
      settings.dep_scenery = settings.dep_icao ? set.has(settings.dep_icao) : false;
      settings.arr_scenery = settings.arr_icao ? set.has(settings.arr_icao) : false;
    }
  } catch (_) {}
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
  // v6.6.1 — parking-brake end-trim anchor (Dean 2026-07-09): the START of the trailing UNBROKEN
  // "parked" streak (brake set, not moving). An explicit release (brake===false) or real ground
  // movement (g>AUTO_MIN_SPEED_KT) invalidates it — this is the ATC hold-and-cross guard: set the
  // brake to hold short, get cleared, release + roll again -> the streak breaks and a later final park
  // becomes the anchor instead. Missing/stale brake data (null) never invalidates by itself — only a
  // definite read does. Custom aircraft that don't drive the SimVar (e.g. Fenix) just never set this,
  // and the trim falls back to the teardown heuristic (engine.js).
  let brakeAnchorTs = null;
  setStatus('recording');
  say('  >> RECORDING. Closing the sim files it automatically.');

  const telemetryRows = [];
  const tick = setInterval(() => {
    const { gspeed: g, onGround: onG, alt, brake } = sampler.latest();   // nulls when the stream is stale
    if (g != null && g > AUTO_MIN_SPEED_KT) lastMovingTs = Date.now() / 1000;
    if (onG != null) { if (!onG) wasAirborne = true; endedOnGround = !!onG; }
    if (brake === true && (g == null || g <= AUTO_MIN_SPEED_KT)) {
      if (brakeAnchorTs == null) brakeAnchorTs = Date.now() / 1000;
    } else if (brake === false || (g != null && g > AUTO_MIN_SPEED_KT)) {
      brakeAnchorTs = null;
    }
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
      g != null ? g.toFixed(1) : '',    // v6.9.5: ground speed persisted → movement-based end-trim anchor
    ]);
  }, 1000);

  await waitForCaptureEnd(proc, sampler, say);

  // End-of-capture anchor for the tail trim: the last moment the sim was provably ALIVE (last
  // SimConnect sample), never bare Date.now() — if PresentMon lingered past sim close (2026-07-02
  // hang), wall-now inflates the trim and cuts real flight data (it cost a landing before re-file).
  const captureEndTs = Math.min(Date.now() / 1000, sampler.lastAliveTs() || Infinity);

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
    const totalElapsed = captureEndTs - recordingWallStart;   // sim-alive anchor, not wall-now
    trimS = Math.max(MIN_TAIL_TRIM_S, totalElapsed - lastElapsed - STOP_BUFFER_S);
  } else trimS = TAIL_FALLBACK_S;

  if (wasAirborne && !endedOnGround) settings.notes = 'mid-flight session';

  // Parking-brake anchor as elapsed seconds since recordingWallStart — the same basis frametimes.csv
  // timestamps use, so engine.js can cut the tail there directly (trimAtElapsed). null = no valid
  // brake-set-and-held streak this flight (never set, released before the end, or the aircraft doesn't
  // drive the SimVar) → engine.js falls back to the teardown heuristic, unchanged from before.
  const brakeAnchorS = brakeAnchorTs != null ? (brakeAnchorTs - recordingWallStart) : null;

  const sessionDir = fileSession({
    rawCsvPath: tmpCsv, settings, vram: vram.summarize(), startedAt,
    telemetryRows, phaseLog: tracker.phaseLog, recordingWallStart,   // absolute times; split subtracts it
    stopTrimS: Math.round(trimS * 10) / 10, brakeAnchorS, driverVersion, simVersion: settings.sim_version,
    sessionsDir: opts.sessionsDir,
  });

  try { fs.unlinkSync(tmpCsv); } catch (_) {}
  setStatus('idle');
  say('  Filed: ' + sessionDir);
  return { ok: true, sessionDir };
}

module.exports = { runAutoCapture, waitForCaptureEnd, resolveAircraft, HEAD_TRIM_S };
