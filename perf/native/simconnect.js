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
// v6.15.6 (Dean 2026-07-30, KORD-CYYZ): was 45000, which is INSIDE the envelope of aircraft he
// actually flies — the Citation Sovereign+ cruised at ~45,500 ft and 16 minutes of altitude were
// discarded as "garbage" (blank alt_ft from 24.0 to 39.9 min). Worse, a null altitude freezes the
// phase tracker, so that whole level cruise was filed as "climb" (51.8% climb / 3.3% cruise).
// 70,000 still catches genuinely unsettled SimConnect reads while clearing every civil aircraft
// (Concorde topped out at 60,000; bizjet ceilings sit around 51,000).
const ALT_SANE_FT         = 70000;    // above this = SimConnect not settled
const ALT_GAP_MAX_S       = 10.0;     // altitude gap longer than this = restart the climb-rate baseline
                                      // rather than divide the change across the whole gap
const PHASE_VS_FPM        = 150.0;    // climb/descent vs level deadband (feet/min)
const AUTO_GIVEUP_SECONDS = 90;       // give up only after this long unreachable — RECONNECTS ONLY
const AUTO_START_TIMEOUT_S = 1800;    // initial connect: MSFS may not even be LAUNCHED yet when we arm
                                      // (both UI arm flows fire before/at launch) — Python waits 30 min
                                      // here (msfs_perf_logger.py:3302) and applies 90s only to REconnects
const STALE_DATA_SECONDS  = 15;       // no samples this long = connection made at the menu / went dead;
                                      // rebuild it (Python's none_streak >= 15 self-heal, py:3359)

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

// --- landing performance (v6.22.0, Dean 2026-09-22) — touchdown FPM + peak G ---
// The 1 Hz sampler above is too coarse for a touchdown (a firm landing is sub-second), so VERTICAL SPEED
// + G FORCE are read on a SEPARATE SIM_FRAME request (attachLandingSampler) feeding this tracker. Pure
// logic here so it's desk-testable with synthetic frame sequences.
const MIN_AIRBORNE_S   = 30.0;   // must have flown this long before an on-ground transition counts as a
                                 // landing — ignores the takeoff ground roll and any pre-flight bump
const BOUNCE_WINDOW_S  = 8.0;    // a re-touch within this long of going back airborne = a bounce (short hop)
const PEAK_G_WINDOW_S  = 2.0;    // track peak G for this long after a touchdown (the G spike lags on-ground)

// Rating from descent rate (primary) with a G-spike override. Word-based (never colour alone) — Dean is
// red-green colourblind. Thresholds are the landing-rate-monitor conventions; tunable.
function rateLanding(fpm, g) {
  const a = Math.abs(fpm || 0);
  let r = a < 60 ? 'Butter' : a < 180 ? 'Good' : a < 400 ? 'Firm' : 'Hard';
  if (g != null) { if (g >= 2.2) r = 'Hard'; else if (g >= 1.8 && (r === 'Butter' || r === 'Good')) r = 'Firm'; }
  return r;
}

