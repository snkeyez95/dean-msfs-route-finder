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
//   2026-11-10  FULL PASS — Dean applied ABRP Suggested, opened the sim, screenshotted every page;
//               every value matched the file. Confirmed: Buildings/Trees/Plants/Grass 1 = Medium;
//               Terrain shadows = HeightFieldShadows Size (256); Cubemap Reflections = ReflectionProbe
//               Size (192); Anisotropic 16 = "16X"; DOF/Motion blur Enabled 0 = Off; Seatbelt 0 = off;
//               Glass cockpit 2 = High; Reflex BOOST = "On+Boost"; Sharpening stored 0.3, shown "30";
//               Exposure -0.6 = "Exposure Compensation EV"; FrameGeneration FSRFG shows "AMD FSR 1.1";
//               NBFramesToGenerate 1 = "2X"; FrameLimiter 30 = "Max Frame Rate" 30.
//               Traffic & life: quantity -1 = "Off", variety/quality 0 = "Low", Road 0 = "Low"
//               (higher steps follow the shared Low/Medium/High scale — inferred, not yet seen).
//   2026-11-10  SECOND PASS (Dean changed rows in-sim, exited, ABRP diffed the file):
//               AntiAliasing DLSS = "NVIDIA DLSS Super Resolution"; DLSSMode QUALITY = "Quality";
//               DOF Medium → Enabled 1 + Quality 1 (Off = Enabled 0, shared scale); Road traffic High = 2;
//               Characters quality Medium = 1; Terrain shadows 128. Light shafts / contact shadows /
//               AO / reflections / clouds / terrain shadows have NO "Off" in the menu — their Enabled
//               flags are file-only (moved to Advanced).
//   2026-11-10  THIRD PASS (Dean picked the in-sim Ultra preset + DLSS Performance, sharpening 50,
//               exposure -0.45, Reflex On): Texture 0 = Ultra; every traffic/people/fauna row 3 = Ultra
//               (so the LIFE scale -1 Off / 0 Low / 1 Medium / 2 High / 3 Ultra is now fully seen);
//               Motion blur 3 = Ultra; DLSS PERFORMANCE = "Performance"; Reflex ON = "On"; Sharpening
//               0.5 = "50"; precache 2 = High; Shadow maps 2048, Terrain shadows 1024, Cubemap 384.
//               The preset also rewrote two file-only keys (POMSubsplitsMaxDist 7.5→10, Omni culling
//               0.02→0) and set "Preset Ultra" — profiles now force "Preset Custom" on apply.
//   2026-11-10  FOURTH PASS: Anti-aliasing "AMD FSR 3.1" is stored as the word FSR; FSRMode BALANCED =
//               "Balanced". Every row on the in-sim graphics pages is now confirmed.
//               Still inferred (not on screen while inactive): DLSS/FSR mode, secondary scaling,
//               DOF/motion-blur quality, the Enabled flags of quality rows, the file-only Advanced keys.
//
// SCOPE: the desktop {Graphics} block + the rendering part of {Video}. NEVER in a profile: display /
// window keys (Adapter, Monitor, Windowed, Resolution, PosX/Y, VSync, HDR10…), every *VR key, the
// {GraphicsVR} block, InstalledPackagesPath. Those are machine/monitor facts, not a "look".

const Q = { 0: 'Low', 1: 'Medium', 2: 'High', 3: 'Ultra' };               // the shared quality scale
const TEXTURE = { 0: 'Ultra', 1: 'High', 2: 'Medium', 3: 'Low' };         // INVERTED (0/1/2 confirmed; 3 inferred)
const PARTICLES = { 0: 'Low', 1: 'High' };                               // own short scale (1 = High confirmed)
const WATER = { 128: 'Low', 256: 'Medium', 512: 'High', 1024: 'Ultra' };  // 512 = High confirmed
const ONOFF = { 0: 'Off', 1: 'On' };
const AA = { TAA: 'TAA', DLSS: 'DLSS',    // in-sim: 'NVIDIA DLSS Super Resolution'
  DLAA: 'DLAA', FSR3: 'AMD FSR', FSR: 'AMD FSR', NONE: 'Off' };   // in-sim: 'AMD FSR 3.1' (file word FSR)
const DLSS_MODE = { AUTO: 'Auto', DLAA: 'DLAA', QUALITY: 'Quality', BALANCED: 'Balanced', PERFORMANCE: 'Performance', ULTRAPERFORMANCE: 'Ultra performance' };
const FSR_MODE = { NATIVEAA: 'Native AA', QUALITY: 'Quality', BALANCED: 'Balanced', PERFORMANCE: 'Performance', ULTRAPERFORMANCE: 'Ultra performance' };
const FG = { NONE: 'Off', FSRFG: 'AMD FSR', DLSSFG: 'NVIDIA DLSS' };      // in-sim reads 'AMD FSR 1.1' for FSRFG
const REFLEX = { OFF: 'Off', ON: 'On', BOOST: 'On+Boost' };
const LIFE = { '-1': 'Off', 0: 'Low', 1: 'Medium', 2: 'High', 3: 'Ultra' };   // traffic/people/fauna (all steps confirmed)

