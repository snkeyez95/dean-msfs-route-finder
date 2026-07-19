'use strict';
// vPilot → Live ATC re-arm + manual-off suppression (Dean 2026-07-18).
// Runs the REAL vpilotWatch() out of index.html against a state machine, with a lightweight
// latcToggle stub that mirrors ONLY the two production state lines the watcher contracts on:
//   - LATC.on / S._vpilotAutoOn   (already there)
//   - S._vpilotSuppress = false on ON; = true on a MANUAL off (auto falsy)   (the 2026-07-18 line)
// The scenario the old !_vpilotPrev edge gate missed: vPilot closes AND reopens inside one poll.
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grab(name){
  const i = html.indexOf('async function ' + name + '(');
  if(i < 0) throw new Error('fn not found: ' + name);
  let d = 0, started = false;
  for(let j = i; j < html.length; j++){
    if(html[j] === '{'){ d++; started = true; }
    else if(html[j] === '}'){ d--; if(started && d === 0) return html.slice(i, j + 1); }
  }
  throw new Error('unbalanced braces: ' + name);
}

// Shared harness state
const LATC = { on:false };
const S = { _vpilotSuppress:false, _vpilotAutoOn:false, _vpilotPrev:false };
let vpilotUp = false;               // what the (stubbed) process probe reports this poll
const log = [];

function RLOG(){}                    // silence
function vCfg(){ return { autoStartVpilot:true }; }
async function isVpilotRunning(){ return vpilotUp; }
// Faithful mirror of the production latcToggle state contract (only the watcher-relevant lines).
async function latcToggle(on, auto){
  LATC.on = on;
  S._vpilotAutoOn = !!(on && auto);
  if(on) S._vpilotSuppress = false; else if(!auto) S._vpilotSuppress = true;
  log.push((on ? 'START' : 'STOP') + (auto ? '(auto)' : '(manual)'));
}

const vpilotWatch = eval('(' + grab('vpilotWatch') + ')');

let pass = 0, fail = 0;
function ok(cond, msg){ if(cond){ pass++; } else { fail++; console.log('  FAIL: ' + msg); } }

(async () => {
  // 1) vPilot launches → auto-start
  vpilotUp = true; log.length = 0; await vpilotWatch();
  ok(LATC.on === true && log[0] === 'START(auto)', 'vPilot up + Live off → auto-start');

  // 2) steady state, vPilot still up, Live already on → no re-toggle
  log.length = 0; await vpilotWatch();
  ok(LATC.on === true && log.length === 0, 'vPilot up + Live on → no action');

  // 3) THE BUG: vPilot restarts within one poll (closes+reopens) → probe still reads "up".
  //    Old edge gate (!_vpilotPrev) would do nothing since _vpilotPrev was already true and stays true.
  //    New state gate: if the window died and Live got knocked off, being "up" + Live off re-arms.
  LATC.on = false;                  // simulate Live having dropped when vPilot's connection died
  log.length = 0; await vpilotWatch();
  ok(LATC.on === true && log[0] === 'START(auto)', 'vPilot restart (no edge) re-arms Live');

  // 4) vPilot closes → auto-stop, suppress cleared
  vpilotUp = false; log.length = 0; await vpilotWatch();
  ok(LATC.on === false && log[0] === 'STOP(auto)', 'vPilot closed → auto-stop');
  ok(S._vpilotSuppress === false, 'vPilot closed clears suppression');

  // 5) MANUAL Live-on, then user MANUALLY turns it off → suppressed
  await latcToggle(true, false);    // manual on
  ok(S._vpilotAutoOn === false, 'manual on does not claim auto ownership');
  await latcToggle(false, false);   // manual off
  ok(S._vpilotSuppress === true, 'manual off sets suppression');

  // 6) With vPilot still running, the watcher must NOT fight the manual off
  vpilotUp = true; LATC.on = false; log.length = 0; await vpilotWatch();
  ok(LATC.on === false && log.length === 0, 'manual off suppresses watcher re-arm while vPilot runs');

  // 7) vPilot cycles off → suppression clears; next up re-arms
  vpilotUp = false; await vpilotWatch();
  ok(S._vpilotSuppress === false, 'vPilot off clears the manual suppression');
  vpilotUp = true; log.length = 0; await vpilotWatch();
  ok(LATC.on === true && log[0] === 'START(auto)', 'after suppression clears, vPilot up re-arms');

  console.log('test_vpilot_rearm.js               ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})();
