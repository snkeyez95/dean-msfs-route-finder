'use strict';
// GSX Pro profile housekeeping (v6.29.0, Dean 2026-11-14). Pure logic + small fs helpers, required by
// main.js and by tests/test_gsx_profiles.js. Born from a manual clean-up of the GSX folder that found
// old versions sitting beside new ones, two editions of one profile installed at once, orphan scripts,
// and no way to tell which tool had put a file there.
//
//  1. Version-aware placement: a scenery's bundled profile vs the installed one is decided by the
//     version written inside the .ini ("notes = v1.3"); file date only breaks ties / unknowns.
//  2. Install record (gsx_ledger.json): every file ABRP installs or updates, with where it came from.
//  3. Health check: duplicates per airport, older versions, orphan scripts, flown airports with no
//     profile — plus a "removed" list so a file Dean moves to backup is never reinstalled by Scan Now.
//  4/5. Profile-only folders (no MSFS package inside) are recognised so they don't become fake
//     airports in My Airports, and a GSX download dropped on the scenery box goes to GSX instead.
const fs = require('fs');
const path = require('path');

const isProfileFile = b => /\.(ini|py)$/i.test(b || '');
const isIni = b => /\.ini$/i.test(b || '');
// Profile "stem": the shared base name of an .ini and its scripts (x.ini / x.py / x_handler.py).
const stemOf = b => String(b || '').toLowerCase().replace(/\.(ini|py)$/i, '').replace(/_handler$/i, '');
// GSX names profiles by ICAO first (kjfk-…, EGCC_…, LIMC-…). Four letters, then a separator or end.
function icaoOf(b){ const m = String(b || '').match(/^([a-z]{4})(?=[^a-z]|$)/i); return m ? m[1].toUpperCase() : null; }

// Version from the [general] notes line: "notes = v1.7", "notes = 1.5", "notes = Version 2.0.1".
// Anything else (blank, prose) → null, which means "unknown — fall back to file date".
function iniVersion(text){
  // The whole notes value must be the version: "v1.7" / "Version 2" (a v or "version" prefix), or a
  // dotted number "1.5". A bare "2024" or "2024 update" is a year/prose, not a version.
  // A v-prefixed version may be followed by " - comment" ("v1.3 - Designed with scenery v2.1.0") and
  // written "V. 1.1"; anything else after it → unknown.
  const m = String(text || '').match(/^[ \t]*notes[ \t]*=[ \t]*(?:(?:version|v)\.?[ \t]*(\d+(?:\.\d+){0,3})(?=[ \t.]*$|[ \t]+[-–(:])|(\d+\.\d+(?:\.\d+){0,2})[ \t.]*$)/im);
  return m ? (m[1] || m[2]).split('.').map(Number) : null;
}
function cmpVer(a, b){
  for (let i = 0; i < Math.max(a.length, b.length); i++){ const d = (a[i] || 0) - (b[i] || 0); if (d) return d; }
  return 0;
}
const fmtVer = v => v ? v.join('.') : null;
function iniMeta(abs){
  let text = '';
  try { text = fs.readFileSync(abs, 'utf8'); } catch (e) {}
  const get = k => { const m = text.match(new RegExp('^[ \\t]*' + k + '[ \\t]*=[ \\t]*(.*)$', 'im')); return m ? m[1].trim() : ''; };
  return { version: iniVersion(text), creator: get('creator'), scenario: get('scenario'), notes: get('notes') };
}

// ── JSON stores (ledger + removed list) ───────────────────────────────────────────────────────────
function readJson(p, dflt){ try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { return dflt; } }
function writeJson(p, obj){ const tmp = p + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(obj, null, 1)); fs.renameSync(tmp, p); }
const LEDGER_MAX = 2000;
function ledgerAdd(ledgerPath, entries){
  if (!ledgerPath || !entries.length) return;
  const led = readJson(ledgerPath, []);
  const list = Array.isArray(led) ? led : [];
  list.push(...entries);
  writeJson(ledgerPath, list.slice(-LEDGER_MAX));
}
// Newest record per file (lowercase base) — "where did this file come from?"
function ledgerIndex(ledgerPath){
  const out = {};
  const led = readJson(ledgerPath, []);
  for (const e of (Array.isArray(led) ? led : [])) if (e && e.file) out[e.file.toLowerCase()] = e;
  return out;
}
function removedSet(removedPath){
  const r = readJson(removedPath, {});
  return new Set(Object.keys((r && r.files) || {}).map(s => s.toLowerCase()));
}
function removedAdd(removedPath, bases, why){
  const r = readJson(removedPath, {}); r.files = r.files || {};
  const ts = new Date().toISOString();
  for (const b of bases) r.files[b.toLowerCase()] = { ts, why: why || 'moved to backup' };
  writeJson(removedPath, r);
}
function removedDel(removedPath, bases){
  const r = readJson(removedPath, {}); if (!r.files) return;
  let changed = false;
  for (const b of bases){ if (r.files[b.toLowerCase()]){ delete r.files[b.toLowerCase()]; changed = true; } }
  if (changed) writeJson(removedPath, r);
}

