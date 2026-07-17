'use strict';
// perf/native/autofps_log.js — v6.11.0: parse the MSFS_AutoFPS companion app's daily debug log to
// recover the ACTUAL dynamic TLOD it applied during a flight (ABRP can't see it any other way —
// AutoFPS writes TLOD straight into sim memory). Its LODController logs a telemetry line every ~10s:
//   2026-07-12 19:50:42.795 [INF] [ LODController:UpdateVariables ] Mode:FSR3 FPS:60 Pri:TLOD
//     TLOD:125 TLODRng:125 OLOD:120 AGL:763 FPM:-785 GPU:59% VRAM:75%
// We window those lines to a flight's wall-clock span and persist them as a small derived sidecar
// (autofps_trace.json) in the session folder — captured at flight-file time so the trace survives
// AutoFPS's own log cleanup. READ-ONLY on AutoFPS's files; defensive parsing (an AutoFPS update that
// changes the line format just yields no trace — never an error). Pure + desk-testable.
const fs = require('fs'), path = require('path');

// GPU/VRAM are absent when GPU-Z isn't running — optional groups. Timestamps are LOCAL time
// (same machine + clock as the capture, so local Date parsing maps them to epoch exactly).
const LINE_RE = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})\.\d+\s+\[\w+\]\s+\[\s*LODController:UpdateVariables\s*\].*?\bFPS:([\d.]+).*?\bTLOD:([\d.]+).*?\bOLOD:([\d.]+).*?\bAGL:(-?[\d.]+)(?:.*?\bVRAM:([\d.]+)%)?/;

function defaultLogDir() {
  if (process.env.ABRP_AUTOFPS_LOG_DIR) return process.env.ABRP_AUTOFPS_LOG_DIR;
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'MSFS_AutoFPS', 'log') : null;
}

// Daily log files covering [t0, t1] epoch-seconds (LOCAL dates; a flight crossing midnight spans two).
function findLogs(logDir, t0, t1) {
  if (!logDir) return [];
  const out = [], seen = new Set();
  for (let t = t0; t <= t1 + 86400; t += 86400) {
    const d = new Date(Math.min(t, t1) * 1000);
    const name = 'MSFS_AutoFPS' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.log';
    if (seen.has(name)) continue; seen.add(name);
    const p = path.join(logDir, name);
    try { if (fs.existsSync(p)) out.push(p); } catch (_) {}
    if (t >= t1) break;
  }
  return out;
}

// Parse UpdateVariables lines from raw log text, keeping samples inside [t0-5, t1+5] epoch-seconds.
// Returns [{t, tlod, olod, agl, vram}] (t = epoch seconds; vram = % or null). Non-matching lines skip.
function parseTrace(text, t0, t1) {
  const out = [];
  for (const line of String(text || '').split(/\r?\n/)) {
    const m = LINE_RE.exec(line);
    if (!m) continue;
    const t = new Date(m[1] + 'T' + m[2]).getTime() / 1000;   // local-time parse (same machine/clock)
    if (!isFinite(t) || t < t0 - 5 || t > t1 + 5) continue;
    out.push({ t, tlod: Math.round(parseFloat(m[4])), olod: Math.round(parseFloat(m[5])),
      agl: Math.round(parseFloat(m[6])), vram: m[7] != null ? Math.round(parseFloat(m[7])) : null });
  }
  return out;
}

// Effective-TLOD stats over a flight's samples. pct_at_cap = share of samples within 2 of the trace
// max — "how much of the flight did AutoFPS park at its ceiling" (the envelope-recommendation input).
function traceStats(samples) {
  if (!samples || !samples.length) return null;
  const t = samples.map(s => s.tlod).sort((a, b) => a - b), n = t.length;
  const q = p => t[Math.min(n - 1, Math.floor(p * n))];
  const mx = t[n - 1];
  let atCap = 0; for (const v of t) if (v >= mx - 2) atCap++;
  return { tlod_med: q(0.5), tlod_p10: q(0.1), tlod_p90: q(0.9), tlod_min: t[0], tlod_max: mx,
    pct_at_cap: Math.round(atCap / n * 100), n };
}

