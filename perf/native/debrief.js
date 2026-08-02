'use strict';
// perf/native/debrief.js — v6.17.0 FLIGHT DEBRIEF (Dean 2026-08-02).
//
// Replaces the static VERDICT block that used to live inline in report_html.js. That block was
// accurate but context-free: it graded P99, named the VRAM ceiling and classified the spike pattern,
// and never once said whether the flight was good FOR DEAN, what explained it, or whether anything
// needed doing. This adds the three things our chat analyses actually turn on — a rank against his
// own history, an attribution, and an explicit "nothing to act on" when that is the truth.
//
// HONEST LIMIT, and the reason the copy stays flat: rules can rank, attribute and caveat. They
// cannot notice something genuinely new. Nothing in here may imply more certainty than a template
// deserves — no "this is why", no advice the data doesn't carry.
//
// PURE: no file I/O, no requires beyond stats helpers. Everything arrives as arguments so the whole
// thing is desk-testable with synthetic histories. It must NOT import report_combined.js — that
// module imports from report_html.js, which imports this, and the cycle would bite.
const { pyRound } = require('./stats.js');

// Same grade ladder the old verdict used (report_html.js gradeP99) — deliberately unchanged, so a
// flight that read "Smooth" before still reads "Smooth".
function gradeP99(p) { if (p == null) return 'na'; if (p <= 20) return 'good'; if (p <= 33.3) return 'ok'; return 'bad'; }
const GRADE_WORD = { good: 'Smooth', ok: 'Playable', bad: 'Rough', na: '—' };
const GRADE_COL = { good: 'var(--good)', ok: 'var(--ok)', bad: 'var(--bad)', na: 'var(--text-faint)' };

const MIN_HISTORY_TO_RANK = 5;      // below this a "rank" is theatre — say nothing instead
const SHORT_FLIGHT_MIN = 45;        // under this, a flight is mostly taxi/climb/descent
const AUTOFPS_SETTLED_PER_MIN = 1.6;// TLOD changes/min — the split that separated Dean's best flights
const ord = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };

// Rank this flight's steadiness among prior flights. frametime_stdev_ms is the metric that actually
// separates them (0.38-3.37 across Dean's log) — P99 sits in a 17.1-21.6 band where a rank is noise.
// Excluded flights never count. Returns null when there isn't enough history to say anything honest.
function rankBySteadiness(stdev, history) {
  if (stdev == null) return null;
  const prior = (history || []).filter(h => h && !h.excluded && typeof h.frametime_stdev_ms === 'number');
  if (prior.length < MIN_HISTORY_TO_RANK) return null;
  const better = prior.filter(h => h.frametime_stdev_ms < stdev).length;
  return { place: better + 1, of: prior.length + 1 };
}

// How busy AutoFPS was. A settled AutoFPS (few TLOD changes) went with Dean's steadiest flights; a
// hunting one went with his roughest. Correlation is modest (r≈0.34) so the copy stays descriptive —
// it reports what AutoFPS did, it does not claim that caused the result.
function autofpsBehaviour(trace, durationSeconds) {
  if (!trace || !Array.isArray(trace.samples) || trace.samples.length < 3 || !(durationSeconds > 0)) return null;
  let changes = 0;
  for (let i = 1; i < trace.samples.length; i++) {
    const a = trace.samples[i - 1][1], b = trace.samples[i][1];
    if (a != null && b != null && a !== b) changes++;
  }
  const perMin = changes / (durationSeconds / 60);
  const st = trace.stats || {};
  return { perMin, settled: perMin <= AUTOFPS_SETTLED_PER_MIN, med: st.tlod_med, atCap: st.pct_at_cap };
}

// Line 2 — what characterised this flight. Facts only, joined into one readable sentence.
function attribution(settings, stats, af) {
  const bits = [];
  if (settings.aircraft) bits.push(String(settings.aircraft));
  if (settings.autofps_active) {
    if (af) bits.push('AutoFPS ' + (af.settled ? 'settled' : 'busy') + ' (' + pyRound(af.perMin, 1) + ' TLOD changes/min' +
      (af.med != null ? ', typically ' + Math.round(af.med) : '') + ')');
    else bits.push('AutoFPS');
  } else if (settings.tlod != null) bits.push('fixed TLOD ' + settings.tlod);
  const payware = [];
  if (settings.dep_scenery && settings.dep_icao) payware.push(settings.dep_icao);
  if (settings.arr_scenery && settings.arr_icao) payware.push(settings.arr_icao);
  if (payware.length) bits.push('payware ' + payware.join(' and '));
  if (settings.online_traffic) bits.push(settings.online_traffic === 'batc' ? 'BeyondATC' : String(settings.online_traffic).toUpperCase());
  // Name the worst phase only when it's meaningfully worse than this flight's OWN cruise — otherwise
  // every flight gets a "worst phase" line that says nothing.
  const ph = stats.phases || {}, cruise = ph.cruise && ph.cruise.p99_ft;
  if (cruise) {
    let worstKey = null, worstV = cruise;
    for (const k of ['dep_taxi', 'climb', 'descent', 'arr_taxi']) {
      const v = ph[k] && ph[k].p99_ft;
      if (v != null && v > worstV) { worstV = v; worstKey = k; }
    }
    const LBL = { dep_taxi: 'departure taxi', climb: 'climb', descent: 'descent', arr_taxi: 'arrival taxi' };
    if (worstKey && worstV - cruise >= 2.0) bits.push(LBL[worstKey] + ' was the rough part (' + pyRound(worstV, 1) + ' ms vs ' + pyRound(cruise, 1) + ' in cruise)');
  }
  return bits.length ? bits.join(' · ') : null;
}