// ── Walk the GSX folder (profiles may sit in subfolders) ──────────────────────────────────────────
function walk(dir, maxDepth){
  const out = [];
  (function rec(d, depth){
    if (depth > maxDepth) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (e) { return; }
    for (const e of ents){
      const full = path.join(d, e.name);
      if (e.isDirectory()) rec(full, depth + 1); else out.push({ abs: full, base: e.name });
    }
  })(dir, 0);
  return out;
}

// ── 1. Version-aware placement of a set of bundled files ──────────────────────────────────────────
// Decision per .ini (bundled = src, installed = dest, both same file name):
//   identical content                          → current
//   both versions known and different          → higher version wins (updated / kept-local)
//   otherwise                                  → newer file date wins (the old rule)
// Scripts (.py / _handler.py) follow the decision of the .ini with the same stem when there is one,
// so a v1.2 profile never ends up running next to a v1.3 script; lone scripts use the date rule.
function decideIni(src, dest, sameContent){
  if (sameContent) return { action: 'current' };
  const vs = iniMeta(src).version, vd = iniMeta(dest).version;
  if (vs && vd && cmpVer(vs, vd) !== 0){
    return cmpVer(vs, vd) > 0 ? { action: 'updated', why: 'v' + fmtVer(vs) + ' replaces v' + fmtVer(vd) }
                              : { action: 'kept-local', why: 'yours is v' + fmtVer(vd) + ', scenery has v' + fmtVer(vs) };
  }
  const newer = fs.statSync(src).mtimeMs > fs.statSync(dest).mtimeMs;
  return newer ? { action: 'updated', why: 'newer file date' } : { action: 'kept-local', why: 'yours is the same or newer by date' };
}
// files: absolute source paths. opts: {sha, ledgerPath, removedPath, via}
function placeSet(files, dir, opts){
  opts = opts || {};
  const sha = opts.sha || (p => require('crypto').createHash('sha256').update(fs.readFileSync(p)).digest('hex'));
  const removed = removedSet(opts.removedPath);
  const installed = walk(dir, 4);
  const findDest = base => installed.find(f => f.base.toLowerCase() === base.toLowerCase());
  const ordered = files.slice().sort((a, b) => (isIni(path.basename(a)) ? 0 : 1) - (isIni(path.basename(b)) ? 0 : 1));
  const stemDecision = {};
  const results = [], ledger = [];
  for (const src of ordered){
    const base = path.basename(src);
    if (removed.has(base.toLowerCase())){ results.push({ base, action: 'skipped-removed' }); continue; }
    const existing = findDest(base);
    if (!existing){
      fs.copyFileSync(src, path.join(dir, base));
      if (isIni(base)) stemDecision[stemOf(base)] = 'updated';
      results.push({ base, action: 'installed' });
      ledger.push({ ts: new Date().toISOString(), file: base, action: 'installed', from: src, via: opts.via || 'scenery' });
      continue;
    }
    const same = sha(src) === sha(existing.abs);
    let d;
    if (isIni(base)) { d = decideIni(src, existing.abs, same); stemDecision[stemOf(base)] = d.action === 'current' ? 'current' : d.action; }
    else if (same) d = { action: 'current' };
    else if (stemDecision[stemOf(base)]) {
      const s = stemDecision[stemOf(base)];
      d = s === 'updated' ? { action: 'updated', why: 'follows its profile' } : { action: 'kept-local', why: 'follows its profile' };
    } else {
      d = fs.statSync(src).mtimeMs > fs.statSync(existing.abs).mtimeMs ? { action: 'updated', why: 'newer file date' } : { action: 'kept-local', why: 'yours is the same or newer by date' };
    }
    if (d.action === 'updated'){
      fs.copyFileSync(src, existing.abs);
      ledger.push({ ts: new Date().toISOString(), file: base, action: 'updated', from: src, via: opts.via || 'scenery', why: d.why });
    }
    results.push(Object.assign({ base }, d));
  }
  ledgerAdd(opts.ledgerPath, ledger);
  return results;
}

