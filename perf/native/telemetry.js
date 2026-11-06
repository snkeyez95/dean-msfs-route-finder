'use strict';
// perf/native/telemetry.js — 1 Hz system telemetry: (sys_cpu%, sys_ram%, busiest non-MSFS process,
// its cpu%). Native replacement for _make_system_sampler (psutil), via a SINGLE streaming typeperf
// process (built-in Windows perf tool) so it adds no per-second spawns to the capture. One stream
// yields all three: \Process(*)\% Processor Time (top process), \Processor(_Total) (sys cpu),
// \Memory\Available MBytes (sys ram, matching psutil's "available"-based percent).
const { spawn } = require('child_process');
const os = require('os');

// process instance names to skip (match Python's ignore set + the pseudo-counters)
const IGNORE = new Set(['_total', 'idle', 'system', 'secure system', 'memory compression',
                        'registry', 'flightsimulator2024', 'typeperf']);

// v6.26.2 (Dean 2026-11-06, EHAM-LOWW): typeperf can go DEAD mid-session — every sample came back with
// \Processor(_Total) at 0 for the whole 1h51m flight (sys_cpu logged 0%) while one process column
// (gameoverlayui64) read a constant ~30%. The counters worked again right after, so it's a session
// glitch. A capture only runs while MSFS is up, so a real system load under CPU_DEAD_PCT is impossible:
// treat it as no reading (blank, never a fake 0%) and, after DEAD_RESTART_S such samples in a row,
// restart typeperf — a fresh session normally reads fine.
const CPU_DEAD_PCT = 2.0;
const DEAD_RESTART_S = 30;
const MAX_RESTARTS = 5;

class TelemetrySampler {
  constructor(selfNames = [], log = null) {
    this.ncpu = os.cpus().length || 1;
    this.totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    this._proc = null;
    this._buf = '';
    this._procCols = null;      // {colIndex: instanceName}
    this._cpuCol = -1;
    this._memCol = -1;
    this._idleCol = -1;         // \Process(Idle)\% Processor Time — the sys-cpu FALLBACK source
    this._warnedNoCpu = false;
    this._warnedBadMem = false;
    this._log = typeof log === 'function' ? log : (() => {});
    this._latest = [null, null, '', null];
    this._deadStreak = 0;
    this._restarts = 0;
    this._ignore = new Set([...IGNORE, ...selfNames.map(s => s.toLowerCase())]);
  }

  start() {
    if (this._proc) return;
    const proc = this._proc = spawn('typeperf',
      ['\\Process(*)\\% Processor Time', '\\Processor(_Total)\\% Processor Time',
       '\\Memory\\Available MBytes', '-si', '1'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });   // stderr ignored: an unread pipe can wedge the child
    proc.stdout.on('data', (d) => {
      if (this._proc !== proc) return;               // output from a typeperf we already restarted away from
      this._buf += d.toString();
      let nl;
      while ((nl = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, nl); this._buf = this._buf.slice(nl + 1);
        this._onLine(line.trim());
      }
    });
    proc.on('error', () => {});
  }

  // Kill the dead typeperf and start a fresh one; header parsing starts over.
  _restart() {
    this._restarts++;
    this._log('[telemetry] CPU readings went dead (' + DEAD_RESTART_S + ' s of blank/0% system CPU) — restarting the reader (' +
      this._restarts + '/' + MAX_RESTARTS + '); samples meanwhile are left blank, not 0%');
    const old = this._proc; this._proc = null;
    try { if (old) old.kill(); } catch (_) {}
    this._buf = ''; this._procCols = null; this._cpuCol = -1; this._memCol = -1; this._idleCol = -1;
    this._deadStreak = 0;
    this.start();
  }

  _cells(line) {
    return line.split('","').map(c => c.replace(/^"|"$/g, ''));   // "a","b" -> [a,b]
  }

