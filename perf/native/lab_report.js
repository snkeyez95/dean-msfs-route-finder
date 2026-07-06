'use strict';
// Settings Lab RESULTS (Phase 9b) — turns lab-tagged flights into findings: per-experiment verdicts
// judged against BASELINE NOISE (±1 pstdev of the same metric across untagged benchmark flights —
// a delta inside the band is honestly reported as "within normal variation", never spun as a win),
// per-metric deltas for the UI's bars, and overlay "fingerprint" SVGs (experiment vs control
// frametime lines, x normalized to % of flight so different durations compare fairly). Runs in a
// CHILD process (like archive.js/capframex.js) — reading raw frametimes.csv(.gz) is heavy.
// Per-flight series are cached as series.json (~15 KB) in each session folder: computed once,
// reused forever, survives raw-capture archiving. Chart math reuses the byte-proven report engine
// (chartFrametimeSeries / rollingMeanSeries) — no new charting tech.
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const { pstdev, pickColumn } = require('./stats.js');
const { chartFrametimeSeries, rollingMeanSeries, readTelemetry, fmt } = require('./report_charts.js');
const lab = require('./lab.js');

const GRID_AC = ['Fenix', 'PMDG'], GRID_TL = [100, 125, 150, 175];
const CTRL_PER_EXP = 4;            // time-nearest same-aircraft baseline flights per experiment flight
const TARGET_MS = 16.67, STUTTER_MS = 33.34;
const FRAMETIME_COLUMNS = ['MsBetweenPresents', 'msBetweenPresents', 'FrameTime', 'ms_between_presents', 'MsBetweenDisplayChange'];

// The judged metrics. 'sm' = a smoothness metric (drives SAVES/COSTS); VRAM is judged separately
// against the 90%-of-card ceiling the Baseline view already uses.
const METRICS = [
  { k: 'ground_stutter', label: 'Ground stutter',  unit: 'pp', dec: 3, sm: true },
  { k: 'ground_p99',     label: 'Ground P99',      unit: 'ms', dec: 2, sm: true },
  { k: 'p99',            label: 'Overall P99',     unit: 'ms', dec: 2, sm: true },
  { k: 'spikes_hr',      label: 'Big spikes / hr', unit: '',   dec: 1, sm: true },
  { k: 'peak_vram',      label: 'Peak VRAM',       unit: 'MB', dec: 0, sm: false },
];

// ── per-flight inputs ────────────────────────────────────────────────────────
function readSummary(sessionsDir, folder) {
  try { return JSON.parse(fs.readFileSync(path.join(sessionsDir, folder, 'summary.json'), 'utf8')); }
  catch (_) { return null; }
}
function metricsFromSummary(sj) {
  if (!sj || !sj.smoothness) return null;
  const sm = sj.smoothness, g = (sm.phases || {}).ground || {}, v = sj.vram || {};
  const hrs = sm.duration_seconds ? sm.duration_seconds / 3600 : null;
  return {
    ground_stutter: g.stutter_pct != null ? g.stutter_pct : null,
    ground_p99:     g.p99_ft != null ? g.p99_ft : null,
    p99:            sm.p99_ft_ms != null ? sm.p99_ft_ms : null,
    spikes_hr:      (sm.spike_count != null && hrs) ? sm.spike_count / hrs : null,
    peak_vram:      v.peak_vram_mb != null ? v.peak_vram_mb : null,
    total_vram:     v.total_vram_mb || 12288,
  };
}

// Raw frametimes reader — frametime column only, transparent .gz (same rule as capframex.js).
function readFt(sessionDir) {
  let p = path.join(sessionDir, 'frametimes.csv');
  if (!fs.existsSync(p)) { p += '.gz'; if (!fs.existsSync(p)) return null; }
  let text;
  try { text = /\.gz$/i.test(p) ? zlib.gunzipSync(fs.readFileSync(p)).toString('utf8') : fs.readFileSync(p, 'utf8'); }
  catch (_) { return null; }
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  const nl = text.indexOf('\n'); if (nl < 0) return null;
  const header = text.slice(0, nl).replace(/\r$/, '').split(',');
  const col = pickColumn(header, FRAMETIME_COLUMNS); if (col == null) return null;
  const fi = header.indexOf(col);
  const ft = []; let pos = nl + 1;
  while (pos < text.length) {
    let e = text.indexOf('\n', pos); if (e < 0) e = text.length;
    const row = text.slice(pos, e).split(','); pos = e + 1;
    if (row.length <= fi) continue;
    const v = Number(row[fi]);
    if (Number.isFinite(v) && v > 0 && v < 1000) ft.push(v);
  }
  return ft.length ? ft : null;
}
// Engine-style time trims (summary records the exact seconds used for this flight).
function trimFt(ft, headS, tailS) {
  let a = 0, cum = 0;
  while (a < ft.length && cum < headS * 1000) { cum += ft[a]; a++; }
  let b = ft.length; cum = 0;
  while (b > a && cum < tailS * 1000) { b--; cum += ft[b]; }
  return ft.slice(a, b);
}