// Build a flight's trace from the daily logs: window [t0, t1] (epoch s). Returns
// {samples, stats} or null (no logs / nothing parsed — never throws).
function buildTrace(logDir, t0, t1) {
  try {
    const files = findLogs(logDir || defaultLogDir(), t0, t1);
    let samples = [];
    for (const f of files) {
      try { samples = samples.concat(parseTrace(fs.readFileSync(f, 'utf8'), t0, t1)); } catch (_) {}
    }
    samples.sort((a, b) => a.t - b.t);
    if (!samples.length) return null;
    return { samples, stats: traceStats(samples) };
  } catch (_) { return null; }
}

// Write the derived sidecar into a session folder. anchorEpoch = the flight's wall anchor
// (recordingWallStart when known; summary timestamp for backfill) — sample times are stored RELATIVE
// to it (t_rel_s) so chart consumers never re-derive the alignment. Returns true if written.
function writeSidecar(sessionDir, anchorEpoch, t0, t1, logDir) {
  const tr = buildTrace(logDir, t0, t1);
  if (!tr) return false;
  const payload = { v: 1, recording_wall_start: Math.round(anchorEpoch * 1000) / 1000,
    samples: tr.samples.map(s => [Math.round((s.t - anchorEpoch) * 10) / 10, s.tlod, s.olod, s.agl, s.vram]),
    stats: tr.stats };
  try { fs.writeFileSync(path.join(sessionDir, 'autofps_trace.json'), JSON.stringify(payload)); return true; }
  catch (_) { return false; }
}

// Read a session's sidecar (null when absent/unreadable).
function readSidecar(sessionDir) {
  try { return JSON.parse(fs.readFileSync(path.join(sessionDir, 'autofps_trace.json'), 'utf8')); }
  catch (_) { return null; }
}

// v6.12.0 (live overlay perf strip): CURRENT TLOD — tail today's daily log, reverse-scan for the
// newest UpdateVariables line (falls back to yesterday's file right after midnight rotation).
// Returns {tlod, ageS} when the newest sample is fresher than maxAgeS, else null. Read-only on
// AutoFPS's files.
//
// v6.12.9 — WINDOW SIZE (Dean 2026-07-16: "TLOD was sometimes present and sometimes not"). The
// window was 4 KB, chosen without measuring against a real Debug-level log. AutoFPS's own logLevel
// defaults to Debug and test18/19 added expanded LogPlus diagnostics, so on Dean's actual log the
// MEDIAN gap between two UpdateVariables lines is ~4.7 KB — bigger than the window itself. Measured
// on his 9 MB 2026-07-16 log, polling just before each next TLOD line: 4 KB found one only 12.6% of
// the time, 64 KB → 98.6%, 128 KB → 100%. Hence 128 KB. A re-read of the same tail every 5s is
// served by the OS page cache, and only runs while a capture is recording.
// Staleness (not window size) is what decides "AutoFPS isn't flying" — the window only has to be
// big enough to FIND the last line; maxAgeS then judges whether it's still current.
const TAIL_BYTES = 131072;
function tailLatest(logDir, maxAgeS) {
  try {
    const dir = logDir || defaultLogDir();
    if (!dir) return null;
    const now = Date.now() / 1000;
    for (const t of [now, now - 86400]) {                       // today, then yesterday (midnight edge)
      const d = new Date(t * 1000);
      const name = 'MSFS_AutoFPS' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.log';
      const p = path.join(dir, name);
      let st; try { st = fs.statSync(p); } catch (_) { continue; }
      let text;
      try {
        const fd = fs.openSync(p, 'r');
        try {
          const len = Math.min(st.size, TAIL_BYTES);
          const buf = Buffer.alloc(len);
          fs.readSync(fd, buf, 0, len, st.size - len);
          text = buf.toString('utf8');
        } finally { fs.closeSync(fd); }
      } catch (_) { continue; }
      const lines = text.split(/\r?\n/);
      for (let i = lines.length - 1; i >= 0; i--) {
        const m = LINE_RE.exec(lines[i]);
        if (!m) continue;
        const ts = new Date(m[1] + 'T' + m[2]).getTime() / 1000;
        if (!isFinite(ts)) continue;
        const age = now - ts;
        if (age > (maxAgeS || 60)) return null;                 // newest sample is stale → AutoFPS idle
        return { tlod: Math.round(parseFloat(m[4])), ageS: Math.round(age) };
      }
    }
    return null;
  } catch (_) { return null; }
}

module.exports = { defaultLogDir, findLogs, parseTrace, traceStats, buildTrace, writeSidecar, readSidecar, tailLatest, LINE_RE };