// type:  'enum' (numeric with labels) · 'word' (text value, labels map) · 'lod' (float ×100, "125") ·
//        'pct' (float ×100 %) · 'x100' (float ×100, no %) · 'num' (plain number) · 'mult' (NBFramesToGenerate → "2×")
// cost:  what the setting mainly spends — 'gpu' | 'vram' | 'cpu' | 'mixed' | 'none'
// lod:   AutoFPS drives it in flight → excluded from "matches current" and only applied on request
const K = [];
function v(key, label, group, type, extra) { K.push(Object.assign({ id: 'Video/' + key, block: 'Video', key, label, page: 'Display & upscaling', group, type }, extra)); }
function g(section, key, label, page, group, type, extra) {
  K.push(Object.assign({ id: 'Graphics/' + section + '/' + key, block: 'Graphics', section, key, label, page, group, type }, extra));
}

// ── {Video}: upscaling / frame generation / image ────────────────────────────────────────────
v('AntiAliasing', 'Anti-aliasing / upscaler', 'Upscaling', 'word', { labels: AA, calib: 'confirmed', cost: 'gpu' });
v('DLSSMode', 'DLSS mode', 'Upscaling', 'word', { labels: DLSS_MODE, calib: 'confirmed', cost: 'gpu' });
v('FSRMode', 'AMD FSR mode', 'Upscaling', 'word', { labels: FSR_MODE, calib: 'confirmed', cost: 'gpu' });
v('PrimaryScaling', 'Render scaling', 'Upscaling', 'pct', { calib: 'confirmed', cost: 'gpu' });
v('SecondaryScaling', 'Secondary render scaling', 'Upscaling', 'pct', { calib: 'inferred', cost: 'gpu', advanced: true });
v('SharpenAmount', 'AMD FidelityFX sharpening', 'Image', 'x100', { calib: 'confirmed', cost: 'none' });
v('ExposureBias', 'Exposure compensation (EV)', 'Image', 'num', { calib: 'confirmed', cost: 'none' });
v('FrameGeneration', 'Frame generation', 'Frame rate', 'word', { labels: FG, calib: 'confirmed', cost: 'gpu' });
v('NBFramesToGenerate', 'Frame rate multiplier', 'Frame rate', 'mult', { calib: 'confirmed', cost: 'gpu' });
v('Reflex', 'NVIDIA Reflex low latency', 'Frame rate', 'word', { labels: REFLEX, calib: 'confirmed', cost: 'none' });
v('TargetFrameRate', 'Target frame rate', 'Frame rate', 'num', { calib: 'confirmed', cost: 'none' });
v('FrameLimiter', 'Max frame rate', 'Frame rate', 'num', { calib: 'confirmed', cost: 'none' });
v('DynamicSettings', 'Dynamic settings', 'Frame rate', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'none' });

// ── {Graphics}: terrain & objects ────────────────────────────────────────────────────────────
const W = 'World', L = 'Lighting & effects', T = 'Traffic & life', A = 'Advanced (file only)';
g('Terrain', 'LoDFactor', 'Terrain level of detail (TLOD)', W, 'Terrain', 'lod', { calib: 'confirmed', cost: 'cpu', lod: true });
g('OffscreenTerrainPreCaching', 'Enabled', 'Off-screen terrain pre-caching', W, 'Terrain', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'vram' });
g('OffscreenTerrainPreCaching', 'Quality', 'Pre-caching quality', W, 'Terrain', 'enum', { labels: Q, calib: 'confirmed', cost: 'vram' });
g('HeightFieldShadows', 'Enabled', 'Terrain shadows on (file only)', W, 'Terrain', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('HeightFieldShadows', 'Size', 'Terrain shadows', W, 'Terrain', 'num', { more: true, calib: 'confirmed', cost: 'gpu' });
g('DisplacementMapping', 'Enabled', 'Displacement mapping', W, 'Terrain', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'gpu' });
g('ObjectsLoD', 'LoDFactor', 'Objects level of detail (OLOD)', W, 'Objects', 'lod', { calib: 'confirmed', cost: 'cpu', lod: true });
g('Buildings', 'Quality', 'Buildings', W, 'Objects', 'enum', { labels: Q, calib: 'confirmed', cost: 'mixed' });
g('Procedural', 'TreesQuality', 'Trees', W, 'Vegetation', 'enum', { labels: Q, calib: 'confirmed', cost: 'mixed' });
g('Procedural', 'PlantsQuality', 'Plants', W, 'Vegetation', 'enum', { labels: Q, calib: 'confirmed', cost: 'mixed' });
g('Procedural', 'GrassQuality', 'Grass', W, 'Vegetation', 'enum', { labels: Q, calib: 'confirmed', cost: 'mixed' });
g('Procedural', 'RocksQuality', 'Rocks', W, 'Vegetation', 'enum', { labels: Q, calib: 'confirmed', cost: 'mixed' });
g('Texture', 'Quality', 'Texture resolution', W, 'Textures', 'enum', { labels: TEXTURE, calib: 'confirmed', cost: 'vram' });
g('Texture', 'MaxAnisotropy', 'Anisotropic filtering', W, 'Textures', 'num', { more: true, calib: 'confirmed', cost: 'gpu', suffix: 'X' });
g('Water', 'FFTSize', 'Water waves', W, 'Water', 'enum', { labels: WATER, calib: 'confirmed', cost: 'gpu' });

