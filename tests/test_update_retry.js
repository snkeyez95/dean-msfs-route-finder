'use strict';
// Auto-update resilience (v6.19.3).
//
// Why this file exists (Dean, 2026-08-12): release.bat published v6.19.2 correctly — tag, installer,
// latest.yml, all three assets uploaded — and his installed app sat on 6.19.1 with no update prompt.
// The log showed the whole story in three lines: "[AU] Checking for update" at launch, then
// net::ERR_HTTP2_SERVER_REFUSED_STREAM 189ms later, then nothing. The update check ran ONCE at
// did-finish-load; a single transient network refusal from GitHub stranded him for the entire session
// and looked exactly like a failed release.
//
// These tests run the REAL checkForUpdate out of main.js against a mock electron-updater and a fake
// clock, and assert the recovery behaviour: a failed check retries with backoff, retries actually
// re-run, listeners never stack, a release published while the app is open is still noticed, and a
// downloaded update stops everything. The last block replays Dean's exact failure end-to-end and
// asserts the renderer receives the events that drive the update banner — the thing he'd see.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner();

const mainSrc = fs.readFileSync(path.join(X.ROOT, 'main.js'), 'utf8');

// Lift the real constants + state + functions out of main.js. If any of these move or get renamed,
// this throws loudly rather than silently testing a reconstruction.
function grabLine(re){
  const m = re.exec(mainSrc);
  if(!m) throw new Error('line not found: ' + re);
  return m[0];
}

// A controllable clock. Nothing here uses real time, so the 2h poll is testable in microseconds.
function makeClock(){
  let now = 0, seq = 0;
  const timers = new Map();
  const api = {
    now: () => now,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, {fn, at: now + ms, every: 0, unrefd: false}); return mkHandle(id); },
    setInterval: (fn, ms) => { const id = ++seq; timers.set(id, {fn, at: now + ms, every: ms, unrefd: false}); return mkHandle(id); },
    clearTimeout: h => { if(h && h.__id) timers.delete(h.__id); },
    clearInterval: h => { if(h && h.__id) timers.delete(h.__id); },
    pending: () => [...timers.values()],
    // Advance the clock, firing everything due. Returns how many callbacks ran.
    advance: (ms) => {
      const target = now + ms; let ran = 0;
      for(;;){
        let next = null;
        for(const [id, t] of timers) if(t.at <= target && (!next || t.at < next[1].at)) next = [id, t];
        if(!next) break;
        const [id, t] = next;
        now = t.at;
        if(t.every) t.at = now + t.every; else timers.delete(id);
        t.fn(); ran++;
      }
      now = target;
      return ran;
    }
  };
  function mkHandle(id){
    return { __id: id, unref(){ const t = timers.get(id); if(t) t.unrefd = true; return this; } };
  }
  return api;
}

// Build a fresh, fully isolated copy of the real update code for each scenario.
function harness(){
  const clock = makeClock();
  const logs = [];
  const sent = [];              // what the renderer would receive → the update banner
  const listeners = {};         // event name -> array of handlers (stacking is a real bug we test for)
  let checkCalls = 0;
  let nextResult = { ok: true };   // what the NEXT checkForUpdates() call does

  const autoUpdater = {
    logger: null, autoDownload: null, autoInstallOnAppQuit: null,
    on(evt, fn){ (listeners[evt] = listeners[evt] || []).push(fn); },
    checkForUpdates(){
      checkCalls++;
      const r = nextResult;
      if(r.ok) return Promise.resolve({ updateInfo: { version: r.version || '0.0.0' } });
      return Promise.reject(new Error(r.error || 'boom'));
    },
    // test helpers — fire an event the way electron-updater would
    emit(evt, arg){ for(const fn of (listeners[evt] || [])) fn(arg); }
  };

  const src = [
    grabLine(/^const AU_RETRY_MS = .*$/m),
    grabLine(/^const AU_POLL_MS  = .*$/m),
    grabLine(/^let _auWired = .*$/m),
    X.grab('_auStopTimers', mainSrc),
    X.grab('checkForUpdate', mainSrc),
    'return { checkForUpdate, state: () => ({ wired: _auWired, fails: _auFails, done: _auDone,' +
    ' retry: _auRetryTimer, poll: _auPollTimer }) };'
  ].join('\n');

  const fn = new Function('require', 'app', 'LOG', 'win', 'setTimeout', 'setInterval',
                          'clearTimeout', 'clearInterval', src);
  const mod = fn(
    (name) => { if(name === 'electron-updater') return { autoUpdater }; throw new Error('unexpected require: ' + name); },
    { isPackaged: true },
    { info: (...a) => logs.push(a.join(' ')), warn: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push(a.join(' ')) },
    { isDestroyed: () => false, webContents: { send: (ch, v) => sent.push(ch + ':' + v) } },
    clock.setTimeout, clock.setInterval, clock.clearTimeout, clock.clearInterval
  );

  return {
    clock, logs, sent, listeners, autoUpdater, mod,
    calls: () => checkCalls,
    fail: (msg) => { nextResult = { ok: false, error: msg }; },
    succeed: (v) => { nextResult = { ok: true, version: v }; },
    // let the pending .then/.catch microtasks run
    settle: () => new Promise(r => setImmediate(r))
  };
}

