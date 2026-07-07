'use strict';
// Phase 8a (report) — native port of the report chart/data helpers (msfs_perf_logger.py:1515-1692):
// _svg_perf_line, _chart_frametime_series, _rolling_mean_series, _variance_bins, _phase_bars_html,
// + _read_csv_chronological. PORT — must match Python (validated by _parity_charts.js). Python's
// :.Nf formatting is round-half-to-even, so all coordinate/number formatting goes through fmt().
const fs = require('fs'), path = require('path');
const { pyRound, pySum } = require('./stats.js');

const TARGET_FRAMETIME_MS = 16.67;
const STUTTER_FRAMETIME_MS = TARGET_FRAMETIME_MS * 2.0;
const MIN_VALID_MS = 0.0, MAX_VALID_MS = 1000.0;
const HEAD_TRIM_S = 5, ALT_SANE_FT = 45000;
const FRAMETIME_COLUMNS = ["MsBetweenPresents", "msBetweenPresents", "FrameTime", "ms_between_presents", "MsBetweenDisplayChange"];
const CPUBUSY_COLUMNS = ["MsCPUBusy", "CPUBusy", "msCPUBusy"];
const GPUBUSY_COLUMNS = ["MsGPUBusy", "GPUBusy", "msGPUBusy"];

function fmt(x, n){ return pyRound(x, n).toFixed(n); }   // == Python f"{x:.Nf}"
function pyFloat(s){ if(s == null) return NaN; const t = String(s).trim(); if(t === '') return NaN; return Number(t); }
function pickColumn(header, cands){ const m = {}; for(const h of header) m[h.trim().toLowerCase()] = h; for(const c of cands) if(c.toLowerCase() in m) return m[c.toLowerCase()]; return null; }

function readChronological(csvPath){
  const ft = [], cpu = [], gpu = [];
  let data; try { data = fs.readFileSync(csvPath, 'utf8'); } catch(e){ return { ft, cpu, gpu }; }
  const nl = data.indexOf('\n'); if(nl < 0) return { ft, cpu, gpu };
  const header = data.slice(0, nl).replace(/\r$/, '').split(',');
  const ftCol = pickColumn(header, FRAMETIME_COLUMNS); if(ftCol == null) return { ft, cpu, gpu };
  const cpuCol = pickColumn(header, CPUBUSY_COLUMNS), gpuCol = pickColumn(header, GPUBUSY_COLUMNS);
  const idx = {}; header.forEach((h, i) => idx[h] = i);
  const fi = idx[ftCol], ci = cpuCol != null ? idx[cpuCol] : undefined, gi = gpuCol != null ? idx[gpuCol] : undefined;
  let pos = nl + 1;
  while(pos < data.length){
    let e = data.indexOf('\n', pos); if(e < 0) e = data.length;
    let line = data.slice(pos, e); pos = e + 1;
    if(line.endsWith('\r')) line = line.slice(0, -1);
    const row = line.split(',');
    if(row.length <= fi) continue;
    const v = pyFloat(row[fi]); if(Number.isNaN(v)) continue;
    if(v <= MIN_VALID_MS || v >= MAX_VALID_MS) continue;
    ft.push(v);
    if(ci !== undefined && row.length > ci){ const c = pyFloat(row[ci]); if(!Number.isNaN(c)) cpu.push(c); }
    if(gi !== undefined && row.length > gi){ const g = pyFloat(row[gi]); if(!Number.isNaN(g)) gpu.push(g); }
  }
  return { ft, cpu, gpu };
}

