'use strict';
// v6.26.0 — Plan a Flight: duration chip bands + precipitation-first "worst weather" (Dean 2026-10-30).
// Runs the REAL getRoutes / scoreMETAR / getWxPill / duration-chip code out of index.html. Guards the
// parts that could quietly lie: a band edge dropping or double-counting a route, the chip state not
// surviving a relaunch, and the weather sort ranking dry fog above real rain again (the bug this fixed).
const fs = require('fs');
const path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('route duration bands + weather scoring:');

const src = [
  X.html.split(/\r?\n/).filter(l => /^const BLOCK_PAD_MIN=|^function blockLen\(/.test(l)).join('\n'),
  X.sliceBetween('const REGION_PREFIXES', 'function getRoutes('),
  X.grab('getRoutes'),
  X.sliceBetween('const DUR_BANDS', 'function setRegion('),
  X.sliceBetween('const WX_PRECIP', 'function getWorstCategory('),
  X.grab('metarObsAgeMin'), X.grab('getWxPill'), X.grab('onSortChange'),
].join('\n');

function mk(S, els) {
  const chips = ['all', 'lt1', '1-2', '2-3', '3-5', '5p'].map(d => ({ dataset: { dur: d }, on: false,
    classList: { toggle(c, v) { this._o.on = !!v; }, _o: null } }));
  chips.forEach(c => { c.classList._o = c; });
  const document = {
    getElementById: id => (els && els[id]) || null,
    querySelectorAll: sel => sel === '[data-dur]' ? chips : [],
  };
  const saved = [];
  const window = { api: { saveConfig: c => saved.push(JSON.parse(JSON.stringify(c))) } };
  const f = new Function('S', 'document', 'window', 'RLOG', 'METAR_STALE_MIN', 'VSCORE', 'vscoreFor', 'getActiveFleet', 'fleetCodesFor', 'renderRoutes',
    '"use strict";' + src + '\nreturn {getRoutes, inDurBand, toggleDurBand, paintDurChips, scoreMETAR, scoreWxGroup, getWxPill, onSortChange, blockLen, DUR_BANDS};');
  const api = f(S, document, window, () => {}, 180, { on: false }, () => null,
    () => new Set(Object.values(S.routeRegistry).map(r => r.aircraft_type)), () => new Set(), () => {});
  return Object.assign(api, { chips, saved });
}
const baseS = reg => ({ cfg: {}, routeRegistry: reg, allRows: [], mode: '0', dirFilter: 'either', acft: 'all',
  regionFilter: 'all', acFilter: '', freshOnly: false, metarCache: {} });
const R = (id, airMin, extra) => Object.assign({ id, departure_airport: 'KAAA', arrival_airport: 'KBBB', aircraft_type: 'a320', flight_length: String(airMin) }, extra || {});

console.log('duration bands:');
{
  // block time = airborne + 25 min taxi pad — the same number the Duration column shows
  const reg = { a: R('a', 20), b: R('b', 34), c: R('c', 35), d: R('d', 60), e: R('e', 95), f: R('f', 155), g: R('g', 300) };
  const S = baseS(reg); const m = mk(S);
  T('block time = airborne + 25 (matches the Duration column)', m.blockLen('35') === 60 && m.blockLen('20') === 45);
  T('band edges are half-open: 59 → <1h, 60 → 1–2h, never both',
    m.inDurBand(59, 'lt1') && !m.inDurBand(59, '1-2') && m.inDurBand(60, '1-2') && !m.inDurBand(60, 'lt1'));
  T('5h+ has no ceiling', m.inDurBand(2000, '5p'));
  T('no bands ticked = All (every route shows)', m.getRoutes().length === 7);
  m.toggleDurBand('1-2');
  T('1–2h only → routes with 60–119 min block', m.getRoutes().map(r => r.id).sort().join() === 'c,d', m.getRoutes().map(r => r.id).join());
  m.toggleDurBand('2-3');
  T('1–2h + 2–3h → 60–179 min (multi-select adds, short hops gone)', m.getRoutes().map(r => r.id).sort().join() === 'c,d,e');
  T('chips painted: 1–2h + 2–3h lit, All dark', m.chips.find(c => c.dataset.dur === '1-2').on && m.chips.find(c => c.dataset.dur === '2-3').on && !m.chips[0].on);
  T('choice saved to config (survives relaunch)', JSON.stringify(m.saved[m.saved.length - 1].durBands) === '["1-2","2-3"]');
  m.toggleDurBand('2-3');
  T('clicking a lit band turns it off', JSON.stringify(S.durBands) === '["1-2"]');
  m.toggleDurBand('all');
  T('All clears the bands', S.durBands.length === 0 && m.chips[0].on && m.getRoutes().length === 7);
  ['lt1', '1-2', '2-3', '3-5', '5p'].forEach(b => m.toggleDurBand(b));
  T('ticking every band collapses back to All', S.durBands.length === 0 && m.chips[0].on);
}

console.log('\nworst-weather scoring (precipitation first):');
{
  const m = mk(baseS({}));
  const sc = (cat, wx, extra) => m.scoreMETAR(Object.assign({ fltCat: cat, wxString: wx, wspd: 8 }, extra || {}));
  const fog = sc('LIFR', 'FG'), dryIfr = sc('IFR', '');
  T('THE BUG: thunderstorm + rain now outranks dry LIFR fog', sc('MVFR', 'TSRA') > fog, sc('MVFR', 'TSRA') + ' vs ' + fog);
  T('every real precipitation beats dry fog (light rain, drizzle, showers, snow showers)',
    ['-RA', '-DZ', 'SHRA', 'SHSN', 'RASN'].every(w => sc('MVFR', w) > fog));
  T('showers now count (SHRA used to score 0 for the rain)', m.scoreWxGroup('SHRA') >= 6 && m.scoreWxGroup('-SHRA') > 0);
  T('mixed precip counts (RASN > RA alone)', m.scoreWxGroup('RASN') > m.scoreWxGroup('RA'));
  T('intensity orders correctly: -RA < RA < +RA', m.scoreWxGroup('-RA') < m.scoreWxGroup('RA') && m.scoreWxGroup('RA') < m.scoreWxGroup('+RA'));
  T('nearby storm (VCTS) counts but less than an overhead one', m.scoreWxGroup('VCTS') > 0 && m.scoreWxGroup('VCTS') < m.scoreWxGroup('TS'));
  T('freezing rain beats plain rain', m.scoreWxGroup('FZRA') > m.scoreWxGroup('RA'));
  T('snow outweighs rain of the same intensity', m.scoreWxGroup('SN') > m.scoreWxGroup('RA'));
  T('ceiling is now a tiebreaker: dry IFR overcast scores low', dryIfr <= 3);
  T('heavy storm with gusts is the top of the scale', sc('IFR', '+TSRA', { wspd: 25, wgst: 38 }) >= 25);
  T('CAVOK clear day stays at 0', sc('VFR', '', { rawOb: 'METAR KAAA 301200Z CAVOK' }) === 0);
  T('junk / remark tokens never throw or score', m.scoreWxGroup('RMK') === 0 && m.scoreWxGroup('') === 0 && m.scoreWxGroup('A2992') === 0);
}

console.log('\nworst-weather sort + pill (real getRoutes):');
{
  const now = new Date().toISOString();
  const reg = { fog: R('fog', 60, { departure_airport: 'KFOG', arrival_airport: 'KCLR' }),
    rain: R('rain', 60, { departure_airport: 'KRAN', arrival_airport: 'KCLR' }),
    storm: R('storm', 60, { departure_airport: 'KSTM', arrival_airport: 'KCLR' }),
    clear: R('clear', 60, { departure_airport: 'KCLR', arrival_airport: 'KCLR' }) };
  const S = baseS(reg);
  S.metarCache = {
    KFOG: { fltCat: 'LIFR', wxString: 'FG', wspd: 3, obsTime: now }, KRAN: { fltCat: 'MVFR', wxString: 'SHRA', wspd: 10, obsTime: now },
    KSTM: { fltCat: 'MVFR', wxString: 'TSRA', wspd: 12, obsTime: now }, KCLR: { fltCat: 'VFR', wxString: '', wspd: 5, obsTime: now },
  };
  const sel = { value: 'wx-worst' };
  const m = mk(S, { 'sort-f': sel });
  T('Sort: Worst weather → storm, rain, fog, clear', m.getRoutes().map(r => r.id).join() === 'storm,rain,fog,clear', m.getRoutes().map(r => r.id).join());
  sel.value = 'wx-best';
  T('Sort: Best weather still puts clear first', m.getRoutes()[0].id === 'clear');
  const pill = m.getWxPill(reg.storm, 9);
  T('route pill shows the new combined score', /MVFR \d+/.test(pill) && /Combined: \d+/.test(pill));
  sel.value = 'wx-worst'; m.onSortChange();
  T('sort choice saved to config (survives relaunch)', m.saved[m.saved.length - 1].routeSort === 'wx-worst');
}

console.log('\nwiring + real data:');
{
  const h = X.html;
  T('Duration chip row present with all 6 chips', /id="dur-row"/.test(h) && (h.match(/data-dur="/g) || []).length === 6);
  T('old "Under Xh" dropdown removed (no stale dur-f refs)', !/dur-f/.test(h));
  T('boot restores bands + sort', /S\.durBands=\(Array\.isArray\(S\.cfg\.durBands\)/.test(h) && /S\.cfg\.routeSort/.test(h));
  T('Free Route hides the duration row', /getElementById\('dur-row'\)/.test(h));
  // Dean's real registry: the band he'd pick removes every sub-1h hop
  let reg = null;
  try { reg = JSON.parse(fs.readFileSync(path.join(X.APP_DATA, 'routeRegistry.json'), 'utf8')); } catch (_) {}
  if (reg && Object.keys(reg).length) {
    const S = baseS(reg); const m = mk(S);
    const all = m.getRoutes().length;
    m.toggleDurBand('1-2'); m.toggleDurBand('2-3');
    const picked = m.getRoutes();
    T('real registry: 1–2h + 2–3h leaves no route under 60 min block (' + picked.length + ' of ' + all + ')',
      picked.length > 0 && picked.every(r => m.blockLen(r.flight_length) >= 60 && m.blockLen(r.flight_length) < 180));
  } else T('real registry not found — skipped', true);
}

process.exit(T.done() ? 1 : 0);
