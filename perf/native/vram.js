'use strict';
// perf/native/vram.js — VRAM sampler. Native replacement for the Python VRAMSampler (pynvml), via a
// SINGLE streaming nvidia-smi process (--loop-ms) rather than one spawn per second, so it doesn't add
// CPU blips to the very frametimes being captured. Device memory.used == pynvml mem.used (same figure,
// ~±1 MiB). summarize() matches the Python vram.summarize() shape + math exactly.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs'), path = require('path');
const { pyRound } = require('./stats.js');

function nvidiaSmi() {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const p = path.join(sys, 'System32', 'nvidia-smi.exe');
  return fs.existsSync(p) ? p : 'nvidia-smi';
}

class VramSampler {
  constructor(intervalMs = 1000) {
    this.interval = intervalMs;
    this.samples = [];          // memory.used in MiB, one per tick
    this.totalMb = null;
    this.available = false;
    this._proc = null;
    this._buf = '';
    this._exe = nvidiaSmi();
    try {                        // probe total VRAM + availability up front
      const r = spawnSync(this._exe, ['--query-gpu=memory.total', '--format=csv,noheader,nounits'],
        { encoding: 'utf8', timeout: 8000, windowsHide: true });
      const total = parseInt((r.stdout || '').trim().split(/\r?\n/)[0], 10);
      if (Number.isFinite(total)) { this.totalMb = total; this.available = true; }
    } catch (_) { this.available = false; }
  }

  start() {
    if (!this.available || this._proc) return;
    this._proc = spawn(this._exe,
      ['--query-gpu=memory.used', '--format=csv,noheader,nounits', '--loop-ms=' + this.interval],
      { windowsHide: true });
    this._proc.stdout.on('data', (d) => {
      this._buf += d.toString();
      let nl;
      while ((nl = this._buf.indexOf('\n')) >= 0) {
        const line = this._buf.slice(0, nl).trim();
        this._buf = this._buf.slice(nl + 1);
        const v = parseInt(line, 10);
        if (Number.isFinite(v)) this.samples.push(v);
      }
    });
    this._proc.on('error', () => {});   // if it dies, we just have fewer samples (summarize handles it)
  }

  latest() { return this.samples.length ? this.samples[this.samples.length - 1] : null; }

  stop() {
    if (this._proc) { try { this._proc.kill(); } catch (_) {} this._proc = null; }
  }

  summarize() {
    if (!this.available || !this.samples.length) {
      return { available: false, avg_vram_mb: null, peak_vram_mb: null,
               total_vram_mb: this.totalMb, peak_pct: null, sample_count: 0 };
    }
    const avg = Math.trunc(this.samples.reduce((a, b) => a + b, 0) / this.samples.length);   // int()
    const peak = Math.max(...this.samples);
    const pct = this.totalMb ? pyRound(peak / this.totalMb * 100, 1) : null;                 // round(.,1)
    return { available: true, avg_vram_mb: avg, peak_vram_mb: peak,
             total_vram_mb: this.totalMb, peak_pct: pct, sample_count: this.samples.length };
  }
}

module.exports = { VramSampler, nvidiaSmi };