// ── 3. Health check ────────────────────────────────────────────────────────────────────────────────
// opts: {ledgerPath, removedPath, owned: [ICAO of airports with 3rd-party scenery], flown: {ICAO: n}}
function healthCheck(dir, opts){
  opts = opts || {};
  const led = ledgerIndex(opts.ledgerPath);
  const files = walk(dir, 4).filter(f => isProfileFile(f.base));
  const origin = base => {
    const e = led[base.toLowerCase()];
    return e ? (e.via === 'drop' ? 'added by you (GSX drop zone)' : 'installed by ABRP from ' + path.basename(path.dirname(e.from))) + ' · ' + String(e.ts).slice(0, 10)
             : 'not installed by ABRP (or before ABRP kept a record)';
  };
  const byIcao = {};
  for (const f of files){ const ic = icaoOf(f.base); if (ic) (byIcao[ic] = byIcao[ic] || []).push(f); }
  const duplicates = [], orphans = [];
  for (const [icao, list] of Object.entries(byIcao)){
    const inis = list.filter(f => isIni(f.base));
    if (inis.length > 1){
      const items = inis.map(f => {
        const m = iniMeta(f.abs);
        let mtime = 0; try { mtime = fs.statSync(f.abs).mtimeMs; } catch (e) {}
        const scripts = list.filter(s => !isIni(s.base) && stemOf(s.base) === stemOf(f.base)).map(s => s.base);
        return { file: f.base, version: fmtVer(m.version), creator: m.creator, scenario: m.scenario, date: new Date(mtime).toISOString().slice(0, 10), scripts, origin: origin(f.base), _v: m.version, _t: mtime };
      });
      // Suggest which to keep only when the answer is clear: same author+scenario and versions differ
      // (an old copy beside a new one). Different editions/authors are Dean's call — no suggestion.
      const sameProfile = items.every(x => x.scenario && x.scenario === items[0].scenario && x.creator === items[0].creator);
      const allVer = items.every(x => x._v);
      let keep = null, kind = 'choice';
      if (sameProfile && allVer){
        const best = items.slice().sort((a, b) => cmpVer(b._v, a._v))[0];
        if (items.filter(x => cmpVer(x._v, best._v) === 0).length === 1){ keep = best.file; kind = 'older-version'; }
      }
      // Inside a mixed group, still mark any file that is a lower version of the SAME profile (same
      // author + scenario) — e.g. EGKK's RW Profiles v1.2 beside v1.4, next to unrelated editions.
      for (const it of items){
        if (!it._v || !it.scenario) continue;
        const newer = items.filter(o => o !== it && o._v && o.scenario === it.scenario && o.creator === it.creator && cmpVer(o._v, it._v) > 0)
                           .sort((a, b) => cmpVer(b._v, a._v))[0];
        if (newer) it.olderThan = newer.file + ' (v' + newer.version + ')';
      }
      duplicates.push({ icao, kind, keep, items: items.map(({ _v, _t, ...rest }) => rest) });
    }
    if (!inis.length) for (const s of list) orphans.push({ icao, file: s.base, origin: origin(s.base) });
  }
  const haveIni = new Set(Object.entries(byIcao).filter(([, l]) => l.some(f => isIni(f.base))).map(([ic]) => ic));
  const missing = (opts.owned || []).map(s => String(s).toUpperCase())
    .filter((ic, i, a) => a.indexOf(ic) === i && !haveIni.has(ic))
    .map(ic => ({ icao: ic, flights: (opts.flown || {})[ic] || 0 }))
    .filter(x => x.flights > 0)
    .sort((a, b) => b.flights - a.flights || a.icao.localeCompare(b.icao));
  duplicates.sort((a, b) => (a.kind === 'older-version' ? 0 : 1) - (b.kind === 'older-version' ? 0 : 1) || a.icao.localeCompare(b.icao));
  orphans.sort((a, b) => a.icao.localeCompare(b.icao));
  return { dir, fileCount: files.length, duplicates, orphans, missing, removedCount: removedSet(opts.removedPath).size };
}

