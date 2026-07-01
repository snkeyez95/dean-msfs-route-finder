'use strict';
// perf/native/sysinfo.js — small capture-time facts. Ports get_driver_version / get_sim_version /
// get_simbrief_route / _normalize_aircraft (the TITLE normalizer, whose match list differs from the
// SimBrief one in prep.js: 737/747/777/DC-6 => PMDG).
const { spawnSync } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');

const CITATION_LABEL = 'Citation Sovereign+';
const TARGET_PROCESS = 'FlightSimulator2024.exe';

function nvidiaSmi() {
  const sys = process.env.SystemRoot || 'C:\\Windows';
  const p = path.join(sys, 'System32', 'nvidia-smi.exe');
  return fs.existsSync(p) ? p : 'nvidia-smi';
}

function getDriverVersion() {
  try {
    const r = spawnSync(nvidiaSmi(), ['--query-gpu=driver_version', '--format=csv,noheader'],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const line = (r.stdout || '').trim().split(/\r?\n/)[0];
    return line ? line.trim() : null;
  } catch (_) { return null; }
}

// MSFS file version from the running exe's version resource — only works while the sim is running.
function getSimVersion() {
  const procName = TARGET_PROCESS.replace(/\.exe$/i, '');
  try {
    const p1 = spawnSync('powershell', ['-NoProfile', '-Command',
      `(Get-Process -Name '${procName}' -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Path)`],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    const exePath = (p1.stdout || '').trim();
    if (!exePath) return null;
    const p2 = spawnSync('powershell', ['-NoProfile', '-Command',
      `(Get-Item -LiteralPath '${exePath}').VersionInfo.FileVersion`],
      { encoding: 'utf8', timeout: 10000, windowsHide: true });
    return (p2.stdout || '').trim() || null;
  } catch (_) { return null; }
}

// Normalize a SimConnect aircraft TITLE to a family label (match-by-airframe, per _normalize_aircraft).
function normalizeAircraftTitle(title) {
  if (!title) return title;
  const tl = String(title).toLowerCase();
  if (tl.includes('fenix') || ['a318', 'a319', 'a320', 'a321'].some(a => tl.includes(a))) return 'Fenix';
  if (tl.includes('pmdg') || ['737', '747', '777', 'dc-6', 'dc6'].some(b => tl.includes(b))) return 'PMDG';
  if (tl.includes('sovereign') || ['c68a', 'c680'].some(c => tl.includes(c))) return CITATION_LABEL;
  return title;
}

// Fetch the latest SimBrief OFP route as 'FLIGHTNO ORIG-DEST' (or 'ORIG-DEST'), or null.
function getSimbriefRoute(username) {
  return new Promise((resolve) => {
    if (!username) return resolve(null);
    const url = 'https://www.simbrief.com/api/xml.fetcher.php?username=' + encodeURIComponent(username);
    const req = https.get(url, { timeout: 10000 }, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const scope = (tag) => (new RegExp('<' + tag + '\\b[^>]*>([\\s\\S]*?)<\\/' + tag + '>', 'i').exec(data) || [])[1] || '';
          const icao = (s) => (/<icao_code\b[^>]*>([\s\S]*?)<\/icao_code>/i.exec(s) || [])[1]?.trim() || '';
          const org = icao(scope('origin'));
          const dst = icao(scope('destination'));
          const flt = (/<flight_number\b[^>]*>([\s\S]*?)<\/flight_number>/i.exec(scope('general')) || [])[1]?.trim() || '';
          if (org && dst) return resolve(flt ? `${flt} ${org}-${dst}` : `${org}-${dst}`);
          resolve(null);
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { getDriverVersion, getSimVersion, getSimbriefRoute, normalizeAircraftTitle, nvidiaSmi };