class LandingTracker {
  constructor() {
    this._airborne = false; this._airborneSince = null; this._lastVs = null;
    this._touchdowns = [];               // {fpm, t, gs, peak_g}
    this._peakUntil = 0;                 // ts through which we still grow the latest touchdown's peak G
  }
  // vsFpm: vertical speed (ft/min, negative = descending); g: G force (~1.0 level); onGround: 0/1/bool;
  // gsKt: ground speed; t: wall seconds. Called at frame rate.
  update(vsFpm, g, onGround, gsKt, t) {
    const down = (onGround === 0 || onGround === false);
    const grounded = (onGround === 1 || onGround === true);
    if (down) {
      if (!this._airborne) { this._airborne = true; this._airborneSince = t; }
      if (vsFpm != null) this._lastVs = vsFpm;
    } else if (grounded) {
      if (this._airborne) {
        const dur = this._airborneSince != null ? (t - this._airborneSince) : 0;
        const first = this._touchdowns.length === 0;
        // first touchdown needs a real flight before it; a bounce is a short hop after one
        const qualifies = first ? (dur >= MIN_AIRBORNE_S) : (dur <= BOUNCE_WINDOW_S);
        if (qualifies) {
          // touchdown rate = VS from the last AIRBORNE frame (at the on-ground frame VS has already
          // arrested); fall back to the current read only if we somehow have no airborne sample.
          const fpm = (this._lastVs != null ? this._lastVs : vsFpm) || 0;
          this._touchdowns.push({ fpm, t, gs: (gsKt != null ? gsKt : null), peak_g: (g != null ? g : 0) });
          this._peakUntil = t + PEAK_G_WINDOW_S;
        }
      }
      this._airborne = false; this._airborneSince = null;
    }
    // grow the latest touchdown's peak G through the window (the spike arrives a frame or two after
    // the on-ground flag flips)
    if (this._touchdowns.length && t <= this._peakUntil && g != null) {
      const td = this._touchdowns[this._touchdowns.length - 1];
      if (g > td.peak_g) td.peak_g = g;
    }
  }
  // The firmest touchdown (most-negative FPM) + bounce count. null when no landing was seen.
  result() {
    if (!this._touchdowns.length) return null;
    let firmest = this._touchdowns[0];
    for (const td of this._touchdowns) if (td.fpm < firmest.fpm) firmest = td;
    return {
      touchdown_fpm: Math.round(firmest.fpm),
      peak_g: Math.round((firmest.peak_g || 0) * 100) / 100,
      touchdown_gs_kt: firmest.gs != null ? Math.round(firmest.gs) : null,
      bounce_count: Math.max(0, this._touchdowns.length - 1),
      rating: rateLanding(firmest.fpm, firmest.peak_g),
    };
  }
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
    // A stale baseline across a long gap (dropped samples, or an altitude the old cap threw away)
    // would spread the whole altitude change over the gap and report a near-zero climb rate — which
    // is how a 16-minute cruise once turned into a phantom transition. On a stale baseline, re-anchor
    // and HOLD the current phase; the next sample measures a real rate against the fresh anchor.
    const prevAlt = this._prevAlt, prevAltT = this._prevAltT;
    this._prevAlt = alt; this._prevAltT = nowSec;
    const stale = prevAltT != null && (nowSec - prevAltT) > ALT_GAP_MAX_S;
    if (stale && this.current != null) return this.current;
    let fpm = 0.0;
    if (prevAlt != null && prevAltT != null && !stale) fpm = computeFpm(alt, prevAlt, nowSec - prevAltT);
    const phase = classifyPhase(!!onGround, fpm);
    if (phase !== this.current) { this.phaseLog.push([nowSec, phase]); this.current = phase; }
    return phase;
  }
}

// --- node-simconnect I/O (validated at the gate) ---
const DEF_ID = 1, REQ_ID = 1;
const DEF_LAND = 3, REQ_LAND = 3;   // v6.22.0: separate SIM_FRAME stream for touchdown FPM + G (id 2 = TITLE)

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
  // v6.11.0: own-ship position — the VATSIM traffic-density sampler needs it to count pilots within
  // 40nm. Standard SimVars, added mid-list: reads below are POSITIONAL and mirror this exact order.
  handle.addToDataDefinition(DEF_ID, 'PLANE LATITUDE', 'Degrees', SimConnectDataType.FLOAT64);
  handle.addToDataDefinition(DEF_ID, 'PLANE LONGITUDE', 'Degrees', SimConnectDataType.FLOAT64);
  // v6.6.1: parking-brake end-trim anchor (Dean 2026-07-09) — a standard SimVar; some custom aircraft
  // (e.g. Fenix) may not drive it, in which case it just reads null/0 forever and the trim falls back
  // to the teardown heuristic (capture.js / phases.js trimAtElapsed).
  handle.addToDataDefinition(DEF_ID, 'BRAKE PARKING POSITION', 'Bool', SimConnectDataType.INT32);
  handle.requestDataOnSimObject(REQ_ID, DEF_ID, 0 /* USER */, SimConnectPeriod.SECOND);
  const state = { gspeed: null, onGround: null, alt: null, lat: null, lon: null, brake: null, lastUpdate: Date.now() / 1000 };
  handle.on('simObjectData', (recv) => {
    if (recv.requestID !== REQ_ID) return;
    try {
      const gspeed = recv.data.readFloat64();
      const onGround = recv.data.readInt32();
      let alt = recv.data.readFloat64();
      if (alt > ALT_SANE_FT) alt = null;                      // discard unsettled garbage
      let lat = recv.data.readFloat64(), lon = recv.data.readFloat64();
      if (!(lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180) || (lat === 0 && lon === 0)) { lat = null; lon = null; }
      const brake = !!recv.data.readInt32();
      state.gspeed = gspeed; state.onGround = onGround; state.alt = alt; state.lat = lat; state.lon = lon; state.brake = brake;
      state.lastUpdate = Date.now() / 1000;                   // freshness: stale = dead/menu connection
      if (tracker) tracker.update(onGround, alt, Date.now() / 1000);
    } catch (_) {}
  });
  return state;
}

