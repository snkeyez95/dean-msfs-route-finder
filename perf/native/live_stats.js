'use strict';
// perf/native/live_stats.js — v6.12.0 LIVE OVERLAY PERF STRIP: an incremental tail over the GROWING
// PresentMon CSV (_capture_tmp.csv) so the in-flight overlay can show a rolling frametime readout
// without re-reading the file. Byte-offset resume + partial-line carry + truncation reset; a rolling
// ~60s window (expired by accumulated frametime, not wall clock — it IS the rendered time).
// Sub-millisecond work per 5s tick (~300 rows). The capture itself is never touched.
const fs = require('fs'), path = require('path');
const { pickColumn } = require('./stats.js');

const FRAMETIME_COLUMNS = ['MsBetweenPresents', 'msBetweenPresents', 'FrameTime', 'ms_between_presents', 'MsBetweenDisplayChange'];
const CPUBUSY_COLUMNS = ['MsCPUBusy', 'CPUBusy', 'msCPUBusy'];
const GPUBUSY_COLUMNS = ['MsGPUBusy', 'GPUBusy', 'msGPUBusy'];
const WINDOW_MS = 60000;          // rolling window = last ~60s of rendered frames
const MIN_SAMPLES = 30;           // below this the snapshot reports nulls (avoid a jumpy first tick)

class LiveFrametimeTail {
  constructor(csvPath) {
    this.csvPath = csvPath;
    this.offset = 0;
    this.remainder = '';
    this.cols = null;             // {fi, ci, gi} once the header has been seen
    this.ring = [];               // [{ft, cpu, gpu}] — trimmed to WINDOW_MS of summed frametime
    this.sumFt = 0;
  }
  _reset() { this.offset = 0; this.remainder = ''; this.cols = null; this.ring = []; this.sumFt = 0; }
  poll() {
    let st; try { st = fs.statSync(this.csvPath); } catch (_) { return; }
    if (st.size < this.offset) this._reset();                 // truncation → start over
    if (st.size === this.offset) return;
    let chunk;
    try {
      const fd = fs.openSync(this.csvPath, 'r');
      try {
        const buf = Buffer.alloc(Math.min(st.size - this.offset, 4 * 1024 * 1024));
        const n = fs.readSync(fd, buf, 0, buf.length, this.offset);
        this.offset += n;
        chunk = buf.slice(0, n).toString('utf8');
      } finally { fs.closeSync(fd); }
    } catch (_) { return; }
    const text = this.remainder + chunk;
    const lines = text.split('\n');
    this.remainder = lines.pop();                             // last piece may be a partial row
    let start = 0;
    if (!this.cols && lines.length) {                         // first complete line = the header
      const header = lines[0].replace(/\r$/, '').split(',');
      const fi = header.indexOf(pickColumn(header, FRAMETIME_COLUMNS));
      const ci = header.indexOf(pickColumn(header, CPUBUSY_COLUMNS));
      const gi = header.indexOf(pickColumn(header, GPUBUSY_COLUMNS));
      if (fi < 0) { this.cols = { fi: -1 }; return; }         // unusable header — stay dormant
      this.cols = { fi, ci, gi };
      start = 1;
    }
    if (!this.cols || this.cols.fi < 0) return;
    const { fi, ci, gi } = this.cols;
    for (let i = start; i < lines.length; i++) {
      const row = lines[i].split(',');
      if (row.length <= fi) continue;
      const ft = Number(row[fi]);
      if (!Number.isFinite(ft) || ft <= 0 || ft >= 1000) continue;
      const cpu = ci >= 0 && row.length > ci ? Number(row[ci]) : NaN;
      const gpu = gi >= 0 && row.length > gi ? Number(row[gi]) : NaN;
      this.ring.push({ ft, cpu: Number.isFinite(cpu) ? cpu : null, gpu: Number.isFinite(gpu) ? gpu : null });
      this.sumFt += ft;
    }
    while (this.sumFt > WINDOW_MS && this.ring.length > 1) this.sumFt -= this.ring.shift().ft;
  }
  snapshot() {
    const n = this.ring.length;
    if (n < MIN_SAMPLES) return { ft_avg: null, ft_p99: null, cpu_busy_avg: null, gpu_busy_avg: null, n };
    const r1 = x => Math.round(x * 10) / 10;
    const fts = this.ring.map(r => r.ft).sort((a, b) => a - b);
    const p99 = fts[Math.min(n - 1, Math.floor(0.99 * n))];
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const cpus = this.ring.map(r => r.cpu).filter(v => v != null);
    const gpus = this.ring.map(r => r.gpu).filter(v => v != null);
    return { ft_avg: r1(this.sumFt / n), ft_p99: r1(p99),
      cpu_busy_avg: cpus.length ? r1(mean(cpus)) : null, gpu_busy_avg: gpus.length ? r1(mean(gpus)) : null, n };
  }
}

// ── perf_live.json — the engine→app live channel (same idea as capture_status.json) ─────────────
function perfLivePath(dataRoot) { return path.join(dataRoot, 'perf_live.json'); }
// Atomic write (tmp+rename) so the app never reads a half-written JSON.
function writePerfLive(dataRoot, payload) {
  try {
    const p = perfLivePath(dataRoot), tmp = p + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(payload));
    fs.renameSync(tmp, p);
    return true;
  } catch (_) { return false; }
}
function clearPerfLive(dataRoot) { try { fs.unlinkSync(perfLivePath(dataRoot)); } catch (_) {} }
// Read + staleness gate (capture crashed / file lingering → null within maxAgeMs of last tick).
function readPerfLive(dataRoot, maxAgeMs) {
  try {
    const j = JSON.parse(fs.readFileSync(perfLivePath(dataRoot), 'utf8'));
    if (!j || !j.ts || (Date.now() - j.ts) > (maxAgeMs || 15000)) return null;
    return j;
  } catch (_) { return null; }
}

module.exports = { LiveFrametimeTail, writePerfLive, clearPerfLive, readPerfLive, perfLivePath, WINDOW_MS, MIN_SAMPLES };
