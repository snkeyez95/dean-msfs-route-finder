'use strict';
// v6.17.0 — the Flight Debrief that replaced the static VERDICT block (Dean 2026-08-02: "could some
// of what we banter about replace the verdict").
//
// The debrief adds the three things the old verdict lacked: a rank against Dean's own history, an
// attribution, and an explicit "nothing to act on" when that is the truth. These assertions guard
// the parts that could quietly lie — a fabricated rank on thin history, a phase called "rough" when
// it wasn't, advice invented from missing data.
const fs = require('fs');
const path = require('path');
const T = require('./lib/extract.js').runner('flight debrief:');
const ROOT = path.resolve(__dirname, '..');
const D = require(path.join(ROOT, 'perf/native/debrief.js'));
const rhSrc = fs.readFileSync(path.join(ROOT, 'perf/native/report_html.js'), 'utf8');
const bfSrc = fs.readFileSync(path.join(ROOT, 'perf/native/backfill_phases.js'), 'utf8');
const enSrc = fs.readFileSync(path.join(ROOT, 'perf/native/engine.js'), 'utf8');
const iwSrc = fs.readFileSync(path.join(ROOT, 'perf/native/index_writer.js'), 'utf8');

const hist = n => Array.from({ length: n }, (_, i) => ({ frametime_stdev_ms: 0.5 + i * 0.05 }));
const base = extra => Object.assign({
  stats: { p99_ft_ms: 17.5, frametime_stdev_ms: 1.0, duration_seconds: 5400, cpu_bound_pct: 99 },
  settings: { aircraft: 'Fenix' }, vram: { peak_pct: 80, peak_vram_mb: 9800, total_vram_mb: 12288 },
  history: hist(40),
}, extra || {});
const textOf = d => d.lines.map(l => l.text).join(' | ');

// ── 1. the grade ladder is unchanged ────────────────────────────────────────
console.log('grade (carried over from the old verdict):');
{
  T('<= 20 ms is Smooth', D.gradeP99(17.5) === 'good' && D.gradeP99(20) === 'good');
  T('20-33.3 ms is Playable', D.gradeP99(21.58) === 'ok' && D.gradeP99(33.3) === 'ok');
  T('above 33.3 ms is Rough', D.gradeP99(40) === 'bad');
  T('missing P99 grades as n/a, it does not guess', D.gradeP99(null) === 'na');
  T('the words match what reports showed before',
    D.buildDebrief(base()).word === 'Smooth' && D.buildDebrief(base({ stats: { p99_ft_ms: 25, duration_seconds: 5400 } })).word === 'Playable');
}

// ── 2. ranking — the part that could most easily lie ────────────────────────
console.log('\nranking:');
{
  const r = D.rankBySteadiness(0.62, hist(46));
  T('ranks against prior flights and counts itself in the total', r && r.of === 47, JSON.stringify(r));
  T('a steadier flight ranks better', D.rankBySteadiness(0.4, hist(46)).place < D.rankBySteadiness(2.0, hist(46)).place);
  T('the steadiest possible flight ranks 1st', D.rankBySteadiness(0.01, hist(46)).place === 1);
  T('NO rank on thin history — under 5 prior flights returns null', D.rankBySteadiness(1.0, hist(4)) === null);
  T('...and 5 is enough', D.rankBySteadiness(1.0, hist(5)) !== null);
  T('excluded flights never count toward the rank', (() => {
    const h = hist(10).concat(Array.from({ length: 20 }, () => ({ frametime_stdev_ms: 0.1, excluded: true })));
    return D.rankBySteadiness(1.0, h).of === 11;
  })());
  T('flights without the metric are skipped, not counted as zero',
    D.rankBySteadiness(1.0, hist(6).concat([{ p99_ft_ms: 17 }, {}])).of === 7);
  T('no stdev on THIS flight → no rank', D.rankBySteadiness(null, hist(40)) === null);
  T('the headline says so plainly when it cannot rank',
    /not enough comparable flights yet/.test(D.buildDebrief(base({ history: hist(3) })).headSub));
  T('a real rank reads as an ordinal', /your \d+(st|nd|rd|th) steadiest of \d+ flights/.test(D.buildDebrief(base()).headSub));
}

