'use strict';
// perf/native/usercfg_schema.js — v6.27.0 SIM PROFILES: the ONE dictionary of every UserCfg.opt key a
// profile may hold. Every label ABRP shows for a sim setting comes from here (Settings A/B re-exports
// these maps), so the app can never show two different words for the same stored number.
//
// WHY THIS EXISTS (Dean 2026-11-10): UserCfg numbers do NOT share one scale. Texture Quality is
// inverted (2 = Medium, 1 = High) and I once told Dean his textures went DOWN when he'd raised them.
// Rules baked in here:
//   · every enum carries an EXPLICIT number → in-sim-word map (no assumed indexing)
//   · every key carries a calibration status: 'confirmed' (seen against the in-sim menu),
//     'inferred' (published references / the shared scale, not yet eyeballed), 'unverified'
//   · the UI ALWAYS shows the raw stored value beside the word; an unverified enum shows the number
//     only ("4 · unverified"), never a guessed word.
//
// CALIBRATION LOG
//   2026-07-14  Dean's in-sim screenshots vs his UserCfg: clouds / light shafts / SSAO / raymarched
//               reflections / contact shadows / windshield at 1 = "Medium"; glass cockpit 2 = High;
//               precache 3 = Ultra; rocks 0 = Low; Particles 1 = "High" (own short scale);
//               Water FFTSize 512 = "High".
//   2026-11-10  Texture Quality: 2 = Medium, 1 = High (Dean raised Medium→High, file went 2→1).
//   PENDING     Dean's screenshot pass of every in-sim graphics page (build step 1) — flips the
//               remaining 'inferred' / 'unverified' entries.
//
// SCOPE: the desktop {Graphics} block + the rendering part of {Video}. NEVER in a profile: display /
// window keys (Adapter, Monitor, Windowed, Resolution, PosX/Y, VSync, HDR10…), every *VR key, the
// {GraphicsVR} block, InstalledPackagesPath. Those are machine/monitor facts, not a "look".

const Q = { 0: 'Low', 1: 'Medium', 2: 'High', 3: 'Ultra' };               // the shared quality scale
const TEXTURE = { 0: 'Ultra', 1: 'High', 2: 'Medium', 3: 'Low' };         // INVERTED (2/1 confirmed; 0/3 inferred)
const PARTICLES = { 0: 'Low', 1: 'High' };                               // own short scale (1 = High confirmed)
const WATER = { 128: 'Low', 256: 'Medium', 512: 'High', 1024: 'Ultra' };  // 512 = High confirmed
const ONOFF = { 0: 'Off', 1: 'On' };
const AA = { TAA: 'TAA', DLSS: 'DLSS', DLAA: 'DLAA', FSR3: 'FSR 3', FSR: 'FSR', NONE: 'Off' };
const DLSS_MODE = { AUTO: 'Auto', DLAA: 'DLAA', QUALITY: 'Quality', BALANCED: 'Balanced', PERFORMANCE: 'Performance', ULTRAPERFORMANCE: 'Ultra performance' };
const FSR_MODE = { NATIVEAA: 'Native AA', QUALITY: 'Quality', BALANCED: 'Balanced', PERFORMANCE: 'Performance', ULTRAPERFORMANCE: 'Ultra performance' };
const FG = { NONE: 'Off', FSRFG: 'FSR 3 frame gen', DLSSFG: 'DLSS frame gen' };
const REFLEX = { OFF: 'Off', ON: 'On', BOOST: 'On + Boost' };

// type:  'enum' (numeric with labels) · 'word' (text value, labels map) · 'lod' (float ×100, "125") ·
//        'pct' (float ×100 %) · 'num' (plain number) · 'mult' (NBFramesToGenerate → "2×")
// cost:  what the setting mainly spends — 'gpu' | 'vram' | 'cpu' | 'mixed' | 'none'
// lod:   AutoFPS drives it in flight → excluded from "matches current" and only applied on request
const K = [];
function v(key, label, group, type, extra) { K.push(Object.assign({ id: 'Video/' + key, block: 'Video', key, label, page: 'Display & upscaling', group, type }, extra)); }
function g(section, key, label, page, group, type, extra) {
  K.push(Object.assign({ id: 'Graphics/' + section + '/' + key, block: 'Graphics', section, key, label, page, group, type }, extra));
}

