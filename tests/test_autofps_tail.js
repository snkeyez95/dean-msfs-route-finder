'use strict';
// v6.12.9 — the overlay's live TLOD field blinked because the AutoFPS log tail window (4 KB) was
// SMALLER than the median gap between UpdateVariables lines on a real Debug-level log (~4.7 KB).
// Proven against Dean's real log; the fix is a 128 KB window.
const fs = require('fs'), path = require('path'), os = require('os');
const X = require('./lib/extract.js');
const A = require(path.join(X.ROOT, 'perf', 'native', 'autofps_log.js'));
const T = X.runner();
const REAL = path.join(process.env.APPDATA || '', 'MSFS_AutoFPS', 'log');

// ── the fix is present ──────────────────────────────────────────────────────
const src = fs.readFileSync(path.join(X.ROOT, 'perf', 'native', 'autofps_log.js'), 'utf8');
T('TAIL_BYTES exists and is 128 KB', /const TAIL_BYTES = 131072;/.test(src));
T('the 4096 literal is gone', !/Math\.min\(st\.size, 4096\)/.test(src));
T('the read uses TAIL_BYTES', /Math\.min\(st\.size, TAIL_BYTES\)/.test(src));

// ── behaviour, against a log we control ─────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'afps-'));
function writeLog(when, tlod, padKB){
  const d = when, p2 = n => String(n).padStart(2, '0');
  const name = 'MSFS_AutoFPS' + d.getFullYear() + p2(d.getMonth() + 1) + p2(d.getDate()) + '.log';
  const stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + ' ' +
                p2(d.getHours()) + ':' + p2(d.getMinutes()) + ':' + p2(d.getSeconds()) + '.000';
  // EXACT real format — nested brackets + padded component name (verified against the live log).
  const line = stamp + ' [INF] [ LODController:UpdateVariables    ] Mode:FSR3 FPS:60 Pri:TLOD TLOD:' + tlod +
               ' TLODRng:125-700 OLOD:120 AGL:763 FPM:-785 GPU:59% VRAM:75%';
  const pad = ('x'.repeat(120) + '\n').repeat(Math.round(padKB * 1024 / 121));
  fs.writeFileSync(path.join(tmp, name), 'header\n' + line + '\n' + pad);
}
const clean = () => { fs.rmSync(tmp, {recursive:true, force:true}); fs.mkdirSync(tmp, {recursive:true}); };

writeLog(new Date(), 514, 60);
const r1 = A.tailLatest(tmp, 60);
T('a fresh reading buried under 60 KB of Debug noise is FOUND (the bug)', !!(r1 && r1.tlod === 514), JSON.stringify(r1));
clean(); writeLog(new Date(), 514, 300);
T('a reading beyond even the 128 KB window -> null (never a stale lie)', A.tailLatest(tmp, 60) === null);
clean(); writeLog(new Date(Date.now() - 600000), 300, 10);
T('a 10-minute-old reading -> null (staleness still governs)', A.tailLatest(tmp, 60) === null);
clean(); writeLog(new Date(Date.now() - 20000), 316, 10);
const r2 = A.tailLatest(tmp, 60);
T('a 20s-old reading inside maxAgeS -> returned with its age', !!(r2 && r2.tlod === 316 && r2.ageS >= 18 && r2.ageS <= 23), JSON.stringify(r2));
clean();
T('no log files at all -> null, no throw', A.tailLatest(tmp, 60) === null);
fs.rmSync(tmp, {recursive:true, force:true});

// ── the real-log hit-rate regression ────────────────────────────────────────
let files = [];
try { files = fs.readdirSync(REAL).filter(f => /^MSFS_AutoFPS\d{8}\.log$/.test(f)).sort(); } catch(_){}
if(!files.length){
  console.log('\n  (skipped the real-log hit-rate check — no AutoFPS logs on this machine)');
} else {
  const buf = fs.readFileSync(path.join(REAL, files[files.length - 1]));
  const lines = buf.toString('utf8').split(/\r?\n/);
  const marks = []; let off = 0;
  for(const ln of lines){ const b = Buffer.byteLength(ln, 'utf8') + 1; if(A.LINE_RE.exec(ln)) marks.push(off + b); off += b; }
  const hitRate = W => {
    let hit = 0, miss = 0;
    for(let i = 1; i < marks.length; i++){
      const pollAt = marks[i] - 1, winStart = Math.max(0, pollAt - W);
      let found = false;
      for(let k = i - 1; k >= 0; k--){ if(marks[k] <= pollAt && marks[k] > winStart){ found = true; break; } if(marks[k] <= winStart) break; }
      found ? hit++ : miss++;
    }
    return (hit + miss) ? hit / (hit + miss) * 100 : 100;
  };
  if(marks.length > 50){
    const old4 = hitRate(4096), now = hitRate(131072);
    console.log('\n  real log ' + files[files.length - 1] + ' (' + (buf.length / 1048576).toFixed(1) + ' MB, ' + marks.length + ' TLOD lines)');
    console.log('  worst-case poll hit-rate:  4 KB (old) ' + old4.toFixed(1) + '%   128 KB (new) ' + now.toFixed(1) + '%');
    T('the old 4 KB window genuinely failed here (<60%)', old4 < 60, old4.toFixed(1) + '%');
    T('128 KB finds a reading essentially always (>=99%)', now >= 99, now.toFixed(1) + '%');
  } else {
    console.log('\n  (real log has too few TLOD lines to measure — needs an AutoFPS flight)');
  }
  const t0 = process.hrtime.bigint();
  for(let i = 0; i < 50; i++) A.tailLatest(REAL, 999999);
  const ms = Number(process.hrtime.bigint() - t0) / 1e6 / 50;
  console.log('  cost: ' + ms.toFixed(2) + ' ms per call (once per 5s, only while recording)');
  T('cost is negligible (<15 ms)', ms < 15, ms.toFixed(2) + 'ms');
}
process.exit(T.done() ? 1 : 0);
