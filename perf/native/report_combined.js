'use strict';
// Phase 8a — native port of rebuild_combined_report (msfs_perf_logger.py:2154): the combined dashboard
// (Sessions/combined_report.html). PORT — must byte-match Python (validated by _parity_combined.js).
const A = require('./report_assets.js');
const { pyRound, pySum } = require('./stats.js');
const RC = require('./report_charts.js');
const { computeCoverage, COVERAGE_AIRCRAFT, COVERAGE_TLODS } = require('./coverage.js');
const { pyJson, htmlEscape, floatRepr } = require('./report_html.js');

const PInt = n => ({ __int: n });
const isPrimary = ac => COVERAGE_AIRCRAFT.includes(ac);
function gradeP99(p99){ if(p99 == null) return 'na'; if(p99 <= 20) return 'good'; if(p99 <= 33.3) return 'ok'; return 'bad'; }

function buildCombinedReport(sessions){
  const allSessions = sessions || [];
  // Excluded flights (confounded runs, e.g. flown with BATC unlike the rest of the benchmark) stay
  // in the flight TABLE (data is never hidden) but leave every average, chart, card, and the
  // coverage panel — same rule the app's tracker and auto-TLOD follow.
  sessions = allSessions.filter(s => !s.excluded);
  const by = new Map();              // key "ac|tl" -> {ac, tl, p99:[], vram:[]}
  const tlodSet = new Set();
  for(const s of sessions){
    const tl = s.tlod, p = s.p99_ft_ms;
    if(tl == null || p == null) continue;
    tlodSet.add(tl);
    const ac = s.aircraft || 'Other', k = ac + '|' + tl;
    if(!by.has(k)) by.set(k, { ac, tl, p99: [], vram: [] });
    by.get(k).p99.push(p);
    const v = s.peak_vram_mb; if(v) by.get(k).vram.push(v);
  }
  const tlods = [...tlodSet].sort((a, b) => a - b);

  function series(metric, ac){
    const out = [];
    for(const tl of tlods){
      let vals = [];
      for(const d of by.values()){
        if(d.tl !== tl || (ac && d.ac !== ac)) continue;
        if(ac == null && !isPrimary(d.ac)) continue;
        vals = vals.concat(d[metric]);
      }
      if(!vals.length) out.push(null);
      else if(metric === 'vram') out.push(pyRound(pySum(vals) / vals.length / 1024, 1));
      else out.push(pyRound(pySum(vals) / vals.length, 1));
    }
    return out;
  }
  const counts = {};
  for(const tl of tlods){ let c = 0; for(const s of sessions) if(s.tlod === tl && s.p99_ft_ms != null && isPrimary(s.aircraft)) c++; counts[tl] = c; }

  const DD = {
    tlods: tlods.map(PInt),
    counts: Object.fromEntries(tlods.map(t => [String(t), PInt(counts[t])])),
    p99: { combined: series('p99', null), fenix: series('p99', 'Fenix'), pmdg: series('p99', 'PMDG') },
    vram: { combined: series('vram', null), fenix: series('vram', 'Fenix'), pmdg: series('vram', 'PMDG') },
  };
  const ddJson = pyJson(DD);

  function aircraftCard(ac, dot, sub){
    const flights = sessions.filter(s => s.aircraft === ac && s.p99_ft_ms != null);
    if(!flights.length) return '';
    const p99s = flights.map(s => s.p99_ft_ms);
    const tlList = [...new Set(flights.filter(s => s.tlod != null).map(s => s.tlod))].sort((a, b) => a - b);
    const avgp = pyRound(pySum(p99s) / p99s.length, 1), bestp = pyRound(Math.min(...p99s), 1);
    const subHtml = sub ? '<div class="lab" style="margin-top:-4px;font-size:10px">' + sub + '</div>' : '';
    return '<div class="panel acard"><div class="name">' +
      '<span class="dot" style="background:' + dot + '"></span>' + htmlEscape(ac) + '</div>' + subHtml +
      '<div class="agrid">' +
      '<div><div class="lab">Flights</div><div class="aval">' + flights.length + '</div></div>' +
      '<div><div class="lab">Avg P99</div><div class="aval g-' + gradeP99(avgp) + '">' + floatRepr(avgp) + ' ms</div></div>' +
      '<div><div class="lab">Best P99</div><div class="aval g-' + gradeP99(bestp) + '">' + floatRepr(bestp) + ' ms</div></div>' +
      '<div><div class="lab">TLODs</div><div class="aval" style="font-size:13px">' +
      (tlList.map(String).join('·') || '—') + '</div></div>' +
      '</div></div>';
  }

  let cardsHtml = COVERAGE_AIRCRAFT.map(ac => aircraftCard(ac, ac === 'Fenix' ? 'var(--fenix)' : 'var(--pmdg)', '')).join('');
  if(!cardsHtml) cardsHtml = '<div class="panel acard"><div class="lab">No flights logged yet.</div></div>';

  const refAcs = [...new Set(sessions.filter(s => s.aircraft && s.p99_ft_ms != null && !isPrimary(s.aircraft)).map(s => s.aircraft))].sort();
  const refCards = refAcs.map(ac => aircraftCard(ac, 'var(--accent)', 'reference · not in baseline')).join('');
  let refCardsHtml = '', refToggleHtml = '';
  if(refCards){
    refCardsHtml = '<div class="cards" id="refCards"><button class="toggle" id="refHideBtn" onclick="toggleRef()" style="align-self:flex-start">Hide reference</button>' + refCards + '</div>' +
      '<button class="toggle" id="refShowBtn" onclick="toggleRef()" style="display:none;margin:0 0 12px">Show reference aircraft</button>';
    refToggleHtml = '<label class="tchip" id="refRowChip" style="margin-right:6px"><input type="checkbox" id="refRows" checked onchange="toggleRefRows(this.checked)"/> Include reference</label>';
  }

  // flight table (sorted by timestamp desc, stable) — includes excluded flights, marked
  const ordered = allSessions.map((s, i) => [s, i]).sort((a, b) => { const x = a[0].timestamp || '', y = b[0].timestamp || ''; if(x < y) return 1; if(x > y) return -1; return a[1] - b[1]; }).map(p => p[0]);
  let rows = '';
  for(const s of ordered){
    const p = s.p99_ft_ms, gr = gradeP99(p), vmb = s.peak_vram_mb;
    const vdisp = vmb ? RC.fmt(vmb / 1024, 1) + ' GB' : 'n/a';
    const ac = s.aircraft || 'n/a', tl = s.tlod, tld = tl != null ? String(tl) : 'n/a';
    const folder = (s.folder || '').replace(/\\/g, '/');
    const href = folder ? folder + '/report.html' : '';
    // v6.3.8: ✳ next to an airport in the route when it's a 3rd-party scenery the user owns.
    const route = RC.displayRoute(s.route || '');
    let rdisp = route ? htmlEscape(route) : '—';
    if (route && (s.dep_scenery || s.arr_scenery)) {
      const m = /^([A-Z]{3,4})-([A-Z]{3,4})$/.exec(route.toUpperCase());
      if (m) rdisp = htmlEscape(m[1]) + (s.dep_scenery ? '✳' : '') + '-' + htmlEscape(m[2]) + (s.arr_scenery ? '✳' : '');
    }
    const link = href ? '<a href="' + href + '" style="color:var(--accent);text-decoration:none">open</a>' : '';
    const prim = isPrimary(s.aircraft) ? '1' : '0';
    rows += '<tr data-tlod="' + tld + '" data-primary="' + prim + '">' +
      '<td>' + (s.timestamp_display || '') + '</td>' +
      '<td>' + htmlEscape(ac) + (s.excluded ? ' <span style="color:var(--text-faint);font-size:9px" title="Confounded run — kept for reference, not counted in any average, chart, or the coverage grid">excluded</span>' : '') + '</td><td class="mono">' + rdisp + '</td>' +
      '<td class="mono">' + (s.driver_version || 'n/a') + '</td>' +
      '<td class="mono">' + tld + '</td>' +
      '<td class="mono g-' + gr + '">' + floatRepr(p) + ' ms</td>' +
      '<td class="mono">' + (s.stutter_pct != null ? floatRepr(s.stutter_pct) : 'n/a') + '%</td>' +
      '<td class="mono">' + vdisp + '</td><td>' + link + '</td></tr>';
  }
  if(!rows) rows = '<tr><td colspan="9" style="color:var(--text-faint)">No flights logged yet.</td></tr>';

  // knee note
  const comb = DD.p99.combined;
  const smooth = tlods.map((t, i) => [t, comb[i]]).filter(([, v]) => v != null && v <= 20);
  let knee = '';
  if(smooth.length){ let bt = smooth[0][0], bp = smooth[0][1]; for(const [t, v] of smooth) if(t > bt){ bt = t; bp = v; } knee = 'Highest TLOD still smooth (avg P99 &le; 20ms): <b>TLOD ' + bt + '</b> at ' + floatRepr(bp) + 'ms avg. '; }
  knee += 'Note: averages can mix drivers — use the table\'s driver column to sanity-check before comparing TLODs head to head.';

  const nFlights = sessions.filter(s => s.p99_ft_ms != null && isPrimary(s.aircraft)).length;
  const nRef = sessions.filter(s => s.p99_ft_ms != null && !isPrimary(s.aircraft)).length;
  const aircraftPresent = [...new Set(sessions.filter(s => s.aircraft && s.p99_ft_ms != null && isPrimary(s.aircraft)).map(s => s.aircraft))].sort();
  const drivers = [...new Set(sessions.filter(s => s.driver_version).map(s => s.driver_version))].sort();
  const tlodRange = tlods.length > 1 ? (tlods[0] + '–' + tlods[tlods.length - 1]) : (tlods.length ? String(tlods[0]) : '—');
  const chips = '<span class="chip">Aircraft <b>' + htmlEscape(aircraftPresent.join(', ') || '—') + '</b></span>' +
    '<span class="chip">TLOD <b>' + tlodRange + '</b></span>' +
    '<span class="chip">Drivers <b>' + drivers.length + ' tested</b></span>';

  // coverage panel
  const cov = computeCoverage(sessions), tgt = cov.target;
  let covGrid = '<table class="covgrid"><tr><th></th>' + COVERAGE_TLODS.map(t => '<th>' + t + '</th>').join('') + '</tr>';
  for(const ac of COVERAGE_AIRCRAFT){
    covGrid += '<tr><td class="lbl">' + ac + '</td>';
    for(const t of COVERAGE_TLODS){ const c = cov.counts[ac + '|' + t]; const cls = c === 0 ? 'cov0' : (c < tgt ? 'cov1' : 'cov3'); covGrid += '<td><span class="covcell ' + cls + '">' + c + '/' + tgt + '</span></td>'; }
    covGrid += '</tr>';
  }
  covGrid += '</table>';
  let covRec, covNext = '';
  if(cov.gaps.length){
    const g0 = cov.gaps[0];
    covRec = 'Fly next → <span class="pick">' + g0.aircraft + ' @ TLOD ' + g0.tlod + '</span> (' + g0.count + ' of ' + tgt + ')';
    const nxt = cov.gaps.slice(0, 4).map(g => g.aircraft + ' ' + g.tlod).join(', ');
    covNext = '<div class="covnext">Next up: ' + nxt + ' · <b>' + cov.total_remaining + ' flights</b> to a full set</div>';
  } else covRec = 'Coverage complete — even spread reached, ready to finalize a TLOD.';
  const coveragePanel = '<div class="panel" id="covpanel" style="margin-bottom:12px"><div class="panel-h">' +
    'Coverage &amp; what to fly next</div><div class="covbody">' +
    '<div class="covrec">' + covRec + '</div>' + covGrid + covNext +
    '<div class="covnote">Target ' + tgt + ' flights per cell · floor TLOD 100 (80 excluded as visually-safe)</div></div></div>';

  return `<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Performance — All Flights</title>
<style>${A.THEME_BASE_CSS}${A.DASH_CSS}</style>
</head>
<body>
  <header>
    <div>
      <div class="title">Performance — All Flights</div>
      <div class="sub mono">${nFlights} baseline flights logged${nRef ? ' · ' + nRef + ' reference' : ''}</div>
    </div>
    <div class="chips">${chips}</div>
    <div class="spacer"></div>
    <button class="toggle" id="themeBtn" onclick="toggleTheme()">◐ Light</button>
  </header>

  <div class="cards">${cardsHtml}</div>
  ${refCardsHtml}

  ${coveragePanel}

  <div class="ctrls">
    <div class="seg">
      <button id="segCombined" class="active" onclick="setView('combined')">Combined</button>
      <button id="segByAc" onclick="setView('byac')">By aircraft</button>
    </div>
    <div class="spacer" style="flex:1"></div>
    ${refToggleHtml}
    <span style="font-size:11px;color:var(--text-faint)">Show TLOD:</span>
    <div class="tlodf" id="tlodFilter"></div>
  </div>

  <div class="charts">
    <div class="panel">
      <div class="panel-h">Avg P99 frametime by TLOD · ms (lower = smoother)</div>
      <div class="graph-wrap"><div id="chartP99"></div></div>
      <div class="legend" id="legP99"></div>
    </div>
    <div class="panel">
      <div class="panel-h">Avg peak VRAM by TLOD · GB (headroom to 12 GB)</div>
      <div class="graph-wrap"><div id="chartVram"></div></div>
      <div class="legend" id="legVram"></div>
    </div>
  </div>

  <div class="note">${knee}</div>

  <table>
    <thead><tr><th>When</th><th>Aircraft</th><th>Route</th><th>Driver</th><th>TLOD</th>
      <th>P99</th><th>Stutter</th><th>VRAM peak</th><th></th></tr></thead>
    <tbody id="tbody">${rows}</tbody>
  </table>

<script>var DD = ${ddJson};</script>
<script>${A.THEME_JS}</script>
<script>${A.DASH_JS}</script>
</body>
</html>`;
}

module.exports = { buildCombinedReport, gradeP99 };