// ── per-flight series cache: series.json in the session folder ──────────────
// { v:1, dur_min, full:[[pctOfFlight, ms]…], ground:[[pctOfGroundTime, ms]…]|null }
function seriesFor(sessionsDir, folder) {
  const dir = path.join(sessionsDir, folder);
  const cache = path.join(dir, 'series.json');
  try { const c = JSON.parse(fs.readFileSync(cache, 'utf8')); if (c && c.v === 1) return c; } catch (_) {}
  const sj = readSummary(sessionsDir, folder);
  const sm = (sj && sj.smoothness) || {};
  const raw = readFt(dir);
  if (!raw) return null;
  const ft = trimFt(raw, sm.start_trim_s != null ? sm.start_trim_s : 5, sm.stop_trim_s != null ? sm.stop_trim_s : 5);
  if (ft.length < 100) return null;
  const smooth = (arr, maxPts) => {
    const [, meanPts, totalMin] = chartFrametimeSeries(arr, maxPts);
    const rm = rollingMeanSeries(meanPts);
    if (!totalMin) return { pts: [], totalMin: 0 };
    return { pts: rm.map(p => [Math.round(p[0] / totalMin * 10000) / 100, p[1]]), totalMin };
  };
  const full = smooth(ft, 600);
  // ground-only: keep frames whose cumulative time falls inside a telemetry 'ground' window,
  // concatenated (departure taxi + arrival taxi), x = % of total ground time.
  let ground = null;
  const tel = readTelemetry(dir);
  if (tel) {
    const head = (sm.start_trim_s != null ? sm.start_trim_s : 5) * 1000;
    const win = [];                                  // [startMs, endMs] on the trimmed timeline
    let cur = null;
    for (const r of tel) {
      const t = r.wall_ms - head;
      if (r.phase === 'ground') { if (!cur) cur = [t, t]; else cur[1] = t; }
      else if (cur) { win.push(cur); cur = null; }
    }
    if (cur) win.push(cur);
    if (win.length) {
      const gf = []; let cum = 0, wi = 0;
      for (const v of ft) {
        cum += v;
        while (wi < win.length && cum > win[wi][1] + 1500) wi++;
        if (wi >= win.length) break;
        if (cum >= win[wi][0] - 1500) gf.push(v);
      }
      if (gf.length >= 100) ground = smooth(gf, 300).pts;
    }
  }
  const out = { v: 1, dur_min: Math.round(full.totalMin * 10) / 10, full: full.pts, ground };
  try { fs.writeFileSync(cache, JSON.stringify(out)); } catch (_) {}
  return out;
}

