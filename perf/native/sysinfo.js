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
    return (p2.stdout || '').trim().replace(/,/g, '.') || null;   // Windows FileVersion uses commas -> dots
  } catch (_) { return null; }
}

// Normalize a SimConnect aircraft TITLE to a family label (match-by-airframe, per _normalize_aircraft).
// Phase 10: user-defined benchmark aircraft (config.benchmark, passed to the detached capture via
// the ABRP_BENCHMARK env JSON) match FIRST, then the legacy built-ins — Dean's seeded defaults
// resolve identically; other users' fleets label correctly without code changes.
let _benchEnv;
function benchFromEnv() {
  if (_benchEnv !== undefined) return _benchEnv;
  try { _benchEnv = JSON.parse(process.env.ABRP_BENCHMARK || ''); } catch (_) { _benchEnv = null; }
  return _benchEnv;
}
function normalizeAircraftTitle(title, benchmark) {
  if (!title) return title;
  const tl = String(title).toLowerCase();
  const bench = benchmark !== undefined ? benchmark : benchFromEnv();
  if (bench && Array.isArray(bench.aircraft)) {
    for (const a of bench.aircraft) {
      if (a && a.label && Array.isArray(a.match) && a.match.some(t => t && tl.includes(String(t).toLowerCase()))) return a.label;
    }
  }
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

// Is this CID actually CONNECTED to VATSIM right now? Checks the live datafeed (v6.9.0).
// Returns true (connected), false (POSITIVELY not connected — vPilot open but not logged in), or
// null (couldn't determine: no CID, or the feed fetch failed). Lets the tag distinguish "flying
// online" from "vPilot left running as a companion app" instead of trusting process-presence.
// v6.9.1: also match controllers[] — Dean flies VATSIM in vPilot OBSERVER mode, which appears in
// controllers[] (facility 0, callsign like CFG2, placeholder freq 199.998) and NOT in pilots[],
// yet online traffic is still injected + rendered, so it's a genuine online flight for the tag.
function vatsimConnected(cid) {
  return new Promise((resolve) => {
    cid = String(cid || '').trim();
    if (!cid) return resolve(null);
    const req = https.get('https://data.vatsim.net/v3/vatsim-data.json', { timeout: 9000 }, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          const has = (arr) => Array.isArray(arr) && arr.some(p => String(p.cid) === cid);
          resolve(has(j.pilots) || has(j.controllers));
        }
        catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

// v6.11.0: fetch just the pilots' positions from the live VATSIM datafeed — the traffic-density
// sampler's input (capture.js counts pilots within 40nm at 1 Hz against this ~30s-refreshed cache).
// Resolves [{lat, lon}] or null on any failure (the sampler just keeps the previous cache).
function fetchVatsimPilots() {
  return new Promise((resolve) => {
    const req = https.get('https://data.vatsim.net/v3/vatsim-data.json', { timeout: 15000 }, (res) => {
      let data = ''; res.on('data', d => data += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(data);
          resolve((Array.isArray(j.pilots) ? j.pilots : [])
            .filter(p => typeof p.latitude === 'number' && typeof p.longitude === 'number')
            .map(p => ({ lat: p.latitude, lon: p.longitude })));
        } catch (_) { resolve(null); }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => { req.destroy(); resolve(null); });
  });
}

module.exports = { getDriverVersion, getSimVersion, getSimbriefRoute, normalizeAircraftTitle, nvidiaSmi, vatsimConnected, fetchVatsimPilots };
