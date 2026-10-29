'use strict';
// perf/native/udp_ports.js — v6.25.0 network-port watch. Windows logs Tcpip 4266 ("all UDP ports in
// use") and it lined up with two freeze storms (10-27 LIMC, 10-28 LSZH-EDDB). The culprit bursts and
// releases (56 endpoints the morning after), so evidence only exists WHILE it happens. One parser,
// shared by the capture sampler (capture.js) and the 24/7 event-triggered snapshot
// (tools/port-watch/snapshot.js). `netstat -ano` (~30 ms) over Get-NetUDPEndpoint (~1-2 s, PS 5.1).
const { execFile, spawnSync } = require('child_process');

const DYN_START = 49152;          // Windows default dynamic (ephemeral) range — what 4266 runs out of
const DYN_COUNT = 16384;

// netstat -ano lines: "  UDP    0.0.0.0:500     *:*                     4688"
//                     "  UDP    [::1]:1900      *:*                     6056"
//                     "  TCP    0.0.0.0:135     0.0.0.0:0   LISTENING   1180"
function parseNetstat(text) {
  const out = { udp: 0, udpDyn: 0, tcp: 0, byPid: {} };
  for (const raw of String(text || '').split(/\r?\n/)) {
    const t = raw.trim().split(/\s+/);
    if (t.length < 4 || (t[0] !== 'UDP' && t[0] !== 'TCP')) continue;
    const pid = Number(t[t.length - 1]);
    if (!Number.isInteger(pid)) continue;
    const port = Number((t[1].match(/:(\d+)$/) || [])[1]);
    if (t[0] === 'TCP') { out.tcp++; continue; }
    out.udp++;
    if (port >= DYN_START && port < DYN_START + DYN_COUNT) out.udpDyn++;
    out.byPid[pid] = (out.byPid[pid] || 0) + 1;
  }
  return out;
}

// tasklist /fo csv /nh → { pid: 'name.exe' }
function parseTasklist(text) {
  const map = {};
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = line.match(/^"([^"]*)","(\d+)"/);
    if (m) map[m[2]] = m[1];
  }
  return map;
}

function topHolders(byPid, n, names) {
  return Object.entries(byPid || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
    .map(([pid, count]) => ({ pid: Number(pid), name: (names && names[pid]) || ('pid ' + pid), count }));
}

function tasklistNames() {
  try {
    const r = spawnSync('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    return parseTasklist(r.stdout);
  } catch (_) { return {}; }
}

function netstatSync() {
  try {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
    return r.stdout ? parseNetstat(r.stdout) : null;
  } catch (_) { return null; }
}

// Async for the capture: never blocks the 1 Hz telemetry tick. cb(parsed|null)
function netstatAsync(cb) {
  try {
    execFile('netstat', ['-ano'], { encoding: 'utf8', timeout: 20000, windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
      (err, stdout) => cb(err || !stdout ? null : parseNetstat(stdout)));
  } catch (_) { cb(null); }
}

// Capture-side sampler: latest() → { total, top: 'name:count' } or null. PID names cached; only the
// top holder is looked up, and tasklist re-runs only when that PID is new (cheap at 15 s cadence).
class UdpSampler {
  constructor(intervalMs) { this.intervalMs = intervalMs || 15000; this._latest = null; this._names = {}; this._iv = null; this.samples = []; }
  _take(onDone) {
    netstatAsync(p => {
      if (!p) { if (onDone) onDone(this._latest); return; }
      const ts = Date.now() / 1000;
      const finish = () => {
        const [top] = topHolders(p.byPid, 1, this._names);
        this._latest = { total: p.udp, dyn: p.udpDyn, top: top ? top.name + ':' + top.count : '' };
        this.samples.push({ ts, total: p.udp, top: this._latest.top });
        if (onDone) onDone(this._latest);
      };
      const [top] = topHolders(p.byPid, 1, this._names);
      if (top && !this._names[top.pid]) {   // new top PID → refresh names, async like netstat
        execFile('tasklist', ['/fo', 'csv', '/nh'], { encoding: 'utf8', timeout: 15000, windowsHide: true },
          (err, out) => { if (!err && out) this._names = parseTasklist(out); finish(); });
      } else finish();
    });
  }
  start() { if (!this._iv) { this._take(); this._iv = setInterval(() => this._take(), this.intervalMs); } return this; }
  latest() { return this._latest; }
  stop() { if (this._iv) clearInterval(this._iv); this._iv = null; }
}

// summary block: baseline (first sample), peak (+ who held most at the peak), exhaustion events
// (elapsed s since recording start). Pure — engine.js passes the event times it queried.
function summarize(samples, eventEpochs, recordingWallStart) {
  const s = (samples || []).filter(x => x && Number.isFinite(x.total));
  const ev = (eventEpochs || []).filter(Number.isFinite)
    .map(e => Math.round(e - (recordingWallStart || 0))).filter(e => e >= 0);
  if (!s.length && !ev.length) return null;
  let peak = s[0] || null;
  for (const x of s) if (x.total > peak.total) peak = x;
  return {
    pool: DYN_COUNT,
    baseline: s.length ? s[0].total : null,
    peak: peak ? peak.total : null,
    peak_top: peak ? peak.top || null : null,
    peak_at_s: peak && recordingWallStart ? Math.round(peak.ts - recordingWallStart) : null,
    exhaustion_events: ev,
  };
}

// Tcpip 4266 events between two epochs (s). One wevtutil query, run at file time. → [epoch s]
function exhaustionEvents(fromEpoch, toEpoch) {
  try {
    const ms = Math.max(1, Math.round((Date.now() / 1000 - fromEpoch) * 1000));
    const q = "*[System[Provider[@Name='Tcpip'] and (EventID=4266) and TimeCreated[timediff(@SystemTime) <= " + ms + ']]]';
    const r = spawnSync('wevtutil', ['qe', 'System', '/q:' + q, '/f:xml'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
    const out = [];
    for (const m of String(r.stdout || '').matchAll(/SystemTime='([^']+)'/g)) {
      const e = Date.parse(m[1]) / 1000;
      if (e >= fromEpoch && e <= toEpoch) out.push(e);
    }
    return out;
  } catch (_) { return []; }
}

// One debrief line, only when it matters: an event landed in the flight, or the peak passed half the pool.
function debriefLine(udp) {
  if (!udp) return null;
  const mmss = s => Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  const top = udp.peak_top ? udp.peak_top.replace(/:(\d+)$/, ' ($1 ports)') : null;
  if (udp.exhaustion_events && udp.exhaustion_events.length) {
    // name a holder only if a sample actually caught the burst — a normal-looking peak (Plex 13) would
    // blame the wrong app; the event-triggered snapshot (port_watch.jsonl) is the authority then
    const caught = udp.peak != null && udp.peak >= udp.pool * 0.25;
    return '⚠ Windows ran out of network ports at ' + udp.exhaustion_events.map(mmss).join(', ') +
      (caught && top ? ' — biggest holder ' + top : ' (the burst fell between samples — see the port-watch log)') +
      '. Freezes near that time may be network, not graphics.';
  }
  if (udp.peak != null && udp.peak >= udp.pool * 0.5) {
    return '⚠ Network ports ran high (' + udp.peak + ' of ' + udp.pool + ')' + (top ? ' — biggest holder ' + top : '') + '.';
  }
  return null;
}

module.exports = { parseNetstat, parseTasklist, topHolders, tasklistNames, netstatSync, netstatAsync,
  UdpSampler, summarize, exhaustionEvents, debriefLine, DYN_START, DYN_COUNT };