// v6.22.0: attach a SIM_FRAME (per-frame) landing stream to a handle, feeding a LandingTracker. Isolated
// from the 1 Hz stream above so touchdown FPM + peak G are caught at frame rate without touching the
// proven rolling/telemetry path. Fully defensive — any failure here must never disturb the capture.
function attachLandingSampler(handle, landing) {
  if (!landing) return;
  try {
    const { SimConnectDataType, SimConnectPeriod } = require('node-simconnect');
    handle.addToDataDefinition(DEF_LAND, 'VERTICAL SPEED', 'Feet per minute', SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_LAND, 'G FORCE', 'GForce', SimConnectDataType.FLOAT64);
    handle.addToDataDefinition(DEF_LAND, 'SIM ON GROUND', 'Bool', SimConnectDataType.INT32);
    handle.addToDataDefinition(DEF_LAND, 'GROUND VELOCITY', 'Knots', SimConnectDataType.FLOAT64);
    handle.requestDataOnSimObject(REQ_LAND, DEF_LAND, 0 /* USER */, SimConnectPeriod.SIM_FRAME);
    handle.on('simObjectData', (recv) => {
      if (recv.requestID !== REQ_LAND) return;
      try {
        const vs = recv.data.readFloat64();
        const g = recv.data.readFloat64();
        const onGround = recv.data.readInt32();
        const gs = recv.data.readFloat64();
        landing.update(vs, g, onGround, gs, Date.now() / 1000);
      } catch (_) {}
    });
  } catch (_) {}
}

// Watch one connection for rolling. Resolves 'rolling' when ground-roll holds AUTO_CONFIRM_SECONDS,
// or 'dropped' when the connection dies / goes stale (caller rebuilds it — never gives up here).
function _rollingOrDropped(handle, state, say) {
  return new Promise((resolve) => {
    let confirmedSince = null, done = false, iv = null;
    const finish = (v) => { if (!done) { done = true; if (iv) clearInterval(iv); resolve(v); } };
    try { handle.on('quit', () => finish('dropped')); handle.on('close', () => finish('dropped')); } catch (_) {}
    iv = setInterval(() => {
      // Stale stream = we almost certainly connected at the menu before the flight loaded (a request
      // made then never refreshes) or the connection silently died. Python none_streak self-heal.
      if (Date.now() / 1000 - state.lastUpdate >= STALE_DATA_SECONDS) return finish('dropped');
      if (isRolling(state.gspeed, state.onGround, state.alt)) {
        if (confirmedSince == null) confirmedSince = Date.now() / 1000;
        else if (Date.now() / 1000 - confirmedSince >= AUTO_CONFIRM_SECONDS) {
          say(`  Rolling (${(state.gspeed || 0).toFixed(1)} kt) — starting capture now.`);
          finish('rolling');
        }
      } else confirmedSince = null;
    }, 1000);
  });
}

// The full armed wait (Python wait_for_auto_start, py:3274): connect with the LONG launch timeout,
// then wait for rolling, self-healing the connection whenever it drops or goes stale — the 90s
// give-up applies ONLY to those rebuilds (a sim that's truly closed never reconnects; a loading or
// transitioning sim comes back in seconds). Resolves {handle, state} at rolling, or 'no-flight'.
async function armAndWaitForRolling(appName, log) {
  const say = log || (() => {});
  let conn = await openWithRetry(appName, AUTO_START_TIMEOUT_S, say);
  if (conn === 'no-flight') return 'no-flight';
  let handle = conn.handle;
  say('  Connected. Waiting for rolling...');
  for (;;) {
    const state = attachSampler(handle, null);
    const outcome = await _rollingOrDropped(handle, state, say);
    if (outcome === 'rolling') return { handle, state };
    say('  No speed data — refreshing SimConnect connection (flight may still be loading).');
    try { handle.close(); } catch (_) {}
    conn = await openWithRetry(appName, AUTO_GIVEUP_SECONDS, say);   // 90s of sustained failure = sim closed
    if (conn === 'no-flight') return 'no-flight';
    handle = conn.handle;
  }
}

// v6.15.7 — RECORD NOW (Dean 2026-07-31). Connect, then start recording straight away instead of
// waiting for the takeoff roll. For deliberate at-the-gate work (cinematic / chase-plane / settings
// A-B tests) where the aircraft may never move, so the rolling trigger would never fire and nothing
// would ever be captured. Same connect path and the same long launch timeout as the normal arm —
// only the rolling wait is skipped.
async function armAndConnect(appName, log) {
  const say = log || (() => {});
  const conn = await openWithRetry(appName, AUTO_START_TIMEOUT_S, say);
  if (conn === 'no-flight') return 'no-flight';
  say('  Connected. RECORD NOW: starting immediately (takeoff-roll detection bypassed).');
  return { handle: conn.handle, state: attachSampler(conn.handle, null) };
}

