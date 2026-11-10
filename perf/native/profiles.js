'use strict';
// perf/native/profiles.js — v6.27.0 SIM PROFILES engine (pure: no file I/O, no Electron).
// Reads the profile-able keys out of UserCfg.opt text, writes a profile back SURGICALLY (only lines
// that already exist, inside the right block, same number formatting), rebuilds past setups from the
// per-flight snapshots, and builds the data-backed "ABRP Suggested" profile.
// The file I/O (backup → atomic write → verify → undo) lives in main.js.
const S = require('./usercfg_schema.js');

// ── reading ──────────────────────────────────────────────────────────────────────────────────
// Locate a top-level block "{Name" … the matching closing "}" at column 0. Returns [start, end) of
// the body (between the header line and the closing brace line) or null.
function _block(t, name) {
  const re = new RegExp('(^|\\n)\\{' + name + '\\n');
  const m = re.exec(t);
  if (!m) return null;
  const start = m.index + m[0].length;
  const close = t.indexOf('\n}', start - 1);
  if (close < 0) return null;
  return { start, end: close + 1 };
}
// Body range of "\t{Section" inside the Graphics block.
function _section(t, gb, section) {
  const body = t.slice(gb.start, gb.end);
  const re = new RegExp('(^|\\n)\\t\\{' + section + '\\n');
  const m = re.exec(body);
  if (!m) return null;
  const s = gb.start + m.index + m[0].length;
  const close = t.indexOf('\n\t}', s - 1);
  if (close < 0 || close > gb.end) return null;
  return { start: s, end: close + 1 };
}
function _parse(tok) {
  const s = String(tok).trim().replace(/^"|"$/g, '');
  return /^-?[0-9]+(\.[0-9]+)?$/.test(s) ? parseFloat(s) : s;
}
function _lineRe(key) { return new RegExp('^(\\t+' + key + ' )(\\S[^\\n]*)$', 'm'); }

function _norm(text) { return String(text || '').replace(/\r\n?/g, '\n'); }

// { id: value } for every schema key present in the file (desktop only — VR / display never read).
function readProfileable(text) {
  const t = _norm(text);
  const out = {};
  const vb = _block(t, 'Video'), gb = _block(t, 'Graphics');
  for (const k of S.KEYS) {
    let range = null;
    if (k.block === 'Video') range = vb;
    else if (gb) range = _section(t, gb, k.section);
    if (!range) continue;
    const m = t.slice(range.start, range.end).match(_lineRe(k.key));
    if (m) out[k.id] = _parse(m[2]);
  }
  return out;
}

// ── writing ──────────────────────────────────────────────────────────────────────────────────
// Format a value the way the file already writes that line (6-decimal floats stay 6-decimal, ints
// stay ints, words stay words). Never invents a format.
function _format(oldTok, value, k) {
  if (k && k.type === 'word') return String(value).toUpperCase();
  const dec = (String(oldTok).split('.')[1] || '').length;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return dec ? n.toFixed(dec) : String(Math.round(n));
}

function _equal(a, b) {
  if (a == null || b == null) return false;
  if (typeof a === 'number' || typeof b === 'number') return Math.abs(Number(a) - Number(b)) < 1e-6;
  return String(a).toUpperCase() === String(b).toUpperCase();
}

