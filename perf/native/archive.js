'use strict';
// perf/native/archive.js — raw-capture archiver. gzips old frametimes.csv IN PLACE (reversible,
// never deletes data), keeping the newest `keepRaw` uncompressed. Every archive is verified by a
// full decompress-and-byte-compare BEFORE the original is replaced — flight data is irreplaceable.
// Runs in a CHILD process (spawned by main.js perf-archive-raw): gzip/gunzip of 100MB+ files is
// synchronous CPU work that must never block the Electron main thread.
const fs = require('fs'), path = require('path'), zlib = require('zlib');

function listRawCaptures(sessionsDir) {
  const out = [];
  (function walk(d) {
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name.toLowerCase() !== 'capframex') walk(p); }
      else if (/^frametimes\.csv(\.gz)?$/i.test(e.name)) {
        let size = 0, mtime = 0;
        try { const st = fs.statSync(p); size = st.size; mtime = st.mtimeMs; } catch (_) {}
        out.push({ p, gz: e.name.toLowerCase().endsWith('.gz'), size, mtime });
      }
    }
  })(sessionsDir);
  return out;
}

function archiveRaw(sessionsDir, keepRaw) {
  const results = { archived: 0, savedBytes: 0, kept: 0, errors: [] };
  const raws = listRawCaptures(sessionsDir).filter(r => !r.gz).sort((a, b) => b.mtime - a.mtime);
  const targets = raws.slice(keepRaw);
  results.kept = Math.min(raws.length, keepRaw);
  for (const t of targets) {
    try {
      const orig = fs.readFileSync(t.p);
      const gz = zlib.gzipSync(orig, { level: 6 });
      const gzPath = t.p + '.gz';
      fs.writeFileSync(gzPath + '.tmp', gz);
      // integrity gate: decompress what was WRITTEN and byte-compare before touching the original
      const back = zlib.gunzipSync(fs.readFileSync(gzPath + '.tmp'));
      if (back.length !== orig.length || !back.equals(orig)) {
        try { fs.unlinkSync(gzPath + '.tmp'); } catch (_) {}
        results.errors.push(path.basename(path.dirname(t.p)) + ': verify failed — kept raw');
        continue;
      }
      fs.renameSync(gzPath + '.tmp', gzPath);
      fs.unlinkSync(t.p);
      results.archived++; results.savedBytes += (orig.length - gz.length);
    } catch (e) { results.errors.push(path.basename(path.dirname(t.p)) + ': ' + e.message); }
  }
  return results;
}

module.exports = { archiveRaw, listRawCaptures };
