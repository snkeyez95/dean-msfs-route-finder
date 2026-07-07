'use strict';
// Phase 8a — native port of write_report (msfs_perf_logger.py:1695): assembles the per-flight
// report.html from the proven chart helpers + the extracted static assets. PORT — must byte-match
// Python (validated by _parity_report.js). The fiddly bits are Python-exact: json.dumps format
// (", "/": " separators, ensure_ascii, float repr keeps ".0"), html.escape, and {:,} thousands.
const A = require('./report_assets.js');
const { pyRound } = require('./stats.js');
const RC = require('./report_charts.js');

const TARGET_FRAMETIME_MS = 16.67, STUTTER_FRAMETIME_MS = 33.34;

// --- Python-compatible formatting ---
function htmlEscape(s){ return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#x27;'); }
function thousands(n){ return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }          // Python {:,} on an int
function floatRepr(x){ if(x === null || x === undefined) return String(x); let s = String(x); if(!/[.eE]/.test(s)) s += '.0'; return s; }   // Python str(float) / float repr — keeps ".0"
function PInt(n){ return { __int: n }; }                                                  // mark a value that must serialize as an int
function gradeP99(p){ if(p == null) return 'na'; if(p <= 20) return 'good'; if(p <= 33.3) return 'ok'; return 'bad'; }
function jsonStr(s){
  let out = '"';
  for(const ch of String(s)){
    const c = ch.codePointAt(0);
    if(ch === '"') out += '\\"'; else if(ch === '\\') out += '\\\\';
    else if(ch === '\n') out += '\\n'; else if(ch === '\r') out += '\\r'; else if(ch === '\t') out += '\\t';
    else if(ch === '\b') out += '\\b'; else if(ch === '\f') out += '\\f';
    else if(c < 0x20) out += '\\u' + c.toString(16).padStart(4, '0');
    else if(c <= 0x7e) out += ch;
    else if(c > 0xffff){ const cc = c - 0x10000; out += '\\u' + ((cc >> 10) + 0xd800).toString(16).padStart(4, '0') + '\\u' + ((cc & 0x3ff) + 0xdc00).toString(16).padStart(4, '0'); }
    else out += '\\u' + c.toString(16).padStart(4, '0');
  }
  return out + '"';
}
function pyJson(v){
  if(v === null || v === undefined) return 'null';
  if(v === true) return 'true'; if(v === false) return 'false';
  if(typeof v === 'object' && v && v.__int !== undefined) return String(v.__int);
  if(typeof v === 'number') return Number.isInteger(v) ? floatRepr(v) : String(v);   // report numbers are floats -> keep ".0"; non-integers repr shortest
  if(typeof v === 'string') return jsonStr(v);
  if(Array.isArray(v)) return '[' + v.map(pyJson).join(', ') + ']';
  return '{' + Object.keys(v).map(k => jsonStr(k) + ': ' + pyJson(v[k])).join(', ') + '}';
}

function buildReport(sessionId, settings, stats, vram, ftInOrder, sortedFt, sessionDir, driverVersion, simVersion){
  const fmt = v => (v === null || v === undefined) ? 'n/a' : v;
  const g = (o, k) => (o && o[k] !== undefined) ? o[k] : undefined;
  const tlod = g(settings, 'tlod'), olod = g(settings, 'olod');
  const aircraft = g(settings, 'aircraft') || 'n/a';
  const route = RC.displayRoute(g(settings, 'simbrief_route') || '');

  const chipPairs = [['Aircraft', htmlEscape(String(aircraft))], ['TLOD', fmt(tlod) + ' / OLOD ' + fmt(olod)]];
  if(route) chipPairs.push(['Route', htmlEscape(route)]);
  chipPairs.push(['Driver', htmlEscape(String(fmt(driverVersion)))], ['Sim', htmlEscape(String(fmt(simVersion)))]);
  const chipsHtml = chipPairs.map(([l, v]) => '<span class="chip">' + l + ' <b>' + v + '</b></span>').join('');

  const sfps = ms => ms ? pyRound(1000.0 / ms, 1) : null;
  const sms = fps => fps ? pyRound(1000.0 / fps, 2) : null;
  const metrics = [
    { k: 'Average', fps: g(stats, 'avg_fps') ?? null, ms: g(stats, 'avg_ft_ms') ?? null },
    { k: 'P95', fps: sfps(g(stats, 'p95_ft_ms')), ms: g(stats, 'p95_ft_ms') ?? null },
    { k: 'P99', fps: sfps(g(stats, 'p99_ft_ms')), ms: g(stats, 'p99_ft_ms') ?? null },
    { k: 'P99.9', fps: sfps(g(stats, 'p999_ft_ms')), ms: g(stats, 'p999_ft_ms') ?? null },
    { k: '1% low', fps: g(stats, 'one_pct_low_fps') ?? null, ms: sms(g(stats, 'one_pct_low_fps')) },
    { k: '0.1% low', fps: g(stats, 'point_one_pct_low_fps') ?? null, ms: sms(g(stats, 'point_one_pct_low_fps')) },
  ];

  const fc = g(stats, 'frame_count') || 0, stutN = g(stats, 'stutter_count') || 0, spikeN = g(stats, 'spike_count') || 0;
  const smoothN = Math.max(fc - stutN, 0), midN = Math.max(stutN - spikeN, 0);
  const pct = x => fc ? pyRound(x / fc * 100, 2) : 0.0;
  const stutPie = [
    { label: 'Smooth: ' + floatRepr(pct(smoothN)) + '%', color: 'var(--accent)', pct: pct(smoothN) },
    { label: 'Stutter 33-50ms: ' + floatRepr(pct(midN)) + '%', color: 'var(--amber)', pct: pct(midN) },
    { label: 'Spike >50ms: ' + floatRepr(pct(spikeN)) + '%', color: 'var(--bad)', pct: pct(spikeN) },
  ];
  const vb = RC.varianceBins(ftInOrder);
  const varPie = vb ? [
    { label: '< 2ms: ' + floatRepr(vb[0]) + '%', color: 'var(--accent)', pct: vb[0] },
    { label: '< 4ms: ' + floatRepr(vb[1]) + '%', color: 'var(--blue2)', pct: vb[1] },
    { label: '< 8ms: ' + floatRepr(vb[2]) + '%', color: 'var(--amber)', pct: vb[2] },
    { label: '< 12ms: ' + floatRepr(vb[3]) + '%', color: 'var(--orange)', pct: vb[3] },
    { label: '> 12ms: ' + floatRepr(vb[4]) + '%', color: 'var(--bad)', pct: vb[4] },
  ] : [{ label: 'no data', color: 'var(--text-faint)', pct: 0 }];

  const rdJson = pyJson({ metrics, pies: { stut: stutPie, var: varPie } });
  const sessionIdJson = pyJson(sessionId);

  const [ftPoints, meanPoints, totalMin] = RC.chartFrametimeSeries(ftInOrder);
  const altPoints = RC.chartAltitudeSeries(sessionDir, totalMin);
  const altJson = altPoints ? altPoints.map(([x, a]) => [x, PInt(a)]) : null;
  let overCount = 0; for(const v of ftInOrder) if(v > 100.0) overCount++;
  let overMax = g(stats, 'max_ft_ms');
  if(overMax == null) { overMax = 0.0; for(const v of ftInOrder) if(v > overMax) overMax = v; }
  const mavgPoints = RC.rollingMeanSeries(meanPoints);
  let q1 = null, q3 = null;
  if(sortedFt && sortedFt.length){ const mm = sortedFt.length; q1 = pyRound(sortedFt[Math.trunc(mm * 0.25)], 2); q3 = pyRound(sortedFt[Math.min(Math.trunc(mm * 0.75), mm - 1)], 2); }
  const chartJson = pyJson({ ft: ftPoints, mavg: mavgPoints, alt: altJson, target: TARGET_FRAMETIME_MS,
    stutter: pyRound(STUTTER_FRAMETIME_MS, 1), avg_fps: g(stats, 'avg_fps') ?? null, q1, q3,
    over_count: PInt(overCount), over_max: pyRound(overMax, 2) });
  const phaseHtml = RC.phaseBarsHtml(g(stats, 'phases'), {
    dep_icao: g(settings, 'dep_icao'), arr_icao: g(settings, 'arr_icao'),
    dep_scenery: g(settings, 'dep_scenery'), arr_scenery: g(settings, 'arr_scenery') });

  let vramHtml;
  if(g(vram, 'available')){
    const peak = vram.peak_vram_mb, total = vram.total_vram_mb, vpct = vram.peak_pct, avg = vram.avg_vram_mb;
    const head = pyRound((total - peak) / 1024, 1);
    vramHtml = '<div class="bar-track"><div class="bar-fill" style="width:' + floatRepr(vpct) + '%"></div></div>' +
      '<div class="vram-nums"><span>' + thousands(peak) + ' MB peak</span>' +
      '<span>' + floatRepr(vpct) + '% of ' + pyRound(total / 1024, 0) + ' GB</span></div>' +
      '<div class="vram-nums"><span>avg ' + thousands(avg) + ' MB</span>' +
      '<span>headroom ' + floatRepr(head) + ' GB</span></div>';
  } else {
    vramHtml = '<div class="vram-nums"><span>VRAM not captured</span><span>install nvidia-ml-py</span></div>';
  }

  let cpuGpu = '';
  if(g(stats, 'gpu_bound_pct') != null){
    cpuGpu = floatRepr(stats.cpu_bound_pct) + '% CPU-bound / ' + floatRepr(stats.gpu_bound_pct) + '% GPU-bound · ' +
      'avg CPU ' + (g(stats, 'avg_cpu_busy_ms') != null ? floatRepr(stats.avg_cpu_busy_ms) : '?') + ' ms / ' +
      'GPU ' + (g(stats, 'avg_gpu_busy_ms') != null ? floatRepr(stats.avg_gpu_busy_ms) : '?') + ' ms';
  }
  const frameCount = g(stats, 'frame_count') || 0;
  const durationSeconds = g(stats, 'duration_seconds');

  // Flight verdict — keep the grade headline; make the BODY the thing that actually varies flight to
  // flight on a smooth rig: the VRAM ceiling (the real constraint) + the worst frame. Not a footer echo.
  const p99v = g(stats, 'p99_ft_ms'), grd = gradeP99(p99v);
  const gword = { good: 'Smooth', ok: 'Playable', bad: 'Rough', na: '—' }[grd];
  const gcol = { good: 'var(--good)', ok: 'var(--ok)', bad: 'var(--bad)', na: 'var(--text-faint)' }[grd];
  const vpk = g(vram, 'peak_pct'), peakMb = g(vram, 'peak_vram_mb'), totMb = g(vram, 'total_vram_mb') || 12288;
  const headGB = peakMb != null ? pyRound((totMb - peakMb) / 1024, 1) : null;
  const cpuB2 = g(stats, 'cpu_bound_pct');
  let insight;
  if (vpk == null) insight = 'VRAM wasn’t captured for this flight.';
  else if (vpk < 85) insight = 'Room to climb — VRAM peaked at ' + floatRepr(vpk) + '% (' + floatRepr(headGB) + ' GB free)' + (cpuB2 != null && cpuB2 > 90 ? ' with the GPU mostly idle' : '') + '. This TLOD isn’t the limiter.';
  else if (vpk < 92) insight = 'VRAM is the ceiling here — peaked at ' + floatRepr(vpk) + '%, only ' + floatRepr(headGB) + ' GB to spare. About as high as this TLOD comfortably sustains.';
  else insight = 'VRAM-limited — peaked at ' + floatRepr(vpk) + '% (' + floatRepr(headGB) + ' GB left). A higher TLOD risks running dry.';
  const maxSpike = g(stats, 'max_ft_ms'), stutN2 = g(stats, 'stutter_count') || 0, fc2 = g(stats, 'frame_count') || 0;
  const spikeTxt = (maxSpike != null) ? ('Worst single frame ' + floatRepr(maxSpike) + ' ms · ' + thousands(stutN2) + ' stutter' + (stutN2 !== 1 ? 's' : '') + ' across ' + thousands(fc2) + ' frames') : '';
  const verdictHtml = '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">' +
    '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint);margin-bottom:7px">Verdict</div>' +
    '<div style="display:flex;align-items:baseline;gap:9px"><span style="font-size:25px;font-weight:700;color:' + gcol + '">' + gword + '</span>' +
    '<span style="font-size:13px;color:var(--text-dim);font-family:Consolas,monospace">P99 ' + (p99v != null ? floatRepr(p99v) : '—') + ' ms</span></div>' +
    '<div style="font-size:12px;color:var(--text-dim);line-height:1.6;margin-top:9px">' + insight + '</div>' +
    (spikeTxt ? '<div style="font-size:11px;color:var(--text-faint);margin-top:9px;font-family:Consolas,monospace">' + spikeTxt + '</div>' : '') +
    '</div>';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Performance — ${sessionId}</title>
<style>${A.THEME_BASE_CSS}${A.REPORT_CSS}</style>
</head>
<body>
  <header>
    <div>
      <div class="title">Performance Analysis</div>
      <div class="sub mono">${sessionId}</div>
    </div>
    <div class="chips">${chipsHtml}</div>
    <div class="spacer"></div>
    <a class="navbtn disabled" id="navPrev" title="Older flight">&#8249; Prev</a>
    <a class="navbtn disabled" id="navNext" title="Newer flight">Next &#8250;</a>
    <button class="toggle" id="themeBtn" onclick="toggleTheme()">◐ Light</button>
  </header>

  <div class="tabs">
    <div class="tab active" id="tabFt" onclick="showGraph('frametime')">Frametime</div>
    <div class="tab" id="tabFps" onclick="showGraph('fps')">FPS</div>
  </div>

  <div class="layout">
    <div class="panel">
      <div class="panel-h">Metrics<button class="unit-btn" id="unitBtn" onclick="toggleUnit()">FPS</button></div>
      <div class="metrics" id="metrics"></div>
      ${verdictHtml}
    </div>
    <div class="rcol">
      <div class="panel">
        <div class="panel-h" id="graphTitle">Frametime over flight · ms (lower = smoother)
          <span class="graph-ctrls">
            <select class="yscale-sel" id="yScale" onchange="window.applyScale&&applyScale(this.value)">
              <option value="100" selected>0-100 ms</option>
              <option value="80">0-80 ms</option>
              <option value="60">0-60 ms</option>
              <option value="40">0-40 ms</option>
              <option value="30">0-30 ms</option>
              <option value="20">0-20 ms</option>
              <option value="10">0-10 ms</option>
              <option value="fit">Full fit</option>
              <option value="iqr">Interquartile range</option>
            </select>
            <button class="unit-btn" id="zoomReset" onclick="resetZoom()">Reset zoom</button>
          </span>
        </div>
        <div class="graph-wrap" style="height:300px;position:relative">
          <canvas id="ftChart" role="img" aria-label="frametime over the flight, with altitude overlay"></canvas>
          <div id="spikeBadge" class="spike-badge" style="display:none"></div>
        </div>
        <div class="chart-legend" id="chartLegend"></div>
        <div class="graph-hint">Scroll to zoom · drag to pan · double-click to reset</div>
      </div>
      <div class="panel">
        <div class="panel-h">Frametime moving average · the smoothed trend you actually feel (ms)</div>
        <div class="graph-wrap" style="height:150px;position:relative">
          <canvas id="ftAvgChart" role="img" aria-label="moving-average frametime over the flight"></canvas>
        </div>
        <div class="graph-hint">A rolling average of frametime that filters out one-off spikes to show the typical smoothness at each point of the flight — plotted on its own tight scale so small drifts are visible. Flat and low = smooth.</div>
      </div>
    </div>
  </div>

  <div class="lower">
    <div class="panel">
      <div class="pietabs">
        <div class="pietab active" id="ptStut" onclick="showPie('stut')">Stuttering</div>
        <div class="pietab" id="ptVar" onclick="showPie('var')">Variances</div>
      </div>
      <div class="pie-wrap">
        <svg id="pieSvg" viewBox="0 0 120 120" width="112" height="112" role="img" aria-label="breakdown"></svg>
        <div class="legend" id="pieLegend"></div>
      </div>
    </div>
    <div class="panel">
      <div class="panel-h">VRAM peak</div>
      <div class="vram-body">${vramHtml}</div>
    </div>
  </div>

  <div class="panel" style="margin-bottom:12px">
    <div class="panel-h">Flight phase breakdown · P99 frametime per phase</div>
    ${phaseHtml}
  </div>

  <footer>
    ${thousands(frameCount)} frames · ${durationSeconds != null ? floatRepr(durationSeconds) : 0} s · ${cpuGpu}<br/>
    Captured by the ABRP Performance Logger · raw per-frame data in frametimes.csv
  </footer>

<script>var RD = ${rdJson};</script>
<script>var CHART = ${chartJson};</script>
<script>var THIS_SESSION = ${sessionIdJson};</script>
<script>${A.THEME_JS}</script>
<script>${A.REPORT_JS}</script>
<script src="../../sessions_nav.js"></script>
<script>${A.NAV_JS}</script>
<script src="../../_lib/chart.umd.min.js"></script>
<script src="../../_lib/hammer.min.js"></script>
<script src="../../_lib/chartjs-plugin-zoom.min.js"></script>
<script>${A.CHART_JS}</script>
</body>
</html>`;
}

module.exports = { buildReport, pyJson, htmlEscape, floatRepr, thousands };