// Apply `values` to the file text. Only replaces lines that already exist; skips unknown keys,
// AutoFPS-managed LOD keys unless opts.includeLod, and anything outside the schema.
// Returns { text, changed:[{id,from,to}], skipped:[{id,reason}] }. Line endings are preserved.
function applyToText(text, values, opts) {
  opts = opts || {};
  const crlf = /\r\n/.test(String(text));
  let t = _norm(text);
  const changed = [], skipped = [];
  for (const id of Object.keys(values || {})) {
    const k = S.BY_ID[id];
    if (!k) { skipped.push({ id, reason: 'not a profile setting' }); continue; }
    if (k.lod && !opts.includeLod) { skipped.push({ id, reason: 'AutoFPS-managed (TLOD/OLOD not applied)' }); continue; }
    const vb = _block(t, 'Video'), gb = _block(t, 'Graphics');
    const range = k.block === 'Video' ? vb : (gb && _section(t, gb, k.section));
    if (!range) { skipped.push({ id, reason: 'section missing from your sim file' }); continue; }
    const body = t.slice(range.start, range.end);
    const m = body.match(_lineRe(k.key));
    if (!m) { skipped.push({ id, reason: 'setting no longer in your sim file' }); continue; }
    const from = _parse(m[2]);
    if (_equal(from, values[id])) continue;
    const tok = _format(m[2], values[id], k);
    if (tok == null) { skipped.push({ id, reason: 'bad value' }); continue; }
    const nb = body.replace(_lineRe(k.key), (_, pre) => pre + tok);
    t = t.slice(0, range.start) + nb + t.slice(range.end);
    changed.push({ id, from, to: _parse(tok) });
  }
  return { text: crlf ? t.replace(/\n/g, '\r\n') : t, changed, skipped };
}

// Every applied key must read back as intended. Returns the list of mismatches (empty = verified).
function verify(text, values, opts) {
  const cur = readProfileable(text);
  const bad = [];
  for (const id of Object.keys(values || {})) {
    const k = S.BY_ID[id];
    if (!k || (k.lod && !(opts && opts.includeLod))) continue;
    if (!(id in cur)) continue;                       // skipped as missing — reported by applyToText
    if (!_equal(cur[id], values[id])) bad.push({ id, want: values[id], got: cur[id] });
  }
  return bad;
}

// ── comparing / naming ───────────────────────────────────────────────────────────────────────
function diff(from, to, opts) {
  const out = [];
  for (const k of S.KEYS) {
    if (k.lod && !(opts && opts.includeLod)) continue;
    if (!(k.id in (to || {})) || !(k.id in (from || {}))) continue;
    if (!_equal(from[k.id], to[k.id])) out.push({ id: k.id, from: from[k.id], to: to[k.id], dir: S.direction(k, from[k.id], to[k.id]) });
  }
  return out;
}
// "matches current": every key the profile holds equals the live value (LOD ignored — AutoFPS
// rewrites OLOD on sim exit, a known false change).
function matches(values, current) {
  let n = 0;
  for (const id of Object.keys(values || {})) {
    const k = S.BY_ID[id]; if (!k || k.lod || !(id in (current || {}))) continue;
    if (!_equal(values[id], current[id])) return false;
    n++;
  }
  return n > 0;
}

function _word(id, v) { const k = S.BY_ID[id]; const d = S.display(k, v); return d.includes(' · ') ? d.split(' · ')[1] : d; }
function profileName(v) {
  v = v || {};
  const parts = [];
  const aa = v['Video/AntiAliasing'];
  if (aa != null) {
    let s = _word('Video/AntiAliasing', aa);
    if (/^DLSS$/i.test(aa) && v['Video/DLSSMode'] != null) s += ' ' + _word('Video/DLSSMode', v['Video/DLSSMode']);
    parts.push(s);
  }
  if (v['Video/PrimaryScaling'] != null) parts.push(Math.round(v['Video/PrimaryScaling'] * 100) + '%');
  if (v['Graphics/Texture/Quality'] != null) parts.push('Textures ' + _word('Graphics/Texture/Quality', v['Graphics/Texture/Quality']));
  if (v['Graphics/VolumetricClouds/Quality'] != null) parts.push('Clouds ' + _word('Graphics/VolumetricClouds/Quality', v['Graphics/VolumetricClouds/Quality']));
  const fg = v['Video/FrameGeneration'];
  if (fg != null) parts.push(/NONE/i.test(fg) ? 'No frame gen' : (/FSR/i.test(fg) ? 'FSR FG' : 'DLSS FG'));
  return parts.join(' · ') || 'Sim settings';
}

