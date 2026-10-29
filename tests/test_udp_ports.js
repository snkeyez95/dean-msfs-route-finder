'use strict';
// v6.25.0 — network-port watch. Windows' Tcpip 4266 ("all UDP ports in use") lined up with the 10-27
// and 10-28 freeze storms. These guard the parts that could quietly lie: miscounting endpoints, naming
// the wrong app as the culprit, missing an event that happened mid-flight, or desyncing the telemetry
// columns (a positional CSV — one missing cell shifts every column after it).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const T = require('./lib/extract.js').runner('udp ports:');
const ROOT = path.resolve(__dirname, '..');
const U = require(path.join(ROOT, 'perf/native/udp_ports.js'));
const D = require(path.join(ROOT, 'perf/native/debrief.js'));
const capSrc = fs.readFileSync(path.join(ROOT, 'perf/native/capture.js'), 'utf8');
const engSrc = fs.readFileSync(path.join(ROOT, 'perf/native/engine.js'), 'utf8');

const NETSTAT = [
  '', 'Active Connections', '',
  '  Proto  Local Address          Foreign Address        State           PID',
  '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1180',
  '  TCP    [::]:445               [::]:0                 LISTENING       4',
  '  UDP    0.0.0.0:500            *:*                                    4688',
  '  UDP    0.0.0.0:50123          *:*                                    9000',
  '  UDP    127.0.0.1:61000        *:*                                    9000',
  '  UDP    [::1]:1900             *:*                                    6056',
  '  UDP    [fe80::1%12]:55555     *:*                                    9000',
].join('\r\n');

console.log('parser:');
{
  const p = U.parseNetstat(NETSTAT);
  T('counts UDP (v4 + v6) and TCP separately', p.udp === 5 && p.tcp === 2);
  T('counts only dynamic-range ports (49152+) as "dynamic"', p.udpDyn === 3);
  T('groups by owning PID', p.byPid[9000] === 3 && p.byPid[4688] === 1 && p.byPid[6056] === 1);
  T('header / blank / junk lines ignored', U.parseNetstat('Active Connections\r\n  Proto Local\r\nnonsense').udp === 0);
  const big = Array.from({ length: 16384 }, (_, i) => '  UDP    0.0.0.0:' + (49152 + i) + '  *:*   7777').join('\n');
  const pb = U.parseNetstat(big);
  T('a full 16,384-port burst parses and pins one owner', pb.udp === 16384 && pb.udpDyn === 16384 && pb.byPid[7777] === 16384);
  const names = U.parseTasklist('"System","4","Services","0","148 K"\r\n"Plex Media Server.exe","14596","Console","1","90,000 K"');
  T('tasklist csv → pid names', names['14596'] === 'Plex Media Server.exe' && names['4'] === 'System');
  const top = U.topHolders(p.byPid, 2, { 9000: 'Leaky.exe' });
  T('top holders ranked, unknown PIDs labelled not dropped', top[0].name === 'Leaky.exe' && top[0].count === 3 && /^pid /.test(top[1].name));
}

