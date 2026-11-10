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
  // A profile is a custom setup. If the file still names a preset ("Preset Ultra" after picking the
  // in-sim Ultra preset), the sim could re-impose that preset's values over ours at launch — so any
  // graphics change also sets the desktop block's "Preset" line to Custom (VR block untouched).
  let preset = null;
  if (changed.some(c => c.id.startsWith('Graphics/'))) {
    const gb = _block(t, 'Graphics');
    if (gb) {
      const body = t.slice(gb.start, gb.end);
      const m = body.match(/^(\tPreset )(\S+)$/m);
      if (m && m[2] !== 'Custom') {
        preset = { from: m[2], to: 'Custom' };
        t = t.slice(0, gb.start) + body.replace(/^(\tPreset )(\S+)$/m, (_, pre) => pre + 'Custom') + t.slice(gb.end);
      }
    }
  }
  return { text: crlf ? t.replace(/\n/g, '\r\n') : t, changed, skipped, preset };
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
  // Settings the base flights never logged (sharpening, exposure, Reflex, DLSS/FSR mode — logged only
  // from v6.27.0). Leaving them alone made "Apply" keep whatever the sim had (Dean 2026-11-10: exposure
  // stayed -0.45 after a test). Fill each from the NEWEST place it's known: (1) a logged flight, else
  // (2) the newest saved profile (opts.profiles, newest first). Every fill is named in Why.
  const filled = [];
  for (const k of S.KEYS) {
    if (k.lod || k.id in values) continue;
    let val = null, from = null;
    for (let i = (flights || []).length - 1; i >= 0 && val == null; i--) {
      const f = flights[i]; if (f.excluded) continue;
      const v = fromSnapshot(f.settings); if (v && v[k.id] != null) { val = v[k.id]; from = 'your ' + fmtRange(f.timestamp, f.timestamp) + ' flight'; }
    }
    for (const p of (opts.profiles || [])) { if (val != null) break; if (p.values && p.values[k.id] != null) { val = p.values[k.id]; from = 'your profile "' + p.name + '"'; } }
    if (val != null) { values[k.id] = val; filled.push({ id: k.id, label: k.label, value: val, from }); }
  }
  const bySrc = {};
  for (const f of filled) (bySrc[f.from] = bySrc[f.from] || []).push(f.label + ' ' + S.display(S.BY_ID[f.id], f.value));
  for (const [src, items] of Object.entries(bySrc)) reasons.push('Not logged on the base flights, so taken from ' + src + ': ' + items.join('; ') + '.');
  const unrecorded = S.KEYS.filter(k => !k.lod && !(k.id in values)).map(k => k.label);
  return { ok: true, values, name: 'ABRP Suggested', confidence: conf, base: { id: base.id, first: base.first, last: base.last, n: base.n, p99: base.p99, feltHr: base.feltHr },
    reasons, candidates, unrecorded, filled, runs: scored.map(r => ({ id: r.id, feltRatio: r.feltRatio, p99Delta: r.p99Delta })) };
}

// ── 🧪 EXPERIMENTS (v6.28.0) ─────────────────────────────────────────────────────────────────
// An experiment = a named base profile + a few changed settings, flown for a small budget of flights
// and judged against the base's own flights. These are the pure parts: the text format, the verdict,
// and ABRP's own proposals. Storage / apply / keep / revert live in profiles_store.js.

const HEADER = 'ABRP-PROFILE v1';