// ── overlay SVG (multi-series sibling of report_charts.svgPerfLine) ─────────
// Series: [{pts:[[pct,ms]…], exp:bool}]. Colors/vars are mapped by the app's wrapper div.
function svgOverlay(seriesList, width, height) {
  const live = (seriesList || []).filter(s => s.pts && s.pts.length > 1);
  if (!live.length) return '<svg viewBox="0 0 ' + width + ' 60" width="100%" xmlns="http://www.w3.org/2000/svg">' +
    '<text x="16" y="34" font-size="11" fill="var(--text-faint)">No chart data for this phase yet.</text></svg>';
  let mx = 0; for (const s of live) for (const p of s.pts) if (p[1] > mx) mx = p[1];
  const ymax = Math.max(mx * 1.18, 22);
  const padL = 40, padR = 10, padT = 12, padB = 22;
  const plotW = width - padL - padR, plotH = height - padT - padB;
  const X = pct => padL + (pct / 100) * plotW;
  const Y = v => padT + plotH - (Math.min(v, ymax) / ymax) * plotH;
  let g = '';
  for (const f of [0.25, 0.5, 0.75]) { const yy = padT + plotH - f * plotH; g += '<line x1="' + padL + '" y1="' + fmt(yy, 1) + '" x2="' + (width - padR) + '" y2="' + fmt(yy, 1) + '" stroke="var(--grid)" stroke-width="1"/>'; }
  for (const f of [0.0, 0.5, 1.0]) { const yy = padT + plotH - f * plotH; g += '<text x="' + (padL - 5) + '" y="' + fmt(yy + 3, 1) + '" font-size="9" fill="var(--text-faint)" text-anchor="end">' + fmt(ymax * f, 0) + '</text>'; }
  for (const px of [0, 50, 100]) g += '<text x="' + fmt(X(px), 1) + '" y="' + (height - 6) + '" font-size="9" fill="var(--text-faint)" text-anchor="middle">' + px + '%</text>';
  const ty = Y(TARGET_MS);
  g += '<line x1="' + padL + '" y1="' + fmt(ty, 1) + '" x2="' + (width - padR) + '" y2="' + fmt(ty, 1) + '" stroke="var(--target)" stroke-dasharray="5 4" stroke-width="1"/>' +
       '<text x="' + (width - padR) + '" y="' + fmt(ty - 3, 1) + '" font-size="9" fill="var(--target)" text-anchor="end">16.67 ms</text>';
  if (ymax > STUTTER_MS * 1.05) {
    const sy = Y(STUTTER_MS);
    g += '<line x1="' + padL + '" y1="' + fmt(sy, 1) + '" x2="' + (width - padR) + '" y2="' + fmt(sy, 1) + '" stroke="var(--bad)" stroke-dasharray="2 4" stroke-width="1" opacity="0.6"/>' +
         '<text x="' + (width - padR) + '" y="' + fmt(sy - 3, 1) + '" font-size="9" fill="var(--bad)" text-anchor="end" opacity="0.8">stutter 33.3</text>';
  }
  // controls under, experiments on top
  let lines = '';
  for (const s of live.filter(x => !x.exp).concat(live.filter(x => x.exp))) {
    const pts = s.pts.map(p => fmt(X(p[0]), 1) + ',' + fmt(Y(p[1]), 1)).join(' ');
    lines += '<polyline points="' + pts + '" fill="none" stroke="var(' + (s.exp ? '--lab-exp' : '--lab-ctrl') + ')" stroke-width="' + (s.exp ? '1.7' : '1.1') + '"' + (s.exp ? '' : ' opacity="0.55"') + '/>';
  }
  const axis = '<line x1="' + padL + '" y1="' + padT + '" x2="' + padL + '" y2="' + (padT + plotH) + '" stroke="var(--border)" stroke-width="1"/>' +
    '<line x1="' + padL + '" y1="' + (padT + plotH) + '" x2="' + (width - padR) + '" y2="' + (padT + plotH) + '" stroke="var(--border)" stroke-width="1"/>';
  return '<svg viewBox="0 0 ' + width + ' ' + height + '" width="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="experiment vs baseline frametimes">' + g + lines + axis + '</svg>';
}

// ── verdict math ─────────────────────────────────────────────────────────────
const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const sidNum = s => parseInt(String(s || '').replace(/\D/g, '').slice(0, 12), 10) || 0;

