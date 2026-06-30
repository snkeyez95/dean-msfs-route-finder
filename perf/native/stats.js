'use strict';
// Phase 8a — native Node port of the engine's stats math (msfs_perf_logger.py: _percentile,
// compute_stats, parse_frametimes, _pick_column). This is a PORT, not a reimplementation — every
// number must match the Python original byte-for-byte (validated by _parity.js against the real
// Python functions over the existing flights). Keep in lockstep with msfs_perf_logger.py.
const fs = require('fs');

// --- constants (mirror msfs_perf_logger.py:82-124) ---
const TARGET_FRAMETIME_MS  = 16.67;
const STUTTER_FRAMETIME_MS = TARGET_FRAMETIME_MS * 2.0;  // 33.34
const SPIKE_FRAMETIME_MS   = 50.0;
const CONSISTENCY_BAND     = 0.20;
const MIN_VALID_MS         = 0.0;
const MAX_VALID_MS         = 1000.0;
const FRAMETIME_COLUMNS = ["MsBetweenPresents","msBetweenPresents","FrameTime","ms_between_presents","MsBetweenDisplayChange"];
const CPUBUSY_COLUMNS   = ["MsCPUBusy","CPUBusy","msCPUBusy"];
const GPUBUSY_COLUMNS   = ["MsGPUBusy","GPUBusy","msGPUBusy"];

// Python round(): round-half-to-EVEN ("banker's"). JS Math.round is half-up, so replicate the tie case.
function pyRound(x, nd){
  if(x === null || x === undefined || Number.isNaN(x)) return x;
  const m = Math.pow(10, nd);
  const y = x * m;
  const fl = Math.floor(y);
  const frac = y - fl;
  let n;
  if(Math.abs(frac - 0.5) < 1e-9) n = (fl % 2 === 0) ? fl : fl + 1;  // exact tie -> nearest even
  else n = Math.round(y);                                            // otherwise nearest (ties up, but ties handled above)
  return n / m;
}
// Strict float parse matching Python float(): trims, empty/garbage -> NaN (skip).
function pyFloat(s){ if(s == null) return NaN; const t = String(s).trim(); if(t === '') return NaN; return Number(t); }

function percentile(sorted, pct){
  if(!sorted.length) return null;
  if(sorted.length === 1) return sorted[0];
  const k = (sorted.length - 1) * (pct / 100.0);
  const lo = Math.floor(k), hi = Math.ceil(k);
  if(lo === hi) return sorted[Math.trunc(k)];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (k - lo);
}
function pstdev(vals){                      // population standard deviation (statistics.pstdev)
  const n = vals.length; if(n < 2) return 0.0;
  let sum = 0; for(const v of vals) sum += v;
  const mean = sum / n;
  let ss = 0; for(const v of vals){ const d = v - mean; ss += d * d; }
  return Math.sqrt(ss / n);
}
function pickColumn(header, candidates){
  const lookup = {}; for(const h of header) lookup[h.trim().toLowerCase()] = h;
  for(const c of candidates){ if(c.toLowerCase() in lookup) return lookup[c.toLowerCase()]; }
  return null;
}