// Parse a pasted block. ctx.resolveBase(name) → {id, name, values} | null (the store supplies it).
// Returns { ok, kind:'experiment'|'profile', name, base, changes:[{id,label,to}], budget, why,
//           errors:[line msgs], warnings:[] } — never touches a file.
function parseChangeText(text, ctx) {
  ctx = ctx || {};
  const lines = String(text || '').replace(/\r/g, '').split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  const out = { ok: false, kind: 'experiment', name: '', baseName: '', base: null, changes: [], budget: 3, why: '', errors: [], warnings: [] };
  const hi = lines.findIndex(l => /^ABRP-PROFILE\b/i.test(l));
  if (hi < 0) { out.errors.push('This doesn\'t look like an ABRP settings block (it should start with "' + HEADER + '").'); return out; }
  const set = new Map();
  for (const line of lines.slice(hi + 1)) {
    const m = line.match(/^([a-z]+)\s*:\s*(.*)$/i);
    if (!m) { out.errors.push('Not understood: "' + line + '"'); continue; }
    const key = m[1].toLowerCase(), val = m[2].replace(/\s+\(.*\)\s*$/, '').trim();
    if (key === 'name') out.name = val;
    else if (key === 'base') out.baseName = val;
    else if (key === 'why' || key === 'note') out.why = m[2].trim();
    else if (key === 'type') out.kind = /profile/i.test(val) ? 'profile' : 'experiment';
    else if (key === 'flights') { const n = parseInt(val, 10); if (n >= 1 && n <= 20) out.budget = n; else out.errors.push('flights: must be 1–20'); }
    else if (key === 'set') {
      const eq = val.lastIndexOf('=');
      if (eq < 0) { out.errors.push('set: needs "setting = value" — got "' + val + '"'); continue; }
      const name = val.slice(0, eq).trim(), v = val.slice(eq + 1).trim();
      let k = S.findKey(name);
      if (!k) { out.errors.push('Unknown setting "' + name + '"'); continue; }
      // In-sim single rows that are two file settings: "Depth of field = Medium" means on + quality Medium.
      if (k.key === 'Enabled' && k.labels === S.LABELS.ONOFF) {
        const sib = S.BY_ID[k.id.replace(/\/Enabled$/, '/Quality')];
        if (sib && !/^(on|off|0|1)$/i.test(v)) {
          const pv = S.parseValue(sib, v);
          if (!pv.ok) { out.errors.push(pv.reason); continue; }
          set.set(k.id, 1); set.set(sib.id, pv.value); continue;
        }
      }
      const pv = S.parseValue(k, v);
      if (!pv.ok) { out.errors.push(pv.reason); continue; }
      set.set(k.id, pv.value);
    } else out.errors.push('Unknown field "' + key + ':"');
  }
  if (!set.size) out.errors.push('No "set:" lines — nothing to change.');
  // base
  if (out.kind === 'experiment') {
    const b = ctx.resolveBase ? ctx.resolveBase(out.baseName || null) : null;
    if (!b) out.errors.push(out.baseName ? ('No profile named "' + out.baseName + '" (use a saved profile\'s name, "ABRP Suggested" or "current")') : 'No base profile to start from.');
    else out.base = b;
  }
  for (const [id, to] of set) {
    const k = S.BY_ID[id];
    const from = out.base ? out.base.values[id] : undefined;
    out.changes.push({ id, label: k.label, to, from: from === undefined ? null : from, dir: from === undefined ? null : S.direction(k, from, to), same: from !== undefined && _equal(from, to) });
  }
  if (out.kind === 'experiment' && out.base) {
    const real = out.changes.filter(c => !c.same);
    if (!real.length && set.size) out.errors.push('Every change already matches "' + out.base.name + '" — nothing to test.');
    // count in-sim rows, not file lines: "Depth of field = Medium" is one row (on flag + quality)
    const rows = new Set(real.map(c => c.id.replace(/\/(Enabled|Quality)$/, '')));
    if (rows.size > 1) out.warnings.push(rows.size + ' settings change at once — if the result moves, you won\'t know which one did it.');
    const vr = out.base.vramPct;
    for (const c of real) {
      const k = S.BY_ID[c.id];
      if (k.calib !== 'confirmed') out.warnings.push(k.label + ' has an unverified label — the value is written exactly, but its in-sim name may differ.');
      if (k.cost === 'vram' && c.dir === 'up' && vr != null && vr >= 0.90) out.warnings.push(k.label + ' uses video memory, and this base already peaks at ' + Math.round(vr * 100) + '%.');
    }
  }
  if (!out.name) {
    const real = out.changes.filter(c => !c.same);
    const ids = new Set(real.map(c => c.id));
    out.name = real.filter(c => !(c.id.endsWith('/Enabled') && ids.has(c.id.replace(/\/Enabled$/, '/Quality'))))
      .map(c => c.label.replace(/ quality$/, '') + ' ' + _word(c.id, c.to)).join(' + ') || 'Experiment';
  }
  out.ok = !out.errors.length;
  return out;
}