function svgPerfLine(ft, asFps = false, width = 880, height = 250){
  if(!ft || !ft.length) return '<svg viewBox="0 0 880 80" width="100%" xmlns="http://www.w3.org/2000/svg">' +
    '<text x="20" y="44" font-size="12" fill="var(--text-faint)">No frametime data.</text></svg>';
  let data = ft;
  if(data.length > 600){ const step = data.length / 600; data = []; for(let i = 0; i < 600; i++) data.push(ft[Math.trunc(i * step)]); }
  if(asFps) data = data.map(v => v ? 1000.0 / v : 0.0);
  const n = data.length;
  const padL = 44, padR = 14, padT = 16, padB = 26;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  let ymax, target, tlabel;
  if(asFps){ ymax = 75.0; target = 60.0; tlabel = '60 fps'; }
  else { let mx = data[0]; for(const v of data) if(v > mx) mx = v; ymax = Math.max(mx * 1.1, STUTTER_FRAMETIME_MS * 1.1); target = TARGET_FRAMETIME_MS; tlabel = '16.67 ms target'; }
  const X = i => padL + (i / Math.max(n - 1, 1)) * plotW;
  const Y = v => padT + plotH - (v / ymax) * plotH;
  let grid = '';
  for(const f of [0.25, 0.5, 0.75]){ const yy = padT + plotH - f * plotH; grid += '<line x1="' + padL + '" y1="' + fmt(yy, 1) + '" x2="' + (width - padR) + '" y2="' + fmt(yy, 1) + '" stroke="var(--grid)" stroke-width="1"/>'; }
  for(const f of [0.0, 0.5, 1.0]){ const yy = padT + plotH - f * plotH; grid += '<text x="' + (padL - 6) + '" y="' + fmt(yy + 3, 1) + '" font-size="9" fill="var(--text-faint)" text-anchor="end">' + fmt(ymax * f, 0) + '</text>'; }
  const ty = Y(target);
  const ref = '<line x1="' + padL + '" y1="' + fmt(ty, 1) + '" x2="' + (width - padR) + '" y2="' + fmt(ty, 1) + '" stroke="var(--target)" stroke-dasharray="5 4" stroke-width="1.2"/>' +
    '<text x="' + (width - padR) + '" y="' + fmt(ty - 4, 1) + '" font-size="10" fill="var(--target)" text-anchor="end">' + tlabel + '</text>';
  const pts = data.map((v, i) => fmt(X(i), 1) + ',' + fmt(Y(v), 1)).join(' ');
  const axis = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="var(--border)" stroke-width="1"/>' +
    '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (width - padR) + '" y2="' + (padT + plotH) + '" stroke="var(--border)" stroke-width="1"/>';
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="performance over the flight">' +
    grid + ref + '<polyline points="' + pts + '" fill="none" stroke="var(--line)" stroke-width="1.2"/>' + axis + '</svg>';
}

function chartFrametimeSeries(ft, maxPoints = 5000){
  const n = ft.length;
  if(n === 0) return [[], [], 0.0];
  if(n <= maxPoints){
    const out = [], meanOut = []; let cum = 0.0;
    for(const v of ft){ cum += v; const x = pyRound(cum / 60000.0, 4); out.push([x, pyRound(v, 2)]); meanOut.push([x, pyRound(v, 2)]); }
    return [out, meanOut, cum / 60000.0];
  }
  const bucket = n / maxPoints;
  const out = [], meanOut = [];
  let cum = 0.0, bmax = 0.0, bsum = 0.0, bcnt = 0, edge = bucket;
  for(let i = 0; i < n; i++){
    const v = ft[i]; cum += v; bsum += v; bcnt += 1; if(v > bmax) bmax = v;
    if((i + 1) >= edge || i === n - 1){
      const x = pyRound(cum / 60000.0, 4);
      out.push([x, pyRound(bmax, 2)]); meanOut.push([x, pyRound(bsum / Math.max(bcnt, 1), 2)]);
      bmax = 0.0; bsum = 0.0; bcnt = 0; edge = edge + bucket;
    }
  }
  return [out, meanOut, cum / 60000.0];
}

function rollingMeanSeries(meanPts){
  const n = meanPts.length; if(n === 0) return [];
  const w = Math.max(5, Math.trunc(n / 100)), half = Math.trunc(w / 2);
  const ys = meanPts.map(p => p[1]); const out = [];
  for(let i = 0; i < n; i++){
    const lo = Math.max(0, i - half), hi = Math.min(n, i + half + 1);
    out.push([meanPts[i][0], pyRound(pySum(ys, lo, hi) / (hi - lo), 2)]);
  }
  return out;
}

function varianceBins(ft){
  if(!ft || ft.length < 2) return null;
  const counts = [0, 0, 0, 0, 0]; let prev = ft[0];
  for(let i = 1; i < ft.length; i++){ const d = Math.abs(ft[i] - prev); prev = ft[i];
    if(d < 2) counts[0]++; else if(d < 4) counts[1]++; else if(d < 8) counts[2]++; else if(d < 12) counts[3]++; else counts[4]++; }
  const tot = counts.reduce((a, b) => a + b, 0) || 1;
  return counts.map(c => pyRound(c / tot * 100, 2));
}