// Line 3 — the one thing worth acting on, or an explicit nothing. VRAM thresholds are carried over
// from the old verdict unchanged so the ceiling advice doesn't silently shift.
function watchLine(vram, stats, periodicTxtIsSevere) {
  const vpk = vram && vram.peak_pct, peakMb = vram && vram.peak_vram_mb;
  const totMb = (vram && vram.total_vram_mb) || 12288;
  const headGB = peakMb != null ? pyRound((totMb - peakMb) / 1024, 1) : null;
  if (periodicTxtIsSevere) return { text: 'Watch the periodic stutter below — that one is worth acting on.', tone: 'bad' };
  if (vpk == null) return { text: 'Nothing to act on. (VRAM wasn’t captured for this flight.)', tone: 'dim' };
  if (vpk >= 92) return { text: 'Watch VRAM — peaked at ' + pyRound(vpk, 1) + '% with ' + headGB + ' GB spare. Another payware field could run it dry.', tone: 'bad' };
  if (vpk >= 85) return { text: 'VRAM peaked at ' + pyRound(vpk, 1) + '% (' + headGB + ' GB spare) — near the ceiling, but it held.', tone: 'ok' };
  const cpuB = stats.cpu_bound_pct;
  return { text: 'Nothing to act on. VRAM peaked at ' + pyRound(vpk, 1) + '% (' + headGB + ' GB spare)' +
    (cpuB != null && cpuB > 90 ? ' with the graphics card mostly idle' : '') + '.', tone: 'dim' };
}

// Line 4 — at most one, and only when it earns its place.
function contextLine(settings, stats, history, changedKeys) {
  if (changedKeys && changedKeys.length) return changedKeys.join(' ');
  const mins = (stats.duration_seconds || 0) / 60;
  if (mins > 0 && mins < SHORT_FLIGHT_MIN) {
    return 'Short flight (' + Math.round(mins) + ' min) — these read rougher than long ones because they’re mostly taxi, climb and descent.';
  }
  return null;
}

// The whole debrief. `history` = prior index entries (chronological, this flight NOT included).
// `trace` = the autofps_trace.json sidecar or null. `changedKeys` = human labels of watched settings
// that differ from the previous flight (report_html supplies them; [] or null when nothing changed).
function buildDebrief(opts) {
  const stats = (opts && opts.stats) || {}, settings = (opts && opts.settings) || {};
  const vram = (opts && opts.vram) || null, history = (opts && opts.history) || [];
  const trace = (opts && opts.trace) || null, changedKeys = (opts && opts.changedKeys) || null;
  const severePeriodic = !!(opts && opts.severePeriodic);

  const p99 = stats.p99_ft_ms, grade = gradeP99(p99);
  const rank = rankBySteadiness(stats.frametime_stdev_ms, history);
  const af = settings.autofps_active ? autofpsBehaviour(trace, stats.duration_seconds) : null;

  const lines = [];
  // 1. grade + rank
  let headSub = 'P99 ' + (p99 != null ? pyRound(p99, 2) : '—') + ' ms';
  if (rank) headSub += ' — your ' + ord(rank.place) + ' steadiest of ' + rank.of + ' flights';
  else if ((history || []).length) headSub += ' — not enough comparable flights yet to rank it';
  // 2. attribution
  const attr = attribution(settings, stats, af);
  if (attr) lines.push({ text: attr, tone: 'body' });
  // 3. watch / nothing
  lines.push(watchLine(vram, stats, severePeriodic));
  // 4. optional context
  const ctx = contextLine(settings, stats, history, changedKeys);
  if (ctx) lines.push({ text: ctx, tone: 'dim' });

  return { word: GRADE_WORD[grade], color: GRADE_COL[grade], grade, headSub, rank, autofps: af, lines };
}

// Render to the exact markup shape the old verdict used. The outer div MUST keep the inline
// margin-top/padding-top/border-top: report.css strips them via `.mv-verdict > div:first-child`, and
// a different wrapper renders an unwanted divider (report_assets/report.css).
function debriefHtml(d, extraHtml) {
  const toneCol = { body: 'var(--text-dim)', dim: 'var(--text-dim)', ok: 'var(--text-dim)', bad: 'var(--bad)' };
  let h = '<div style="margin-top:16px;padding-top:14px;border-top:1px solid var(--border)">' +
    '<div style="font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:var(--text-faint);margin-bottom:7px">Debrief</div>' +
    '<div style="display:flex;align-items:baseline;gap:9px;flex-wrap:wrap"><span style="font-size:25px;font-weight:700;color:' + d.color + '">' + d.word + '</span>' +
    '<span style="font-size:13px;color:var(--text-dim);font-family:Consolas,monospace">' + d.headSub + '</span></div>';
  for (const l of d.lines) {
    h += '<div style="font-size:12px;color:' + (toneCol[l.tone] || 'var(--text-dim)') + ';line-height:1.6;margin-top:9px">' + l.text + '</div>';
  }
  h += (extraHtml || '') + '</div>';
  return h;
}

module.exports = { buildDebrief, debriefHtml, rankBySteadiness, autofpsBehaviour, attribution, watchLine, contextLine,
  gradeP99, MIN_HISTORY_TO_RANK, SHORT_FLIGHT_MIN, AUTOFPS_SETTLED_PER_MIN };