// Any profile / experiment → the same text format (Copy as text). Experiments list only their
// changes + base; plain profiles list every value (type: profile) so pasting recreates them exactly.
function toChangeText(p) {
  const L = [HEADER, 'name: ' + (p.name || 'Profile')];
  // in-sim words where the label is confirmed ("Ultra", "On+Boost"); the raw stored value otherwise
  const line = (id, v) => {
    const k = S.BY_ID[id];
    let shown;
    if ((k.type === 'word' || k.type === 'enum') && k.labels && k.labels[k.type === 'word' ? String(v).toUpperCase() : v] != null && k.calib === 'confirmed') shown = k.labels[k.type === 'word' ? String(v).toUpperCase() : v];
    else if (k.type === 'word' || k.type === 'enum') shown = String(v);
    else shown = S.display(k, v).replace(/ frames$/, '').replace(/ · unverified$/, '');
    // a word shared by two stored values can't round-trip — fall back to the raw value
    if (k.labels && Object.values(k.labels).filter(w => w === shown).length > 1) shown = String(v);
    return 'set: ' + k.label + ' = ' + shown;
  };
  if (p.changes && p.changes.length) {
    if (p.baseName) L.push('base: ' + p.baseName);
    for (const c of p.changes) L.push(line(c.id, c.to));
    if (p.budget) L.push('flights: ' + p.budget);
  } else {
    L.push('type: profile');
    for (const k of S.KEYS) if (!k.lod && p.values && p.values[k.id] != null) L.push(line(k.id, p.values[k.id]));
  }
  if (p.why || p.note) L.push('why: ' + (p.why || p.note));
  return L.join('\n');
}

// Per-flight values, normalized by that aircraft's own usual — so a Citation-heavy side can't look
// smoother than a Fenix-heavy side just because of the planes.
function _flightMetrics(f, nm) {
  const hrs = (f.dur || 0) / 3600;
  return {
    felt: nm && nm.feltHr > 0 && hrs > 0 ? (f.felt || 0) / hrs / nm.feltHr : null,     // 1.0 = your usual
    p99: f.p99 != null && nm && nm.p99 != null ? f.p99 - nm.p99 : null,                   // ms vs usual
    gpu: f.gpu != null ? f.gpu : null,                                                     // avg GPU busy ms
    vram: f.vram && f.vramTotal ? f.vram / f.vramTotal : null,                             // peak fraction
    taxi: f.taxiStut != null ? f.taxiStut : null
  };
}
const _mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const _sd = a => { if (a.length < 2) return 0; const m = _mean(a); return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length); };
const EXP_METRICS = [
  { k: 'felt', label: 'Felt stutters (vs your usual)', judge: true, unit: '×', dec: 2 },
  { k: 'p99', label: 'P99 frametime (vs your usual)', judge: true, unit: 'ms', dec: 2 },
  { k: 'taxi', label: 'Taxi stutter', judge: true, unit: '%', dec: 3 },
  { k: 'gpu', label: 'GPU busy per frame', judge: false, unit: 'ms', dec: 1 },
  { k: 'vram', label: 'Peak video memory', judge: false, unit: '%', dec: 0, pct: true }
];