// ── history: per-flight snapshot → profile values ─────────────────────────────────────────────
// summary.settings → schema values. Old snapshots stored the upscaler as a display string ("TAA",
// "DLSS Quality") and frame gen as "FSR FG" / "off" under 'Sim/'. Only what is KNOWN is returned —
// a key that wasn't logged is simply absent (applying such a profile leaves that setting alone).
function fromSnapshot(st) {
  if (!st || !st.graphics) return null;
  const out = {};
  for (const [id, val] of Object.entries(st.graphics)) if (S.BY_ID[id]) out[id] = val;
  const up = String(st.upscaling || '');
  if (!out['Video/AntiAliasing'] && up) {
    const [m, mode] = up.split(/\s+/);
    if (/^(TAA|DLSS|DLAA)$/i.test(m)) {
      out['Video/AntiAliasing'] = m.toUpperCase();
      if (/^DLSS$/i.test(m) && mode && !out['Video/DLSSMode']) out['Video/DLSSMode'] = mode.toUpperCase();
    }
  }
  const fg = st.graphics['Sim/FrameGeneration'] != null ? st.graphics['Sim/FrameGeneration'] : st.frame_gen;
  if (fg != null && !out['Video/FrameGeneration']) {
    const w = /^off$/i.test(fg) ? 'NONE' : /FSR/i.test(fg) ? 'FSRFG' : /DLSS/i.test(fg) ? 'DLSSFG' : null;
    if (w) out['Video/FrameGeneration'] = w;
  }
  const tf = st.graphics['Sim/TargetFPS'] != null ? st.graphics['Sim/TargetFPS'] : st.target_fps;
  if (tf != null && out['Video/TargetFrameRate'] == null) out['Video/TargetFrameRate'] = Number(tf);
  if (st.fg_multiplier != null && out['Video/NBFramesToGenerate'] == null) out['Video/NBFramesToGenerate'] = Number(st.fg_multiplier) - 1;
  return Object.keys(out).length ? out : null;
}

// Two snapshots describe the same setup if every key BOTH recorded is equal (LOD ignored). This
// lets newly-logged keys (sharpening, exposure… from v6.27.0) join an existing run instead of
// splitting it on the day logging started.
function _sameSetup(a, b) {
  for (const id of Object.keys(a)) {
    const k = S.BY_ID[id]; if (!k || k.lod || !(id in b)) continue;
    if (!_equal(a[id], b[id])) return false;
  }
  return true;
}