function buildLabReport(sessionsDir) {
  let idx;
  try { idx = JSON.parse(fs.readFileSync(path.join(sessionsDir, 'index.json'), 'utf8')); }
  catch (e) { return { ok: false, error: 'index.json unreadable: ' + e.message }; }
  const sessions = (idx.sessions || []).filter(s => s && s.folder);
  const grid = sessions.filter(s => !s.experiment && !s.autofps_active && GRID_AC.includes(s.aircraft) && GRID_TL.includes(s.tlod) && s.p99_ft_ms != null);
  const mcache = {};   // folder -> metrics
  const M = s => (mcache[s.folder] !== undefined ? mcache[s.folder] : (mcache[s.folder] = metricsFromSummary(readSummary(sessionsDir, s.folder))));

  const experiments = [];
  for (const exp of lab.EXPERIMENTS) {
    const exps = sessions.filter(s => s.experiment === exp.id);
    const need = lab.N_PER_EXPERIMENT;
    const base = { id: exp.id, label: exp.label, hypothesis: exp.hypothesis, manual: !!exp.manual,
      dir: exp.dir || 'down', section: exp.section || null, key: exp.key || null,
      testValue: exp.testValue != null ? exp.testValue : null, done: exps.length, need };
    if (!exps.length) { experiments.push({ ...base, verdict: 'collecting', sentence: 'Not flown yet — the Lab will schedule it.', deltas: [], flights: { exp: [], ctrl: [] } }); continue; }

    // control set: per experiment flight, the CTRL_PER_EXP time-nearest same-aircraft grid flights
    const ctrlMap = new Map();
    for (const e of exps) {
      grid.filter(c => c.aircraft === e.aircraft)
        .sort((a, b) => Math.abs(sidNum(a.session_id) - sidNum(e.session_id)) - Math.abs(sidNum(b.session_id) - sidNum(e.session_id)))
        .slice(0, CTRL_PER_EXP).forEach(c => ctrlMap.set(c.folder, c));
    }
    const ctrls = [...ctrlMap.values()];
    if (!ctrls.length) { experiments.push({ ...base, verdict: 'awaiting-control', sentence: 'Waiting for baseline flights on the same aircraft to compare against.', deltas: [], flights: { exp: exps.map(fRef), ctrl: [] } }); continue; }

    // noise pool: every untagged grid flight on the experiment's aircraft — the honest yardstick
    const acSet = new Set(exps.map(e => e.aircraft));
    let pool = grid.filter(c => acSet.has(c.aircraft));
    if (pool.length < 4) pool = grid;

    const deltas = [];
    let worse = null, better = null, vramTotal = 12288, expVramMean = null;
    for (const m of METRICS) {
      const ev = exps.map(s => (M(s) || {})[m.k]).filter(v => v != null);
      const cv = ctrls.map(s => (M(s) || {})[m.k]).filter(v => v != null);
      const pv = pool.map(s => (M(s) || {})[m.k]).filter(v => v != null);
      if (!ev.length || !cv.length) continue;
      const em = mean(ev), cm = mean(cv);
      const sigma = pv.length >= 3 ? pstdev(pv) : null;
      const delta = em - cm;
      const within = sigma != null ? Math.abs(delta) <= sigma : null;
      deltas.push({ k: m.k, label: m.label, unit: m.unit, dec: m.dec, expMean: em, ctrlMean: cm,
        delta, sigma, within, pct: cm ? Math.round(delta / cm * 1000) / 10 : null });
      if (m.k === 'peak_vram') {
        expVramMean = em;
        for (const s of exps) { const mm = M(s); if (mm && mm.total_vram) vramTotal = mm.total_vram; }
      }
      if (m.sm && sigma != null && !within) {
        if (delta > 0 && (!worse || Math.abs(delta / sigma) > Math.abs(worse.delta / worse.sigma))) worse = deltas[deltas.length - 1];
        if (delta < 0 && (!better || Math.abs(delta / sigma) > Math.abs(better.delta / better.sigma))) better = deltas[deltas.length - 1];
      }
    }
    const vramOver = expVramMean != null && expVramMean > vramTotal * 0.90;
    let verdict, sentence;
    const say = d => d.label.toLowerCase() + ' ' + (d.delta > 0 ? '+' : '') + d.delta.toFixed(d.dec) + (d.unit ? ' ' + d.unit : '');
    if (worse && better) { verdict = 'mixed'; sentence = 'Trade-off: ' + say(better) + ' improved, but ' + say(worse) + ' got worse. Your call — the bars below show both sides.'; }
    else if (worse || vramOver) { verdict = 'costs'; sentence = vramOver && !worse
      ? 'This pushes peak VRAM past the 90% safety ceiling (' + Math.round(expVramMean) + ' of ' + vramTotal + ' MB) — leave it at your baseline.'
      : 'This measurably hurt: ' + say(worse) + ' (beyond normal flight-to-flight variation). Leave it at your baseline.'; }
    else if (better) { verdict = 'saves'; sentence = 'Real improvement: ' + say(better) + ' — beyond normal variation. Worth adopting.'; }
    else if (base.dir === 'up') { verdict = 'free'; sentence = 'Free upgrade: every metric stayed within normal variation — the prettier setting costs you nothing measurable.'; }
    else { verdict = 'noeffect'; sentence = 'No measurable difference — every metric stayed within your normal flight-to-flight variation. Keep whichever you prefer.'; }

    // fingerprint SVGs from the cached per-flight series
    const load = (s, isExp) => { const sr = seriesFor(sessionsDir, s.folder); return sr ? { full: { pts: sr.full, exp: isExp }, ground: sr.ground ? { pts: sr.ground, exp: isExp } : null } : null; };
    const packs = exps.map(s => load(s, true)).concat(ctrls.map(s => load(s, false))).filter(Boolean);
    const svgFull = svgOverlay(packs.map(p => p.full), 560, 190);
    const svgGround = svgOverlay(packs.map(p => p.ground).filter(Boolean), 560, 190);

    experiments.push({ ...base, verdict, sentence, preliminary: exps.length < need, deltas,
      flights: { exp: exps.map(fRef), ctrl: ctrls.map(fRef) }, ctrlN: ctrls.length, poolN: pool.length,
      svgGround, svgFull });
  }
  return { ok: true, generated: new Date().toISOString(), experiments };
}
function fRef(s) { return { session_id: s.session_id, folder: s.folder, aircraft: s.aircraft, tlod: s.tlod }; }

module.exports = { buildLabReport, seriesFor, svgOverlay, readFt, trimFt, metricsFromSummary };
