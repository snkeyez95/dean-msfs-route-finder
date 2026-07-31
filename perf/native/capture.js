'use strict';
// perf/native/capture.js — the --auto capture orchestrator (the run flow). Native replacement for the
// record loop in msfs_perf_logger.py: connect + wait for rolling -> start PresentMon+VRAM+telemetry ->
// tick the phase/movement/telemetry tracker at 1 Hz -> on sim-close stop -> movement-based tail-trim ->
// hand the raw capture to engine.fileSession (which trims/stats/phases/writes everything).
//
// ⚠ INTEGRATION MODULE: every piece it calls is individually tested, but the full path can only be
// validated with the sim running (a ~5-min gate+taxi session). This is the assembly, not new math.
const fs = require('fs'), path = require('path');
const { armAndWaitForRolling, armAndConnect, ResilientSampler, readTitle, PhaseTracker,
        AUTO_MIN_SPEED_KT, AUTO_GIVEUP_SECONDS } = require('./simconnect.js');
const { VramSampler } = require('./vram.js');
const { TelemetrySampler } = require('./telemetry.js');
const { startPresentmon, stopPresentmon, findPresentmon, killStrayPresentmon, TARGET_PROCESS } = require('./presentmon.js');
const { readSettings } = require('./settings.js');
const gfxWatch = require('./gfx_watch.js');
const { LiveFrametimeTail, writePerfLive, clearPerfLive } = require('./live_stats.js');
const { tailLatest: autofpsTailLatest } = require('./autofps_log.js');
const { getDriverVersion, getSimVersion, getSimbriefRoute, normalizeAircraftTitle, vatsimConnected, fetchVatsimPilots } = require('./sysinfo.js');
const { fileSession } = require('./engine.js');

const HEAD_TRIM_S = 5, STOP_BUFFER_S = 30, TAIL_FALLBACK_S = 60, MIN_TAIL_TRIM_S = 5;
// v6.11.0: traffic-density radius = vPilot's default aircraft injection/draw distance, so the count
// approximates what vPilot actually spawns into the sim around you.
const TRAFFIC_NM = 40, TRAFFIC_FEED_MS = 30000;
const LATE_VATSIM_MS = 120000, LATE_VATSIM_TRIES = 10;   // re-check a late VATSIM connect for ~20 min
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Great-circle distance in nm (haversine) — for the 40nm traffic count.
function gcNm(lat1, lon1, lat2, lon2) {
  const r = Math.PI / 180, dLat = (lat2 - lat1) * r, dLon = (lon2 - lon1) * r;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.sqrt(a));
}
function trafficCount(pilots, lat, lon) {
  if (!pilots || lat == null || lon == null) return null;
  let n = 0;
  for (const p of pilots) {
    if (Math.abs(p.lat - lat) > 0.75) continue;               // cheap prefilter (~45nm of latitude)
    if (gcNm(lat, lon, p.lat, p.lon) <= TRAFFIC_NM) n++;
  }
  return Math.max(0, n - 1);                                  // exclude own ship (it's in the feed too)
}

