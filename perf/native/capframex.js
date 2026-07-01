'use strict';
// CapFrameX exporter — PORT of msfs_perf_logger.py (_capframex_header_lines / _meta_from_session_dir /
// _capframex_convert_one / _find_session_csvs / convert_paths_to_capframex / export_capframex).
// Pure text transform: prepend the //Key=Value info-header CapFrameX needs to register a record, pass
// the raw frame data through, and trim the sim-shutdown spike(s) off the tail. The original
// frametimes.csv is NEVER modified. Validated byte-for-byte vs the Python engine (_parity_cfx.js).
const fs = require('fs'), path = require('path');
const { pickColumn } = require('./stats.js');
const { displayRoute } = require('./report_charts.js');

const FRAMETIME_COLUMNS = ['MsBetweenPresents', 'msBetweenPresents', 'FrameTime', 'ms_between_presents', 'MsBetweenDisplayChange'];
const SHUTDOWN_MS = 200.0, WINDOW_MS = 60000.0;

const pad2 = n => String(n).padStart(2, '0');

// Format a naive ISO timestamp to {date:'MM/DD/YYYY', time:'HH:MM:SS'} WITHOUT any timezone shift —
// mirrors Python datetime.fromisoformat(...).strftime('%m/%d/%Y' / '%H:%M:%S'). now() on parse failure.
function fmtTs(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2}):(\d{2})/.exec(String(iso || ''));
  if (m) return { date: `${m[2]}/${m[3]}/${m[1]}`, time: `${m[4]}:${m[5]}:${m[6]}` };
  const n = new Date();
  return { date: `${pad2(n.getMonth() + 1)}/${pad2(n.getDate())}/${n.getFullYear()}`,
           time: `${pad2(n.getHours())}:${pad2(n.getMinutes())}:${pad2(n.getSeconds())}` };
}

// Build CapFrameX metadata from a session folder (summary.json, else folder-name regex).
function metaFromSessionDir(sessionDir) {
  let summ = {};
  const sp = path.join(sessionDir, 'summary.json');
  if (fs.existsSync(sp)) { try { summ = JSON.parse(fs.readFileSync(sp, 'utf8')); } catch (_) { summ = {}; } }
  const settings = summ.settings || {};
  const name = path.basename(sessionDir.replace(/[\\/]+$/, ''));
  const date = path.basename(path.dirname(sessionDir.replace(/[\\/]+$/, '')));
  const mT = /TLOD(\d+)/.exec(name), mO = /OLOD(\d+)/.exec(name), mHM = /^(\d{4})/.exec(name);
  const tlod = settings.tlod || (mT ? parseInt(mT[1], 10) : 'na');
  const olod = settings.olod || (mO ? parseInt(mO[1], 10) : 'na');
  const sid = summ.session_id || (mHM ? `${date}_${mHM[1]}` : name);
  const aircraft = String(settings.aircraft || summ.aircraft || 'Unknown').replace(/[^A-Za-z0-9_-]/g, '') || 'Unknown';
  const route = displayRoute(settings.simbrief_route || summ.notes || '');
  const driver = summ.driver_version || 'Unknown';
  const totalVram = (summ.vram || {}).total_vram_mb || 12288;
  return { sid, tlod, olod, aircraft, route, driver, total_vram: totalVram, ts: fmtTs(summ.timestamp) };
}

// The '//Key=Value' info-header block CapFrameX needs to register a record.
function headerLines(meta, gpuName) {
  const comment = `TLOD ${meta.tlod} / OLOD ${meta.olod} | ${meta.aircraft} | ${meta.route} | drv ${meta.driver}`;
  return [
    '//GameName=MSFS 2024',
    '//ProcessName=FlightSimulator2024',
    `//CreationDate=${meta.ts.date}`,
    `//CreationTime=${meta.ts.time}`,
    '//Motherboard=Unknown',
    '//OS=Windows 11',
    '//Processor=Unknown',
    '//System RAM=Unknown',
    `//Base Driver Version=${meta.driver}`,
    '//Driver Package=Unknown',
    `//GPU=${gpuName}`,
    '//GPU #=1',
    '//GPU Core Clock (MHz)=Unknown',
    '//GPU Memory Clock (MHz)=Unknown',
    `//GPU Memory (MB)=${meta.total_vram}`,
    `//Comment=${comment}`,
  ];
}

// Convert one raw frametimes.csv to a CapFrameX-loadable CSV. Returns {outPath, trimmed} or null.
function convertOne(srcCsv, outDir, meta, gpuName) {
  let raw;
  try { raw = fs.readFileSync(srcCsv, 'utf8'); } catch (_) { return null; }
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);            // strip BOM (utf-8-sig)
  const srcLines = raw.split(/\r\n|\r|\n/);                        // like Python splitlines()...
  if (srcLines.length && srcLines[srcLines.length - 1] === '') srcLines.pop(); // ...drop trailing empty
  if (!srcLines.length) return null;
  const colHeader = srcLines[0];
  const dataRows = srcLines.slice(1);

  const cols = colHeader.split(',').map(c => c.trim());
  const ftCol = pickColumn(cols, FRAMETIME_COLUMNS);
  let cut = dataRows.length;
  if (ftCol != null && dataRows.length) {
    const ftI = cols.indexOf(ftCol);
    let tailMs = 0.0;
    for (let i = dataRows.length - 1; i >= 0; i--) {
      const parts = dataRows[i].split(',');
      let ft = Number(parts[ftI]);                                // strict, like Python float()
      if (!isFinite(ft)) ft = 0.0;
      if (ft > SHUTDOWN_MS) cut = i;
      tailMs += ft;
      if (tailMs > WINDOW_MS) break;
    }
  }
  const trimmed = dataRows.length - cut;

  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${meta.sid}_TLOD${meta.tlod}_${meta.aircraft}.csv`);
  const body = headerLines(meta, gpuName).join('\n') + '\n' + colHeader + '\n' +
               dataRows.slice(0, cut).join('\n') + '\n';
  fs.writeFileSync(outPath, body);
  return { outPath, trimmed };
}

// Resolve a dropped file/folder into [ [frametimes.csv, sessionDir], ... ]. Only files named exactly
// 'frametimes.csv' match, so already-converted exports are never re-processed.
function findSessionCsvs(p) {
  p = path.resolve(p);
  let st; try { st = fs.statSync(p); } catch (_) { return []; }
  if (st.isFile()) return path.basename(p).toLowerCase() === 'frametimes.csv' ? [[p, path.dirname(p)]] : [];
  const direct = path.join(p, 'frametimes.csv');
  if (fs.existsSync(direct)) return [[direct, p]];
  const out = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.name.toLowerCase() === 'frametimes.csv') out.push([fp, dir]);
    }
  })(p);
  return out;
}

// Convert dropped session data (folders/files) into <sessionsDir>/CapFrameX CSVs.
function convertPaths(paths, sessionsDir, gpuName) {
  const outDir = path.join(sessionsDir, 'CapFrameX');
  const seen = new Set();
  let count = 0;
  const results = [];
  for (const p of paths) {
    for (const [srcCsv, sessionDir] of findSessionCsvs(p)) {
      const key = path.resolve(srcCsv);
      if (seen.has(key)) continue;
      seen.add(key);
      const r = convertOne(srcCsv, outDir, metaFromSessionDir(sessionDir), gpuName);
      if (r) { count++; results.push(r); }
    }
  }
  return { outDir, count, results };
}

module.exports = { metaFromSessionDir, headerLines, convertOne, findSessionCsvs, convertPaths, FRAMETIME_COLUMNS };
