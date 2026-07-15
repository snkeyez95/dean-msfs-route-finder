'use strict';
// perf/native/gfx_watch.js — v6.12.0 SETTINGS A/B: the passive graphics-settings snapshot.
// Reads the WHOLE flat {Graphics} block of UserCfg.opt into a map at capture start ("silent data"),
// plus a CURATED watch list of ~10 GPU-heavy / VRAM-light keys the user would actually A/B test.
// The per-flight fingerprint hashes ONLY the watched keys — TLOD/OLOD/Texture are deliberately
// excluded (machine-driven or VRAM levers, not candidates). A fingerprint change between
// consecutive flights = the user changed a setting = a before/after card in the Settings A/B view.
//
// ⚠ LABEL CALIBRATION (Dean 2026-07-14: "you got one backwards once"): every enum key carries an
// EXPLICIT numeral→in-sim-label map — no assumed indexing. LIVE-CALIBRATED datapoint locked
// 2026-07-14: UserCfg `VolumetricClouds Quality 1` while AutoFPS displayed "Clouds: Med" →
// 0=Low / 1=Medium / 2=High / 3=Ultra. The other Quality enums use the same sim-wide scale;
// the A/B view always shows the raw numeral BESIDE the label so a mislabel can never hide a value.
// Sections that also have an Enabled flag report -1 (= "Off") when disabled, so toggling a feature
// off is a tracked change, not a blind spot.
const fs = require('fs'), path = require('path');

const Q_LABELS = { '-1': 'Off', 0: 'Low', 1: 'Medium', 2: 'High', 3: 'Ultra' };

// The watch list (Dean-scoped 2026-07-14, from his REAL UserCfg): GPU-work levers that don't feed
// VRAM. Excluded deliberately: Texture (VRAM), Terrain/ObjectsLoD (machine-driven + the TLOD study),
// Traffic (CPU), Buildings/Trees (VRAM+CPU), precaching (its own Lab experiment).
// fmt: 'pct' = float shown as percent · 'enum' = labels map · 'raw' = plain number.
const WATCH = [
  { id: 'Video/PrimaryScaling',            top: 'Video', key: 'PrimaryScaling', label: 'Render scale',        fmt: 'pct' },
  { id: 'Graphics/VolumetricClouds',       section: 'VolumetricClouds', key: 'Quality', gated: true, label: 'Volumetric clouds',  fmt: 'enum', labels: Q_LABELS },
  { id: 'Graphics/VolumetricLights',       section: 'VolumetricLights', key: 'Quality', gated: true, label: 'Volumetric lights',  fmt: 'enum', labels: Q_LABELS },
  { id: 'Graphics/SSAO',                   section: 'SSAO',             key: 'Quality', gated: true, label: 'Ambient occlusion (SSAO)', fmt: 'enum', labels: Q_LABELS },
  { id: 'Graphics/SSR',                    section: 'SSR',              key: 'Quality', gated: true, label: 'Reflections (SSR)',  fmt: 'enum', labels: Q_LABELS },
  { id: 'Graphics/ContactShadows',         section: 'ContactShadows',   key: 'Quality', gated: true, label: 'Contact shadows',    fmt: 'enum', labels: Q_LABELS },
  { id: 'Graphics/Shadows/Size',           section: 'Shadows',          key: 'Size',    label: 'Shadow map size',    fmt: 'raw' },
  { id: 'Graphics/Water/FFTSize',          section: 'Water',            key: 'FFTSize', label: 'Water waves (FFT)',  fmt: 'raw' },
  { id: 'Graphics/WindShield',             section: 'WindShield',       key: 'Quality', label: 'Windshield effects', fmt: 'enum', labels: Q_LABELS },
  { id: 'Graphics/Particles',              section: 'Particles',        key: 'Quality', label: 'Particles',          fmt: 'enum', labels: Q_LABELS },
];

