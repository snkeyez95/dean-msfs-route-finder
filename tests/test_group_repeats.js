'use strict';
// v6.35.0 "Group repeats" in Plan a Flight: one row per route + airline + aircraft, ×N tag, usual
// (median) duration, the flights listed in the open row (pick one → SimBrief), switch off = full list.
// Runs the REAL getRoutes + getDisplayRoutes + renderRoutes from index.html against Dean's real registry.
const fs = require('fs'), path = require('path');
const X = require('./lib/extract.js');
const T = X.runner('group repeats:');
const html = X.html;
const line = re => html.split(/\r?\n/).filter(l => re.test(l)).join('\n');
const src = [
  line(/^const BLOCK_PAD_MIN=|^function blockLen\(/), X.grab('fmtFlightLen'),
  X.sliceBetween('const REGION_PREFIXES', 'function getRoutes('),
  X.grab('getRoutes'),
  X.sliceBetween('const DUR_BANDS', 'function setRegion('),
  X.grab('routeGroupKey'), X.grab('groupRepeatsOn'), X.grab('getDisplayRoutes'), X.grab('toggleGroupRepeats'), X.grab('paintGroupChip'), X.grab('pickGroupFlight'), X.grab('_grpFlightsHtml'),
  X.grab('renderRoutes'), X.grab('esc'),
].join('\n');

function mk(S) {
  const els = {}; const el = id => (els[id] = els[id] || { innerHTML: '', textContent: '', value: '', style: {}, classList: { toggle() {}, add() {}, remove() {} } });
  const document = { getElementById: el, querySelectorAll: () => [] };
  const window = { api: { saveConfig() {} } };
  const stubs = { S, document, window, RLOG() {}, METAR_STALE_MIN: 180, VSCORE: { on: false }, vscoreFor: () => null,
    getActiveFleet: () => new Set(Object.values(S.routeRegistry).map(r => r.aircraft_type)), fleetCodesFor: c => new Set([c]),
    getWxPill: () => '<span>wx</span>', getVatsimPill: () => '', vscoreDetailRow: () => '', populateAirlineDropdown() {}, freshNoteHtml: () => '', updateStats() {},
    renderFreeRouteResults() {}, vatsimFeedGet: async () => ({}), routeNm: () => 100, AI: {}, SI_ACFT_MAP: {}, FLEET_LBL: {}, SIM_LBL: {}, fmtFirstSeen: () => '',
    freshBuild: () => null, freshCfg: () => ({}), freshHides: () => false, sceneryBtnHtml: () => '', hydrateOpenRoute() {}, wxBlock: () => '', qlBtnHtml: () => '', console: { log() {} } };
  const f = new Function(...Object.keys(stubs), src + '\nreturn {getRoutes, getDisplayRoutes, toggleGroupRepeats, pickGroupFlight, renderRoutes};');
  return Object.assign(f(...Object.values(stubs)), { els });
}
const baseS = reg => ({ cfg: {}, routeRegistry: reg, allRows: [], selICAOs: new Set(), mode: '0', dirFilter: 'either', acft: 'all', regionFilter: 'all', acFilter: '', freshOnly: false, metarCache: {}, durBands: [], openRoute: null });

console.log('1. grouping rules (synthetic)');
{
  const reg = {};
  const add = (id, dep, arr, al, ac, min, seen, cs) => { reg[id] = { id, departure_airport: dep, arrival_airport: arr, airline: al, aircraft_type: ac, flight_length: String(min), times_seen: seen, callsign: cs, gate_origin: 'A' + id }; };
  add('1', 'KDEN', 'KHDN', 'United (UAL)', 'A319', 47, 1, 'UAL2045'); add('2', 'KDEN', 'KHDN', 'United (UAL)', 'A319', 52, 3, 'UAL2173'); add('3', 'KDEN', 'KHDN', 'United (UAL)', 'A319', 57, 2, 'UAL2201');
  add('4', 'KDEN', 'KHDN', 'Southwest (SWA)', 'B737', 50, 1, 'SWA167');   // different airline + aircraft → own row
  add('5', 'KHDN', 'KDEN', 'United (UAL)', 'A319', 50, 1, 'UAL2100');      // reverse direction → own row
  const S = baseS(reg); const A = mk(S);
  const d = A.getDisplayRoutes();
  T('3 United A319 KDEN→KHDN flights become 1 row; other airline and reverse direction stay separate', d.length === 3, d.map(r => r.id));
  const g = d.find(r => r._grp);
  T('the group shows the most-seen flight (UAL2173, seen 3×) by default', g && g.callsign === 'UAL2173' && g._grp.n === 3);
  T('usual duration = median 52 min, range 47–57', g._grp.med === 52 && g._grp.min === 47 && g._grp.max === 57);
  A.pickGroupFlight(g._grp.key, '3');
  T('picking a flight makes it the one shown (and sent to SimBrief)', A.getDisplayRoutes().find(r => r._grp).callsign === 'UAL2201');
  A.toggleGroupRepeats();
  T('switching it off brings back every flight (5 rows)', A.getDisplayRoutes().length === 5 && S.cfg.groupRepeats === false);
  A.toggleGroupRepeats();
  T('switching it on again regroups (3 rows)', A.getDisplayRoutes().length === 3 && S.cfg.groupRepeats === true);
  A.renderRoutes();
  const body = A.els['rt-body'].innerHTML, cnt = A.els['rcnt'].textContent;
  T('row shows the ×3 tag and "~" usual duration', /×3<\/span>/.test(body) && /~1h 17m/.test(body), body.slice(0, 200));   // 52 + 25 taxi = 77
  T('count line says routes and flights', cnt === '3 routes found · 5 flights', cnt);
  S.openRoute = 0; A.renderRoutes();
  const open = A.els['rt-body'].innerHTML;
  T('open row lists the 3 flights with the picked one marked', /3 flights on this route/.test(open) && /✓ UAL2201/.test(open) && /UAL2045/.test(open) && /UAL2173/.test(open));
  T('SimBrief link uses the picked flight number', /fltnum=2201/.test(open));
}
console.log('2. wiring');
T('open-route weather/ATIS fetch uses the same list as the rows', /const r=getDisplayRoutes\(\)\[S\.openRoute\];/.test(html));
T('Group repeats chip is next to Fresh and painted at start-up', /id="group-toggle-btn" onclick="toggleGroupRepeats\(\)"/.test(html) && /paintFreshChips\(\); paintGroupChip\(\);/.test(html));
T('CSV export still lists every flight (uses getRoutes)', /function exportCSV|Callsign,Airline,Dep,Arr/.test(html) && !/getDisplayRoutes\(\)\.map\(r=>\{\s*const simAcft/.test(html));

console.log('3. Dean\'s real routes (read-only)');
const UD = path.join(process.env.APPDATA || '', 'A Better Route Planner');
if (fs.existsSync(path.join(UD, 'routeRegistry.json'))) {
  const reg = JSON.parse(fs.readFileSync(path.join(UD, 'routeRegistry.json'), 'utf8'));
  const S = baseS(reg); const A = mk(S);
  const all = A.getRoutes(), d = A.getDisplayRoutes();
  T('whole registry: ' + all.length + ' flights → ' + d.length + ' rows', d.length < all.length * 0.8 && d.reduce((n, r) => n + (r._grp ? r._grp.n : 1), 0) === all.length);
  const den = d.filter(r => r.departure_airport === 'KDEN' && r.arrival_airport === 'KHDN' && /United/.test(r.airline || ''));
  T('KDEN→KHDN United: ' + den.map(r => r.aircraft_type + ' ×' + (r._grp ? r._grp.n : 1)).join(', '), den.length >= 1 && den.every(r => !d.some(o => o !== r && routeKey(o) === routeKey(r))));
  function routeKey(r) { return r.departure_airport + r.arrival_airport + r.airline + r.aircraft_type; }
  S.cfg.groupRepeats = false;
  T('switched off: the full ' + all.length + ' flights again', A.getDisplayRoutes().length === all.length);
} else console.log('  skip real data');

T.done();
