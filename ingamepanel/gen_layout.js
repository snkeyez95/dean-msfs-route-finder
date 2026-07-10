'use strict';
// Regenerates layout.json for the ABRP in-game panel package. MSFS validates the size of every file
// listed here, so run this after ANY change to the package contents:
//   node ingamepanel/gen_layout.js
// "date" is a Windows FILETIME (100-nanosecond ticks since 1601-01-01), like fspackagetool writes.
const fs = require('fs');
const path = require('path');
const PKG = path.join(__dirname, 'abrp-ingamepanels-liveatc');

function walk(dir, base) {
  let out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, e.name);
    const rel = (base ? base + '/' : '') + e.name;
    if (e.isDirectory()) out = out.concat(walk(abs, rel));
    else out.push({ abs, rel });
  }
  return out;
}
const skip = new Set(['layout.json', 'manifest.json']);
const content = walk(PKG, '')
  .filter(f => !skip.has(f.rel))
  .map(f => {
    const st = fs.statSync(f.abs);
    return {
      path: f.rel,
      size: st.size,
      date: (BigInt(Math.round(st.mtimeMs)) + 11644473600000n) * 10000n
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));
const json = '{\n  "content": [\n' + content.map(c =>
  '    {\n      "path": "' + c.path + '",\n      "size": ' + c.size + ',\n      "date": ' + c.date.toString() + '\n    }'
).join(',\n') + '\n  ]\n}';
fs.writeFileSync(path.join(PKG, 'layout.json'), json);
console.log('layout.json written — ' + content.length + ' files:');
for (const c of content) console.log('  ' + c.path + ' (' + c.size + ' bytes)');