function computeStats(frametimes, cpuBusy, gpuBusy){
  const s = frametimes.slice().sort((a, b) => a - b);
  const n = s.length;
  let sum = 0; for(const v of s) sum += v;
  const avg = sum / n;
  const p50 = percentile(s, 50), p95 = percentile(s, 95), p99 = percentile(s, 99), p999 = percentile(s, 99.9);
  const mx = s[n - 1];
  const stdev = n > 1 ? pstdev(s) : 0.0;
  const low = p50 * (1 - CONSISTENCY_BAND), high = p50 * (1 + CONSISTENCY_BAND);
  let inBand = 0; for(const v of s){ if(v >= low && v <= high) inBand++; }
  let stutter = 0, spikes = 0; for(const v of s){ if(v > STUTTER_FRAMETIME_MS) stutter++; if(v > SPIKE_FRAMETIME_MS) spikes++; }
  const duration = sum / 1000.0;
  const stats = {
    avg_ft_ms: pyRound(avg, 2), p50_ft_ms: pyRound(p50, 2), p95_ft_ms: pyRound(p95, 2),
    p99_ft_ms: pyRound(p99, 2), p999_ft_ms: pyRound(p999, 2), max_ft_ms: pyRound(mx, 2),
    frametime_stdev_ms: pyRound(stdev, 2), consistency_pct: pyRound(inBand / n * 100, 1),
    stutter_pct: pyRound(stutter / n * 100, 2), stutter_count: stutter, spike_count: spikes,
    one_pct_low_fps: p99 ? pyRound(1000.0 / p99, 1) : null,
    point_one_pct_low_fps: p999 ? pyRound(1000.0 / p999, 1) : null,
    avg_fps: pyRound(1000.0 / avg, 1), frame_count: n, duration_seconds: pyRound(duration, 1),
  };
  if(cpuBusy && gpuBusy && cpuBusy.length === gpuBusy.length && cpuBusy.length){
    let gpuBound = 0; for(let i = 0; i < cpuBusy.length; i++){ if(gpuBusy[i] >= cpuBusy[i]) gpuBound++; }
    stats.gpu_bound_pct = pyRound(gpuBound / cpuBusy.length * 100, 1);
    stats.cpu_bound_pct = pyRound((1 - gpuBound / cpuBusy.length) * 100, 1);
    let cs = 0; for(const v of cpuBusy) cs += v; stats.avg_cpu_busy_ms = pyRound(cs / cpuBusy.length, 2);
    let gs = 0; for(const v of gpuBusy) gs += v; stats.avg_gpu_busy_ms = pyRound(gs / gpuBusy.length, 2);
  } else { stats.gpu_bound_pct = null; stats.cpu_bound_pct = null; }
  return stats;
}

function parseFrametimes(csvPath){
  let data; try { data = fs.readFileSync(csvPath, 'utf8'); } catch(e){ return null; }
  const nl = data.indexOf('\n');
  if(nl < 0) return null;
  const header = data.slice(0, nl).replace(/\r$/, '').split(',');
  const ftCol = pickColumn(header, FRAMETIME_COLUMNS);
  const cpuCol = pickColumn(header, CPUBUSY_COLUMNS);
  const gpuCol = pickColumn(header, GPUBUSY_COLUMNS);
  if(ftCol === null) return null;
  const idx = {}; header.forEach((h, i) => idx[h] = i);
  const fi = idx[ftCol], ci = cpuCol != null ? idx[cpuCol] : undefined, gi = gpuCol != null ? idx[gpuCol] : undefined;
  const ft = [], cpu = [], gpu = [];
  let pos = nl + 1;
  const len = data.length;
  while(pos < len){
    let end = data.indexOf('\n', pos);
    if(end < 0) end = len;
    let line = data.slice(pos, end);
    pos = end + 1;
    if(line.endsWith('\r')) line = line.slice(0, -1);
    if(!line) continue;
    const row = line.split(',');
    if(row.length <= fi) continue;
    const val = pyFloat(row[fi]);
    if(Number.isNaN(val)) continue;
    if(val <= MIN_VALID_MS || val >= MAX_VALID_MS) continue;
    ft.push(val);
    if(ci !== undefined && row.length > ci){ const c = pyFloat(row[ci]); if(!Number.isNaN(c)) cpu.push(c); }
    if(gi !== undefined && row.length > gi){ const g = pyFloat(row[gi]); if(!Number.isNaN(g)) gpu.push(g); }
  }
  if(!ft.length) return null;
  return computeStats(ft, cpu, gpu);
}

module.exports = { computeStats, parseFrametimes, percentile, pstdev, pyRound, pickColumn };
