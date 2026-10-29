'use strict';
// tools/port-watch/snapshot.js — v6.25.0. Run by the "ABRP Port Watch" scheduled task the moment
// Windows logs Tcpip 4266 ("all UDP ports in use"). The culprit bursts and then releases its ports,
// so this is the only time the evidence exists. Takes 3 samples (now, +20s, +60s) to see who holds
// the ports and who lets go, and appends one JSON line per sample to
// %APPDATA%\A Better Route Planner\port_watch\port_watch.jsonl.
//   node snapshot.js            → real run (3 samples, ~60s)
//   node snapshot.js --once     → one sample (manual check / install self-test)
//   node snapshot.js --out DIR  → write somewhere else (tests)
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const U = require('../../perf/native/udp_ports.js');

const WATCH = ['FlightSimulator2024.exe', 'SayIntentionsAI.exe', 'msedgewebview2.exe', 'FenixSystem.exe',
  'vPilot.exe', 'Plex Media Server.exe', 'qbittorrent.exe', 'A Better Route Planner.exe', 'MSFS_AutoFPS.exe',
  'firefox.exe', 'ProtonVPN.WireGuardService.exe'];

function arg(name) { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : null; }
const outDir = arg('--out') || path.join(process.env.APPDATA || os.homedir(), 'A Better Route Planner', 'port_watch');
const once = process.argv.includes('--once');

function reservedUdp() {
  try {
    const r = spawnSync('netsh', ['int', 'ipv4', 'show', 'excludedportrange', 'protocol=udp'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    let n = 0;
    for (const m of String(r.stdout || '').matchAll(/^\s*(\d+)\s+(\d+)/gm)) n += Number(m[2]) - Number(m[1]) + 1;
    return n;
  } catch (_) { return null; }
}

function sample(label) {
  const p = U.netstatSync();
  const names = U.tasklistNames();
  const running = WATCH.filter(w => Object.values(names).some(n => n.toLowerCase() === w.toLowerCase()));
  // processes that hold the most ports, collapsed by name too (e.g. 6 WebView2 helpers = one app)
  const top = p ? U.topHolders(p.byPid, 15, names) : [];
  const byName = {};
  if (p) for (const [pid, c] of Object.entries(p.byPid)) { const n = names[pid] || ('pid ' + pid); byName[n] = (byName[n] || 0) + c; }
  return {
    ts: new Date().toISOString(), label,
    uptime_h: Math.round(os.uptime() / 360) / 10,
    udp: p ? p.udp : null, udp_dynamic: p ? p.udpDyn : null, tcp: p ? p.tcp : null,
    pool: U.DYN_COUNT, reserved_udp: reservedUdp(),
    top_pids: top,
    top_names: Object.entries(byName).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, count]) => ({ name, count })),
    running,
  };
}

function write(rec) {
  fs.mkdirSync(outDir, { recursive: true });
  fs.appendFileSync(path.join(outDir, 'port_watch.jsonl'), JSON.stringify(rec) + '\n');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
(async () => {
  write(sample(once ? 'manual' : 'event+0s'));
  if (once) return;
  await sleep(20000); write(sample('event+20s'));
  await sleep(40000); write(sample('event+60s'));
})().catch(() => {});