// Move a profile (and its same-stem scripts) to a backup folder OUTSIDE the GSX tree (GSX reads its
// subfolders, so a backup inside it would still load). Records them as removed so Scan Now never
// reinstalls them from a scenery folder.
function backupDirFor(dir){ return path.join(path.dirname(dir), path.basename(dir) + '_backup'); }
function moveToBackup(dir, base, opts){
  opts = opts || {};
  const all = walk(dir, 4);
  const target = all.find(f => f.base.toLowerCase() === String(base).toLowerCase());
  if (!target) return { ok: false, error: 'not found: ' + base };
  const rel = path.relative(dir, target.abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return { ok: false, error: 'outside the GSX folder' };
  // Scripts that belong only to this profile (same stem, and no OTHER .ini shares that stem).
  const st = stemOf(target.base);
  const group = [target];
  if (isIni(target.base)){
    const otherIni = all.some(f => f !== target && isIni(f.base) && stemOf(f.base) === st);
    if (!otherIni) for (const f of all) if (f !== target && !isIni(f.base) && stemOf(f.base) === st) group.push(f);
  }
  const bk = opts.backupDir || backupDirFor(dir);
  fs.mkdirSync(bk, { recursive: true });
  const moved = [];
  for (const f of group){
    let dest = path.join(bk, f.base);
    if (fs.existsSync(dest)) dest = path.join(bk, f.base.replace(/(\.\w+)$/, '.' + Date.now() + '$1'));
    fs.renameSync(f.abs, dest);
    moved.push(f.base);
  }
  removedAdd(opts.removedPath, moved, 'moved to backup');
  return { ok: true, moved, backupDir: bk };
}

// ── 4/5. Folders that hold GSX profiles but no MSFS package ────────────────────────────────────────
// A scenery package has a manifest.json at its top (or one level down, for a wrapper like
// "KLAS FlyTampa"). A folder with neither is not scenery — My Airports must not list it.
function hasPackage(dir){
  try {
    if (fs.existsSync(path.join(dir, 'manifest.json'))) return true;
    return fs.readdirSync(dir, { withFileTypes: true }).some(e => e.isDirectory() && fs.existsSync(path.join(dir, e.name, 'manifest.json')));
  } catch (e) { return false; }
}
// Profile-only download: no manifest anywhere in the first few levels, at least one .ini/.py.
function isProfileOnly(dir){
  const files = walk(dir, 4);
  if (files.some(f => f.base.toLowerCase() === 'manifest.json')) return false;
  return files.some(f => isProfileFile(f.base));
}

// Two .ini files for the same airport in one drop = two editions of a profile (e.g. LEIB GSXVDGS +
// NOOLVDGS). Returns {ICAO: [ini base names]} for those airports.
function editionsIn(fileList){
  const by = {};
  for (const f of fileList){ const b = path.basename(f); if (!isIni(b)) continue; const ic = icaoOf(b); if (ic) (by[ic] = by[ic] || []).push(b); }
  for (const k of Object.keys(by)){ by[k] = [...new Set(by[k])]; if (by[k].length < 2) delete by[k]; }
  return by;
}

module.exports = { iniVersion, cmpVer, icaoOf, stemOf, iniMeta, placeSet, healthCheck, moveToBackup, backupDirFor,
  hasPackage, isProfileOnly, editionsIn, ledgerAdd, ledgerIndex, removedSet, removedAdd, removedDel, walk };