// Mid-RECORDING sampler that survives SimConnect drops. A transient 'close' (or silent freeze) must
// NEVER end the capture — Python ends a capture ONLY when PresentMon exits (py:3845) and swallows
// every tracker read failure. This goes one better: it reconnects so phase/movement data resumes,
// while latest() nulls out stale values in the meantime (matching Python's failed-read → None rows).
class ResilientSampler {
  constructor(appName, handle, state, log) {
    this._appName = appName; this._say = log || (() => {});
    this._stopped = false; this._reconnecting = false; this._landing = null;
    this._adopt(handle, state);
  }
  // v6.22.0: begin per-frame touchdown tracking on the live handle (re-attached on reconnect below).
  enableLanding(tracker) { this._landing = tracker; try { attachLandingSampler(this._handle, tracker); } catch (_) {} }
  _adopt(handle, state) {
    this._handle = handle; this._state = state;
    const onDrop = () => this._reconnect('connection dropped');
    try { handle.on('quit', onDrop); handle.on('close', onDrop); } catch (_) {}
  }
  latest() {
    const s = this._state;
    if (!s || Date.now() / 1000 - s.lastUpdate >= STALE_DATA_SECONDS) {
      this._reconnect('no data');                    // silent freeze without a close event
      return { gspeed: null, onGround: null, alt: null, lat: null, lon: null, brake: null };
    }
    return { gspeed: s.gspeed, onGround: s.onGround, alt: s.alt, lat: s.lat, lon: s.lon, brake: s.brake };
  }
  // Wall-clock seconds of the last REAL sample — i.e. the last moment the sim was provably alive.
  // Used as the end-of-capture trim anchor (Date.now() lies if PresentMon lingers past sim close).
  lastAliveTs() { return this._state ? this._state.lastUpdate : null; }
  // Seconds the stream has been dead (0 while healthy). Sustained unreachability while the
  // reconnect loop keeps failing = the sim is closed (connectability doctrine).
  unreachableFor() {
    const s = this._state; if (!s) return 0;
    const age = Date.now() / 1000 - s.lastUpdate;
    return age >= STALE_DATA_SECONDS ? age : 0;
  }
  _reconnect(why) {
    if (this._stopped || this._reconnecting) return;
    this._reconnecting = true;
    this._say('  SimConnect ' + why + ' mid-recording — reconnecting (PresentMon is unaffected and still recording).');
    const { open, Protocol } = require('node-simconnect');
    try { this._handle.close(); } catch (_) {}
    const tryOpen = () => {
      if (this._stopped) return;
      open(this._appName, Protocol.SunRise)
        .then(({ handle }) => {
          if (this._stopped) { try { handle.close(); } catch (_) {} return; }
          this._adopt(handle, attachSampler(handle, null));
          if (this._landing) { try { attachLandingSampler(handle, this._landing); } catch (_) {} }
          this._reconnecting = false;
          this._say('  SimConnect reconnected — phase/movement tracking resumed.');
        })
        .catch(() => { if (!this._stopped) setTimeout(tryOpen, 5000); });   // retry until stop(); the
        // capture's end is PresentMon's job, so endless retries here can never lose a flight
    };
    setTimeout(tryOpen, 2000);
  }
  stop() { this._stopped = true; try { this._handle.close(); } catch (_) {} }
}

// One-shot read of the loaded aircraft TITLE (e.g. "PMDG 737-800"). Resolves the string or null after
// a short timeout. Mirrors get_aircraft_title's SimConnect read (the caller normalizes + falls back).
const DEF_TITLE = 2, REQ_TITLE = 2;
function readTitle(handle, timeoutMs = 4000) {
  const { SimConnectDataType, SimConnectPeriod } = require('node-simconnect');
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      handle.addToDataDefinition(DEF_TITLE, 'TITLE', null, SimConnectDataType.STRING256);
      handle.requestDataOnSimObject(REQ_TITLE, DEF_TITLE, 0 /* USER */, SimConnectPeriod.ONCE);
      const onData = (recv) => {
        if (recv.requestID !== REQ_TITLE) return;
        try { finish((recv.data.readString(256) || '').trim() || null); } catch (_) { finish(null); }
      };
      handle.on('simObjectData', onData);
      setTimeout(() => finish(null), timeoutMs);
    } catch (_) { finish(null); }
  });
}

module.exports = {
  computeFpm, classifyPhase, isRolling, PhaseTracker, openWithRetry, attachSampler, readTitle,
  armAndWaitForRolling, armAndConnect, ResilientSampler, attachLandingSampler, LandingTracker, rateLanding,
  AUTO_MIN_SPEED_KT, AUTO_CONFIRM_SECONDS, ALT_SANE_FT, PHASE_VS_FPM, AUTO_GIVEUP_SECONDS,
  AUTO_START_TIMEOUT_S, STALE_DATA_SECONDS,
};
