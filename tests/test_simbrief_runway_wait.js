'use strict';
// v6.32.1: Open in SimBrief waits for a still-loading ATIS before sending runways. Dean's KBOS→KDCA
// 2026-11-18: SimBrief opened 11 s before KBOS's SI ATIS arrived, got no origrwy and picked 33L while
// the ATIS said "DPTG RWYS 22L, 22R". Runs the REAL fetchDatis wrapper, siWxFetch, siAtisData,
// datisBlockFor, datisActiveRwy and sbOpenWithRunways from index.html with stubbed network calls.
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
function grab(name) {
  let i = html.indexOf('async function ' + name + '('); if (i < 0) i = html.indexOf('function ' + name + '(');
  if (i < 0) throw new Error('fn ' + name);
  const st = html.lastIndexOf('\n', i) + 1; let d = 0, s = false;
  for (let j = i; j < html.length; j++) { if (html[j] === '{') { d++; s = true; } else if (html[j] === '}') { d--; if (s && d === 0) return html.slice(st, j + 1); } }
}
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m + (x !== undefined ? '  → ' + JSON.stringify(x) : '')); } };
const KBOS_ATIS = 'BOSTON LOGAN INTL ARPT, INFO QUEBEC. 1754Z. ARVG RWYS 22L, 27. DPTG RWYS 22L, 22R. RWYS 14, 15L, 32 AND 33R CLSD. WIND 270 AT 13. VIS 10. FEW AT 25000. TEMP 17, DP 3. ALTIM 30.32. DENSITY ALT -100 FT. ILS RWY 22L AND RNAV RWY 27 APCHS IN USE. VISUAL APCHS IN USE. CTN UNKNOWN DRONE ACTIVITY IN THE AREA. ILS RWY 15R OTS. ILS RWY 27 OTS. ILS RWY 33L OTS. ADVS ON COURSE HDG, ALT, AND IF FLIGHT FOLLOWING IS REQUESTED. RDBK ALL RWY AND HOLD SHORT INSTR. ADVS ON INITIAL CTC YOU HAVE INFO QUEBEC.';

function makeEnv(opts) {
  const opened = [], toasts = [], logs = [], netCalls = [];
  const S = { cfg: { siApiKey: 'k' }, datisCache: {}, siWxCache: {} };
  const env = {
    S, window: { api: {
      openExternal: u => opened.push(u),
      siFetchWx: async ({ icao }) => { netCalls.push(icao); await new Promise(r => setTimeout(r, opts.siDelay || 5)); return { ok: true, data: { airports: [{ airport: icao, atis: icao === 'KBOS' ? KBOS_ATIS : 'DCA INFO A. 1752Z. ARVG RWY 01. DPTG RWY 01.', active_runway: '' }] } }; } } },
    gsxToast: m => toasts.push(m), RLOG: m => logs.push(m),
  };
  const sbWait = opts.wait || 10000;
  const code = grab('siWxFetch') + '\n' + grab('_siWxFetchNet') + '\n' + grab('siAtisData') + '\n' + grab('datisBlockFor') + '\n' + grab('datisActiveRwy') + '\n'
    + 'function extractRunways(){return [];}\n'
    + html.slice(html.indexOf('const SB_RWY_WAIT_MS='), html.indexOf(';', html.indexOf('const SB_RWY_WAIT_MS=')) + 1).replace(/=\d+;/, '=' + sbWait + ';') + '\n'
    + grab('sbOpenWithRunways') + '\n' + grab('fetchDatis') + '\n'
    // stand-in for the real loader: fetch SI and cache it the way _fetchDatisInner does
    + 'async function _fetchDatisInner(icao){ await siWxFetch(icao); const d=siAtisData(icao); if(d) S.datisCache[icao.toUpperCase()]={data:d,ts:Date.now(),si:true}; }\n'
    + 'return {fetchDatis, sbOpenWithRunways, siWxFetch, siAtisData};';
  const F = new Function(...Object.keys(env), code)(...Object.values(env));
  return { F, S, opened, toasts, logs, netCalls };
}