// ── {Video}: upscaling / frame generation / image ────────────────────────────────────────────
v('AntiAliasing', 'Anti-aliasing / upscaler', 'Upscaling', 'word', { labels: AA, calib: 'confirmed', cost: 'gpu' });
v('DLSSMode', 'DLSS mode', 'Upscaling', 'word', { labels: DLSS_MODE, calib: 'inferred', cost: 'gpu' });
v('FSRMode', 'FSR mode', 'Upscaling', 'word', { labels: FSR_MODE, calib: 'inferred', cost: 'gpu' });
v('PrimaryScaling', 'Render scaling', 'Upscaling', 'pct', { calib: 'confirmed', cost: 'gpu' });
v('SecondaryScaling', 'Secondary render scaling', 'Upscaling', 'pct', { calib: 'inferred', cost: 'gpu', advanced: true });
v('SharpenAmount', 'Sharpening', 'Image', 'num', { calib: 'inferred', cost: 'none' });
v('ExposureBias', 'Exposure', 'Image', 'num', { calib: 'inferred', cost: 'none' });
v('FrameGeneration', 'Frame generation', 'Frame rate', 'word', { labels: FG, calib: 'confirmed', cost: 'gpu' });
v('NBFramesToGenerate', 'Generated frames', 'Frame rate', 'mult', { calib: 'inferred', cost: 'gpu' });
v('Reflex', 'NVIDIA Reflex', 'Frame rate', 'word', { labels: REFLEX, calib: 'inferred', cost: 'none' });
v('TargetFrameRate', 'Target frame rate', 'Frame rate', 'num', { calib: 'confirmed', cost: 'none' });
v('FrameLimiter', 'Frame rate limit', 'Frame rate', 'num', { calib: 'inferred', cost: 'none' });
v('DynamicSettings', 'Dynamic settings', 'Frame rate', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'none' });

// ── {Graphics}: terrain & objects ────────────────────────────────────────────────────────────
const W = 'World', L = 'Lighting & effects', T = 'Traffic & life', A = 'Advanced (file only)';
g('Terrain', 'LoDFactor', 'Terrain level of detail (TLOD)', W, 'Terrain', 'lod', { calib: 'confirmed', cost: 'cpu', lod: true });
g('OffscreenTerrainPreCaching', 'Enabled', 'Off-screen terrain pre-caching', W, 'Terrain', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'vram' });
g('OffscreenTerrainPreCaching', 'Quality', 'Pre-caching quality', W, 'Terrain', 'enum', { labels: Q, calib: 'confirmed', cost: 'vram' });
g('HeightFieldShadows', 'Enabled', 'Terrain shadows', W, 'Terrain', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('HeightFieldShadows', 'Size', 'Terrain shadow size', W, 'Terrain', 'num', { more: true, calib: 'inferred', cost: 'gpu' });
g('DisplacementMapping', 'Enabled', 'Displacement mapping', W, 'Terrain', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'gpu' });
g('ObjectsLoD', 'LoDFactor', 'Objects level of detail (OLOD)', W, 'Objects', 'lod', { calib: 'confirmed', cost: 'cpu', lod: true });
g('Buildings', 'Quality', 'Buildings', W, 'Objects', 'enum', { labels: Q, calib: 'inferred', cost: 'mixed' });
g('Procedural', 'TreesQuality', 'Trees', W, 'Vegetation', 'enum', { labels: Q, calib: 'inferred', cost: 'mixed' });
g('Procedural', 'PlantsQuality', 'Plants', W, 'Vegetation', 'enum', { labels: Q, calib: 'inferred', cost: 'mixed' });
g('Procedural', 'GrassQuality', 'Grass and bushes', W, 'Vegetation', 'enum', { labels: Q, calib: 'inferred', cost: 'mixed' });
g('Procedural', 'RocksQuality', 'Rocks', W, 'Vegetation', 'enum', { labels: Q, calib: 'confirmed', cost: 'mixed' });
g('Texture', 'Quality', 'Texture resolution', W, 'Textures', 'enum', { labels: TEXTURE, calib: 'confirmed', cost: 'vram' });
g('Texture', 'MaxAnisotropy', 'Anisotropic filtering', W, 'Textures', 'num', { more: true, calib: 'inferred', cost: 'gpu', suffix: '×' });
g('Water', 'FFTSize', 'Water waves', W, 'Water', 'enum', { labels: WATER, calib: 'confirmed', cost: 'gpu' });