// Resolve to the end of capture: PresentMon exits on its own when MSFS closes
// (--terminate_on_proc_exit). That is the ONLY end condition — Python parity (py:3845 waits solely on
// proc.poll()). A SimConnect 'quit'/'close' mid-flight is a transient the ResilientSampler absorbs;
// treating it as capture-end filed truncated flights (deep-review finding 4).
function waitForCaptureEnd(proc, sampler, say, stopFile) {
  return new Promise((resolve) => {
    let done = false, poll = null;
    const finish = (why) => { if (!done) { done = true; if (poll) clearInterval(poll); say('  Capture ended (' + why + ').'); resolve(); } };
    proc.on('exit', () => finish('sim closed — PresentMon exited'));
    proc.on('error', (e) => { say('  PresentMon process error: ' + (e && e.message)); finish('PresentMon error'); });
    poll = setInterval(() => {
      // v6.15.7 — STOP & FILE from the app, without quitting the sim. The engine runs detached with
      // stdio ignored, so a file is the channel (same idea as capture_status.json in the other
      // direction). Consumed here, then the normal end-of-capture path runs: stopPresentmon → flush →
      // trim → file. Nothing about the resulting session differs from a sim-close ending.
      if (stopFile) {
        try {
          if (fs.existsSync(stopFile)) { try { fs.unlinkSync(stopFile); } catch (_) {} return finish('stopped from ABRP'); }
        } catch (_) {}
      }
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
  // v6.15.7 RECORD NOW: bypass the takeoff-roll trigger and record from the moment SimConnect is up.
  const recordNow = !!opts.recordNow;
  const stopFile = path.join(opts.dataRoot, '_capture_stop');
  try { fs.unlinkSync(stopFile); } catch (_) {}   // a stale request must never kill a fresh capture
  try { fs.unlinkSync(tmpCsv); } catch (_) {}

  killStrayPresentmon();                       // one capture path only

  const appName = opts.appName || 'ABRP Perf';
  setStatus('armed');
  // Armed wait — the long launch timeout + self-healing reconnects live in armAndWaitForRolling
  // (Python wait_for_auto_start parity: 1800s for MSFS to appear, 90s give-up on REconnects only).
  const armed = recordNow ? await armAndConnect(appName, say) : await armAndWaitForRolling(appName, say);
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
  // A RECORD NOW session is a deliberate bench test (gate cinematics, a settings A-B), not a flight.
  // Tagging it here makes engine.js mark it excluded, which quarantines it from the baseline,
  // coverage, drift, Settings A/B and the Scenery ranking in one move — it still records and shows
  // in the flight list, it just never counts toward anything.
  if (recordNow) settings.manual_capture = true;
  // SETTINGS A/B (v6.12.0): snapshot the WHOLE {Graphics} block at capture start ("silent data") +
  // a short fingerprint over the curated watch keys. A fingerprint change between consecutive
  // flights = the user changed a setting = a before/after card. Single snapshot by design (Dean
  // avoids mid-flight settings changes; the sim only re-reads UserCfg at launch anyway).
  try {
    if (fresh.usercfg_found) {
      const g = gfxWatch.readAllGraphics(fs.readFileSync(opts.usercfgPath, 'utf8'));
      if (g) { settings.graphics = g; settings.gfx_fp = gfxWatch.fingerprint(g); }
    }
  } catch (_) {}
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
  let onlineVatsim = false;   // v6.11.0: hoisted — gates the traffic-density sampler below
  let vpilotSeen = false;     // v6.15.2: hoisted — gates the late-connect re-check below
  try {
    const out = require('child_process').spawnSync('tasklist', ['/NH'], { encoding: 'utf8', timeout: 15000 }).stdout || '';
    const low = out.toLowerCase();
    const vpilotRunning = low.includes('vpilot'), batc = low.includes('beyondatc');
    vpilotSeen = vpilotRunning;
    if (low.includes('autofps')) {
      settings.autofps_active = true;
      // v6.12.0: AutoFPS's TLOD envelope lives in ITS config, not UserCfg — snapshot min/max/target
      // so a cap change (e.g. Max TLOD 800→700) fingerprints as a settings change like any other.
      try { const ac = gfxWatch.readAutofpsCfg(); if (ac) settings.autofps_cfg = ac; } catch (_) {}
    }
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
    onlineVatsim = vatsim;
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
  const telem = new TelemetrySampler(['perf-engine', 'node'], say); telem.start();
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

  // v6.11.0: VATSIM traffic-density sampler — refresh the pilots cache every ~30s (the feed itself
  // only updates ~15s; NEVER fetch at 1 Hz), count within 40nm each tick. Online-VATSIM flights only.
  let trafficPilots = null, trafficIv = null;
  const startTrafficSampler = () => {
    if (trafficIv) return;
    const refresh = () => { fetchVatsimPilots().then(p => { if (p) trafficPilots = p; }).catch(() => {}); };
    refresh(); trafficIv = setInterval(refresh, TRAFFIC_FEED_MS);
  };
  if (onlineVatsim) startTrafficSampler();

  // LATE VATSIM CONNECT (v6.15.2, Dean 2026-07-28 KEYW-TNCM): the probe above is ONE-SHOT at
  // recording start, so connecting after pushback — or after takeoff — left a genuine VATSIM flight
  // tagged offline, which then counted toward the fixed-TLOD baseline instead of being quarantined.
  // Re-check while vPilot is up until the CID confirms. BOUNDED (the datafeed is ~20MB a call):
  // every 2 min for the first ~20 min, which covers taxi + climb, then give up.
  let lateIv = null;
  if (vpilotSeen && !onlineVatsim && String(process.env.ABRP_VATSIM_CID || '').trim()) {
    let tries = 0;
    lateIv = setInterval(() => {
      if (++tries > LATE_VATSIM_TRIES) { clearInterval(lateIv); lateIv = null; return; }
      vatsimConnected(process.env.ABRP_VATSIM_CID).then(c => {
        if (c !== true || !lateIv) return;
        clearInterval(lateIv); lateIv = null;
        onlineVatsim = true;
        settings.online_traffic = (settings.online_traffic === 'batc') ? 'vatsim+batc' : 'vatsim';
        say('  CONTEXT: VATSIM connect detected after start → tagged ' + settings.online_traffic);
        startTrafficSampler();
      }).catch(() => {});
    }, LATE_VATSIM_MS);
  }

  const telemetryRows = [];
  const tick = setInterval(() => {
    const { gspeed: g, onGround: onG, alt, lat, lon, brake } = sampler.latest();   // nulls when the stream is stale
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
      (() => { const c = trafficCount(trafficPilots, lat, lon); return c != null ? c : ''; })(),   // v6.11.0: pilots within 40nm
    ]);
  }, 1000);

  // v6.12.0 LIVE PERF STRIP: every 5s, tail the growing PresentMon CSV (rolling ~60s window) and
  // publish a tiny perf_live.json (atomic tmp+rename) the app attaches to the VATSIM overlay state.
  // All fields nullable; any failure is silent — the capture itself is never disturbed.
  const liveTail = new LiveFrametimeTail(tmpCsv);
  const liveIv = setInterval(() => {
    try {
      liveTail.poll();
      const sn = liveTail.snapshot();
      const vNow = vram.latest();
      let tlod = settings.tlod != null ? settings.tlod : null;   // fixed-TLOD flights: the launch value
      if (settings.autofps_active) { const t = autofpsTailLatest(null, 60); tlod = t ? t.tlod : null; }
      writePerfLive(opts.dataRoot, {
        v: 1, ts: Date.now(),
        ft_avg: sn.ft_avg, ft_p99: sn.ft_p99,
        cpu_busy_avg: sn.cpu_busy_avg, gpu_busy_avg: sn.gpu_busy_avg,
        gpu_util_pct: vram.latestUtil(),
        vram_pct: (vNow != null && vram.totalMb) ? Math.round(vNow / vram.totalMb * 100) : null,
        tlod,
      });
    } catch (_) {}
  }, 5000);

  await waitForCaptureEnd(proc, sampler, say, stopFile);

  // End-of-capture anchor for the tail trim: the last moment the sim was provably ALIVE (last
  // SimConnect sample), never bare Date.now() — if PresentMon lingered past sim close (2026-07-02
  // hang), wall-now inflates the trim and cuts real flight data (it cost a landing before re-file).
  const captureEndTs = Math.min(Date.now() / 1000, sampler.lastAliveTs() || Infinity);

  clearInterval(tick);
  clearInterval(liveIv); clearPerfLive(opts.dataRoot);   // strip disappears from the overlay at capture end
  if (trafficIv) clearInterval(trafficIv);
  if (lateIv) clearInterval(lateIv);
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
    manual: recordNow,   // teardown-only trim: the ground-truth anchors assume a real flight
    sessionsDir: opts.sessionsDir,
  });

  try { fs.unlinkSync(tmpCsv); } catch (_) {}
  setStatus('idle');
  say('  Filed: ' + sessionDir);
  return { ok: true, sessionDir };
}

module.exports = { runAutoCapture, waitForCaptureEnd, resolveAircraft, trafficCount, gcNm, TRAFFIC_NM, HEAD_TRIM_S };