// v6.3.8: 5-phase model (departing/arrival taxi split), per-phase VRAM in the tooltip, and the two
// taxi rows label their airport with a ✳ when it's a 3rd-party scenery the user owns. meta =
// {dep_icao, arr_icao, dep_scenery, arr_scenery} (optional).
function phaseBarsHtml(phases, meta){
  meta = meta || {};
  const taxiLbl = (base, icao, is3p) => base + (icao ? ' · ' + icao + (is3p ? '✳' : '') : '');
  const order = [
    ["dep_taxi", taxiLbl("Departing taxi", meta.dep_icao, meta.dep_scenery)],
    ["climb", "Climb"], ["cruise", "Cruise"], ["descent", "Descent"],
    ["arr_taxi", taxiLbl("Arrival taxi", meta.arr_icao, meta.arr_scenery)],
  ];
  const active = order.filter(([k]) => phases && k in phases && (phases[k].frame_count || 0) > 0);
  if(!active.length) return '<div class="note">Flight phase data unavailable — SimConnect wasn\'t active for this flight. New flights populate Departing taxi / Climb / Cruise / Descent / Arrival taxi.</div>';
  let mx = Math.max(...active.map(([k]) => phases[k].p99_ft)); mx = Math.max(mx * 1.1, 25.0);
  let rows = '';
  for(const [k, l] of order){
    if(!phases || !(k in phases) || (phases[k].frame_count || 0) === 0){
      rows += '<div class="phase-row"><span class="lbl">' + l + '</span><div class="ph-track"></div><span class="num" style="color:var(--text-faint)">—</span></div>';
      continue;
    }
    const ph = phases[k];
    const p99 = ph.p99_ft;
    const w = Math.min(p99 / mx * 100, 100);
    const col = p99 <= 20 ? 'var(--good)' : (p99 <= 33.3 ? 'var(--ok)' : 'var(--bad)');
    const vramTip = ph.vram_peak != null ? ' · peak VRAM ' + ph.vram_peak + ' MB' : '';
    const tip = l + ' — ' + (ph.frame_count != null ? ph.frame_count.toLocaleString() : '?') + ' frames · avg ' + ph.avg_ft + ' ms · P99 ' + ph.p99_ft + ' ms · stutter ' + ph.stutter_pct + '%' + vramTip + ' · ' + ph.pct_of_total + '% of the flight';
    rows += '<div class="phase-row" title="' + tip + '" style="cursor:help"><span class="lbl">' + l + '</span><div class="ph-track"><div class="ph-fill" style="width:' + fmt(w, 0) + '%;background:' + col + '"></div></div><span class="num" style="color:' + col + '">' + fmt(p99, 1) + ' ms</span></div>';
  }
  return '<div class="phase">' + rows + '</div>';
}

function displayRoute(route){
  if(!route) return '';
  const parts = route.trim().split(/\s+/);                 // Python str.split(): runs of whitespace
  if(parts.length >= 2 && parts[parts.length - 1].includes('-')) return parts[parts.length - 1];
  return route;
}

function readTelemetry(sessionDir){
  const p = path.join(sessionDir, 'telemetry.csv');
  if(!fs.existsSync(p)) return null;
  let text; try { text = fs.readFileSync(p, 'utf8'); } catch(e){ return null; }
  if(text.charCodeAt(0) === 0xFEFF) text = text.slice(1);   // utf-8-sig BOM
  const lines = text.split(/\r?\n/); if(!lines.length) return null;
  const header = lines[0].split(',');
  const num = (row, k) => { const v = row[k]; if(v == null) return null; const t = String(v).trim(); if(t === '') return null; const n = Number(t); return Number.isNaN(n) ? null : n; };
  const out = [];
  for(let i = 1; i < lines.length; i++){
    if(lines[i] === '' || lines[i] == null) continue;
    const cols = lines[i].split(','); const row = {}; header.forEach((h, j) => row[h] = cols[j]);
    out.push({ wall_ms: num(row, 'wall_ms'), phase: row['phase'] || '', alt_ft: num(row, 'alt_ft'),
      vram_mb: num(row, 'vram_mb'), sys_ram_pct: num(row, 'sys_ram_pct'), sys_cpu_pct: num(row, 'sys_cpu_pct'),
      top_proc: row['top_proc'] || '', top_proc_cpu: num(row, 'top_proc_cpu') });
  }
  const filtered = out.filter(r => r.wall_ms !== null);
  filtered.sort((a, b) => a.wall_ms - b.wall_ms);
  return filtered.length ? filtered : null;
}

function chartAltitudeSeries(sessionDir, totalMin){
  const tel = readTelemetry(sessionDir);
  if(!tel) return null;
  const out = [];
  for(const r of tel){
    const alt = r.alt_ft;
    if(alt == null || alt > ALT_SANE_FT) continue;
    const x = (r.wall_ms - HEAD_TRIM_S * 1000.0) / 60000.0;
    if(x < 0 || x > totalMin + 0.5) continue;
    out.push([pyRound(x, 4), Math.trunc(alt)]);
  }
  return out.length ? out : null;
}

module.exports = { readChronological, svgPerfLine, chartFrametimeSeries, rollingMeanSeries, varianceBins, phaseBarsHtml, displayRoute, readTelemetry, chartAltitudeSeries, fmt };
