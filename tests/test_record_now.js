'use strict';
// v6.15.7 — RECORD NOW + STOP & FILE (Dean 2026-07-31: "an option to override any of our flight
// detection if I wanted to do some random at the gate cinematic (chase plane) testing").
//
// Arm Capture waits for gspeed > 2 kt on the ground — the takeoff roll — so anything done parked at
// a gate never records. RECORD NOW starts at SimConnect connect instead. Three things have to hold:
//   1. the session is quarantined (excluded) so a bench test can never move the baseline,
//   2. the end-trim uses the teardown path ONLY — the brake anchor latches on the first tick when
//      you're parked with the brake set, and the movement anchor cuts everything after the aircraft
//      last moved, which for a static cinematic is the entire take,
//   3. the capture can be stopped and filed without quitting the sim.
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('record now + stop & file:');
const ROOT = path.resolve(__dirname, '..');
const PH = require(path.join(ROOT, 'perf/native/phases.js'));
const IW = require(path.join(ROOT, 'perf/native/index_writer.js'));
const SC = require(path.join(ROOT, 'perf/native/simconnect.js'));
const CAP = require(path.join(ROOT, 'perf/native/capture.js'));
const src = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const capSrc = src('perf/native/capture.js'), engSrc = src('perf/native/engine.js');
const mainSrc = src('main.js'), preSrc = src('preload.js'), htmlSrc = src('index.html');
const runSrc = src('perf/native/run_capture.js'), scSrc = src('perf/native/simconnect.js');

// ── 1. the override path exists and only skips the rolling wait ─────────────
console.log('the override path:');
{
  T('armAndConnect is exported', typeof SC.armAndConnect === 'function');
  T('it reuses the same long launch timeout as a normal arm',
    /armAndConnect[\s\S]{0,400}openWithRetry\(appName, AUTO_START_TIMEOUT_S/.test(scSrc));
  T('it does NOT wait for rolling', !/armAndConnect[\s\S]{0,400}_rollingOrDropped/.test(scSrc));
  T('the normal arm still waits for rolling (unchanged)',
    /armAndWaitForRolling[\s\S]{0,400}_rollingOrDropped/.test(scSrc));
  T('capture.js picks the path from opts.recordNow',
    /recordNow \? await armAndConnect\(appName, say\) : await armAndWaitForRolling\(appName, say\)/.test(capSrc));
  T('run_capture.js reads it from the environment',
    /recordNow: process\.env\.ABRP_RECORD_NOW === '1'/.test(runSrc));
  T('main.js sets that env only when asked', /ABRP_RECORD_NOW: '1'/.test(mainSrc)
    && /\(o && o\.recordNow\) \? \{ ABRP_RECORD_NOW: '1' \}/.test(mainSrc));
}

// ── 2. quarantine — a bench test must never move a number ───────────────────
console.log('\nquarantine:');
{
  T('capture tags the session manual_capture', /if \(recordNow\) settings\.manual_capture = true;/.test(capSrc));
  T('the index entry carries manual_capture AND excluded',
    /settings\.manual_capture \? \{ manual_capture: true, excluded: true \}/.test(engSrc));
  T('a normal flight gets neither field', !/manual_capture: true, excluded: true \} : \{ manual_capture/.test(engSrc));
  T('manual_capture is written to index.csv', IW.INDEX_CSV_FIELDS.includes('manual_capture'));
  T('the CSV row builder emits it', (() => {
    const rows = IW.buildIndexCsvRows([{ session_id: 'x', manual_capture: true }]);
    return rows.length === 1 && rows[0].manual_capture === true;
  })());
  T('main.js already forwards `excluded` to the compare payload (one flag quarantines everywhere)',
    /excluded: s\.excluded \|\| midflight \|\| null/.test(mainSrc));
}

// ── 3. the trim trap — this is what would silently ruin a gate recording ────
console.log('\nend-trim on a parked session:');
{
  T('engine.js takes a manual flag', /sessionsDir, manual \} = opts;/.test(engSrc));
  T('manual sessions use the teardown trim only', /if \(manual\) \{\s*\[ft, cpu, gpu, teardownS\] = trimTeardownTail/.test(engSrc));
  T('the brake/movement anchors still run for real flights',
    /\} else if \(!tryAnchor\(brakeAnchorS, 'brake'\) && !tryAnchor\(moveAnchorS, 'movement'\)\)/.test(engSrc));
  T('capture.js passes it through to fileSession', /manual: recordNow,/.test(capSrc));

  // Prove the hazard is real: 10 minutes of steady gate frames, brake set at the 30 s mark.
  const ft = new Array(36000).fill(16.7);
  const brakeAnchorS = 30;
  const [kept] = PH.trimAtElapsed(ft, [], [], brakeAnchorS - 5);
  T('the brake anchor WOULD have cut a 10-minute take down to seconds',
    kept.length < ft.length * 0.1, kept.length + ' of ' + ft.length + ' frames survive');
  const [teardownKept] = PH.trimTeardownTail(ft, [], []);
  T('the teardown trim keeps a clean parked recording intact',
    teardownKept.length === ft.length, teardownKept.length + ' frames');
  // and it still cuts a genuine shutdown burst at the end
  const withTeardown = ft.slice(0, 35900).concat(new Array(100).fill(400));
  const [cut] = PH.trimTeardownTail(withTeardown, [], []);
  T('...while still removing a real teardown burst', cut.length < withTeardown.length,
    (withTeardown.length - cut.length) + ' frames trimmed');
}