// ── full {Graphics} snapshot ─────────────────────────────────────────────────
// Parses the flat desktop {Graphics} block into { 'Section/Key': number } (every nested section,
// ~40 keys, ~1.5 KB) + the {Video} block's PrimaryScaling. Whole map lands in summary.settings —
// cheap insurance even though cards only ever surface the watched subset.
function readAllGraphics(text) {
  if (!text) return null;
  const t = String(text).replace(/\r\n?/g, '\n');
  const out = {};
  // {Video ...} top-level lines (up to the first nested/next top-level block)
  const mv = t.match(/\{Video\b([\s\S]*?)\n\{/);
  if (mv) {
    const ps = mv[1].match(/^\s*PrimaryScaling\s+(-?[0-9.]+)/m);
    if (ps) out['Video/PrimaryScaling'] = parseFloat(ps[1]);
  }
  // flat {Graphics} (not {GraphicsVR}) → nested {Section key value ...} blocks
  const gi = t.search(/\{Graphics\b(?!VR)/);
  if (gi < 0) return Object.keys(out).length ? out : null;
  const vi = t.indexOf('{GraphicsVR', gi);
  const gfx = t.slice(gi, vi > gi ? vi : t.length);
  const secRe = /\{(\w+)\n([\s\S]*?)\}/g;
  let m;
  while ((m = secRe.exec(gfx)) !== null) {
    const sec = m[1];
    for (const line of m[2].split('\n')) {
      const km = line.match(/^\s*(\w+)\s+(-?[0-9.]+)\s*$/);
      if (km) out['Graphics/' + sec + '/' + km[1]] = parseFloat(km[2]);
    }
  }
  return Object.keys(out).length ? out : null;
}

// Effective watched value for one WATCH entry from the full map. Gated sections (have an Enabled
// flag) report -1 when disabled so an on/off toggle is a tracked change. null = key absent.
function watchValue(w, graphics) {
  if (!graphics) return null;
  if (w.top === 'Video') { const v = graphics['Video/' + w.key]; return v != null ? v : null; }
  if (w.gated) {
    const en = graphics['Graphics/' + w.section + '/Enabled'];
    if (en === 0) return -1;
  }
  const v = graphics['Graphics/' + w.section + '/' + w.key];
  return v != null ? v : null;
}

// { watchId: effectiveValue } — the curated subset the pipeline/UI carries per flight.
function watchValues(graphics) {
  if (!graphics) return null;
  const out = {};
  for (const w of WATCH) out[w.id] = watchValue(w, graphics);
  return out;
}

// Short stable fingerprint over ONLY the watched keys (djb2 hex). Same settings → same fp; any
// watched change (incl. Enabled toggles) → new fp → a run boundary in the A/B view.
function fingerprint(graphics) {
  const wv = watchValues(graphics);
  if (!wv) return null;
  const s = WATCH.map(w => w.id + '=' + (wv[w.id] != null ? wv[w.id] : 'x')).join(';');
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
  return h.toString(16).padStart(8, '0');
}

// Human display for a watched value ("1 · Medium", "100%", "1536", "Off"). Numeral ALWAYS shown
// beside an enum label so a label-calibration slip can never hide the real stored value.
function displayValue(w, v) {
  if (v == null) return '—';
  if (w.fmt === 'pct') return Math.round(v * 100) + '%';
  if (w.fmt === 'enum') {
    if (v === -1) return 'Off';
    const l = w.labels && w.labels[v];
    return l ? (v + ' · ' + l) : String(v);
  }
  return String(v);
}

// Watch metadata for the renderer (single source of truth — the UI never re-declares label maps).
function watchMeta() {
  return WATCH.map(w => ({ id: w.id, label: w.label, fmt: w.fmt, labels: w.labels || null,
    key: (w.top === 'Video' ? 'Video → ' + w.key : w.section + ' → ' + w.key) }));
}

// ── AutoFPS config snapshot ──────────────────────────────────────────────────
// The AutoFPS TLOD envelope lives OUTSIDE UserCfg (its own XML config) — without this, a Max-TLOD
// 800→700 change would be invisible to the fingerprint. Read min/max TLOD (+ target FPS for the
// active graphics mode) from MSFS2024_AutoFPS.config; the AutoFPS-lane fingerprint appends min-max.
// Read-only, defensive: any parse failure → null (flight just carries no cfg).
function autofpsCfgPath() {
  if (process.env.ABRP_AUTOFPS_CFG) return process.env.ABRP_AUTOFPS_CFG;
  return process.env.APPDATA ? path.join(process.env.APPDATA, 'MSFS_AutoFPS', 'MSFS2024_AutoFPS.config') : null;
}
function readAutofpsCfg(cfgPath) {
  try {
    const p = cfgPath || autofpsCfgPath();
    if (!p || !fs.existsSync(p)) return null;
    const xml = fs.readFileSync(p, 'utf8');
    const kv = {};
    const re = /<add\s+key="([^"]+)"\s+value="([^"]*)"/g;
    let m; while ((m = re.exec(xml)) !== null) kv[m[1]] = m[2];
    const vfr = String(kv.FlightTypeIFR).toLowerCase() === 'false';   // IFR profile unless explicitly VFR
    const sfx = vfr ? '_VFR' : '';
    const min = parseInt(kv['minTLod' + sfx], 10), max = parseInt(kv['maxTLod' + sfx], 10);
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    const mode = kv.ActiveGraphicsMode || null;
    const tKey = mode ? ('targetFps' + mode + (vfr ? 'VFR' : '')) : null;
    const target = tKey && kv[tKey] != null ? parseInt(kv[tKey], 10) : null;
    return { min, max, target: Number.isFinite(target) ? target : null, profile: vfr ? 'VFR' : 'IFR' };
  } catch (_) { return null; }
}

module.exports = { WATCH, readAllGraphics, watchValue, watchValues, fingerprint, displayValue, watchMeta, readAutofpsCfg, autofpsCfgPath };