// ── lighting, shadows, effects ───────────────────────────────────────────────────────────────
g('VolumetricClouds', 'Enabled', 'Volumetric clouds on (file only)', L, 'Sky', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('VolumetricClouds', 'Quality', 'Volumetric clouds quality', L, 'Sky', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('VolumetricLights', 'Enabled', 'Light shafts on (file only)', L, 'Sky', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('VolumetricLights', 'Quality', 'Light shafts quality', L, 'Sky', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('Shadows', 'Size', 'Shadow maps', L, 'Shadows', 'num', { more: true, calib: 'confirmed', cost: 'gpu' });
g('ContactShadows', 'Enabled', 'Contact shadows on (file only)', L, 'Shadows', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('ContactShadows', 'Quality', 'Contact shadows quality', L, 'Shadows', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('RaytracedShadows', 'Enabled', 'Raytraced shadows', L, 'Shadows', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'gpu' });
g('SSAO', 'Enabled', 'Ambient occlusion on (file only)', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('SSAO', 'Quality', 'Ambient occlusion quality', L, 'Lighting', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('SSAO', 'FullRes', 'Ambient occlusion full resolution', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('SSR', 'Enabled', 'Raymarched reflections on (file only)', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('SSR', 'Quality', 'Raymarched reflections quality', L, 'Lighting', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('SSR', 'HalfRes', 'Reflections half resolution', L, 'Lighting', 'enum', { labels: ONOFF, calib: 'inferred', cost: 'gpu', advanced: true });
g('ReflectionProbe', 'Size', 'Cubemap reflections', L, 'Lighting', 'num', { more: true, calib: 'confirmed', cost: 'gpu' });
g('WindShield', 'Quality', 'Windshield effects', L, 'Effects', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('Particles', 'Quality', 'Visual effects particles quality', L, 'Effects', 'enum', { labels: PARTICLES, calib: 'confirmed', cost: 'gpu' });
g('DOF', 'Enabled', 'Depth of field', L, 'Effects', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'gpu' });
g('DOF', 'Quality', 'Depth of field quality', L, 'Effects', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('MotionBlur', 'Enabled', 'Motion blur', L, 'Effects', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'gpu' });
g('MotionBlur', 'Quality', 'Motion blur quality', L, 'Effects', 'enum', { labels: Q, calib: 'confirmed', cost: 'gpu' });
g('GlassCockpitsRefreshRate', 'Quality', 'Glass cockpit refresh rate', L, 'Cockpit', 'enum', { labels: Q, calib: 'confirmed', cost: 'cpu' });
g('Seatbelts', 'Enabled', 'Seatbelt visibility', L, 'Cockpit', 'enum', { labels: ONOFF, calib: 'confirmed', cost: 'none' });

// ── traffic & life (-1 Off / 0 Low / 1 Medium / 2 High / 3 Ultra — all CONFIRMED 2026-11-10) ──
g('Traffic', 'AircraftTrafficQuantity', 'Aircraft traffic quantity', T, 'Air traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'AircraftTrafficVariety', 'Aircraft traffic variety', T, 'Air traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'ParkedAircraftQuantity', 'Parked aircraft quantity', T, 'Air traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'ParkedAircraftVariety', 'Parked aircraft variety', T, 'Air traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'AirportsServicesQuantity', 'Airport services quantity', T, 'Ground traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'AirportsServicesVariety', 'Airport services variety', T, 'Ground traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'RoadQuality', 'Road traffic', T, 'Ground traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Traffic', 'SeaQuality', 'Sea traffic', T, 'Ground traffic', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Characters', 'Quantity', 'Characters quantity', T, 'Life', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Characters', 'Quality', 'Characters quality', T, 'Life', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Characters', 'Variety', 'Characters variety', T, 'Life', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });
g('Fauna', 'Quantity', 'Fauna density', T, 'Life', 'enum', { labels: LIFE, calib: 'confirmed', cost: 'cpu' });

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
    case 'x100': return String(Math.round(Number(value) * 100));
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
  if (k.type === 'lod' || k.type === 'pct' || k.type === 'x100' || k.type === 'mult' || k.more) return Number(to) > Number(from) ? 'up' : 'down';
  return null;
}

function schemaMeta() {
  return { pages: PAGES, keys: K.map(k => ({ id: k.id, label: k.label, page: k.page, group: k.group, type: k.type,
    labels: k.labels || null, calib: k.calib, cost: k.cost, lod: !!k.lod, advanced: !!k.advanced, suffix: k.suffix || '', more: !!k.more,
    inverted: k.labels === TEXTURE })) };
}

module.exports = { KEYS: K, BY_ID, PAGES, display, direction, schemaMeta,
  LABELS: { Q, TEXTURE, PARTICLES, WATER, ONOFF, AA, DLSS_MODE, FSR_MODE, FG, REFLEX } };