// ── lighting, shadows, effects ───────────────────────────────────────────────────────────────
g('VolumetricClouds', 'Enabled', 'Volumetric clouds', L, 'Sky', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('VolumetricClouds', 'Quality', 'Volumetric clouds quality', L, 'Sky', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('VolumetricLights', 'Enabled', 'Light shafts', L, 'Sky', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('VolumetricLights', 'Quality', 'Light shafts quality', L, 'Sky', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('Shadows', 'Size', 'Shadow maps', L, 'Shadows', 'num', { more: true, calib: 'inferred', cost: 'gpu' });
g('ContactShadows', 'Enabled', 'Contact shadows', L, 'Shadows', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('ContactShadows', 'Quality', 'Contact shadows quality', L, 'Shadows', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('RaytracedShadows', 'Enabled', 'Raytraced shadows', L, 'Shadows', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'gpu' });
g('SSAO', 'Enabled', 'Ambient occlusion', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('SSAO', 'Quality', 'Ambient occlusion quality', L, 'Lighting', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('SSAO', 'FullRes', 'Ambient occlusion full resolution', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('SSR', 'Enabled', 'Raymarched reflections', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('SSR', 'Quality', 'Raymarched reflections quality', L, 'Lighting', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('SSR', 'HalfRes', 'Reflections half resolution', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('ReflectionProbe', 'Size', 'Reflection probes', L, 'Lighting', 'num', { more: true, calib: 'inferred', cost: 'gpu' });
g('WindShield', 'Quality', 'Windshield effects', L, 'Effects', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('Particles', 'Quality', 'Particles (visual effects)', L, 'Effects', 'enum', { labels: PARTICLES, calib: 'confirmed', cost: 'gpu' });
g('DOF', 'Enabled', 'Depth of field', L, 'Effects', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('DOF', 'Quality', 'Depth of field quality', L, 'Effects', 'enum', { labels: Q, calib: 'inferred', cost: 'gpu' });
g('MotionBlur', 'Enabled', 'Motion blur', L, 'Effects', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu' });
g('MotionBlur', 'Quality', 'Motion blur quality', L, 'Effects', 'enum', { labels: Q, calib: 'inferred', cost: 'gpu' });
g('GlassCockpitsRefreshRate', 'Quality', 'Glass cockpit refresh rate', L, 'Cockpit', 'enum', { labels: Q, calib: 'confirmed', cost: 'cpu' });
g('Seatbelts', 'Enabled', 'Seatbelts', L, 'Cockpit', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'none' });

// ── traffic & life (−1 = the sim's own default/"auto"; scale unverified until the screenshot pass) ──
g('Traffic', 'AircraftTrafficQuantity', 'Aircraft traffic', T, 'Air traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'AircraftTrafficVariety', 'Aircraft traffic variety', T, 'Air traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'ParkedAircraftQuantity', 'Parked aircraft', T, 'Air traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'ParkedAircraftVariety', 'Parked aircraft variety', T, 'Air traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'AirportsServicesQuantity', 'Airport services', T, 'Ground traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'AirportsServicesVariety', 'Airport services variety', T, 'Ground traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'RoadQuality', 'Road traffic', T, 'Ground traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Traffic', 'SeaQuality', 'Boat traffic', T, 'Ground traffic', 'num', { calib: 'unverified', cost: 'cpu' });
g('Characters', 'Quantity', 'People', T, 'Life', 'num', { calib: 'unverified', cost: 'cpu' });
g('Characters', 'Quality', 'People quality', T, 'Life', 'num', { calib: 'unverified', cost: 'cpu' });
g('Characters', 'Variety', 'People variety', T, 'Life', 'num', { calib: 'unverified', cost: 'cpu' });
g('Fauna', 'Quantity', 'Wildlife', T, 'Life', 'num', { calib: 'unverified', cost: 'cpu' });

// ── advanced: in the file, not on the in-sim menu ─────────────────────────────────────────────
g('Terrain', 'POMMaxDist', 'Parallax mapping distance', A, 'Advanced', 'num', { calib: 'inferred', cost: 'gpu', advanced: true });
g('Terrain', 'POMSubsplitsMaxDist', 'Parallax sub-split distance', A, 'Advanced', 'num', { calib: 'inferred', cost: 'gpu', advanced: true });
g('Shadows', 'MaxSliceCount', 'Shadow cascades', A, 'Advanced', 'num', { calib: 'inferred', cost: 'gpu', advanced: true });
for (const s of ['S0', 'S1', 'S2', 'S3']) g('Shadows', 'DLightContributionCullingThreshold' + s, 'Sun-shadow culling ' + s, A, 'Advanced', 'num', { calib: 'inferred', cost: 'gpu', advanced: true });
g('Shadows', 'OmniContributionCullingThreshold', 'Light-shadow culling', A, 'Advanced', 'num', { calib: 'inferred', cost: 'gpu', advanced: true });

const PAGES = ['Display & upscaling', W, L, T, A];
const BY_ID = Object.fromEntries(K.map(k => [k.id, k]));

// Display one value: word + raw number ("1 · High"), percent, TLOD-style, or the raw number with an
// "unverified" marker. Never a guessed word for an unverified enum.
function display(k, value) {
  if (value == null || value === '') return '—';
  if (!k) return String(value);
  switch (k.type) {
    case 'word': { const w = k.labels && k.labels[String(value).toUpperCase()]; return w || String(value); }
    case 'enum': {
      const w = k.labels && k.labels[value];
      if (!w || k.calib === 'unverified') return String(value) + (k.calib === 'unverified' ? ' · unverified' : '');
      return value + ' · ' + w;
    }
    case 'lod': return String(Math.round(Number(value) * 100));
    case 'pct': return Math.round(Number(value) * 100) + '%';
    case 'mult': return (Math.trunc(Number(value)) + 1) + '× frames';
    default: return String(value) + (k.suffix || '') + (k.calib === 'unverified' ? ' · unverified' : '');
  }
}

// Plain-English direction of a change, ONLY where the scale is known. 'up' = more quality/cost.
// Returns null when unknown (the UI then shows "changed", never a guess).
function direction(k, from, to) {
  if (!k || from == null || to == null || from === to) return null;
  if (k.calib === 'unverified') return null;
  if (k.type === 'enum' && k.labels) {
    if (k.labels === TEXTURE) return Number(to) < Number(from) ? 'up' : 'down';   // inverted
    if (k.labels === ONOFF) return Number(to) > Number(from) ? 'up' : 'down';
    return Number(to) > Number(from) ? 'up' : 'down';
  }
  if (k.type === 'lod' || k.type === 'pct' || k.type === 'mult' || k.more) return Number(to) > Number(from) ? 'up' : 'down';
  return null;
}

function schemaMeta() {
  return { pages: PAGES, keys: K.map(k => ({ id: k.id, label: k.label, page: k.page, group: k.group, type: k.type,
    labels: k.labels || null, calib: k.calib, cost: k.cost, lod: !!k.lod, advanced: !!k.advanced, suffix: k.suffix || '', more: !!k.more,
    inverted: k.labels === TEXTURE })) };
}

module.exports = { KEYS: K, BY_ID, PAGES, display, direction, schemaMeta,
  LABELS: { Q, TEXTURE, PARTICLES, WATER, ONOFF, AA, DLSS_MODE, FSR_MODE, FG, REFLEX } };