console.log('\nsummary + debrief:');
{
  const t0 = 1000000;
  const quiet = U.summarize([{ ts: t0 + 5, total: 56, top: 'Plex Media Server.exe:13' }, { ts: t0 + 900, total: 61, top: 'Plex Media Server.exe:13' }], [], t0);
  T('baseline = first sample, peak = max', quiet.baseline === 56 && quiet.peak === 61 && quiet.peak_at_s === 900);
  T('a quiet flight adds NO debrief line', U.debriefLine(quiet) === null);
  const caught = U.summarize([{ ts: t0 + 5, total: 56, top: 'a:1' }, { ts: t0 + 3400, total: 16200, top: 'Leaky.exe:16000' }], [t0 + 3455], t0);
  const lc = U.debriefLine(caught);
  T('event mid-flight → mm:ss of the event', /57:35/.test(lc));
  T('a sample that caught the burst names the holder', /Leaky\.exe \(16000 ports\)/.test(lc));
  const missed = U.summarize([{ ts: t0 + 5, total: 56, top: 'Plex Media Server.exe:13' }], [t0 + 3455], t0);
  const lm = U.debriefLine(missed);
  T('burst between samples → does NOT blame the normal top app', !/Plex/.test(lm) && /port-watch log/.test(lm));
  T('events before recording start are dropped', U.summarize([], [t0 - 60], t0) === null);
  T('high peak without an event still warns', /ran high/.test(U.debriefLine(U.summarize([{ ts: t0, total: 9000, top: 'x:8000' }], [], t0))));
  T('no samples, no events → no block at all', U.summarize([], [], t0) === null && U.debriefLine(null) === null);
  const base = { stats: { p99_ft_ms: 33, frametime_stdev_ms: 5.9, duration_seconds: 5340 }, vram: { peak_pct: 93 }, history: [] };
  const withU = D.buildDebrief(Object.assign({ settings: { aircraft: 'Fenix', udp: caught } }, base));
  const without = D.buildDebrief(Object.assign({ settings: { aircraft: 'Fenix' } }, base));
  T('the real debrief carries the port line (bad tone)', withU.lines.some(l => l.tone === 'bad' && /network ports/.test(l.text)));
  T('…and flights without the block are unchanged', !without.lines.some(l => /network ports/.test(l.text)));
}

console.log('\nwiring:');
{
  const cols = (engSrc.match(/const TELEMETRY_COLUMNS = \[([^\]]+)\]/) || [])[1].split(',').map(s => s.trim().replace(/'/g, ''));
  T('telemetry columns end with udp_total, udp_top', cols.slice(-2).join() === 'udp_total,udp_top');
  const push = capSrc.slice(capSrc.indexOf('telemetryRows.push(['), capSrc.indexOf(']);', capSrc.indexOf('telemetryRows.push([')));
  T('capture row pushes udp cells LAST (lockstep with the column list)', /vatsim_traffic|pilots within 40nm/.test(push) && /udp_total, udp_top\s*$/.test(push.trim()));
  T('sampler is async (execFile), never spawnSync inside the 1 Hz tick', /netstatAsync/.test(fs.readFileSync(path.join(ROOT, 'perf/native/udp_ports.js'), 'utf8')) && /new UdpSampler\(15000\)\.start\(\)/.test(capSrc));
  T('sampler stopped at capture end + samples handed to fileSession', /udp\.stop\(\)/.test(capSrc) && /udpSamples: udp\.samples/.test(capSrc));
  T('fileSession writes settings.udp + index flag', /settings\.udp = u/.test(engSrc) && /udp_exhaustion:/.test(engSrc));
}

console.log('\nreal runtime:');
{
  const live = U.netstatSync();
  T('real netstat parses on this machine', live && live.udp > 0 && Object.keys(live.byPid).length > 0);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'abrp-pw-'));
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools/port-watch/snapshot.js'), '--once', '--out', out], { encoding: 'utf8', timeout: 60000 });
  let rec = null;
  try { rec = JSON.parse(fs.readFileSync(path.join(out, 'port_watch.jsonl'), 'utf8').trim()); } catch (_) {}
  T('snapshot.js --once writes one valid JSON line', r.status === 0 && rec && rec.label === 'manual');
  T('snapshot names real processes + pool/reserved', rec && rec.top_names.length > 0 && !/^pid /.test(rec.top_names[0].name) && rec.pool === 16384 && rec.reserved_udp != null);
  fs.rmSync(out, { recursive: true, force: true });
  const inst = fs.readFileSync(path.join(ROOT, 'tools/port-watch/install.ps1'), 'utf8');
  T('task trigger = Tcpip 4266, launched headless (no window over the sim)', /Provider\[@Name='Tcpip'\] and \(EventID=4266\)/.test(inst) && /--headless/.test(inst));
}

process.exit(T.done() ? 1 : 0);