// ── 3. attribution states facts, and stays quiet when it has none ───────────
console.log('\nattribution:');
{
  const af = { samples: Array.from({ length: 100 }, (_, i) => [i * 10, i % 20 === 0 ? 125 : 300]), stats: { tlod_med: 300, pct_at_cap: 70 } };
  const busy = { samples: Array.from({ length: 100 }, (_, i) => [i * 10, i % 2 === 0 ? 125 : 300]), stats: { tlod_med: 200 } };
  const settled = D.buildDebrief(base({ settings: { aircraft: 'Fenix', autofps_active: true }, trace: af }));
  T('a settled AutoFPS is described as settled', /AutoFPS settled/.test(textOf(settled)), textOf(settled));
  // 99 changes over 30 min = 3.3/min — the rate Dean's roughest flights actually ran at (EDDF-LOWS
  // was 3.9). Over 90 min the SAME trace is only 1.1/min and correctly reads as settled, which is the
  // whole point of measuring per minute rather than counting changes.
  const hunting = D.buildDebrief(base({ settings: { aircraft: 'Citation', autofps_active: true }, trace: busy,
    stats: { p99_ft_ms: 18, frametime_stdev_ms: 2.2, duration_seconds: 1800 } }));
  T('a busy AutoFPS is described as busy', /AutoFPS busy/.test(textOf(hunting)), textOf(hunting));
  T('the same trace over a long flight is settled instead — it is a RATE, not a count',
    D.autofpsBehaviour(busy, 5400).settled === true && D.autofpsBehaviour(busy, 1800).settled === false);
  T('a fixed-TLOD flight says so instead', /fixed TLOD 125/.test(textOf(D.buildDebrief(base({ settings: { aircraft: 'PMDG', tlod: 125 } })))));
  T('payware fields are named', /payware KDCA/.test(textOf(D.buildDebrief(base({ settings: { aircraft: 'Fenix', arr_icao: 'KDCA', arr_scenery: true } })))));
  T('a default airport is NOT called payware', !/payware/.test(textOf(D.buildDebrief(base({ settings: { aircraft: 'Fenix', arr_icao: 'KGPI' } })))));
  T('online traffic is named', /VATSIM/.test(textOf(D.buildDebrief(base({ settings: { aircraft: 'Fenix', online_traffic: 'vatsim' } })))));
  // the worst-phase clause must only fire when a phase is genuinely worse than that flight's own cruise
  const rough = base({ stats: { p99_ft_ms: 18, frametime_stdev_ms: 1, duration_seconds: 5400,
    phases: { cruise: { p99_ft: 17.4 }, dep_taxi: { p99_ft: 25.0 }, arr_taxi: { p99_ft: 17.9 } } } });
  T('a genuinely rough phase is named with both numbers', /departure taxi was the rough part \(25 ms vs 17.4 in cruise\)/.test(textOf(D.buildDebrief(rough))), textOf(D.buildDebrief(rough)));
  const flat = base({ stats: { p99_ft_ms: 17.5, frametime_stdev_ms: 1, duration_seconds: 5400,
    phases: { cruise: { p99_ft: 17.4 }, dep_taxi: { p99_ft: 17.6 }, arr_taxi: { p99_ft: 17.9 } } } });
  T('a flight with no standout phase says NOTHING about phases', !/rough part/.test(textOf(D.buildDebrief(flat))), textOf(D.buildDebrief(flat)));
}

// ── 4. the action line — including an honest "nothing" ──────────────────────
console.log('\nwhat to act on:');
{
  const at = pct => textOf(D.buildDebrief(base({ vram: { peak_pct: pct, peak_vram_mb: Math.round(12288 * pct / 100), total_vram_mb: 12288 } })));
  T('under 85% VRAM → nothing to act on', /Nothing to act on/.test(at(80)), at(80));
  T('85-92% → near the ceiling but it held', /near the ceiling, but it held/.test(at(88)));
  T('92%+ → watch VRAM', /Watch VRAM/.test(at(95)));
  T('the thresholds match the old verdict exactly (84/86/93)',
    /Nothing to act on/.test(at(84)) && /near the ceiling/.test(at(86)) && /Watch VRAM/.test(at(93)));
  T('a severe periodic stutter outranks the VRAM line',
    /Watch the periodic stutter/.test(textOf(D.buildDebrief(base({ severePeriodic: true })))));
  T('missing VRAM data says so rather than inventing advice',
    /VRAM wasn’t captured/.test(textOf(D.buildDebrief(base({ vram: null })))));
  T('the GPU-idle clause only appears when the flight was CPU-bound',
    /graphics card mostly idle/.test(at(80)) && !/graphics card mostly idle/.test(textOf(D.buildDebrief(base({ stats: { p99_ft_ms: 17.5, frametime_stdev_ms: 1, duration_seconds: 5400, cpu_bound_pct: 40 } })))));
}

// ── 5. the optional 4th line earns its place or stays away ──────────────────
console.log('\ncontext line:');
{
  const short = textOf(D.buildDebrief(base({ stats: { p99_ft_ms: 17.5, frametime_stdev_ms: 1, duration_seconds: 40 * 60 } })));
  T('a short flight gets the taxi/descent caveat', /Short flight \(40 min\)/.test(short));
  T('a long flight does not', !/Short flight/.test(textOf(D.buildDebrief(base()))));
  T('a settings change wins over the duration caveat', (() => {
    const d = D.buildDebrief(base({ stats: { p99_ft_ms: 17.5, frametime_stdev_ms: 1, duration_seconds: 40 * 60 },
      changedKeys: ['A watched graphics setting changed since your last flight — Settings A/B has the before and after.'] }));
    return /Settings A\/B has the before and after/.test(textOf(d)) && !/Short flight/.test(textOf(d));
  })());
  T('at most 4 lines total', D.buildDebrief(base({ stats: { p99_ft_ms: 17.5, frametime_stdev_ms: 1, duration_seconds: 40 * 60,
    phases: { cruise: { p99_ft: 17 }, dep_taxi: { p99_ft: 25 } } }, changedKeys: ['x'] })).lines.length <= 4);
}