// ── 4. stop & file ──────────────────────────────────────────────────────────
console.log('\nstop & file without quitting the sim:');
{
  T('waitForCaptureEnd accepts a stop-file', CAP.waitForCaptureEnd.length === 4);
  T('it is polled alongside the existing end conditions', /if \(stopFile\) \{[\s\S]{0,220}finish\('stopped from ABRP'\)/.test(capSrc));
  T('the request is consumed so it cannot end the NEXT capture too',
    /fs\.unlinkSync\(stopFile\)[\s\S]{0,80}finish\('stopped from ABRP'\)/.test(capSrc));
  T('a stale request is cleared when a capture starts',
    /try \{ fs\.unlinkSync\(stopFile\); \} catch \(_\) \{\}   \/\/ a stale request must never kill a fresh capture/.test(capSrc));
  T('the sim-close and PresentMon-exit endings are untouched',
    /finish\('sim closed — PresentMon exited'\)/.test(capSrc) && /finish\('PresentMon gone'\)/.test(capSrc));
  T('main.js exposes perf-stop-capture', /ipcMain\.handle\('perf-stop-capture'/.test(mainSrc));
  T('it refuses when nothing is recording', /if \(!isCaptureRunning\(\)\) return \{ ok:false, error:'no capture is running' \}/.test(mainSrc));
  T('it writes the file the engine polls', /_capture_stop'\), String\(Date\.now\(\)\)/.test(mainSrc));
  T('preload bridges both calls', /perfStopCapture:\s+\(\)\s+=> ipcRenderer\.invoke\('perf-stop-capture'\)/.test(preSrc)
    && /perfStartCapture:\s+\(o\)\s+=> ipcRenderer\.invoke\('perf-start-capture', o\)/.test(preSrc));

  // live behaviour: a fake PresentMon child + a stop file must resolve the wait
  const TMP = path.join(ROOT, 'tests', '_tmp_stopfile');
  fs.mkdirSync(TMP, { recursive: true });
  const stopFile = path.join(TMP, '_capture_stop');
  const fakeProc = { exitCode: null, signalCode: null, on() {} };
  let resolved = false;
  const p = CAP.waitForCaptureEnd(fakeProc, null, () => {}, stopFile).then(() => { resolved = true; });
  fs.writeFileSync(stopFile, '1');
  const done = new Promise(r => setTimeout(r, 2600));
  Promise.race([p, done]).then(() => {
    T('writing the stop file actually ends the wait', resolved);
    T('the engine deleted the request after consuming it', !fs.existsSync(stopFile));
    try { fs.rmSync(TMP, { recursive: true, force: true }); } catch (_) {}
    // ── 5. UI ────────────────────────────────────────────────────────────────
    console.log('\nUI:');
    T('a Record Now button exists', /onclick="perfRecordNow\(\)"/.test(htmlSrc));
    T('a Stop & file button exists', /onclick="perfStopCapture\(\)"/.test(htmlSrc));
    T('Record Now asks for the override explicitly', /perfStartCapture\(\{recordNow:true\}\)/.test(htmlSrc));
    T('the confirm warns it will not count toward the baseline', /NOT count toward your baseline/.test(htmlSrc));
    T('plain Arm Capture is unchanged (no options object)', /perfStartCapture\(\);/.test(htmlSrc));
    const X = require('./lib/extract.js');
    // grab() locates `function <name>(` and so drops the leading `async` keyword — re-add it, or
    // every await inside reads as a syntax error (the same trip-up that broke latcPoll once).
    T('both new handlers parse', (() => {
      try {
        for (const n of ['perfRecordNow', 'perfStopCapture']) new Function('"use strict"; async ' + X.grab(n, htmlSrc));
        return true;
      } catch (e) { return false; }
    })());
    T('both are declared async (they await IPC)',
      /async function perfRecordNow\(\)/.test(htmlSrc) && /async function perfStopCapture\(\)/.test(htmlSrc));
    process.exit(T.done() ? 1 : 0);
  });
}
