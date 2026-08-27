'use strict';
// Display-resolution-on-launch (v6.21.0): set the Windows desktop to the DLDSR resolution before MSFS
// launches, restore on sim close. The actual ChangeDisplaySettings call needs an interactive desktop
// session (not available in CI/sandbox), so this locks the FAIL-SAFE contract + the renderer parsing:
// never apply without a current-mode read AND a passing CDS_TEST; dynamic (reboot-revertible) change;
// original saved before the set; restore wired into sim-close watch + boot catch-up + before-quit.
const fs = require('fs'), path = require('path');
const ROOT = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(ROOT, 'main.js'), 'utf8');
let pass = 0, fail = 0;
function T(name, cond){ if(cond){ pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function grab(src, name){
  let i = src.indexOf('function ' + name + '('); if(i < 0) i = src.indexOf('async function ' + name + '(');
  if(i < 0) throw new Error('not found: ' + name);
  let d = 0, s = false; for(let j = i; j < src.length; j++){ const c = src[j]; if(c === '{'){ d++; s = true; } else if(c === '}'){ d--; if(s && d === 0) return src.slice(i, j + 1); } }
}
console.log('display resolution on launch:');

// ── renderer: drSetMode / drSetEnabled ──
let saved = null;
const S = { cfg:{} };
const win = { api:{ saveConfig: c => { saved = c; } } };
const r = new Function('S', 'window', grab(html,'drSetMode') + grab(html,'drSetEnabled') + '\nreturn { drSetMode, drSetEnabled };')(S, win);
r.drSetMode('3413x1920x165');
T('valid mode string parses to w/h/hz', S.cfg.displayRes.w === 3413 && S.cfg.displayRes.h === 1920 && S.cfg.displayRes.hz === 165);
T('saveConfig called on mode set', saved === S.cfg);
r.drSetEnabled(true);
T('enable toggle preserves the chosen resolution', S.cfg.displayRes.enabled === true && S.cfg.displayRes.w === 3413);
r.drSetMode('');
T('empty selection zeroes the resolution', S.cfg.displayRes.w === 0 && S.cfg.displayRes.h === 0);
T('enabled flag preserved when the mode is cleared', S.cfg.displayRes.enabled === true);

// ── main.js: fail-safe structure ──
const apply = grab(main, 'displayApplyForLaunch');
T('apply no-ops unless enabled + w + h', /if\(!dr \|\| !dr\.enabled \|\| !\(dr\.w>0\) \|\| !\(dr\.h>0\)\) return;/.test(apply));
T('apply reads current mode first and bails if unreadable', /const cur = displayGetCurrent\(\);/.test(apply) && /if\(!cur\)\{[\s\S]*?return;/.test(apply));
T('apply skips when already at the target', /if\(cur\.w===dr\.w && cur\.h===dr\.h\)\{[\s\S]*?return;/.test(apply));
T('apply CDS_TESTs the target and bails if invalid', /if\(displaySet\(dr\.w,dr\.h,hz,true\)!==0\)\{[\s\S]*?return;/.test(apply));
T('apply saves the ORIGINAL before the real set', apply.indexOf('writeFileSync(DISPLAY_STATE()') > -1 && apply.indexOf('writeFileSync(DISPLAY_STATE()') < apply.indexOf('displaySet(dr.w,dr.h,hz,false)'));
T('apply arms the restore watch', /_displayRestorePending=true; startDisplayWatch\(\);/.test(apply));

const set = grab(main, 'displaySet');
T('change is DYNAMIC (flags=0, non-registry) so a reboot self-reverts; test uses CDS_TEST 0x02', /const flag=test\?'0x02':'0';/.test(set));
T('displaySet sets DM_PELSWIDTH|DM_PELSHEIGHT|DM_DISPLAYFREQUENCY', /dmFields=0x80000 -bor 0x100000 -bor 0x400000/.test(set));

const watch = grab(main, 'startDisplayWatch');
T('watch restores on sim close', /if\(sawSim && !up\)\{[\s\S]*?displayRestore\(\)/.test(watch));
T('watch has a never-launched safety net (~5 min)', /ticks>=50[\s\S]*?displayRestore\(\)/.test(watch));

const restore = grab(main, 'displayRestore');
T('restore reads the saved original and deletes the state file', /DISPLAY_STATE\(\)/.test(restore) && /unlinkSync/.test(restore));

T('launch-msfs applies the resolution before launching', /try \{ displayApplyForLaunch\(\); \} catch\(_\)\{\}/.test(main));
T('boot catch-up restores a stuck resolution', /if \(fs\.existsSync\(DISPLAY_STATE\(\)\) && !isMsfsRunning\(\)\) displayRestore\(\);/.test(main));
T('before-quit restores the resolution', /try\{ displayRestore\(\); \}catch\(_\)\{\}/.test(main));
T('P/Invoke here-string opener + flush-left terminator element (valid PS -Command)', /Add-Type -TypeDefinition @'/.test(main) && /"'@"/.test(main) && /ChangeDisplaySettings\(ref DEVMODE/.test(main));

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
