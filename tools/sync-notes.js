'use strict';
// Copy Claude's working notes (roadmap + memory) INTO the project so they're backed up to GitHub.
//
// Why: those files live in C:\Users\<you>\.claude\ — the tool's own folder, which git never sees.
// The roadmap alone is ~350 KB of accumulated decisions and history; a drive failure would take it
// and there'd be no way back. This mirrors them into docs/notes/ so they ride along with every
// commit. The .claude copies stay the live ones (the tool reads them from there) — these are
// backups, refreshed by running this script.
//
//   node tools\sync-notes.js
const fs = require('fs'), path = require('path');

const ROOT = path.resolve(__dirname, '..');
const HOME = process.env.USERPROFILE || process.env.HOME || '';
const CLAUDE = path.join(HOME, '.claude');
// The per-project folder name is the project path with separators replaced by dashes.
const PROJ_KEY = 'C--Users-MultiBotPC-Desktop-DeanMSFS-v2';
const OUT = path.join(ROOT, 'docs', 'notes');

const SOURCES = [
  { from: path.join(CLAUDE, 'plans', 'imperative-drifting-rain.md'), to: 'roadmap.md',
    note: 'the master roadmap — every plan, decision, and lesson' },
  { from: path.join(CLAUDE, 'projects', PROJ_KEY, 'memory'), to: 'memory', dir: true,
    note: "Claude's persistent memory about this project" },
];

fs.mkdirSync(OUT, { recursive: true });
let copied = 0, missing = [];

function copyFile(src, dest){
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
  copied++;
}
for(const s of SOURCES){
  if(!fs.existsSync(s.from)){ missing.push(s.from); continue; }
  if(s.dir){
    const destDir = path.join(OUT, s.to);
    fs.mkdirSync(destDir, { recursive: true });
    for(const f of fs.readdirSync(s.from)){
      const p = path.join(s.from, f);
      if(fs.statSync(p).isFile() && f.endsWith('.md')) copyFile(p, path.join(destDir, f));
    }
  } else {
    copyFile(s.from, path.join(OUT, s.to));
  }
}

const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
fs.writeFileSync(path.join(OUT, 'README.md'),
  '# Claude\'s working notes — backup copies\n\n' +
  'These are **mirrors**, not the live files. The live ones live in `' + path.join('%USERPROFILE%', '.claude') + '`,\n' +
  'which git never sees — so a drive failure would take them with it. This folder is the backup.\n\n' +
  'Refresh with `node tools\\sync-notes.js` (run before committing if the notes changed).\n\n' +
  '| File | What it is |\n|---|---|\n' +
  SOURCES.map(s => '| `' + s.to + '` | ' + s.note + ' |').join('\n') + '\n\n' +
  'Last synced: ' + stamp + '\n');

console.log('synced ' + copied + ' file(s) -> ' + path.relative(ROOT, OUT));
for(const m of missing) console.log('  (not found, skipped: ' + m + ')');