const _med = a => { const s = a.filter(x => x != null && Number.isFinite(x)).sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const _counts = a => a.reduce((m, x) => (m[x] = (m[x] || 0) + 1, m), {});

// flights: chronological [{session_id, timestamp, aircraft, p99, felt, dur, vram, vramTotal, sim, excluded, settings}]
// → runs of consecutive flights flown on the same setup, with honest stats.
function historyRuns(flights) {
  const runs = [];
  let cur = null;
  for (const f of flights || []) {
    const vals = fromSnapshot(f.settings);
    if (!vals) continue;
    if (!cur || !_sameSetup(cur.values, vals)) {
      cur = { values: Object.assign({}, vals), first: f.timestamp, last: f.timestamp, all: [] };
      runs.push(cur);
    } else {
      for (const [id, v] of Object.entries(vals)) if (!(id in cur.values)) cur.values[id] = v;   // keys logged later
    }
    // LOD: keep the latest the sim saved (informational; profiles don't apply it unless asked)
    for (const id of ['Graphics/Terrain/LoDFactor', 'Graphics/ObjectsLoD/LoDFactor']) if (vals[id] != null) cur.values[id] = vals[id];
    cur.last = f.timestamp;
    cur.all.push(f);
  }
  return runs.map((r, i) => {
    const fl = r.all.filter(f => !f.excluded);
    const hrs = fl.reduce((a, f) => a + (f.dur || 0), 0) / 3600;
    const felt = fl.reduce((a, f) => a + (f.felt || 0), 0);
    return {
      id: 'run-' + String(r.first).slice(0, 10) + '-' + i,
      first: r.first, last: r.last, n: fl.length, total: r.all.length,
      sessions: fl.map(f => f.session_id),
      values: r.values, name: profileName(r.values),
      p99: _med(fl.map(f => f.p99)), feltHr: hrs > 0 ? Math.round(felt / hrs * 10) / 10 : null,
      vram: _med(fl.map(f => f.vram)), vramTotal: _med(fl.map(f => f.vramTotal)) || null,
      aircraft: _counts(fl.map(f => f.aircraft || '?')), sims: _counts(fl.map(f => f.sim || '?')),
      flights: fl
    };
  });
}

// Track record of any profile: logged flights whose setup matches it (on keys both recorded).
function trackRecord(values, flights) {
  const fl = (flights || []).filter(f => !f.excluded).filter(f => { const v = fromSnapshot(f.settings); return v && _sameSetup(values, v) && _sameSetup(v, values); });
  if (!fl.length) return null;
  const hrs = fl.reduce((a, f) => a + (f.dur || 0), 0) / 3600;
  return { n: fl.length, p99: _med(fl.map(f => f.p99)), feltHr: hrs > 0 ? Math.round(fl.reduce((a, f) => a + (f.felt || 0), 0) / hrs * 10) / 10 : null,
    vram: _med(fl.map(f => f.vram)), vramTotal: _med(fl.map(f => f.vramTotal)) || null, last: fl[fl.length - 1].timestamp };
}

// ── ⭐ ABRP Suggested ─────────────────────────────────────────────────────────────────────────
// Aircraft-normalized: a run is scored against what EACH aircraft normally does across ALL your
// flights, so a run full of light Citation flights can't beat a Fenix-heavy run just by mix.
//   feltRatio = Σ felt stutters ÷ Σ (hours × that aircraft's usual felt/hr)   (1.0 = your normal)
//   p99Delta  = median of (flight p99 − that aircraft's median p99)
const MIN_BASE = 8, MIN_CANDIDATE = 5, VRAM_CAP = 0.96;   // 96% = AutoFPS's own VRAM hold line; Dean's good setups peak ~93%
function _aircraftNorms(flights) {
  const by = {};
  for (const f of flights) { if (f.excluded) continue; const a = f.aircraft || '?'; (by[a] = by[a] || []).push(f); }
  const norms = {};
  for (const [a, fl] of Object.entries(by)) {
    const hrs = fl.reduce((s, f) => s + (f.dur || 0), 0) / 3600;
    norms[a] = { feltHr: hrs > 0 ? fl.reduce((s, f) => s + (f.felt || 0), 0) / hrs : 0, p99: _med(fl.map(f => f.p99)), n: fl.length };
  }
  return norms;
}
function _score(run, norms) {
  let felt = 0, expect = 0; const dp = [];
  for (const f of run.flights) {
    const nm = norms[f.aircraft || '?']; if (!nm) continue;
    felt += f.felt || 0; expect += (f.dur || 0) / 3600 * nm.feltHr;
    if (f.p99 != null && nm.p99 != null) dp.push(f.p99 - nm.p99);
  }
  return { feltRatio: expect > 0 ? felt / expect : null, p99Delta: _med(dp) };
}

function suggest(flights, opts) {
  opts = opts || {};
  const runs = historyRuns(flights);
  const norms = _aircraftNorms(flights || []);
  const vramOk = r => !r.vram || !r.vramTotal || r.vram / r.vramTotal <= VRAM_CAP;
  const scored = runs.map(r => Object.assign({}, r, _score(r, norms)));
  const eligible = scored.filter(r => r.n >= MIN_BASE && r.feltRatio != null && vramOk(r));
  if (!eligible.length) return { ok: false, reason: 'Not enough flights on any one setup yet (need ' + MIN_BASE + ').', runs: scored };
  eligible.sort((a, b) => (a.feltRatio - b.feltRatio) || ((a.p99Delta || 0) - (b.p99Delta || 0)));
  const base = eligible[0];
  const conf = base.n >= 15 ? 'High' : 'Medium';
  const pct = Math.round((1 - base.feltRatio) * 100);
  const reasons = [];
  reasons.push('Base: your ' + fmtRange(base.first, base.last) + ' setup — ' + base.n + ' flights, P99 ' + base.p99 +
    ' ms, ' + base.feltHr + ' felt stutters/hr.');
  reasons.push(pct >= 0 ? (pct + '% fewer felt stutters than your usual for the same aircraft — the best of ' + eligible.length + ' well-flown setups.')
                        : ('Your best-sampled setup, though ' + (-pct) + '% more felt stutters than your overall usual.'));
  if (base.vram && base.vramTotal) reasons.push('Video memory peaked at a typical ' + Math.round(base.vram / base.vramTotal * 100) + '% — under the ' + Math.round(VRAM_CAP * 100) + '% line where AutoFPS starts holding detail back.');
  const mix = Object.entries(base.aircraft).sort((a, b) => b[1] - a[1]).map(([a, n]) => a + ' ' + n).join(', ');
  reasons.push('Aircraft flown on it: ' + mix + ' (scores are compared per aircraft, so the mix can\'t flatter it).');

  // Later setups that changed only a few things: evidence for or against each change.
  const candidates = [];
  for (const r of scored) {
    if (r === base || r.first <= base.first || r.n < 2) continue;   // single flights are noise, not evidence
    const d = diff(base.values, r.values);
    if (!d.length || d.length > 4) continue;
    const better = r.feltRatio != null && r.feltRatio <= base.feltRatio * 1.15 && (r.p99Delta == null || base.p99Delta == null || r.p99Delta <= base.p99Delta + 0.5) && vramOk(r);
    const status = r.n < MIN_CANDIDATE ? 'collecting' : (better ? 'adopted' : 'rejected');
    candidates.push({ run: r.id, n: r.n, changes: d, status, feltHr: r.feltHr, p99: r.p99 });
  }
  const values = Object.assign({}, base.values);
  for (const c of candidates) if (c.status === 'adopted') for (const ch of c.changes) values[ch.id] = ch.to;
  for (const c of candidates) {
    const what = c.changes.map(ch => S.BY_ID[ch.id].label + ' ' + S.display(S.BY_ID[ch.id], ch.from) + ' → ' + S.display(S.BY_ID[ch.id], ch.to)).join('; ');
    if (c.status === 'adopted') reasons.push('Adopted: ' + what + ' — ' + c.n + ' flights, no measurable cost against your usual for the same aircraft.');
    else if (c.status === 'rejected') reasons.push('Not adopted: ' + what + ' — ' + c.n + ' flights ran rougher (' + c.feltHr + ' felt/hr).');
    else reasons.push('Collecting: ' + what + ' — only ' + c.n + ' flight' + (c.n === 1 ? '' : 's') + ' so far; needs ' + MIN_CANDIDATE + '.');
  }
  // Sim-update awareness: measured on an older sim build than you're running now?
  const curSim = opts.currentSim || null;
  const baseSims = Object.keys(base.sims);
  if (curSim && !baseSims.includes(curSim)) {
    reasons.push('Measured on sim ' + baseSims.join('/') + '; you\'re on ' + curSim + ' now. The suggestion re-checks itself as you fly.');
  }
  const unrecorded = S.KEYS.filter(k => !k.lod && !(k.id in values)).map(k => k.label);
  return { ok: true, values, name: 'ABRP Suggested', confidence: conf, base: { id: base.id, first: base.first, last: base.last, n: base.n, p99: base.p99, feltHr: base.feltHr },
    reasons, candidates, unrecorded, runs: scored.map(r => ({ id: r.id, feltRatio: r.feltRatio, p99Delta: r.p99Delta })) };
}

function fmtRange(a, b) {
  const f = s => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  return a && b && String(a).slice(0, 10) !== String(b).slice(0, 10) ? f(a) + ' – ' + f(b) : f(a || b);
}

module.exports = { readProfileable, applyToText, verify, diff, matches, profileName, fromSnapshot, historyRuns, trackRecord, suggest, fmtRange,
  _equal, MIN_BASE, MIN_CANDIDATE, VRAM_CAP };
