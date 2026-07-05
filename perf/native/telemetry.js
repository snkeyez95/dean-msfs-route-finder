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

class TelemetrySampler {
  constructor(selfNames = []) {
    this.ncpu = os.cpus().length || 1;
    this.totalMemMb = Math.round(os.totalmem() / (1024 * 1024));
    this._proc = null;
    this._buf = '';
    this._procCols = null;      // {colIndex: instanceName}
    this._cpuCol = -1;
    this._memCol = -1;
    this._latest = [null, null, '', null];
    this._ignore = new Set([...IGNORE, ...selfNames.map(s => s.toLowerCase())]);
  }

  start() {
    if (this._proc) return;
    this._proc = spawn('typeperf',
      ['\\Process(*)\\% Processor Time', '\\Processor(_Total)\\% Processor Time',
       '\\Memory\\Available MBytes', '-si', '1'],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] });   // stderr ignored: an unread pipe can wedge the child
    this._proc.stdout.on('data', (d) => {
      this._buf += d.toString();
      let nl;
      while ((nl = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, nl); this._buf = this._buf.slice(nl + 1);
        this._onLine(line.trim());
      }
    });
    this._proc.on('error', () => {});
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
        if ((m = /\\Process\(([^)]*)\)\\% Processor Time/i.exec(c))) this._procCols[i] = m[1];
        else if (/\\Processor\(_Total\)\\% Processor Time/i.test(c)) this._cpuCol = i;
        else if (/\\Memory\\Available MBytes/i.test(c)) this._memCol = i;
      }
      return;
    }
    const num = i => { const v = parseFloat(cells[i]); return Number.isFinite(v) ? v : 0; };
    const sysCpu = this._cpuCol >= 0 ? Math.round(num(this._cpuCol) * 10) / 10 : null;
    let sysRam = null;
    if (this._memCol >= 0 && this.totalMemMb) {
      sysRam = Math.round((this.totalMemMb - num(this._memCol)) / this.totalMemMb * 1000) / 10;
    }
    let topName = '', topCpu = 0;                  // busiest non-ignored process (normalized to whole-system %)
    for (const i in this._procCols) {
      const base = this._procCols[i].replace(/#\d+$/, '').toLowerCase();
      if (this._ignore.has(base)) continue;
      const v = num(i) / this.ncpu;
      if (v > topCpu) { topCpu = v; topName = this._procCols[i].replace(/#\d+$/, ''); }
    }
    this._latest = [sysCpu, sysRam, topName ? topName + '.exe' : '',
                    topName ? Math.round(topCpu * 10) / 10 : null];
  }

  latest() { return this._latest.slice(); }   // [sys_cpu, sys_ram, top_proc, top_proc_cpu]
  stop() { if (this._proc) { try { this._proc.kill(); } catch (_) {} this._proc = null; } }
}

module.exports = { TelemetrySampler };