(async () => {
  console.log('1. the real KBOS ATIS text');
  {
    const E = makeEnv({});
    await E.F.siWxFetch('KBOS');
    const d = E.F.siAtisData('KBOS');
    ok(d.dep.siRwy === '22L' && d.arr.siRwy === '22L', 'reads departure 22L and arrival 22L from "DPTG RWYS 22L, 22R" / "ARVG RWYS 22L, 27" (not 33L from "ILS RWY 33L OTS")', d && [d.dep.siRwy, d.arr.siRwy]);
  }
  console.log('2. click SimBrief while the ATIS is still loading (the bug)');
  {
    const E = makeEnv({ siDelay: 60 });
    E.F.fetchDatis('KBOS', 0, 'dep', ''); E.F.fetchDatis('KDCA', 0, 'arr', '');
    await E.F.sbOpenWithRunways('KBOS', 'KDCA', 'https://dispatch.simbrief.com/options/custom?orig=KBOS&dest=KDCA');
    ok(E.opened.length === 1 && /origrwy=22L/.test(E.opened[0]) && /destrwy=01/.test(E.opened[0]), 'waits for the ATIS, then sends origrwy=22L and destrwy=01', E.opened);
    ok(E.toasts.some(t => /Getting active runways/.test(t)), 'tells you it is getting the runways');
    ok(E.logs.some(l => /SimBrief: dep KBOS RWY 22L · arr KDCA RWY 01 \(waited for ATIS\)/.test(l)), 'logs exactly what was sent', E.logs);
  }
  console.log('3. ATIS already loaded → opens immediately');
  {
    const E = makeEnv({});
    await E.F.fetchDatis('KBOS', 0, 'dep', ''); await E.F.fetchDatis('KDCA', 0, 'arr', '');
    const t0 = Date.now();
    await E.F.sbOpenWithRunways('KBOS', 'KDCA', 'https://x/?orig=KBOS');
    ok(Date.now() - t0 < 30 && /origrwy=22L/.test(E.opened[0]) && !E.toasts.length, 'no wait, no toast, runways sent');
  }
  console.log('4. ATIS never arrives in time → opens anyway and says so');
  {
    const E = makeEnv({ siDelay: 400, wait: 40 });
    E.F.fetchDatis('KBOS', 0, 'dep', '');
    await E.F.sbOpenWithRunways('KBOS', 'KDCA', 'https://x/?orig=KBOS');
    ok(E.opened.length === 1 && !/origrwy=/.test(E.opened[0]), 'opens SimBrief after the wait limit, without a runway');
    ok(E.toasts.some(t => /No active runway yet for KBOS/.test(t)), 'warns that SimBrief will pick one');
  }
  console.log('5. one SI request per airport');
  {
    const E = makeEnv({ siDelay: 20 });
    await Promise.all([E.F.siWxFetch('KBOS'), E.F.siWxFetch('KBOS'), E.F.siWxFetch('kbos')]);
    ok(E.netCalls.length === 1, 'three simultaneous KBOS requests → one network call', E.netCalls);
  }
  console.log('6. runway table lookup no longer blocks the ATIS');
  {
    const inner = grab('_fetchDatisInner');
    const iP = inner.indexOf('const _rwyP=fetchRwyData(icao)'), iSI = inner.indexOf('await siWxFetch(icao)'), iW = inner.indexOf('await _rwyP;'), iB = inner.indexOf('const block=datisBlockFor(data,side)');
    ok(iP > 0 && iP < iSI && iW > iSI && iW < iB && !/await fetchRwyData\(icao\)/.test(inner), 'runway table starts first, runs alongside the ATIS, and is awaited before the runway is read');
  }
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('  FAIL crash ' + e.stack); process.exit(1); });