// ── 6. degrades instead of throwing ─────────────────────────────────────────
console.log('\nmissing data:');
{
  T('no history at all', (() => { try { return !!D.buildDebrief(base({ history: [] })).word; } catch (_) { return false; } })());
  T('no settings/stats/vram at all', (() => { try { const d = D.buildDebrief({}); return d.word === '—'; } catch (_) { return false; } })());
  T('AutoFPS flagged but no trace sidecar', (() => {
    const t = textOf(D.buildDebrief(base({ settings: { aircraft: 'Fenix', autofps_active: true }, trace: null })));
    return /AutoFPS/.test(t) && !/changes\/min/.test(t);
  })());
  T('a one-sample trace cannot produce a churn figure', D.autofpsBehaviour({ samples: [[0, 300]] }, 3600) === null);
  T('zero duration cannot divide by zero', D.autofpsBehaviour({ samples: [[0, 1], [1, 2], [2, 3]] }, 0) === null);
  T('the HTML renders and keeps the wrapper report.css depends on', (() => {
    const h = D.debriefHtml(D.buildDebrief(base()), '<i>x</i>');
    return /^<div style="margin-top:16px;padding-top:14px;border-top:1px solid var\(--border\)">/.test(h) && /<i>x<\/i>/.test(h) && /Debrief/.test(h);
  })());
}

// ── 7. wiring ───────────────────────────────────────────────────────────────
console.log('\nwiring:');
{
  T('report_html builds the debrief instead of the old verdict',
    /const debrief = buildDebrief\(/.test(rhSrc) && !/letter-spacing:\.12em;text-transform:uppercase;color:var\(--text-faint\);margin-bottom:7px">Verdict</.test(rhSrc));
  T('the spike + periodic lines are preserved, not rewritten',
    /debriefHtml\(debrief,\s*\n?\s*\(spikeTxt/.test(rhSrc) && /periodicTxt\)/.test(rhSrc));
  T('buildReport takes history, defaulting harmlessly', /simVersion, history\)\{/.test(rhSrc));
  T('the capture path passes prior sessions', /buildReport\([\s\S]{0,160}priorSessions\)/.test(enSrc));
  T('...and reuses ONE index read rather than adding one', /priorSessions = \(readIndex\(sessionsDir\)\.sessions/.test(enSrc));
  T('the backfill passes each flight its predecessors', /priorOf = cur => allSessions\.slice\(0, Math\.max\(allSessions\.indexOf\(cur\), 0\)\)/.test(bfSrc));
  T('the ranking metric is written to the index', /frametime_stdev_ms: smoothness\.frametime_stdev_ms/.test(enSrc)
    && /"frametime_stdev_ms"/.test(iwSrc));
  T('older index entries get it backfilled', /frametime_stdev_ms: sm\.frametime_stdev_ms/.test(bfSrc));
  T('debrief.js does not REQUIRE report_combined (that would be a cycle — the comment naming it is fine)',
    !/require\(['"]\.\/report_combined/.test(fs.readFileSync(path.join(ROOT, 'perf/native/debrief.js'), 'utf8')));
}

// ── 8. real flights ─────────────────────────────────────────────────────────
console.log('\nreal reports (skipped if unavailable):');
{
  const S = path.join(process.env.APPDATA || '', 'A Better Route Planner', 'Sessions');
  const grab = f => { try { return fs.readFileSync(path.join(S, f.replace(/\//g, path.sep), 'report.html'), 'utf8'); } catch (_) { return null; } };
  const smooth = grab('2026-08-01/2211_TLOD125_OLOD120');     // Fenix, VRAM 95.4%
  const rough = grab('2026-07-27/2053_TLOD125_OLOD120');      // Citation, real periodic overload
  if (!smooth || !rough) { console.log('  (reference reports not on this machine — skipped)'); }
  else {
    T('the smooth flight is graded Smooth and ranked', /Debrief/.test(smooth) && /steadiest of \d+ flights/.test(smooth));
    T('it names the VRAM ceiling it actually hit', /Watch VRAM — peaked at 95.4%/.test(smooth));
    T('its quoted worst frame matches the summary (the v6.17.0 trim fix)', /Worst single frame 116\.1 ms/.test(smooth));
    T('the rough flight is graded Playable, not Smooth', /Playable/.test(rough) && !/>Smooth</.test(rough));
    T('it points at the periodic stutter as the thing to act on', /Watch the periodic stutter below/.test(rough));
    T('it carries the short-flight caveat', /Short flight \(40 min\)/.test(rough));
    T('neither report still says "Verdict"', !/>Verdict</.test(smooth) && !/>Verdict</.test(rough));
  }
}

process.exit(T.done() ? 1 : 0);
