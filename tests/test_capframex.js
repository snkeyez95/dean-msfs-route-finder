'use strict';
// CapFrameX export (perf/native/capframex.js) — proves the converter still turns a raw frametimes.csv
// into a valid CapFrameX record. It's a pure passthrough (frametime column + summary.json metadata),
// so growth in telemetry/VRAM/phases/traffic doesn't touch it — this suite locks that in.
// Covers a synthetic case (deterministic) + a real-data smoke on the newest flight when present.
const fs = require('fs'), path = require('path'), os = require('os'), zlib = require('zlib');
const X = require('./lib/extract.js');
const cfx = require(path.join(X.ROOT, 'perf', 'native', 'capframex.js'));
const T = X.runner('capframex export:');

// PresentMon's real column header — the format the converter must keep handling.
const HEADER = 'Application,ProcessID,SwapChainAddress,PresentRuntime,SyncInterval,PresentFlags,AllowsTearing,PresentMode,TimeInMs,MsBetweenSimulationStart,MsBetweenPresents,MsBetweenDisplayChange,MsInPresentAPI,MsRenderPresentLatency,MsUntilDisplayed,CPUStartTimeInMs,MsBetweenAppStart,MsCPUBusy,MsCPUWait,MsGPULatency,MsGPUTime,MsGPUBusy,MsGPUWait,MsAnimationError,AnimationTime,MsFlipDelay,MsAllInputToPhotonLatency,MsClickToPhotonLatency';
const FT_INDEX = HEADER.split(',').indexOf('MsBetweenPresents');   // = 10
function row(ftMs){
  const c = new Array(28).fill('0');
  c[0] = 'FlightSimulator2024.exe'; c[7] = 'Composed: Flip'; c[8] = '1000'; c[FT_INDEX] = ftMs.toFixed(4);
  return c.join(',');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cfx-'));
function session(rows, opts){
  const dir = path.join(tmp, 'sess'); fs.rmSync(dir, {recursive:true, force:true}); fs.mkdirSync(dir, {recursive:true});
  const body = HEADER + '\n' + rows.map(row).join('\n') + '\n';
  if(opts && opts.gz) fs.writeFileSync(path.join(dir, 'frametimes.csv.gz'), zlib.gzipSync(Buffer.from(body)));
  else fs.writeFileSync(path.join(dir, 'frametimes.csv'), body);
  fs.writeFileSync(path.join(dir, 'summary.json'), JSON.stringify({
    session_id: '2026-07-16_2029', timestamp: '2026-07-16T20:29:59', driver_version: '566.36',
    settings: { tlod: 125, olod: 120, aircraft: 'Citation Sovereign+', simbrief_route: 'KMIA-KMCO' },
    vram: { total_vram_mb: 12288 }
  }));
  return dir;
}

// ── metadata ────────────────────────────────────────────────────────────────
{
  const m = cfx.metaFromSessionDir(session([16.7, 16.7]));
  T('metadata: TLOD/OLOD from settings', m.tlod === 125 && m.olod === 120);
  T('metadata: aircraft sanitized', m.aircraft === 'CitationSovereign', m.aircraft);
  T('metadata: driver + VRAM carried', m.driver === '566.36' && m.total_vram === 12288);
  T('metadata: timestamp split without tz shift', m.ts.date === '07/16/2026' && m.ts.time === '20:29:59', JSON.stringify(m.ts));
}

// ── a normal convert ─────────────────────────────────────────────────────────
{
  const dir = session([16.7, 16.7, 20.0, 18.0, 16.7]);
  const out = path.join(tmp, 'out1');
  const r = cfx.convertOne(path.join(dir, 'frametimes.csv'), out, cfx.metaFromSessionDir(dir), 'NVIDIA GeForce RTX 3080 Ti');
  T('convert returns a result', !!r, 'null');
  const lines = fs.readFileSync(r.outPath, 'utf8').split('\n');
  T('output starts with //GameName (CapFrameX registers the record)', lines[0] === '//GameName=MSFS 2024');
  T('GPU + VRAM in the header block', lines.some(l => l === '//GPU=NVIDIA GeForce RTX 3080 Ti') && lines.some(l => l === '//GPU Memory (MB)=12288'));
  T('the raw column header is preserved verbatim', lines.includes(HEADER));
  T('a clean flight trims nothing', r.trimmed === 0, 'trimmed ' + r.trimmed);
  T('output filename = sid_TLOD_aircraft', path.basename(r.outPath) === '2026-07-16_2029_TLOD125_CitationSovereign.csv', path.basename(r.outPath));
}

// ── shutdown-spike tail trim ─────────────────────────────────────────────────
{
  // 5 normal frames, then a shutdown burst (>200ms) at the very end — must be cut.
  const dir = session([16.7, 16.7, 16.7, 16.7, 16.7, 900.0, 1200.0]);
  const out = path.join(tmp, 'out2');
  const r = cfx.convertOne(path.join(dir, 'frametimes.csv'), out, cfx.metaFromSessionDir(dir), 'GPU');
  T('shutdown burst at the tail is trimmed', r.trimmed === 2, 'trimmed ' + r.trimmed);
  const dataLines = fs.readFileSync(r.outPath, 'utf8').split('\n').filter(l => l.startsWith('FlightSimulator'));
  T('...leaving exactly the 5 real frames', dataLines.length === 5, dataLines.length + '');
}

// ── gzip input (archived captures) ───────────────────────────────────────────
{
  const dir = session([16.7, 16.7, 16.7], { gz:true });
  const out = path.join(tmp, 'out3');
  const found = cfx.findSessionCsvs(dir);
  T('findSessionCsvs locates a .gz capture', found.length === 1 && /\.gz$/.test(found[0][0]), JSON.stringify(found.map(f=>path.basename(f[0]))));
  const r = cfx.convertOne(found[0][0], out, cfx.metaFromSessionDir(dir), 'GPU');
  T('a gzipped capture converts transparently', !!r && fs.readFileSync(r.outPath, 'utf8').startsWith('//GameName'));
}

// ── never re-processes an already-exported file ─────────────────────────────
{
  const dir = session([16.7, 16.7]);
  fs.writeFileSync(path.join(dir, 'already_TLOD125.csv'), '//GameName=x\n' + HEADER + '\n');
  const found = cfx.findSessionCsvs(dir);
  T('only frametimes.csv is picked up, never a prior export', found.length === 1 && /frametimes\.csv$/.test(found[0][0]));
}

fs.rmSync(tmp, {recursive:true, force:true});

// ── real-data smoke (the actual question: does it work on a CURRENT flight?) ─
{
  const SES = X.APP_DATA + path.sep + 'Sessions';
  let newest = null;
  try {
    const walk = d => { for(const e of fs.readdirSync(d, {withFileTypes:true})){ const p = path.join(d, e.name);
      if(e.isDirectory()) walk(p); else if(e.name === 'frametimes.csv'){ const mt = fs.statSync(p).mtimeMs; if(!newest || mt > newest.mt) newest = { p, dir: d, mt }; } } };
    if(fs.existsSync(SES)) walk(SES);
  } catch(_){}
  if(!newest){ console.log('  (no real flight found — skipped the live smoke)'); }
  else {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'cfx-real-'));
    const r = cfx.convertOne(newest.p, out, cfx.metaFromSessionDir(newest.dir), 'GPU');
    T('REAL newest flight converts to valid CapFrameX', !!r && fs.readFileSync(r.outPath, 'utf8').startsWith('//GameName'), 'null');
    const head = fs.readFileSync(newest.p, 'utf8').split('\n')[0].replace(/^﻿/, '');
    T('REAL frametimes header still contains MsBetweenPresents', head.includes('MsBetweenPresents'));
    fs.rmSync(out, {recursive:true, force:true});
  }
}

process.exit(T.done() ? 1 : 0);