(async function main(){

console.log('the bug: a failed check must not end the session:');
{
  const h = harness();
  h.fail('net::ERR_HTTP2_SERVER_REFUSED_STREAM');   // Dean's exact error
  h.mod.checkForUpdate();
  await h.settle();

  T('1. the check ran once', h.calls() === 1, String(h.calls()));
  T('   …the failure was logged, not swallowed', h.logs.some(l => /Check failed/.test(l)));
  T('   …a RETRY is scheduled (the old code stopped here forever)', !!h.mod.state().retry);
  T('   …the retry is 15s out, not next session', h.clock.pending().some(t => t.at === 15e3));

  // Nothing should happen before the backoff elapses.
  h.clock.advance(14e3);
  T('2. no retry before the backoff elapses', h.calls() === 1, String(h.calls()));

  // GitHub is fine on the second attempt — the normal case for a transient HTTP/2 refusal.
  h.succeed('6.19.2');
  h.clock.advance(2e3);
  await h.settle();
  T('   …the retry actually re-runs the check', h.calls() === 2, String(h.calls()));
  T('   …and a good check clears the failure count', h.mod.state().fails === 0, String(h.mod.state().fails));
}

console.log('\nbackoff + caps:');
{
  const h = harness();
  h.fail('down');
  h.mod.checkForUpdate(); await h.settle();
  const waits = [];
  // Walk four consecutive failures and record the gap the code chose each time.
  for(let i = 0; i < 4; i++){
    const t = h.clock.pending().find(x => !x.every);      // the retry timer (not the poll interval)
    waits.push(t.at - h.clock.now());
    h.clock.advance(t.at - h.clock.now()); await h.settle();
  }
  T('3. backoff grows 15s → 60s → 180s → 600s', waits.join(',') === '15000,60000,180000,600000', waits.join(','));
  const t5 = h.clock.pending().find(x => !x.every);
  T('   …then caps at 600s instead of growing forever', t5.at - h.clock.now() === 600e3, String(t5.at - h.clock.now()));
  T('   …and it is still retrying after 5 failures', h.calls() === 5, String(h.calls()));
}

console.log('\nno listener stacking (checkForUpdate is now re-entrant):');
{
  const h = harness();
  h.fail('x');
  h.mod.checkForUpdate(); await h.settle();
  for(let i = 0; i < 5; i++){ h.clock.advance(600e3); await h.settle(); }
  T('4. update-available handler registered exactly once', h.listeners['update-available'].length === 1,
    String(h.listeners['update-available'].length));
  T('   …update-downloaded too', h.listeners['update-downloaded'].length === 1,
    String(h.listeners['update-downloaded'].length));
  T('   …error too', h.listeners['error'].length === 1, String(h.listeners['error'].length));
  // A duplicated handler would fire the renderer banner N times for one update.
  h.autoUpdater.emit('update-available', { version: '6.19.2' });
  T('   …so one update sends the renderer ONE banner event',
    h.sent.filter(s => s === 'update-available:6.19.2').length === 1, h.sent.join('|'));
}

console.log('\nrelease published while ABRP is already open (Dean runs release.bat with the app up):');
{
  const h = harness();
  h.succeed('6.19.1');            // first check: nothing new yet, release not cut
  h.mod.checkForUpdate(); await h.settle();
  T('5. a slow re-check timer exists after a clean check', !!h.mod.state().poll);
  const poll = h.clock.pending().find(t => t.every);
  T('   …it repeats (interval, not one-shot)', !!poll && poll.every === 2 * 60 * 60 * 1000, poll && String(poll.every));

  h.clock.advance(2 * 60 * 60 * 1000); await h.settle();
  T('   …and it re-checks 2h later without a restart', h.calls() === 2, String(h.calls()));
}

console.log('\nstop once the update is in hand:');
{
  const h = harness();
  h.fail('x');
  h.mod.checkForUpdate(); await h.settle();
  T('6. timers are live while hunting', !!h.mod.state().retry && !!h.mod.state().poll);

  h.autoUpdater.emit('update-downloaded', { version: '6.19.2' });
  T('   …update-downloaded clears the retry timer', !h.mod.state().retry);
  T('   …and the 2h poll', !h.mod.state().poll);
  T('   …no timers left pending at all', h.clock.pending().length === 0, String(h.clock.pending().length));

  const before = h.calls();
  h.mod.checkForUpdate();
  T('   …further checks are no-ops (nothing left to find)', h.calls() === before, String(h.calls()));
  T('   …renderer was told to show the restart prompt',
    h.sent.includes('update-downloaded:6.19.2'), h.sent.join('|'));
}

console.log('\ntimers must never hold the app open at quit:');
{
  const h = harness();
  h.fail('x');
  h.mod.checkForUpdate(); await h.settle();
  const all = h.clock.pending();
  T('7. every scheduled timer is unref\'d', all.length > 0 && all.every(t => t.unrefd),
    all.map(t => t.unrefd).join(','));
}

// The end-to-end replay: this is the sequence that failed on Dean's machine, start to finish.
console.log("\nend-to-end — replaying Dean's 2026-08-12 failure:");
{
  const h = harness();
  h.fail('net::ERR_HTTP2_SERVER_REFUSED_STREAM');
  h.mod.checkForUpdate(); await h.settle();
  T('8. launch check fails exactly as his log shows', h.calls() === 1 && h.logs.some(l => /ERR_HTTP2_SERVER_REFUSED_STREAM/.test(l)));
  T('   …app is NOT stranded — a retry is armed', !!h.mod.state().retry);

  h.succeed('6.19.2');
  h.clock.advance(15e3); await h.settle();
  h.autoUpdater.emit('update-available',  { version: '6.19.2' });
  h.autoUpdater.emit('update-downloaded', { version: '6.19.2' });

  T('   …within 15s the update is found and the banner fires',
    h.sent.includes('update-available:6.19.2'), h.sent.join('|'));
  T('   …and the silent-update restart prompt follows',
    h.sent.includes('update-downloaded:6.19.2'), h.sent.join('|'));
  T('   …everything shuts down cleanly afterwards', h.clock.pending().length === 0);
}

// Guard the settings the silent auto-update depends on (v6.3.2) — a regression here would put the
// NSIS wizard back in front of Dean.
console.log('\nsilent-update settings still intact:');
{
  const h = harness();
  h.succeed('6.19.2');
  h.mod.checkForUpdate(); await h.settle();
  T('9. autoDownload on', h.autoUpdater.autoDownload === true);
  T('   …autoInstallOnAppQuit on (installs even if he clicks Later)', h.autoUpdater.autoInstallOnAppQuit === true);
  T('   …logger wired to the app log', !!h.autoUpdater.logger && typeof h.autoUpdater.logger.error === 'function');
}

process.exit(T.done() ? 1 : 0);
})();
