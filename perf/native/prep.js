'use strict';
// perf/native/prep.js — native --prep-next (auto-TLOD). PORT of get_simbrief_aircraft /
// _normalize_simbrief_aircraft / backup_usercfg / write_settings / prep_next_tlod. Picks the TLOD that
// fills the thinnest coverage gap for the SimBrief aircraft and writes it to UserCfg.opt (backed up).
// Coverage/next-gap and the UserCfg text transform (writeSettingsText) are already byte-proven; this
// adds the SimBrief fetch + the read/backup/write/verify orchestration.
const fs = require('fs'), path = require('path'), https = require('https');
const { computeCoverage, nextGapForAircraft } = require('./coverage.js');
const { readSettings, writeSettingsText } = require('./settings.js');

const CITATION_LABEL = 'Citation Sovereign+';
const p2 = n => String(n).padStart(2, '0');

function normalizeSimbriefAircraft(...cands) {
  const blob = cands.filter(Boolean).map(String).join(' ').toLowerCase();
  if (blob.includes('fenix') || ['a318', 'a319', 'a320', 'a321'].some(a => blob.includes(a))) return 'Fenix';
  if (blob.includes('pmdg') || ['b737', 'b738', 'b739', '737', '738', '739'].some(b => blob.includes(b))) return 'PMDG';
  if (blob.includes('sovereign') || ['c68a', 'c680'].some(c => blob.includes(c))) return CITATION_LABEL;
  return null;
}

function tagIn(scope, tag) {
  const m = new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(scope);
  return m ? m[1].trim() : '';
}
function parseSimbriefAircraft(xml) {
  const am = /<aircraft\b[^>]*>([\s\S]*?)<\/aircraft>/i.exec(xml);
  const scope = am ? am[1] : xml;
  const code = tagIn(scope, 'icaocode') || tagIn(scope, 'icao_code') || tagIn(scope, 'base_type');
  const name = tagIn(scope, 'name');
  const reg  = tagIn(scope, 'reg');
  return [code || name || reg || null, normalizeSimbriefAircraft(code, name, reg)];
}

function getSimbriefAircraft(username) {
  return new Promise((resolve) => {
    if (!username) return resolve([null, null]);
    const url = 'https://www.simbrief.com/api/xml.fetcher.php?username=' + encodeURIComponent(username);
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => { try { resolve(parseSimbriefAircraft(data)); } catch (_) { resolve([null, null]); } });
    });
    req.on('error', () => resolve([null, null]));
    req.on('timeout', () => { req.destroy(); resolve([null, null]); });
  });
}

function backupUsercfg(usercfgPath, backupDir) {
  fs.mkdirSync(backupDir, { recursive: true });
  const d = new Date();
  const stamp = d.getFullYear() + '-' + p2(d.getMonth() + 1) + '-' + p2(d.getDate()) + '_' +
                p2(d.getHours()) + p2(d.getMinutes()) + p2(d.getSeconds());
  const dest = path.join(backupDir, 'UserCfg_' + stamp + '.opt');
  fs.copyFileSync(usercfgPath, dest);
  const orig = path.join(backupDir, 'UserCfg_ORIGINAL.opt');   // keep a pristine first-ever copy
  if (!fs.existsSync(orig)) fs.copyFileSync(usercfgPath, orig);
  return dest;
}

// Read + backup + surgically set TLOD/OLOD + write + verify-readback. Returns {ok, msg}.
function writeSettings(usercfgPath, backupDir, tlod, olod) {
  if (!fs.existsSync(usercfgPath)) return { ok: false, msg: 'UserCfg.opt not found at ' + usercfgPath };
  let text;
  try { text = fs.readFileSync(usercfgPath, 'utf8'); }
  catch (e) { return { ok: false, msg: 'Could not read UserCfg.opt: ' + e.message }; }
  const res = writeSettingsText(text, tlod, olod);   // clamps + surgical edit; byte-proven
  if (!res.ok) return { ok: false, msg: 'Could not locate the LOD lines to edit (' + res.reason + '). File left unchanged.' };
  let backup;
  try {
    backup = backupUsercfg(usercfgPath, backupDir);
    fs.writeFileSync(usercfgPath, res.text);
  } catch (e) { return { ok: false, msg: 'Could not write UserCfg.opt: ' + e.message }; }
  const tC = Math.max(10, Math.min(Math.trunc(tlod), 400)), oC = Math.max(10, Math.min(Math.trunc(olod), 400));
  const check = readSettings(usercfgPath);
  if (check.tlod !== tC || check.olod !== oC) {
    return { ok: false, msg: 'Wrote the file but read-back does not match (got TLOD ' + check.tlod + ', OLOD ' + check.olod + '). Backup at ' + backup };
  }
  return { ok: true, msg: 'Set TLOD ' + tC + ' / OLOD ' + oC + ' (backup: ' + path.basename(backup) + ')' };
}

// Full prep-next. sessions = index.json sessions; opts = {username, usercfgPath, backupDir}.
async function prepNext(sessions, opts) {
  const [raw, aircraft] = await getSimbriefAircraft(opts.username);
  if (!aircraft) return { ok: false, set: false, reason: 'no-simbrief', raw,
    msg: 'SimBrief aircraft not recognized (' + JSON.stringify(raw) + ') - leaving TLOD unchanged.' };
  const tlod = nextGapForAircraft(computeCoverage(sessions), aircraft);
  if (tlod == null) return { ok: true, set: false, reason: 'coverage-complete', aircraft,
    msg: aircraft + ': coverage already complete - leaving TLOD unchanged.' };
  const olod = readSettings(opts.usercfgPath).olod || 120;
  const w = writeSettings(opts.usercfgPath, opts.backupDir, tlod, olod);
  return { ok: w.ok, set: w.ok, aircraft, raw, tlod, olod, msg: w.msg };
}

module.exports = { prepNext, getSimbriefAircraft, normalizeSimbriefAircraft, parseSimbriefAircraft, writeSettings, backupUsercfg };
