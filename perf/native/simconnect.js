'use strict';
// perf/native/simconnect.js — SimConnect auto-start + flight-phase tracker (the capture trigger).
// Native replacement for wait_for_auto_start + the _sc_tracker phase loop, using node-simconnect.
//
// THE v5.9.44 CONNECTABILITY FIX IS NATIVE HERE: open() only resolves if the sim is actually running,
// so "can we connect?" IS ground truth for "is the sim alive?" — never a process-list check. We give
// up only after open() fails for a sustained AUTO_GIVEUP_SECONDS (a menu<->flight transition drops the
// connection for seconds; a genuinely closed sim never comes back).
//
// The pure decision functions (classifyPhase / computeFpm / isRolling) are exported so they can be
// desk-tested with synthetic data; the node-simconnect I/O is validated at the gate (Tier 1).

// --- constants (match msfs_perf_logger.py exactly) ---
const AUTO_MIN_SPEED_KT   = 2.0;      // above GSX reposition, below pushback
const AUTO_CONFIRM_SECONDS = 3.0;     // rolling must hold this long before triggering
const ALT_SANE_FT         = 45000;    // above this = SimConnect not settled
const PHASE_VS_FPM        = 150.0;    // climb/descent vs level deadband (feet/min)
const AUTO_GIVEUP_SECONDS = 90;       // give up only after this long unreachable (the fix)

// --- pure decision logic (no I/O — desk-testable) ---
function computeFpm(alt, prevAlt, dtSec) {
  if (prevAlt == null || !(dtSec > 0)) return 0.0;
  return (alt - prevAlt) / dtSec * 60.0;
}
function classifyPhase(onGround, fpm) {
  if (onGround) return 'ground';
  if (fpm > PHASE_VS_FPM) return 'climb';
  if (fpm < -PHASE_VS_FPM) return 'descent';
  return 'cruise';
}
function isRolling(gspeed, onGround, alt) {
  return gspeed != null && gspeed > AUTO_MIN_SPEED_KT &&
         !!onGround && alt != null && alt < ALT_SANE_FT;
}

// Accumulates the phase_log (transition list) + telemetry the same way the Python tracker does.
class PhaseTracker {
  constructor(recordingWallStart) {
    this.recordingWallStart = recordingWallStart != null ? recordingWallStart : Date.now() / 1000;
    this.phaseLog = [];          // [[wallTimeSec, phase], ...] — first entry is the initial phase
    this.current = null;
    this._prevAlt = null;
    this._prevAltT = null;
  }
  // feed one sample; returns the current phase (or null if not yet determinable)
  update(onGround, alt, nowSec) {
    if (onGround == null || alt == null) return this.current;
    let fpm = 0.0;
    if (this._prevAlt != null && this._prevAltT != null) fpm = computeFpm(alt, this._prevAlt, nowSec - this._prevAltT);
    this._prevAlt = alt; this._prevAltT = nowSec;
    const phase = classifyPhase(!!onGround, fpm);
    if (phase !== this.current) { this.phaseLog.push([nowSec, phase]); this.current = phase; }
    return phase;
  }
}

// --- node-simconnect I/O (validated at the gate) ---
const DEF_ID = 1, REQ_ID = 1;

// Open a SimConnect session, retrying until success or sustained unreachability. Resolves the handle
// (sim is alive) or 'no-flight' (sim genuinely closed). log(msg) is optional.
function openWithRetry(appName, giveUpSec, log) {
  const { open, Protocol } = require('node-simconnect');
  const say = log || (() => {});
  return new Promise((resolve) => {
    let unreachableSince = null;
    const attempt = () => {
      open(appName, Protocol.SunRise)                         // SunRise = MSFS 2024
        .then(({ handle }) => { say('  Connected.'); resolve({ handle }); })
        .catch(() => {
          const now = Date.now() / 1000;
          if (unreachableSince == null) unreachableSince = now;
          if (now - unreachableSince > giveUpSec) {
            say(`  SimConnect unreachable for ${giveUpSec}s — MSFS appears closed, exiting (nothing to record).`);
            return resolve('no-flight');
          }
          setTimeout(attempt, 2000);                          // transition drop: retry; alive if it reconnects
        });
    };
    attempt();
  });
}

// Live sampler over a handle: keeps the latest {gspeed, onGround, alt} updated at 1 Hz, and (optionally)
// drives a PhaseTracker. Mirrors Python's aq.get(...) polling + _sc_tracker in one request stream.
function attachSampler(handle, tracker) {
  const { SimConnectDataType, SimConnectPeriod } = require('node-simconnect');
  handle.addToDataDefinition(DEF_ID, 'GROUND VELOCITY', 'Knots', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF_ID, 'SIM ON GROUND', 'Bool', SimConnectDataType.INT32);
  handle.addToDataDefinition(DEF_ID, 'PLANE ALTITUDE', 'Feet', SimConnectDataType.FLOAT64);
  handle.requestDataOnSimObject(REQ_ID, DEF_ID, 0 /* USER */, SimConnectPeriod.SECOND);
  const state = { gspeed: null, onGround: null, alt: null };
  handle.on('simObjectData', (recv) => {
    if (recv.requestID !== REQ_ID) return;
    try {
      const gspeed = recv.data.readFloat64();
      const onGround = recv.data.readInt32();
      let alt = recv.data.readFloat64();
      if (alt > ALT_SANE_FT) alt = null;                      // discard unsettled garbage
      state.gspeed = gspeed; state.onGround = onGround; state.alt = alt;
      if (tracker) tracker.update(onGround, alt, Date.now() / 1000);
    } catch (_) {}
  });
  return state;
}

module.exports = {
  computeFpm, classifyPhase, isRolling, PhaseTracker, openWithRetry, attachSampler,
  AUTO_MIN_SPEED_KT, AUTO_CONFIRM_SECONDS, ALT_SANE_FT, PHASE_VS_FPM, AUTO_GIVEUP_SECONDS,
};