// Verdict for an experiment vs its base, on flights matched by their logged settings.
// Same vocabulary as Settings A/B: collecting · free · saves · noeffect · costs · mixed.
function experimentVerdict(exp, flights) {
  const all = (flights || []).filter(f => !f.excluded);
  const norms = _aircraftNorms(all);
  const on = vals => all.filter(f => { const v = fromSnapshot(f.settings); return v && _sameSetup(vals, v) && _sameSetup(v, vals); });
  const ef = on(exp.values), bf = on(exp.baseValues || {});
  const budget = exp.budget || 3;
  const em = ef.map(f => _flightMetrics(f, norms[f.aircraft || '?'])), bm = bf.map(f => _flightMetrics(f, norms[f.aircraft || '?']));
  const rows = []; let worse = false, better = false, gpuUp = false, vramOver = false;
  const collecting = ef.length < 2 || bf.length < 2;
  for (const m of EXP_METRICS) {
    const a = em.map(x => x[m.k]).filter(v => v != null), b = bm.map(x => x[m.k]).filter(v => v != null);
    if (!a.length || !b.length) continue;
    const am = _mean(a), bmn = _mean(b), delta = am - bmn, sigma = b.length >= 2 ? _sd(b) : null;
    const beyond = sigma != null && sigma > 0 ? Math.abs(delta) > sigma : false;
    if (!collecting && beyond && m.judge) { if (delta > 0) worse = true; else better = true; }
    if (!collecting && m.k === 'gpu' && delta > 0) gpuUp = true;
    if (m.k === 'vram' && am > VRAM_CAP) vramOver = true;
    rows.push({ k: m.k, label: m.label, base: bmn, exp: am, delta, sigma, within: m.judge ? (sigma > 0 ? !beyond : null) : null, unit: m.unit, dec: m.dec, pct: !!m.pct });
  }
  let verdict, sentence;
  if (collecting) { verdict = 'collecting'; sentence = 'Collecting: ' + ef.length + ' of ' + budget + ' experiment flights' + (bf.length < 2 ? (' (the base needs 2 flights too; it has ' + bf.length + ')') : '') + '.'; }
  else if (worse && better) { verdict = 'mixed'; sentence = 'Trade-off: some measures improved and others got worse, beyond your normal flight-to-flight variation.'; }
  else if (worse || vramOver) { verdict = 'costs'; sentence = worse ? 'Measurably rougher than the base — worth reverting.' : 'Smoothness held, but video memory ran past the ' + Math.round(VRAM_CAP * 100) + '% line.'; }
  else if (better) { verdict = 'saves'; sentence = 'Smoother than the base, beyond normal variation.'; }
  else if (gpuUp) { verdict = 'free'; sentence = 'Free upgrade: the GPU took the extra work and smoothness held.'; }
  else { verdict = 'noeffect'; sentence = 'No measurable effect: everything stayed within your normal flight-to-flight variation.'; }
  // honesty notes: things that changed between the two sides besides the setting
  const notes = [];
  const set = (fl, f) => [...new Set(fl.map(f))].filter(Boolean);
  const ea = set(ef, f => f.afps), ba = set(bf, f => f.afps);
  if (ea.length && ba.length && ea.join() !== ba.join()) notes.push('AutoFPS range differs: base ' + ba.join('/') + ', experiment ' + ea.join('/') + '.');
  const es = set(ef, f => f.sim), bs = set(bf, f => f.sim);
  if (es.length && bs.length && es.some(s => !bs.includes(s))) notes.push('Sim version differs: base ' + bs.join('/') + ', experiment ' + es.join('/') + '.');
  const et = set(ef, f => f.traffic), bt = set(bf, f => f.traffic);
  if (et.length && bt.length && et.join() !== bt.join()) notes.push('Online traffic differs: base ' + bt.join('/') + ', experiment ' + et.join('/') + '.');
  return { verdict, sentence, rows, n: ef.length, baseN: bf.length, budget, done: ef.length >= budget, notes,
    lastExpFlight: ef.length ? ef[ef.length - 1].timestamp : null };
}

// Compact block for pasting into a chat with Claude ("Copy results for Claude").
function experimentResultsText(exp, v) {
  const fmt = r => { const d = r.pct ? Math.round(r.delta * 100) + ' pts' : (r.delta >= 0 ? '+' : '') + r.delta.toFixed(r.dec) + ' ' + r.unit;
    return '  ' + r.label + ': base ' + (r.pct ? Math.round(r.base * 100) + '%' : r.base.toFixed(r.dec)) + ' → ' + (r.pct ? Math.round(r.exp * 100) + '%' : r.exp.toFixed(r.dec)) + ' (' + d + (r.within == null ? '' : r.within ? ', within noise' : ', BEYOND noise') + ')'; };
  return ['ABRP-EXPERIMENT-RESULTS v1',
    'experiment: ' + exp.name, 'base: ' + (exp.baseName || '?'),
    'changes: ' + (exp.changes || []).map(c => S.BY_ID[c.id].label + ' ' + S.display(S.BY_ID[c.id], c.from) + ' → ' + S.display(S.BY_ID[c.id], c.to)).join('; '),
    'flights: ' + v.n + ' experiment / ' + v.baseN + ' base (budget ' + v.budget + ')',
    'verdict: ' + v.verdict.toUpperCase() + ' — ' + v.sentence,
    ...v.rows.map(fmt), ...(v.notes.length ? ['notes: ' + v.notes.join(' ')] : []),
    'status: ' + (exp.status || 'draft')].join('\n');
}