  _onLine(line) {
    if (!line || line[0] !== '"') return;
    const cells = this._cells(line);
    if (this._procCols === null) {                 // header row
      if (!/PDH-CSV/.test(cells[0])) return;
      this._procCols = {};
      for (let i = 1; i < cells.length; i++) {
        const c = cells[i]; let m;
        if ((m = /\\Process\(([^)]*)\)\\% Processor Time/i.exec(c))) {
          this._procCols[i] = m[1];
          if (/^idle$/i.test(m[1])) this._idleCol = i;   // remember Idle for the sys-cpu fallback
        }
        else if (/\\Processor\(_Total\)\\% Processor Time/i.test(c)) this._cpuCol = i;
        else if (/\\Memory\\Available MBytes/i.test(c)) this._memCol = i;
      }
      // Windows can transiently disable the Processor counter library at typeperf launch (self-heals
      // next session); typeperf then silently omits \Processor(_Total) from the header while the
      // Process + Memory counters stay. When that happens, derive sys-cpu from the Idle process
      // (100 − Idle%/ncpu) — a different counter library that isn't affected — so the column never
      // goes blank. Warn once so a recurrence is visible in native_capture.log, not found weeks later.
      if (this._cpuCol < 0) {
        this._log(this._idleCol >= 0
          ? '[telemetry] \\Processor(_Total) counter unavailable this session — deriving sys_cpu from Process(Idle) (Windows perf-counter glitch; usually self-heals)'
          : '[telemetry] \\Processor(_Total) counter unavailable AND no Idle column — sys_cpu will be blank this session (run "lodctr /R" if it persists)');
      }
      return;
    }
    const num = i => { const v = parseFloat(cells[i]); return Number.isFinite(v) ? v : 0; };
    const val = i => { const v = parseFloat(cells[i]); return Number.isFinite(v) ? v : null; };   // blank → null, never 0
    let sysCpu = null;
    if (this._cpuCol >= 0 && val(this._cpuCol) != null) sysCpu = Math.round(val(this._cpuCol) * 10) / 10;
    else if (this._idleCol >= 0 && val(this._idleCol) != null) {   // fallback: 100 − idle-fraction
      sysCpu = Math.round(Math.max(0, Math.min(100, 100 - val(this._idleCol) / this.ncpu)) * 10) / 10;
    }
    const dead = sysCpu == null || sysCpu < CPU_DEAD_PCT;   // impossible while MSFS runs → the counters are dead
    let sysRam = null;
    if (this._memCol >= 0 && this.totalMemMb) {
      // Guard the stuck-100% bug (Dean 2026-10-05): a transient/disabled \Memory\Available MBytes counter
      // returns blank or non-numeric; num() would coerce that to 0 → "0 MB free" → a FALSE 100% RAM. (3
      // flights logged 99.9% for the whole flight while identical routes/aircraft read ~45%.) A running
      // flight never has 0 MB available — Windows thrashes long before that — so a non-finite, <=0, or
      // >total read is a glitch: leave sysRam null (blank in telemetry) rather than a false 100%.
      const availMb = parseFloat(cells[this._memCol]);
      if (Number.isFinite(availMb) && availMb > 0 && availMb <= this.totalMemMb) {
        sysRam = Math.round((this.totalMemMb - availMb) / this.totalMemMb * 1000) / 10;
      } else if (!this._warnedBadMem) {
        this._warnedBadMem = true;
        this._log('[telemetry] \\Memory\\Available MBytes returned a bad value ("' + cells[this._memCol] +
          '") — sys_ram left blank this sample (Windows perf-counter glitch; run "lodctr /R" if it persists)');
      }
    }
    let topName = '', topCpu = 0;                  // busiest non-ignored process (normalized to whole-system %)
    for (const i in this._procCols) {
      const base = this._procCols[i].replace(/#\d+$/, '').toLowerCase();
      if (this._ignore.has(base)) continue;
      const v = num(i) / this.ncpu;
      if (v > topCpu) { topCpu = v; topName = this._procCols[i].replace(/#\d+$/, ''); }
    }
    // dead sample: the CPU columns are untrustworthy (the per-process ones too — EHAM-LOWW showed a
    // phantom constant top process), so leave them all blank; RAM is a separate counter and stays.
    this._latest = dead ? [null, sysRam, '', null]
      : [sysCpu, sysRam, topName ? topName + '.exe' : '', topName ? Math.round(topCpu * 10) / 10 : null];
    if (dead) {
      if (++this._deadStreak >= DEAD_RESTART_S && this._restarts < MAX_RESTARTS && this._proc) this._restart();
    } else this._deadStreak = 0;
  }

  latest() { return this._latest.slice(); }   // [sys_cpu, sys_ram, top_proc, top_proc_cpu]
  stop() { if (this._proc) { try { this._proc.kill(); } catch (_) {} this._proc = null; } }
}

module.exports = { TelemetrySampler, CPU_DEAD_PCT, DEAD_RESTART_S, MAX_RESTARTS };