// ABRP's own proposals: one-step-up changes to GPU-cost settings, offered only when the GPU clearly
// has headroom (CPU-bound rig). Never VRAM-cost or CPU-cost settings, never unverified labels, never
// a setting already under test or one that measurably cost something in the last 30 days.
const PROPOSE_ORDER = ['Graphics/VolumetricLights/Quality', 'Graphics/ContactShadows/Quality', 'Graphics/SSR/Quality',
  'Graphics/SSAO/Quality', 'Graphics/VolumetricClouds/Quality', 'Graphics/WindShield/Quality', 'Graphics/RaytracedShadows/Enabled',
  'Graphics/DisplacementMapping/Enabled'];
function proposeExperiments(flights, current, opts) {
  opts = opts || {};
  const out = { ok: false, reason: '', gpu: null, budgetMs: null, cpuBound: null, proposals: [] };
  if (!current) { out.reason = 'Your sim settings file couldn\'t be read.'; return out; }
  const recent = (flights || []).filter(f => !f.excluded && f.gpu != null).slice(-10);
  if (recent.length < 3) { out.reason = 'Needs a few more logged flights to judge GPU headroom.'; return out; }
  const tf = Number(current['Video/TargetFrameRate']) || 30;
  const frame = 1000 / tf;
  out.gpu = _med(recent.map(f => f.gpu)); out.budgetMs = frame; out.cpuBound = _med(recent.map(f => f.cpuBound));
  if (out.gpu > frame * 0.6) { out.reason = 'Your GPU is already busy ' + out.gpu.toFixed(1) + ' ms of each ' + frame.toFixed(1) + ' ms frame — no clear headroom to spend.'; return out; }
  const busy = new Set((opts.experiments || []).filter(e => e.status === 'draft' || e.status === 'active').flatMap(e => (e.changes || []).map(c => c.id)));
  const cutoff = Date.now() - 30 * 86400e3;
  const burned = new Set((opts.experiments || []).filter(e => e.verdict === 'costs' && Date.parse(e.finished || e.created) > cutoff).flatMap(e => (e.changes || []).map(c => c.id)));
  for (const id of PROPOSE_ORDER) {
    const k = S.BY_ID[id];
    if (!k || k.cost !== 'gpu' || k.calib !== 'confirmed' || busy.has(id) || burned.has(id)) continue;
    const cur = current[id]; if (cur == null) continue;
    // a quality row whose feature is switched off isn't a one-step change
    const en = current[id.replace(/\/Quality$/, '/Enabled')]; if (id.endsWith('/Quality') && en === 0) continue;
    const steps = Object.keys(k.labels || {}).map(Number).filter(n => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
    const max = k.max != null ? k.max : steps[steps.length - 1];
    const next = steps.find(s => s > Number(cur) && s <= max);
    if (next == null) continue;
    const word = _word(id, next);
    const p = { id: 'prop-' + id.replace(/\W+/g, '-'), name: k.label.replace(/ quality$/, '') + ' ' + word,
      changes: [{ id, from: cur, to: next }],
      why: 'GPU busy ~' + out.gpu.toFixed(1) + ' ms of a ' + frame.toFixed(1) + ' ms frame' + (out.cpuBound != null ? ', ' + Math.round(out.cpuBound) + '% of frames CPU-bound' : '') + '; ' + k.label.replace(/ quality$/, '').toLowerCase() + ' costs GPU time, not video memory.' };
    p.text = toChangeText({ name: p.name, baseName: opts.baseName || '', changes: p.changes, budget: 3, why: p.why });
    out.proposals.push(p);
    if (out.proposals.length >= (opts.max || 3)) break;
  }
  out.ok = true;
  if (!out.proposals.length) out.reason = 'Every GPU setting worth testing is already at its top step or under test.';
  return out;
}

function fmtRange(a, b) {
  const f = s => { const d = new Date(String(s).slice(0, 10) + 'T12:00:00'); return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  return a && b && String(a).slice(0, 10) !== String(b).slice(0, 10) ? f(a) + ' – ' + f(b) : f(a || b);
}

module.exports = { readProfileable, applyToText, verify, diff, matches, profileName, fromSnapshot, historyRuns, trackRecord, suggest, fmtRange,
  parseChangeText, toChangeText, experimentVerdict, experimentResultsText, proposeExperiments, HEADER, EXP_METRICS,
  _equal, MIN_BASE, MIN_CANDIDATE, VRAM_CAP };
