const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const https  = require('https');
const crypto = require('crypto');
const { spawn } = require('child_process');

// ── USER DATA DIR ─────────────────────────────────────────────────────────────
// Name the runtime data folder to match the product. MUST run before any
// app.getPath('userData') call. Folder becomes %APPDATA%\A Better Route Planner\
app.setName('A Better Route Planner');
const USER_DATA = app.getPath('userData');
if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });
// Old folder name (from package.json "name") — used once to migrate existing data.
const LEGACY_USER_DATA = path.join(app.getPath('appData'), 'dean-msfs-route-finder');

// ── FILE LOGGER ──────────────────────────────────────────────────────────────
const LOG_PATH = path.join(USER_DATA, 'dean_msfs_debug.log');
function redact(str) {
  // Redact long hex strings (API keys) and anything labelled cookie=
  return String(str)
    .replace(/[a-f0-9]{32,}/gi, '***REDACTED***')
    .replace(/(cookie[=:]\s*)\S+/gi, '$1***REDACTED***');
}
function log(level, ...args) {
  const ts = new Date().toISOString();
  const raw = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ');
  const line = `[${ts}] [${level}] ${redact(raw)}`;
  console.log(line);
  try { fs.appendFileSync(LOG_PATH, line + '\n'); } catch(e) {}
}
const LOG = {
  info:  (...a) => log('INFO ', ...a),
  warn:  (...a) => log('WARN ', ...a),
  error: (...a) => log('ERROR', ...a),
};

// Clear log on fresh start, write header
try {
  fs.writeFileSync(LOG_PATH,
    `A Better Route Planner — Session started ${new Date().toISOString()}\n` +
    `Platform: ${process.platform} | Node: ${process.version} | Electron: ${process.versions.electron}\n` +
    '='.repeat(80) + '\n'
  );
} catch(e) {}
LOG.info('App starting');

// GPU flags to suppress errors when running as Administrator on Windows

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor,UseSkiaRenderer');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

function isNewer(remote, local) {
  const r = remote.split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (r[i] > l[i]) return true;
    if (r[i] < l[i]) return false;
  }
  return false;
}

// The update check used to be a single shot at did-finish-load: one failure and the app
// went the whole session with no update, silently. Dean hit exactly that on 2026-08-12 —
// GitHub answered the v6.19.2 check with net::ERR_HTTP2_SERVER_REFUSED_STREAM (a transient
// HTTP/2 refusal, 189ms after launch) and the installed app just sat on 6.19.1 looking like
// release.bat had failed. So: retry a failed check with backoff, and keep re-checking on a
// slow timer — which also covers the other half of his workflow, running release.bat while
// ABRP is already open (a startup-only check can never see that release).
const AU_RETRY_MS = [15e3, 60e3, 180e3, 600e3];  // backoff after a failed check
const AU_POLL_MS  = 2 * 60 * 60 * 1000;          // re-check every 2h while the app stays open
let _auWired = false, _auFails = 0, _auRetryTimer = null, _auPollTimer = null, _auDone = false;

function _auStopTimers() {
  if (_auRetryTimer) { clearTimeout(_auRetryTimer);  _auRetryTimer = null; }
  if (_auPollTimer)  { clearInterval(_auPollTimer);  _auPollTimer  = null; }
}

function checkForUpdate() {
  if (app.isPackaged) {
    // Installed .exe — use electron-updater to download and apply updates
    const { autoUpdater } = require('electron-updater');
    // Handlers are registered ONCE. checkForUpdate() is now re-entrant (retries + the 2h poll
    // call it again), and re-registering would stack duplicate listeners on every attempt.
    if (!_auWired) {
      _auWired = true;
      autoUpdater.logger = { info: m => LOG.info('[AU]', m), warn: m => LOG.warn('[AU]', m), error: m => LOG.error('[AU]', m) };
      autoUpdater.autoDownload = true;
      autoUpdater.autoInstallOnAppQuit = true;
      autoUpdater.on('update-available', info => {
        LOG.info('[AU] Update available: v' + info.version);
        if (win && !win.isDestroyed()) win.webContents.send('update-available', info.version);
      });
      autoUpdater.on('update-downloaded', info => {
        LOG.info('[AU] Update downloaded: v' + info.version);
        _auDone = true;                 // nothing left to look for — stop the retry/poll timers
        _auStopTimers();
        if (win && !win.isDestroyed()) win.webContents.send('update-downloaded', info.version);
      });
      autoUpdater.on('error', e => LOG.error('[AU] Error:', e.message));
      // Slow re-check so a release published while ABRP is open is still noticed this session.
      _auPollTimer = setInterval(() => { if (!_auDone) checkForUpdate(); }, AU_POLL_MS);
      if (_auPollTimer.unref) _auPollTimer.unref();   // never hold the app open at quit
    }
    if (_auDone) return;
    autoUpdater.checkForUpdates()
      .then(() => { _auFails = 0; })
      .catch(e => {
        // A failed check is retried; a check that simply finds nothing new resolves above.
        const wait = AU_RETRY_MS[Math.min(_auFails, AU_RETRY_MS.length - 1)];
        _auFails++;
        LOG.warn(`[AU] Check failed: ${e.message} — retry ${_auFails} in ${Math.round(wait / 1000)}s`);
        if (_auRetryTimer) clearTimeout(_auRetryTimer);
        _auRetryTimer = setTimeout(() => { _auRetryTimer = null; if (!_auDone) checkForUpdate(); }, wait);
        if (_auRetryTimer.unref) _auRetryTimer.unref();
      });
  } else {
    // Dev mode — compare raw GitHub index.html version string, prompt to git pull (dev copies only)
    try {
      const localHtml = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
      const localMatch = localHtml.match(/A Better Route Planner[^v]*v(\d+\.\d+\.\d+)/);
      if (!localMatch) return;
      const localVer = localMatch[1];
      https.get('https://raw.githubusercontent.com/snkeyez95/dean-msfs-route-finder/main/index.html', res => {
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => {
          const remoteMatch = data.match(/A Better Route Planner[^v]*v(\d+\.\d+\.\d+)/);
          if (!remoteMatch) return;
          const remoteVer = remoteMatch[1];
          LOG.info(`Version check: local=v${localVer} remote=v${remoteVer}`);
          if (isNewer(remoteVer, localVer) && win && !win.isDestroyed()) {
            LOG.info(`Update available: remote=v${remoteVer} local=v${localVer}`);
            win.webContents.send('update-available', remoteVer);
          }
        });
      }).on('error', e => LOG.warn('Version check failed:', e.message));
    } catch(e) {
      LOG.warn('Version check error:', e.message);
    }
  }
}

let win;
// Resolve the perf engine folder. In the installed app it's shipped OUTSIDE app.asar via
// extraResources (process.resourcesPath\perf) so the bundled perf-engine.exe is a real file
// an external process can run; in dev it's the project's perf/ folder.
function perfDir(){
  return app.isPackaged ? path.join(process.resourcesPath, 'perf') : path.join(__dirname, 'perf');
}
// Ensure the bundled chart libraries are in the perf data home so embedded reports
// render offline (copies perf/vendor/*.js -> userData\Sessions\_lib\ if missing).
function seedPerfLibs(){
  try{
    const vendor = path.join(perfDir(), 'vendor');
    if(!fs.existsSync(vendor)) return;
    const dest = path.join(USER_DATA, 'Sessions', '_lib');
    fs.mkdirSync(dest, {recursive:true});
    for(const f of fs.readdirSync(vendor)){
      if(!f.toLowerCase().endsWith('.js')) continue;
      const s = path.join(vendor, f), d = path.join(dest, f);
      // copy when missing OR stale (size differs) — a vendored chart-lib update must actually
      // reach the reports, not sit behind a copy-once check forever
      let need = !fs.existsSync(d);
      if(!need){ try{ need = fs.statSync(s).size !== fs.statSync(d).size; }catch(_){ need = true; } }
      if(need) fs.copyFileSync(s, d);
    }
  }catch(e){ try{LOG.warn('seedPerfLibs failed: '+e.message);}catch(_){} }
}
let _perfAllowClose = false;
// ── Window size/position persistence (Dean 2026-07-11: default was too short to show a whole route
// card; remember whatever size the user picks). Stored in its own tiny file (not config.json — this
// is loss-tolerable UI state, and keeping it separate never risks the route data). Off-screen guard:
// a saved position on a monitor that's since been unplugged would strand the window — only restore a
// position that still lands on a connected display.
const WIN_STATE = path.join(USER_DATA, 'window_state.json');
const OVERLAY_POS = path.join(USER_DATA, 'overlay_pos.json');   // v6.11.6: user-dragged overlay dot position (Dean: default top-right sat on the PMDG overhead light switches)
const WIN_DEFAULT = { width:1440, height:980, minW:1100, minH:700 };
function loadWindowState(){
  try{
    const s = JSON.parse(fs.readFileSync(WIN_STATE,'utf8'));
    if(!s || typeof s.width!=='number' || typeof s.height!=='number') return null;
    s.width = Math.max(WIN_DEFAULT.minW, Math.round(s.width));
    s.height = Math.max(WIN_DEFAULT.minH, Math.round(s.height));
    // keep the saved x/y only if the window still lands on a connected display
    if(typeof s.x==='number' && typeof s.y==='number'){
      try{
        const { screen } = require('electron');
        const onScreen = screen.getAllDisplays().some(d=>{
          const w=d.workArea;
          return s.x < w.x+w.width && s.x+s.width > w.x && s.y < w.y+w.height && s.y+s.height > w.y;
        });
        if(!onScreen){ delete s.x; delete s.y; }
      }catch(_){ delete s.x; delete s.y; }
    }
    return s;
  }catch(_){ return null; }
}
let _winSaveT=null;
function saveWindowState(){
  if(!win || win.isDestroyed()) return;
  try{
    const maximized = win.isMaximized();
    // when maximized, persist the NORMAL bounds so un-maximizing restores a sensible size
    const b = maximized ? win.getNormalBounds() : win.getBounds();
    writeFileAtomic(WIN_STATE, JSON.stringify({ x:b.x, y:b.y, width:b.width, height:b.height, maximized }));
  }catch(_){}
}
function queueWindowSave(){ if(_winSaveT) clearTimeout(_winSaveT); _winSaveT=setTimeout(saveWindowState, 400); }

function createWindow() {
  seedPerfLibs();
  // Catch-up: if a prior run closed apps but never reopened them (ABRP/sim ended early) and the
  // sim isn't running now, reopen them so nothing stays closed.
  try { if (fs.existsSync(FLIGHT_STATE()) && !isMsfsRunning()) { _flightReopenPending = true; flightReopenApps(); } } catch(_){}
  const ws = loadWindowState();
  win = new BrowserWindow({
    width:(ws&&ws.width)||WIN_DEFAULT.width, height:(ws&&ws.height)||WIN_DEFAULT.height,
    ...(ws&&typeof ws.x==='number'?{x:ws.x, y:ws.y}:{}),
    minWidth:WIN_DEFAULT.minW, minHeight:WIN_DEFAULT.minH,
    frame:false, backgroundColor:'#000000',
    webPreferences:{
      preload: path.join(__dirname,'preload.js'),
      contextIsolation:true, nodeIntegration:false
    }
  });
  if(ws && ws.maximized) win.maximize();
  // Remember size/position across sessions — debounced on resize/move, and a final save on close.
  win.on('resize', queueWindowSave);
  win.on('move', queueWindowSave);
  // "Sim is running — confirm close" guard (Dean's ask). Capture runs detached, so closing
  // ABRP never affects it; this is just a deliberate heads-up.
  win.on('close', (e) => {
    saveWindowState();                 // final, synchronous save before teardown (beats the debounce)
    if (_perfAllowClose) return;
    let simUp = false, capUp = false;
    try { simUp = isMsfsRunning(); } catch (_) {}
    try { capUp = isCaptureRunning(); } catch (_) {}
    if (!simUp && !capUp) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type:'question', buttons:['Close ABRP','Cancel'], defaultId:0, cancelId:1, noLink:true,
      title: capUp ? 'Capture is active' : 'MSFS is running',
      message: capUp ? 'A performance capture is active.' : 'MSFS 2024 is still running.',
      detail: capUp
        ? 'It runs independently of ABRP — it will keep recording and file on its own when you close the sim. Closing ABRP will NOT stop or lose it. Close ABRP now?'
        : 'Closing ABRP is fine — any active performance capture runs independently and will keep recording, filing on its own when you close the sim. Close ABRP now?'
    });
    if (choice === 0) { _perfAllowClose = true; win.close(); }
  });
  win.on('closed', () => {
    // v6.6.3 ZOMBIE FIX (root cause of Dean's stuck updates, 2026-07-09): the invisible in-sim OVERLAY
    // is a real BrowserWindow, so while it existed 'window-all-closed' never fired when the user closed
    // ABRP — the app lived on as a windowless zombie that (a) held the single-instance lock, (b) threw
    // the destroyed-window error at every relaunch attempt, and (c) held a file lock on the exe so NSIS
    // updates silently failed (disk stayed on the old version). Closing the main window now tears the
    // overlay down with it, letting window-all-closed -> app.quit() proceed normally.
    try { if (overlayWin && !overlayWin.isDestroyed()) overlayWin.destroy(); } catch (_) {}
    overlayWin = null;
    win = null;
  });
  win.loadFile('index.html');
  win.webContents.once('did-finish-load', checkForUpdate);
}
// Only one copy of ABRP may run at a time. Two instances share one config file and
// one Community folder with no coordination, so the second to close wipes the first's
// active junctions (and the survivor re-links them minutes later). The losing instance
// uses app.exit(0) — NOT app.quit() — so before-quit never fires and the existing
// instance's add-ons are left untouched.
if(!app.requestSingleInstanceLock()){
  app.exit(0);
}else{
  app.on('second-instance', () => {   // user opened a second copy — focus the existing window
    // isDestroyed guard (v6.6.2, Dean hit this live): during a silent auto-update the dying instance
    // still holds the single-instance lock while its window is already destroyed — the relaunched copy
    // fires second-instance on it and win.isMinimized() threw "Object has been destroyed".
    try{ if(win && !win.isDestroyed()){ if(win.isMinimized()) win.restore(); win.focus(); } }catch(_){}
  });
  app.whenReady().then(createWindow);
  // v6.3.8: one-time sidecar backfill of the 5-phase split for pre-v6.3.8 flights (idempotent, skips
  // done + native-5-phase). DETACHED (parses frametimes) — never blocks the UI; originals untouched.
  app.whenReady().then(() => {
    try {
      const mod = path.join(perfDir(), 'native', 'backfill_phases.js');
      if (!fs.existsSync(mod)) return;
      const ch = spawn(process.execPath, [mod, path.join(USER_DATA, 'Sessions')], {
        detached: true, stdio: 'ignore', windowsHide: true,
        env: Object.assign({}, process.env, { ELECTRON_RUN_AS_NODE: '1',
          ABRP_THIRDPARTY_ICAOS: JSON.stringify(thirdPartyIcaos()),   // for the report ✳ + flags on regen
          NODE_PATH: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules') : path.join(__dirname, 'node_modules') }) });
      ch.on('error', e => LOG.warn('[MIGRATE] phases_ext backfill spawn failed: ' + e.message));
      ch.unref();
    } catch (e) { LOG.warn('[MIGRATE] phases_ext backfill failed (non-fatal): ' + e.message); }
  });
}
app.on('window-all-closed',()=>{ if(process.platform!=='darwin') app.quit(); });
app.on('web-contents-created',(_,c)=>{
  c.setWindowOpenHandler(({url})=>{ shell.openExternal(url); return {action:'deny'}; });
});

ipcMain.handle('browse-folder', async ()=>{ LOG.info('browse-folder requested');
  const r=await dialog.showOpenDialog(win,{properties:['openDirectory'],title:'Select 3rd-Party Scenery Folder'});
  const result = r.canceled ? null : r.filePaths[0];
  LOG.info('browse-folder result:', result||'cancelled');
  return result;
});
ipcMain.handle('scan-folder', async (_,p)=>{
  LOG.info('scan-folder:', p);
  try{
    const entries=fs.readdirSync(p,{withFileTypes:true});
    const folders=entries.filter(e=>e.isDirectory()).map(e=>e.name);
    // Wrapper detection: a folder with no manifest.json of its OWN, but whose immediate subfolders ARE
    // packages (each has manifest.json), is a WRAPPER (e.g. "KLAS FlyTampa" → airport + city). MSFS only
    // loads a package that sits DIRECTLY in Community, so a wrapper's inner packages must be linked
    // individually. pkgMap[folder] = [innerPackageNames] for wrappers; normal packages are absent.
    const pkgMap={};
    for(const f of folders){
      const full=path.join(p,f);
      if(pkgIsPackageDir(full))continue;                 // folder is itself a package → link as-is
      let inner=[];
      try{ inner=fs.readdirSync(full,{withFileTypes:true}).filter(e=>e.isDirectory()&&pkgIsPackageDir(path.join(full,e.name))).map(e=>e.name); }catch(_){}
      if(inner.length)pkgMap[f]=inner;                   // wrapper → link each inner package directly
    }
    LOG.info('scan-folder found', folders.length, 'subfolders,', Object.keys(pkgMap).length, 'wrapper(s)');
    return {success:true,folders,pkgMap};
  }catch(e){
    LOG.error('scan-folder failed:', e.message);
    return {success:false,error:e.message};
  }
});

// ── GSX PRO PROFILES ──────────────────────────────────────────────────────────
// GSX profiles live (flat, sometimes in subfolders) in %APPDATA%\Virtuali\GSX\MSFS.
// A profile for an airport is a set of files whose base name starts with the
// lowercase ICAO, e.g. lppr-mkstudios-...-gsx-vdgs.ini / .py / _handler.py
function gsxDefaultDir(){
  const appData = process.env.APPDATA || path.join(os.homedir(),'AppData','Roaming');
  return path.join(appData,'Virtuali','GSX','MSFS');
}
function gsxResolveDir(gsxFolder){
  return (gsxFolder && gsxFolder.trim()) ? gsxFolder.trim() : gsxDefaultDir();
}
// Recursively collect files under dir up to maxDepth. skipRe (optional) matches
// directory names to skip (e.g. bulky texture folders).
function gsxWalkFiles(dir, maxDepth, skipRe){
  const out=[];
  (function rec(d, depth){
    if(depth>maxDepth) return;
    let ents;
    try{ ents=fs.readdirSync(d,{withFileTypes:true}); }catch(e){ return; }
    for(const e of ents){
      const full=path.join(d,e.name);
      if(e.isDirectory()){
        if(skipRe && skipRe.test(e.name)) continue;
        rec(full, depth+1);
      } else {
        out.push({abs:full, base:e.name});
      }
    }
  })(dir, 0);
  return out;
}
const GSX_SKIP_DIRS = /^texture$/i;
const gsxIsProfileFile = b => { b=(b||'').toLowerCase(); return b.endsWith('.py')||b.endsWith('.ini'); };
// Conservative match for scanning whole scenery packages: a .py/.ini that either
// starts with the ICAO or has "gsx" in the name.
function gsxLooksBundled(base, icao){
  const b=(base||'').toLowerCase();
  if(!gsxIsProfileFile(b)) return false;
  if(icao && b.startsWith(icao.toLowerCase())) return true;
  return b.includes('gsx');
}

ipcMain.handle('gsx-list-profiles', (_, gsxFolder)=>{
  const dir=gsxResolveDir(gsxFolder);
  try{
    if(!fs.existsSync(dir)){ LOG.info('[GSX] profile dir not found:', dir); return {ok:true, dir, files:[]}; }
    const files=gsxWalkFiles(dir, 4, null).map(f=>f.base.toLowerCase());
    LOG.info('[GSX] list-profiles:', files.length, 'files in', dir);
    return {ok:true, dir, files};
  }catch(e){ LOG.error('[GSX] list-profiles failed:', e.message); return {ok:false, error:e.message, files:[]}; }
});

ipcMain.handle('gsx-scan-bundled', (_, {sceneryFolder, icao})=>{
  try{
    if(!sceneryFolder || !fs.existsSync(sceneryFolder)) return {ok:true, files:[]};
    const files=gsxWalkFiles(sceneryFolder, 6, GSX_SKIP_DIRS).filter(f=>gsxLooksBundled(f.base, icao));
    if(files.length) LOG.info('[GSX] scan-bundled', icao, '→', files.length, 'file(s)');
    return {ok:true, files};
  }catch(e){ LOG.error('[GSX] scan-bundled failed:', e.message); return {ok:false, error:e.message, files:[]}; }
});

// Place one bundled profile file into the GSX folder, update-aware (Dean, 2026-07-06 — real case:
// iniBuilds KJFK scenery shipped a newer kjfk-24-inibuilds.ini than the installed 2025 copy and the
// old name-match logic silently kept the stale one). If a file with the same name already exists
// ANYWHERE in the GSX tree (profiles sit in subfolders too — never create a flat duplicate):
//   identical content        -> 'current'    (nothing to do)
//   yours is newer than src  -> 'kept-local' (an old scenery can't stomp a newer profile)
//   scenery copy is newer    -> 'updated'    (replaced in place — no .bak clutter, per Dean)
function gsxSha(p){ return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function gsxPlaceFile(src, dir){
  const base=path.basename(src);
  const existing=gsxWalkFiles(dir, 4, null).find(f=>f.base.toLowerCase()===base.toLowerCase());
  if(!existing){ fs.copyFileSync(src, path.join(dir, base)); return {action:'installed', base}; }
  const dest=existing.abs;
  if(gsxSha(src)===gsxSha(dest)) return {action:'current', base};
  if(fs.statSync(src).mtimeMs<=fs.statSync(dest).mtimeMs) return {action:'kept-local', base};
  fs.copyFileSync(src, dest);
  return {action:'updated', base};
}
ipcMain.handle('gsx-install-bundled', (_, {files, gsxFolder})=>{
  const dir=gsxResolveDir(gsxFolder);
  const copied=[], updated=[], errors=[];
  try{ fs.mkdirSync(dir,{recursive:true}); }catch(e){}
  for(const src of (files||[])){
    try{
      const r=gsxPlaceFile(src, dir);
      if(r.action==='installed'){ copied.push(r.base); LOG.info('[GSX] installed', r.base, '->', dir); }
      else if(r.action==='updated'){ updated.push(r.base); LOG.info('[GSX] UPDATED', r.base, '(newer copy bundled with scenery)'); }
      else if(r.action==='kept-local'){ LOG.info('[GSX] kept local', r.base, '(installed copy is newer than the bundled one)'); }
    }catch(e){ errors.push(path.basename(src)+': '+e.message); LOG.error('[GSX] install failed:', e.message); }
  }
  return {ok:errors.length===0, copied, updated, errors};
});

const GSX_ARCHIVE_RE=/\.(zip|rar|7z)$/i;
// Windows has no built-in .rar/.7z extractor — locate 7-Zip or WinRAR if installed.
function gsxFindExtractor(){
  const cands=[
    {exe:'C:\\Program Files\\7-Zip\\7z.exe', kind:'7z'},
    {exe:'C:\\Program Files (x86)\\7-Zip\\7z.exe', kind:'7z'},
    {exe:'C:\\Program Files\\WinRAR\\UnRAR.exe', kind:'unrar'},
    {exe:'C:\\Program Files (x86)\\WinRAR\\UnRAR.exe', kind:'unrar'},
    {exe:'C:\\Program Files\\WinRAR\\WinRAR.exe', kind:'winrar'},
    {exe:'C:\\Program Files (x86)\\WinRAR\\WinRAR.exe', kind:'winrar'},
  ];
  for(const c of cands){ try{ if(fs.existsSync(c.exe)) return c; }catch(e){} }
  return null;
}
// Extract .zip/.rar/.7z into tmp. .zip uses Expand-Archive (built-in); .rar/.7z
// shell out to 7-Zip or WinRAR. Returns {ok, needTool}.
function gsxExtractArchive(archivePath, tmp){
  const cp=require('child_process');
  const ext=path.extname(archivePath).toLowerCase();
  if(ext==='.zip'){
    // Single-quoted PS literals (with '' escaping) — a filename containing " or $(...) must never be
    // interpreted by PowerShell (double quotes would expand/execute it).
    const psq = s => `'${String(s).replace(/'/g,"''")}'`;
    const r=cp.spawnSync('powershell',
      ['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${psq(archivePath)} -DestinationPath ${psq(tmp)} -Force`],
      {windowsHide:true});
    if(r.status===0) return {ok:true};
    // some zips trip Expand-Archive — fall through to a real archiver if present
  }
  const tool=gsxFindExtractor();
  if(!tool) return {ok:false, needTool:true};
  let args;
  if(tool.kind==='7z') args=['x', archivePath, '-o'+tmp, '-y'];
  else if(tool.kind==='unrar') args=['x','-y', archivePath, tmp+'\\'];
  else args=['x','-ibck','-y', archivePath, tmp+'\\'];  // WinRAR.exe
  const r=cp.spawnSync(tool.exe, args, {windowsHide:true});
  if(r.status!==0) LOG.error('[GSX] extractor exit', r.status, tool.exe);
  return {ok:r.status===0};
}

// Manual drag-and-drop install: accepts loose .py/.ini files, a folder, or a
// .zip/.rar/.7z archive (downloaded straight from flightsim.to).
ipcMain.handle('gsx-install-dropped', (_, {paths, gsxFolder, variant})=>{
  const dir=gsxResolveDir(gsxFolder);
  const copied=[], skipped=[], errors=[], tmpDirs=[];
  let needTool=false;
  try{ fs.mkdirSync(dir,{recursive:true}); }catch(e){}
  const collect=[];
  for(const p of (paths||[])){
    try{
      const st=fs.statSync(p);
      if(st.isDirectory()){
        gsxWalkFiles(p, 8, GSX_SKIP_DIRS).forEach(f=>{ if(gsxIsProfileFile(f.base)) collect.push(f.abs); });
      } else if(GSX_ARCHIVE_RE.test(p)){
        const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'gsxarc-'));
        tmpDirs.push(tmp);
        const ex=gsxExtractArchive(p, tmp);
        if(!ex.ok){
          if(ex.needTool) needTool=true;
          errors.push(path.basename(p)+(ex.needTool?': no .rar/.7z extractor installed':': extract failed'));
          LOG.error('[GSX] extract failed:', p, ex.needTool?'(no tool)':'');
          continue;
        }
        gsxWalkFiles(tmp, 8, GSX_SKIP_DIRS).forEach(f=>{ if(gsxIsProfileFile(f.base)) collect.push(f.abs); });
      } else if(gsxIsProfileFile(path.basename(p))){
        collect.push(p);
      } else {
        skipped.push(path.basename(p));
      }
    }catch(e){ errors.push(path.basename(p)+': '+e.message); LOG.error('[GSX] dropped item failed:', e.message); }
  }
  // Duplicate-filename detection (v6.11.4, Dean 2026-07-14): a variant pack ships the SAME profile
  // filename in two subfolders (normal version/ + winter version/) — a blind copy-by-basename silently
  // installs whichever comes last (the winter-EPWA bug). Group the collisions by their immediate parent
  // folder and let the user pick which variant. Works for ANY differently-named subfolders too.
  const meta=collect.map(abs=>({abs, base:path.basename(abs).toLowerCase(), parent:path.basename(path.dirname(abs))}));
  const byBase={}; for(const m of meta){ (byBase[m.base]=byBase[m.base]||[]).push(m); }
  const dupBases=Object.keys(byBase).filter(b=>byBase[b].length>1);
  if(dupBases.length && !variant){
    const vset={}; for(const b of dupBases) for(const m of byBase[b]) vset[m.parent]=true;
    for(const t of tmpDirs){ try{ fs.rmSync(t,{recursive:true,force:true}); }catch(e){} }
    return {ok:false, dupes:true, variants:Object.keys(vset).sort(), dupCount:dupBases.length};
  }
  // Install: everything, OR (when a variant was chosen) the non-duplicated files + only the chosen
  // variant's copies of the duplicated ones.
  const toInstall = variant ? meta.filter(m => byBase[m.base].length===1 || m.parent===variant) : meta;
  for(const m of toInstall){
    try{
      const destName=path.basename(m.abs);
      fs.copyFileSync(m.abs, path.join(dir, destName));
      copied.push(destName);
      LOG.info('[GSX] dropped install', destName, variant?('(variant: '+variant+')'):'', '->', dir);
    }catch(e){ errors.push(path.basename(m.abs)+': '+e.message); LOG.error('[GSX] dropped copy failed:', e.message); }
  }
  for(const t of tmpDirs){ try{ fs.rmSync(t,{recursive:true,force:true}); }catch(e){} }
  return {ok:errors.length===0, copied, skipped, errors, needTool, variant:variant||null};
});
// Drag-and-drop a scenery package into the library folder (v6.11.4). Mirrors util-add but FLATTENS a
// wrapping archive folder so scan-folder sees the scenery at the top level: one inner folder → use it
// (ignore stray root readmes); multiple inner folders → add each; loose files only → wrap in a folder
// named after the archive. Skips folders already present. Dean 2026-07-14.
ipcMain.handle('scenery-add', (_, {paths, libraryFolder})=>{
  const root=libraryFolder;
  const added=[], skipped=[], errors=[], tmpDirs=[]; let needTool=false;
  if(!root || !fs.existsSync(root)) return {ok:false, added, skipped, errors:['no scenery library folder set'], needTool, noLib:true};
  for(const p of (paths||[])){
    try{
      const st=fs.statSync(p);
      if(st.isDirectory()){
        const dest=path.join(root, path.basename(p));
        if(fs.existsSync(dest)){ skipped.push(path.basename(p)); continue; }
        fs.cpSync(p, dest, {recursive:true});
        added.push(path.basename(p));
        LOG.info('[SCN] scenery added (folder):', dest);
      } else if(GSX_ARCHIVE_RE.test(p)){
        const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'scnadd-'));
        tmpDirs.push(tmp);
        const ex=gsxExtractArchive(p, tmp);
        if(!ex.ok){ if(ex.needTool) needTool=true; errors.push(path.basename(p)+(ex.needTool?': no .rar/.7z extractor installed':': extract failed')); continue; }
        const entries=fs.readdirSync(tmp,{withFileTypes:true});
        const dirs=entries.filter(e=>e.isDirectory());
        const srcRoots = dirs.length>=1 ? dirs.map(d=>path.join(tmp,d.name)) : [tmp];  // ≥1 folder → each is a package (ignore root readmes); no folder → wrap loose files
        for(const sr of srcRoots){
          const name = (sr===tmp) ? path.basename(p).replace(/\.(zip|rar|7z)$/i,'') : path.basename(sr);
          const dest=path.join(root, name);
          if(fs.existsSync(dest)){ skipped.push(name); continue; }
          fs.cpSync(sr, dest, {recursive:true});
          added.push(name);
          LOG.info('[SCN] scenery added (archive):', dest);
        }
      } else {
        skipped.push(path.basename(p));   // a loose non-archive file isn't a scenery package
      }
    }catch(e){ errors.push(path.basename(p)+': '+e.message); LOG.error('[SCN] scenery-add failed:', e.message); }
  }
  for(const t of tmpDirs){ try{ fs.rmSync(t,{recursive:true,force:true}); }catch(e){} }
  return {ok:errors.length===0, added, skipped, errors, needTool};
});

const CFG = path.join(USER_DATA, 'config.json');
// Atomic JSON write: write to a sibling tmp file then rename over the target. A crash or power cut
// mid-write can otherwise leave a truncated file — load-config/si-get-* would then silently start
// "fresh", losing settings or the never-pruned 20k route snapshot. rename on the same volume is atomic.
function writeFileAtomic(file, data){
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}
// One-time migration into the renamed userData folder. Copy-only — the source
// files are left untouched as a backup. Prefer the legacy userData folder
// (dean-msfs-route-finder), then fall back to the original home-root dot-file.
(()=>{
  if (fs.existsSync(CFG)) return;
  const legacyCfg = path.join(LEGACY_USER_DATA, 'config.json');
  const homeCfg   = path.join(os.homedir(), '.dean_msfs_v4.json');
  const src = fs.existsSync(legacyCfg) ? legacyCfg : (fs.existsSync(homeCfg) ? homeCfg : null);
  if (!src) return;
  try { fs.copyFileSync(src, CFG); LOG.info('Config migrated from', src); }
  catch(e) { LOG.warn('Config migration failed:', e.message); }
  // Carry over the community routes backup too, if present in the legacy folder.
  try {
    const legacyCR = path.join(LEGACY_USER_DATA, 'community_routes.json');
    const newCR    = path.join(USER_DATA, 'community_routes.json');
    if (fs.existsSync(legacyCR) && !fs.existsSync(newCR)) {
      fs.copyFileSync(legacyCR, newCR);
      LOG.info('Community routes migrated from', legacyCR);
    }
  } catch(e) { LOG.warn('Community routes migration failed:', e.message); }
})();

// Route data lives in its own files, NOT in config.json — so a settings save no longer rewrites the
// ~13 MB route blob (config.json drops from ~16 MB to ~18 KB). One-time, non-destructive migration:
// write the route data out of config into these files, then strip the keys from config.
const REG_FILE  = path.join(USER_DATA, 'routeRegistry.json');
const SNAP_FILE = path.join(USER_DATA, 'routeSnapshot.json');
(()=>{
  try {
    if (!fs.existsSync(CFG)) return;
    const c = JSON.parse(fs.readFileSync(CFG,'utf8'));
    let changed = false;
    if (c.routeRegistry)         { writeFileAtomic(REG_FILE,  JSON.stringify(c.routeRegistry));         LOG.info('[MIGRATE] routeRegistry -> routeRegistry.json ('+Object.keys(c.routeRegistry).length+')');         delete c.routeRegistry;         changed = true; }
    if (c.routeRegistrySnapshot) { writeFileAtomic(SNAP_FILE, JSON.stringify(c.routeRegistrySnapshot)); LOG.info('[MIGRATE] routeRegistrySnapshot -> routeSnapshot.json ('+Object.keys(c.routeRegistrySnapshot).length+')'); delete c.routeRegistrySnapshot; changed = true; }
    if (changed) { writeFileAtomic(CFG, JSON.stringify(c, null, 2)); LOG.info('[MIGRATE] config.json slimmed (route data split out)'); }
  } catch(e) { LOG.warn('[MIGRATE] route-data split failed (non-fatal):', e.message); }
})();
// ── BENCHMARK CONFIG (Phase 10) ───────────────────────────────────────────────
// The 24-flight benchmark grid used to be hardcoded (Fenix/PMDG × TLOD 100-175 × 3 = Dean's rig).
// It now lives in config.benchmark so any user's fleet works; the seed below IS Dean's classic
// grid, so an existing install migrates with zero behavior change. vramCapMb null = auto-detect
// from the flights' own total_vram_mb. The setup wizard / baseline walkthrough writes this block.
// ORDER MATTERS: normalizeAircraftTitle (perf/native/sysinfo.js) and matchBenchmarkAircraft
// (perf/native/prep.js) both return on the FIRST entry whose match terms appear in the title. The PMDG
// entry's bare 'pmdg' term would swallow every other PMDG airframe, so any specific PMDG type must sit
// ABOVE it (a 777 title hits '777' first; a 737 title contains no '777' and falls through to 'pmdg').
const DEFAULT_BENCHMARK = {
  aircraft: [
    { label: 'Fenix', match: ['fenix', 'a318', 'a319', 'a320', 'a321'] },
    { label: 'PMDG 777', match: ['777', '77w'] },
    { label: 'PMDG',  match: ['pmdg', '737', '738', '739'] },
  ],
  tlods: [100, 125, 150, 175],
  perCell: 3,
  vramCapMb: null,
};
function benchCfg(){
  const b = _perfCfg().benchmark;
  return (b && Array.isArray(b.aircraft) && b.aircraft.length && Array.isArray(b.tlods) && b.tlods.length)
    ? b : DEFAULT_BENCHMARK;
}
function benchLabels(){ return benchCfg().aircraft.map(a => a.label); }
// The set of ICAOs the user owns 3rd-party scenery for (from the My Airports scan). A real match
// only — has an ICAO, still selected, not a 'noise'-word false match. Used to flag dep/arr scenery.
function thirdPartyIcaos(){
  try { const rows = (_perfCfg().savedRows) || [];
    return [...new Set(rows.filter(r => r && r.icao && r.selected !== false && r.method !== 'noise').map(r => String(r.icao).toUpperCase()))]; }
  catch(_){ return []; }
}
// VATSIM CID (v6.9.0) — passed to the capture engine so it can CONFIRM an actual VATSIM connection
// (your CID in the live datafeed) rather than just "vPilot.exe is running" (Dean 2026-07-10: vPilot
// left open as a companion but never connected must NOT tag the flight as vatsim).
function vatsimCid(){ try { return String((_perfCfg().vatsim||{}).cid || '').trim() || null; } catch(_){ return null; } }
(()=>{  // one-time seed for existing installs so the renderer always finds cfg.benchmark
  try {
    if (!fs.existsSync(CFG)) return;                       // brand-new install: the wizard writes it
    const c = JSON.parse(fs.readFileSync(CFG,'utf8'));
    let ch = false;
    if (!c.benchmark) { c.benchmark = DEFAULT_BENCHMARK; ch = true; LOG.info('[MIGRATE] seeded config.benchmark (classic Fenix/PMDG grid)'); }
    // v6.19.0 — PMDG 777 gets its OWN benchmark label. Without this, the PMDG entry's bare 'pmdg' match
    // term claims every 777 title too, so 777 flights would be logged as the 737 label and averaged into
    // its baseline cells, coverage, Scenery z-baselines and Compare. Inserted BEFORE the PMDG entry
    // because the matchers are first-match-wins. One-shot (mig777Done) so a later user edit sticks.
    if (!c.mig777Done) {
      const acs = (c.benchmark && Array.isArray(c.benchmark.aircraft)) ? c.benchmark.aircraft : null;
      if (acs) {
        const has777 = acs.some(a => a && Array.isArray(a.match) && a.match.some(t => /^(777|77w)$/i.test(String(t))));
        if (!has777) {
          const i = acs.findIndex(a => a && Array.isArray(a.match) && a.match.some(t => String(t).toLowerCase() === 'pmdg'));
          const entry = { label: 'PMDG 777', match: ['777', '77w'] };
          if (i >= 0) acs.splice(i, 0, entry); else acs.push(entry);
          LOG.info('[MIGRATE] benchmark: added "PMDG 777" label ahead of PMDG (777 flights no longer count as the 737)');
        }
      }
      c.mig777Done = true; ch = true;
    }
    // an already-configured install is by definition "set up" — the wizard must never fire on it
    if (!c.setupDone && (c.folder || (c.savedRows && c.savedRows.length) || c.siCookie)) { c.setupDone = true; ch = true; }
    if (ch) writeFileAtomic(CFG, JSON.stringify(c, null, 2));
  } catch(e) { LOG.warn('[MIGRATE] benchmark seed failed (non-fatal):', e.message); }
})();
// v6.3.8 scenery attribution: keep each flight's dep/arr ICAO + 3rd-party flags current in index.json
// (the dashboard reads these for the ✳). index.json is derived metadata (regenerable) — the raw
// summary/frametimes/telemetry are never touched here. Recomputed every launch so the flags follow
// the CURRENT library (adding/removing scenery updates them). Cheap: split route + set membership.
(()=>{
  try {
    const idxPath = path.join(USER_DATA, 'Sessions', 'index.json');
    if (!fs.existsSync(idxPath)) return;
    const tp = new Set(thirdPartyIcaos());
    const idx = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    let ch = false;
    for (const s of (idx.sessions || [])) {
      const m = /([A-Z]{3,4})-([A-Z]{3,4})/.exec(String(s.route || '').toUpperCase());
      const dep = m ? m[1] : null, arr = m ? m[2] : null;
      const dS = dep ? tp.has(dep) : false, aS = arr ? tp.has(arr) : false;
      if (s.dep_icao !== (dep||undefined) || s.arr_icao !== (arr||undefined) || !!s.dep_scenery !== dS || !!s.arr_scenery !== aS) {
        if (dep) s.dep_icao = dep; if (arr) s.arr_icao = arr; s.dep_scenery = dS; s.arr_scenery = aS; ch = true;
      }
    }
    if (ch) { writeFileAtomic(idxPath, JSON.stringify(idx, null, 2)); LOG.info('[MIGRATE] scenery flags refreshed on index.json'); }
  } catch(e) { LOG.warn('[MIGRATE] scenery-flag backfill failed (non-fatal):', e.message); }
})();
ipcMain.handle('load-config',()=>{try{const c=JSON.parse(fs.readFileSync(CFG,'utf8'));LOG.info('load-config: loaded, savedRows='+((c.savedRows||[]).length));return c;}catch(e){LOG.warn('load-config: no config found, starting fresh');return {};}});
ipcMain.handle('save-config',(_,cfg)=>{
  try{
    let existing={};
    try{existing=JSON.parse(fs.readFileSync(CFG,'utf8'));}catch(e){}
    const merged=Object.assign({},existing,cfg);
    // Route data lives in routeRegistry.json / routeSnapshot.json now — never store it in config
    // (this is what kept config.json at ~16 MB). Strip defensively + drop the retired AirLabs key.
    delete merged.routeRegistry; delete merged.routeRegistrySnapshot; delete merged.routeCache;
    writeFileAtomic(CFG,JSON.stringify(merged,null,2));
    LOG.info('save-config: saved savedRows='+(cfg.savedRows||[]).length);
  }catch(e){LOG.error('save-config failed:',e.message);}
});

ipcMain.handle('si-fetch-page', (_, {page, cookie}) => new Promise(resolve => {
  LOG.info('si-fetch-page: page=' + page + ' cookie=***REDACTED***');
  const opts = {
    hostname: 'p2.sayintentions.ai',
    path: `/p2/api/commercial-routes/list?page=${page}&limit=100`,
    method: 'GET',
    headers: {
      'Accept': 'application/json',
      'User-Agent': 'DeanMSFSRouteFinder/4.4',
      'Cookie': `p2_session_id=${cookie}`,
    },
  };
  const req = https.request(opts, res => {
    let data = '';
    res.on('data', c => data += c);
    res.on('end', () => {
      LOG.info('si-fetch-page response: status=' + res.statusCode + ' page=' + page + ' bytes=' + data.length);
      if (res.statusCode === 401 || res.statusCode === 403) {
        if (win && !win.isDestroyed()) win.webContents.send('si-cookie-expired');
        resolve({ok: false, status: res.statusCode, expired: true});
        return;
      }
      try {
        const parsed = JSON.parse(data);
        resolve({ok: res.statusCode < 300, status: res.statusCode, data: parsed, bytes: data.length});
      } catch(e) {
        LOG.error('si-fetch-page parse error: status=' + res.statusCode + ' raw=' + data.slice(0, 200));
        resolve({ok: false, status: res.statusCode, data: null, bytes: data.length});
      }
    });
  });
  req.on('error', e => { LOG.error('si-fetch-page network error:', e.message); resolve({ok: false, error: e.message}); });
  req.setTimeout(15000, () => { req.destroy(); resolve({ok: false, error: 'timeout'}); });
  req.end();
}));

ipcMain.handle('si-get-registry', () => {
  try {
    const reg = fs.existsSync(REG_FILE) ? JSON.parse(fs.readFileSync(REG_FILE, 'utf8')) : {};
    LOG.info('[SI] Registry loaded: ' + Object.keys(reg).length + ' entries');
    return reg;
  } catch(e) {
    LOG.warn('si-get-registry: error', e.message);
    return {};
  }
});

ipcMain.handle('si-save-registry', (_, registry) => {
  try {
    writeFileAtomic(REG_FILE, JSON.stringify(registry));
    LOG.info('[SI] Registry saved: ' + Object.keys(registry||{}).length + ' entries');
  } catch(e) {
    LOG.error('si-save-registry failed:', e.message);
  }
});

ipcMain.handle('si-get-snapshot', () => {
  try {
    const snap = fs.existsSync(SNAP_FILE) ? JSON.parse(fs.readFileSync(SNAP_FILE, 'utf8')) : {};
    LOG.info('[SI] Snapshot loaded: ' + Object.keys(snap).length + ' entries');
    return snap;
  } catch(e) {
    LOG.warn('si-get-snapshot: error', e.message);
    return {};
  }
});

ipcMain.handle('si-save-snapshot', (_, snapshot) => {
  try {
    writeFileAtomic(SNAP_FILE, JSON.stringify(snapshot));
    LOG.info('[SI] Snapshot saved: ' + Object.keys(snapshot||{}).length + ' entries');
  } catch(e) {
    LOG.error('si-save-snapshot failed:', e.message);
  }
});

// community_routes.json: dev = project folder (git can commit it), installed = userData
const COMMUNITY_ROUTES = app.isPackaged
  ? path.join(USER_DATA, 'community_routes.json')
  : path.join(__dirname, 'community_routes.json');

ipcMain.handle('si-export-snapshot', (_, snapshot) => {
  try {
    const routes = Object.values(snapshot);
    writeFileAtomic(COMMUNITY_ROUTES, JSON.stringify({routes}, null, 2));
    LOG.info('[SI] community_routes.json exported: ' + routes.length + ' routes to ' + COMMUNITY_ROUTES);
    return {ok: true, path: COMMUNITY_ROUTES};
  } catch(e) {
    LOG.error('si-export-snapshot failed:', e.message);
    return {ok: false, error: e.message};
  }
});

ipcMain.handle('si-write-community-routes', (_, snapshot) => {
  try {
    const routes = Object.values(snapshot);
    writeFileAtomic(COMMUNITY_ROUTES, JSON.stringify({routes}, null, 2));
    LOG.info('[SI] community_routes.json updated: ' + routes.length + ' routes to ' + COMMUNITY_ROUTES);
    // Auto-publish only makes sense in dev where git is set up
    if (!app.isPackaged) {
      // 'auto' arg makes publish.bat skip its trailing `pause` — spawned hidden with no stdin, a
      // pause would leave a zombie cmd window waiting forever for a keypress nobody can give.
      const pub = spawn('cmd', ['/c', path.join(__dirname, 'publish.bat'), 'auto'], {
        windowsHide: true, shell: false, cwd: __dirname, stdio: 'ignore',
      });
      pub.on('close', code => {
        if (code === 0) LOG.info('[SI] Community routes published to GitHub successfully');
        else LOG.warn('[SI] Community routes publish failed — will retry next refresh');
      });
      pub.on('error', e => LOG.error('[SI] Community routes publish error:', e.message));
    }
    return {ok: true, count: routes.length};
  } catch(e) {
    LOG.error('[SI] si-write-community-routes failed:', e.message);
    return {ok: false, error: e.message};
  }
});

ipcMain.handle('activate-scenery', (_, {dep, arr, depFolder, arrFolder, folders, items, libraryFolder, communityFolder}) => {
  const created = [], skipped = [], errors = [];
  // Preferred: explicit items [{name, rel}] — name = the Community link name, rel = path under the
  // library (rel may be "wrapper/innerPackage" so a wrapped addon links its inner packages directly).
  // Fallbacks: folders[] (name = rel = folder), then the legacy dep/arr pair.
  const list = Array.isArray(items) && items.length
    ? items.map(it => [it.name, it.rel])
    : Array.isArray(folders) && folders.length
      ? folders.map(f => [f, f])
      : [[depFolder, depFolder], [arrFolder, arrFolder]];
  for (const [name, rel] of list) {
    if (!name || !rel) continue;
    const src = path.join(libraryFolder, rel);
    const dest = path.join(communityFolder, name);
    try {
      if (fs.existsSync(dest)) {
        skipped.push(name);
        LOG.info(`[SCENE] junction already exists at ${dest}`);
      } else {
        fs.symlinkSync(src, dest, 'junction');
        created.push(name);
        LOG.info(`[SCENE] junction created ${dest} -> ${src}`);
      }
    } catch(e) {
      errors.push(name + ': ' + e.message);
      LOG.error(`[SCENE] junction failed:`, e.message);
    }
  }
  return {ok: errors.length === 0, created, skipped, errors};
});

ipcMain.handle('deactivate-scenery', (_, {folders, communityFolder}) => {
  const removed = [], errors = [];
  for (const folder of folders) {
    const dest = path.join(communityFolder, folder);
    try {
      if (fs.existsSync(dest)) {
        // Safety: only remove genuine junctions/symlinks — never a real installed folder/file that
        // happens to share the name (same guard as unlink-packages / removeJunctionIfLink).
        if (!fs.lstatSync(dest).isSymbolicLink()) {
          LOG.warn(`[SCENE] refusing to remove non-junction: ${dest}`);
          removed.push(folder);   // not ours to remove — treat as done so the UI unchecks cleanly
          continue;
        }
        fs.unlinkSync(dest);
        removed.push(folder);
        LOG.info(`[SCENE] Junction removed: ${dest}`);
      } else {
        removed.push(folder);
      }
    } catch(e) {
      errors.push(folder + ': ' + e.message);
      LOG.error(`[SCENE] Junction removal failed:`, e.message);
    }
  }
  return {ok: errors.length === 0, removed, errors};
});

// ── PACKAGE ACTIVATION (Aircraft / Util) ─────────────────────────────────────
// Junctions add-on packages into the Community folder on demand. A "package" is
// any folder containing manifest.json (the MSFS signal). A "group" is any folder
// that directly contains >=1 package; activating a group links all its packages
// together (aircraft + liveries + sound = one bundle). Reuses the same junction
// mechanism as scenery activation.
function pkgDefaultRoots(){
  const base = path.join(os.homedir(), 'Documents', 'MSFS');
  return { aircraft: path.join(base, 'Aircraft'), util: path.join(base, 'Util') };
}
function pkgResolveRoot(root, which){
  return (root && root.trim()) ? root.trim() : pkgDefaultRoots()[which];
}
function pkgIsPackageDir(dir){
  try{ return fs.existsSync(path.join(dir, 'manifest.json')); }catch(e){ return false; }
}

ipcMain.handle('pkg-default-roots', () => pkgDefaultRoots());

// Read PMDG/Fenix aircraft versions from the aircraft library (config root or default). Returns a
// per-vendor signature ("pkg:version|pkg:version", sorted) so the maintenance watcher can detect an
// aircraft update. Excludes -liveries packages (liveries hold no WASM, so they don't warrant a clean).
function readAircraftVersions(aircraftRoot){
  const out = { pmdg:null, fenix:null };
  try {
    const dir = pkgResolveRoot(aircraftRoot, 'aircraft');
    if(!fs.existsSync(dir)) return out;
    const pmdg = [], fenix = [];
    for(const g of pkgScanGroups(dir)){
      for(const p of (g.packages||[])){
        const n = (p.name||'').toLowerCase();
        if(n.includes('liveries')) continue;
        const vendor = n.startsWith('pmdg-aircraft-') ? 'pmdg' : n.startsWith('fnx-aircraft-') ? 'fenix' : null;
        if(!vendor) continue;
        let ver = '';
        try { const m = fs.readFileSync(path.join(p.abs,'manifest.json'),'utf8').match(/"package_version"\s*:\s*"([^"]+)"/); ver = m ? m[1] : ''; } catch(_){}
        (vendor==='pmdg'?pmdg:fenix).push(p.name+':'+ver);
      }
    }
    if(pmdg.length)  out.pmdg  = pmdg.sort().join('|');
    if(fenix.length) out.fenix = fenix.sort().join('|');
  } catch(_){}
  return out;
}

// Walk a package root and return its groups (folders directly holding >=1 package).
function pkgScanGroups(dir){
  const groups = [];
  if(!fs.existsSync(dir)) return groups;
  (function walk(d, depth){
    if(depth > 5) return;
    let ents;
    try{ ents = fs.readdirSync(d, {withFileTypes:true}).filter(e=>e.isDirectory()); }catch(e){ return; }
    const packages = [];
    const subdirs = [];
    for(const e of ents){
      const full = path.join(d, e.name);
      if(pkgIsPackageDir(full)) packages.push({name:e.name, abs:full});
      else subdirs.push(full);  // only recurse into non-package folders
    }
    if(packages.length){
      const rel = path.relative(dir, d).split(path.sep).join('/');
      const id = rel || '.';
      groups.push({ id, label: rel ? path.basename(d) : path.basename(dir), parent: id.split('/')[0], packages });
    }
    for(const s of subdirs) walk(s, depth+1);
  })(dir, 0);
  return groups;
}

ipcMain.handle('scan-packages', (_, {root, which}) => {
  const dir = pkgResolveRoot(root, which);
  try{
    if(!fs.existsSync(dir)){ LOG.info('[PKG] root not found:', dir); return {ok:true, root:dir, groups:[]}; }
    const groups = pkgScanGroups(dir);
    LOG.info('[PKG] scan', dir, '→', groups.length, 'group(s)');
    return {ok:true, root:dir, groups};
  }catch(e){ LOG.error('[PKG] scan failed:', e.message); return {ok:false, error:e.message, groups:[]}; }
});

ipcMain.handle('link-packages', (_, {items, communityFolder}) => {
  const created = [], skipped = [], errors = [];
  for(const it of (items||[])){
    const dest = path.join(communityFolder, it.name);
    try{
      if(fs.existsSync(dest)){ skipped.push(it.name); LOG.info('[PKG] link skip (exists):', dest); }
      else{ fs.symlinkSync(it.abs, dest, 'junction'); created.push(it.name); LOG.info('[PKG] linked', dest, '->', it.abs); }
    }catch(e){ errors.push(it.name+': '+e.message); LOG.error('[PKG] link failed:', e.message); }
  }
  return {ok:errors.length===0, created, skipped, errors};
});

ipcMain.handle('unlink-packages', (_, {names, communityFolder}) => {
  const removed = [], skipped = [], errors = [];
  for(const name of (names||[])){
    const dest = path.join(communityFolder, name);
    try{
      if(!fs.existsSync(dest)){ removed.push(name); continue; }
      // Safety: only remove genuine junctions/symlinks — never a real installed folder.
      if(fs.lstatSync(dest).isSymbolicLink()){ fs.unlinkSync(dest); removed.push(name); LOG.info('[PKG] unlinked', dest); }
      else{ skipped.push(name); LOG.warn('[PKG] refusing to remove real folder:', dest); }
    }catch(e){ errors.push(name+': '+e.message); LOG.error('[PKG] unlink failed:', e.message); }
  }
  return {ok:errors.length===0, removed, skipped, errors};
});

// On app close, remove the scenery + aircraft junctions we created and clear their
// checked state, so the next launch starts with both unchecked. Utilities are left
// active (Dean keeps those on permanently); My Airports library is untouched. Runs
// synchronously from the on-disk config (the renderer keeps it current on every
// toggle). Only genuine junctions are removed — never a real installed folder.
function removeJunctionIfLink(dest, tag){
  try{
    if(fs.existsSync(dest) && fs.lstatSync(dest).isSymbolicLink()){
      fs.unlinkSync(dest);
      LOG.info(`[QUIT] ${tag} junction removed: ${dest}`);
    }
  }catch(e){ LOG.warn(`[QUIT] ${tag} unlink failed: ${e.message}`); }
}
function isMsfsRunning(){
  try{
    const cp = require('child_process');
    const r = cp.spawnSync('tasklist', ['/FI','IMAGENAME eq FlightSimulator2024.exe','/NH'],
      {encoding:'utf8', timeout:4000, windowsHide:true});
    return /FlightSimulator2024\.exe/i.test(r.stdout || '');
  }catch(e){ return false; }
}
function isCaptureRunning(){
  try{
    const r = require('child_process').spawnSync('tasklist', ['/FI','IMAGENAME eq perf-engine.exe','/NH'],
      {encoding:'utf8', timeout:4000, windowsHide:true});
    if (/perf-engine\.exe/i.test(r.stdout || '')) return true;
  }catch(e){}
  // Native engine: a detached Electron-as-node process, invisible to an image-name check. It writes
  // its pid to capture_status.json; an alive pid = capture running (stale file after a crash fails
  // the signal-0 probe, so no false positives).
  try{
    const sf = path.join(USER_DATA, 'capture_status.json');
    if (fs.existsSync(sf)) {
      const j = JSON.parse(fs.readFileSync(sf, 'utf8'));
      if (j && j.pid) { try { process.kill(j.pid, 0); return true; } catch(_){} }
    }
  }catch(e){}
  return false;
}
function cleanupActivationsOnQuit(){
  let cfg;
  try{ cfg = JSON.parse(fs.readFileSync(CFG, 'utf8')); }catch(e){ return; }
  // Don't strip add-ons out from under a live or loading sim — the normal workflow is
  // activate → Quick Launch → close ABRP while MSFS loads. Clear only when the sim is off.
  if(isMsfsRunning()){
    LOG.info('[QUIT] MSFS is running — skipping activation cleanup (sim may still need the add-ons)');
    return;
  }
  const community = cfg.communityFolder;
  if(!community) return;
  let changed = false;
  // scenery
  const scenery = cfg.activeJunctions || [];
  for(const folder of scenery) removeJunctionIfLink(path.join(community, folder), 'scenery');
  if(scenery.length){ cfg.activeJunctions = []; changed = true; }
  // aircraft (map active group ids → their package folder names via a fresh scan)
  const aircraft = cfg.aircraftActive || [];
  if(aircraft.length){
    let byId = new Map();
    try{ byId = new Map(pkgScanGroups(pkgResolveRoot(cfg.aircraftFolder, 'aircraft')).map(g => [g.id, g])); }catch(e){}
    for(const id of aircraft){
      const g = byId.get(id);
      if(!g) continue;
      for(const pkg of g.packages) removeJunctionIfLink(path.join(community, pkg.name), 'aircraft');
    }
    cfg.aircraftActive = [];
    changed = true;
  }
  if(changed){
    try{ writeFileAtomic(CFG, JSON.stringify(cfg, null, 2)); LOG.info('[QUIT] cleared scenery + aircraft activations'); }
    catch(e){ LOG.error('[QUIT] config write failed: ' + e.message); }
  }
}
let _cleanupDone = false;
app.on('before-quit', () => { if(_cleanupDone) return; _cleanupDone = true; try{ LiveATC.stop(); }catch(_){} try{ if(overlayWin&&!overlayWin.isDestroyed())overlayWin.destroy(); }catch(_){} cleanupActivationsOnQuit(); });
// When the auto-updater restarts ABRP to install a new version, exit FAST: skip the close-confirm
// dialog and the (slow) activation cleanup so the NSIS installer doesn't catch ABRP still shutting
// down and show "cannot be closed / Retry". The junctions are intentionally left in place — the
// freshly-installed copy relaunches immediately with the same config and cleans them up on the next
// normal close.
app.on('before-quit-for-update', () => { _perfAllowClose = true; _cleanupDone = true; });

// Manually add a utility into the Util library folder: copy a dropped/browsed
// package folder, or extract a downloaded .zip/.rar/.7z, into the Util root. The
// normal scan then picks it up. Reuses the GSX archive extractor.
ipcMain.handle('util-add', (_, {paths, utilFolder}) => {
  const root = pkgResolveRoot(utilFolder, 'util');
  const added = [], skipped = [], errors = [], tmpDirs = [];
  let needTool = false;
  try{ fs.mkdirSync(root, {recursive:true}); }catch(e){}
  for(const p of (paths||[])){
    try{
      const st = fs.statSync(p);
      if(st.isDirectory()){
        const dest = path.join(root, path.basename(p));
        if(fs.existsSync(dest)){ skipped.push(path.basename(p)); continue; }
        fs.cpSync(p, dest, {recursive:true});
        added.push(path.basename(p));
        LOG.info('[PKG] util added (folder):', dest);
      } else if(GSX_ARCHIVE_RE.test(p)){
        const baseName = path.basename(p).replace(/\.(zip|rar|7z)$/i, '');
        const dest = path.join(root, baseName);
        if(fs.existsSync(dest)){ skipped.push(baseName); continue; }
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'utiladd-'));
        tmpDirs.push(tmp);
        const ex = gsxExtractArchive(p, tmp);
        if(!ex.ok){ if(ex.needTool) needTool = true; errors.push(path.basename(p)+(ex.needTool?': no .rar/.7z extractor installed':': extract failed')); continue; }
        fs.cpSync(tmp, dest, {recursive:true});
        added.push(baseName);
        LOG.info('[PKG] util added (archive):', dest);
      } else {
        skipped.push(path.basename(p));
      }
    }catch(e){ errors.push(path.basename(p)+': '+e.message); LOG.error('[PKG] util-add failed:', e.message); }
  }
  for(const t of tmpDirs){ try{ fs.rmSync(t, {recursive:true, force:true}); }catch(e){} }
  return {ok:errors.length===0, added, skipped, errors, needTool};
});

// ── LIVE D-ATIS ───────────────────────────────────────────────────────────────
// US/Pacific (K*, P*) → atis.info JSON (FAA). Everything else → atis.guru SSR HTML.
// Returns a normalized object; interpretation (runway extraction, plain-English) is
// done in the renderer. Never throws — any failure resolves to {ok:true, hasData:false}.
function datisSourceFor(icao){
  const c = (icao||'').trim().toUpperCase()[0];
  return (c === 'K' || c === 'P') ? 'atis.info' : 'atis.guru';
}
function datisGet(url, depth = 0){
  return new Promise(resolve => {
    try{
      const req = https.get(url, {headers:{'User-Agent':'ABRP-RoutePlanner'}}, res => {
        // follow redirects (atis.info → datis.clowd.io etc.) — capped so a redirect loop can't spin forever
        if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
          res.resume();
          if(depth >= 5) return resolve({status:res.statusCode, body:'', error:'too many redirects'});
          return resolve(datisGet(res.headers.location, depth + 1));
        }
        let data = '';
        res.on('data', c => data += c);
        res.on('end', () => resolve({status:res.statusCode, body:data}));
      });
      req.on('error', e => resolve({status:0, body:'', error:e.message}));
      req.setTimeout(8000, () => { req.destroy(); resolve({status:0, body:'', error:'timeout'}); });
    }catch(e){ resolve({status:0, body:'', error:e.message}); }
  });
}
function datisDecodeEntities(s){
  return (s||'')
    .replace(/&#x([0-9a-fA-F]+);/g, (_,h)=>String.fromCharCode(parseInt(h,16)))
    .replace(/&#(\d+);/g, (_,d)=>String.fromCharCode(parseInt(d,10)))
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&nbsp;/g,' ');
}
function datisCleanText(s){
  return datisDecodeEntities(s).replace(/\r/g,'').replace(/[ \t]+\n/g,'\n')
    .replace(/[ \t]{2,}/g,' ').replace(/\n{3,}/g,'\n\n').trim();
}
function datisLetterOf(t){ const m=(t||'').match(/ATIS\s+([A-Z])\b/) || (t||'').match(/INFO\s+([A-Z])\b/); return m?m[1]:null; }
function datisTimeOf(t){ const m=(t||'').match(/\b(\d{3,4}Z)\b/); return m?m[1]:null; }
// atis.info returns el.time as a bare "1856" (no Z); atis.guru's regex time carries the Z.
// Normalize a bare 3-4 digit time to "1856Z" so zuluAgeMin() can read it (age display + the
// stale-D-ATIS wind cross-check both need the Z). Returns null for anything non-bare (e.g. ISO).
function datisTimeNorm(t){ const m=String(t||'').match(/^\s*(\d{3,4})Z?\s*$/); return m?m[1]+'Z':null; }
function parseAtisInfo(body){
  let arr=null, dep=null, combined=null, metar=null;
  let json; try{ json = JSON.parse(body); }catch(e){ return {hasData:false}; }
  if(!Array.isArray(json) || !json.length) return {hasData:false};
  for(const el of json){
    if(!el || !el.datis) continue;
    const block = {letter: el.code || datisLetterOf(el.datis), time: datisTimeOf(el.datis) || datisTimeNorm(el.time), text: el.datis.trim()};
    const ty = (el.type||'').toLowerCase();
    if(ty === 'arr' || ty === 'arrival') arr = block;
    else if(ty === 'dep' || ty === 'departure') dep = block;
    else combined = block;
  }
  const hasData = !!(arr || dep || combined);
  return {hasData, arr, dep, combined, metar, taf:null};
}
function parseAtisGuru(html){
  let arr=null, dep=null, combined=null, metar=null, taf=null;
  const re = /<div[^>]*class="[^"]*\batis\b[^"]*"[^>]*>([\s\S]*?)<\/div>/gi;
  let m;
  while((m = re.exec(html)) !== null){
    const txt = datisCleanText(m[1]);
    if(!txt) continue;
    const head = txt.slice(0, 40).toUpperCase();
    if(/^METAR\b/.test(head)) { metar = txt; continue; }
    if(/^TAF\b/.test(head))   { taf = txt; continue; }
    if(/NO\s+ATIS/i.test(head) && txt.length < 30) continue;
    const block = {letter: datisLetterOf(txt), time: datisTimeOf(txt), text: txt};
    if(/\bARR\b/.test(head))      arr = block;
    else if(/\bDEP\b/.test(head)) dep = block;
    else                          combined = block;
  }
  const hasData = !!(arr || dep || combined);
  return {hasData, arr, dep, combined, metar, taf};
}
ipcMain.handle('fetch-datis', async (_, {icao}) => {
  const id = (icao||'').trim().toUpperCase();
  const base = {ok:true, icao:id, source:null, hasData:false, arr:null, dep:null, combined:null, metar:null, taf:null, fetchedAt:new Date().toISOString()};
  if(!/^[A-Z0-9]{3,4}$/.test(id)) return base;
  const source = datisSourceFor(id);
  try{
    const url = source === 'atis.info'
      ? `https://atis.info/api/${id}`
      : `https://atis.guru/atis/${id}`;
    const res = await datisGet(url);
    let parsed = (!res || res.status < 200 || res.status >= 400 || !res.body)
      ? {hasData:false}
      : (source === 'atis.info' ? parseAtisInfo(res.body) : parseAtisGuru(res.body));
    // US redundancy: datis.clowd.io fronts the same FAA SWIM feed as atis.info from a different
    // host + same JSON shape — a free resilience fallback when the primary is down or empty.
    if(!parsed.hasData && source === 'atis.info'){
      const res2 = await datisGet(`https://datis.clowd.io/api/${id}`);
      if(res2 && res2.status >= 200 && res2.status < 400 && res2.body){
        const p2 = parseAtisInfo(res2.body);
        if(p2.hasData){ LOG.info(`[DATIS] ${id} via clowd.io fallback: hasData=true`); return {...base, source:'datis.clowd.io', ...p2}; }
      }
    }
    LOG.info(`[DATIS] ${id} via ${source}: hasData=${parsed.hasData}`);
    return {...base, source, ...parsed};
  }catch(e){
    LOG.warn(`[DATIS] ${id} fetch error: ${e.message}`);
    return {...base, source};
  }
});

ipcMain.handle('msfs-detect', () => {
  const home = os.homedir();
  const steamCommunity = path.join(home, 'AppData', 'Roaming', 'Microsoft Flight Simulator 2024', 'Packages', 'Community');
  const storeCommunity = path.join(home, 'AppData', 'Local', 'Packages', 'Microsoft.Limitless_8wekyb3d8bbwe', 'LocalCache', 'Packages', 'Community');
  const defaultSteamExe = 'C:\\Program Files (x86)\\Steam\\steam.exe';
  // edition = which MSFS is actually installed (used e.g. to tag flightsim.to links with base=msfs2024).
  // 2024 wins if both are present; only a POSITIVE 2020-only find reports '2020'.
  const has2020 = fs.existsSync(path.join(home, 'AppData', 'Roaming', 'Microsoft Flight Simulator', 'Packages', 'Community'))
    || fs.existsSync(path.join(home, 'AppData', 'Local', 'Packages', 'Microsoft.FlightSimulator_8wekyb3d8bbwe', 'LocalCache', 'Packages', 'Community'));
  if (fs.existsSync(steamCommunity)) {
    LOG.info('[DETECT] MSFS 2024 Steam detected. Community:', steamCommunity);
    return {version: 'steam', communityFolder: steamCommunity, steamExe: defaultSteamExe, edition: '2024'};
  }
  if (fs.existsSync(storeCommunity)) {
    LOG.info('[DETECT] MSFS 2024 Store detected. Community:', storeCommunity);
    return {version: 'store', communityFolder: storeCommunity, edition: '2024'};
  }
  LOG.info('[DETECT] MSFS 2024 not found at known paths' + (has2020 ? ' (MSFS 2020 present)' : ''));
  return {version: null, communityFolder: null, edition: has2020 ? '2020' : null};
});

ipcMain.handle('launch-msfs', (_, {version, steamExePath}) => {
  try {
    if (version === 'store') {
      // Microsoft Store version — launch via Windows shell protocol (no storefront)
      const child = spawn('explorer.exe', ['shell:AppsFolder\\Microsoft.Limitless_8wekyb3d8bbwe!App'], {
        detached: true, stdio: 'ignore',
      });
      child.unref();
      LOG.info('[LAUNCH] MSFS 2024 Store launched via shell:AppsFolder');
    } else {
      // Steam version — -silent keeps Steam hidden in tray (no window), -FastLaunch skips intro videos
      const steamExe = (steamExePath && steamExePath.trim()) || 'C:\\Program Files (x86)\\Steam\\steam.exe';
      const child = spawn(steamExe, ['-silent', '-applaunch', '2537590', '--', '-FastLaunch'], {
        detached: true, stdio: 'ignore', windowsHide: true,
      });
      child.unref();
      LOG.info('[LAUNCH] MSFS 2024 Steam launched silently via', steamExe);
    }
    return {ok: true};
  } catch(e) {
    LOG.error('[LAUNCH] Failed to launch MSFS:', e.message);
    return {ok: false, error: e.message};
  }
});

ipcMain.handle('get-world-map', () => {
  try {
    const topojson = require('topojson-client');
    const world = require('world-atlas/land-50m.json');
    const W = 720, H = 340;
    const px = lon => (lon + 180) / 360 * W;
    const py = lat => (90 - lat) / 180 * H;
    // ANTIMERIDIAN SPLIT (v6.15.4, Dean 2026-07-28). A ring that wraps past ±180° has consecutive
    // points at lon +179.9 and -179.9, which project to opposite edges (x≈719 and x≈1). Joining them
    // with 'L' streaks a horizontal bar across the ENTIRE map: 8 such segments existed — Russia/
    // Chukotka (y≈35-47, the two visible streaks), Fiji (y≈201, a full 720px bar) and Antarctica
    // (y≈329-340). When a step jumps more than half the map width it isn't a real coastline edge, so
    // close the subpath and start a new one. NOTE: W/H and the viewBox are deliberately untouched —
    // the dots in renderDashMap() project with the SAME W=720/H=340 math and must never desync.
    const ringsToPath = rings =>
      rings.map(ring => {
        let d = '', prevX = null;
        for (const [lon, lat] of ring) {
          const x = px(lon), y = py(lat);
          if (prevX === null || Math.abs(x - prevX) > W / 2) {
            if (prevX !== null) d += 'Z';                 // close the piece we were drawing
            d += 'M' + x.toFixed(1) + ',' + y.toFixed(1);
          } else d += 'L' + x.toFixed(1) + ',' + y.toFixed(1);
          prevX = x;
        }
        return d ? d + 'Z' : '';
      }).join('');
    const land = topojson.feature(world, world.objects.land);
    const paths = [];
    const processGeom = g => {
      if (!g) return;
      if (g.type === 'Polygon') paths.push(ringsToPath(g.coordinates));
      else if (g.type === 'MultiPolygon') g.coordinates.forEach(poly => paths.push(ringsToPath(poly)));
    };
    if (land.type === 'FeatureCollection') land.features.forEach(f => processGeom(f.geometry));
    else if (land.type === 'Feature') processGeom(land.geometry);
    LOG.info('get-world-map: generated ' + paths.length + ' path(s)');
    return paths;
  } catch (e) {
    LOG.error('get-world-map failed: ' + e.message);
    return null;
  }
});

ipcMain.handle('browse-file', async () => {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [
      {name: 'Programs & Scripts', extensions: ['exe', 'bat', 'cmd']},
      {name: 'All Files', extensions: ['*']},
    ],
  });
  return res.canceled ? null : {filePath: res.filePaths[0]};
});

ipcMain.handle('launch-app', (_, {path: appPath}) => {
  try {
    const isBat = /\.(bat|cmd)$/i.test(appPath || '');
    // Windows can't spawn a .bat/.cmd directly — it must run through cmd.exe.
    // Run it from its own folder (batch files often assume relative paths) and
    // hide the console window so it doesn't flash on screen.
    const child = isBat
      ? spawn('cmd', ['/c', appPath], {detached: true, stdio: 'ignore', cwd: path.dirname(appPath), windowsHide: true})
      : spawn(appPath, [], {detached: true, stdio: 'ignore'});
    child.unref();
    LOG.info('[LAUNCH] App launched:', appPath, isBat ? '(via cmd)' : '');
    return {ok: true};
  } catch(e) {
    LOG.error('[LAUNCH] Failed to launch app:', e.message);
    return {ok: false, error: e.message};
  }
});

ipcMain.handle('get-log-path',()=>LOG_PATH);

// ── PERFORMANCE LOGS ──────────────────────────────────────────────────────────
// Read the perf engine's flight index from the writable data home (userData\Sessions),
// enriching each flight with a file:// URL (for embedding the report) and an absolute
// path (for opening it in the default browser). The engine writes here because ABRP
// launches it with MSFS_PERF_ROOT pointed at userData (see perf/README.md).
ipcMain.handle('perf-list-sessions', () => {
  try {
    const { pathToFileURL } = require('url');
    const sdir    = path.join(USER_DATA, 'Sessions');
    const idxPath = path.join(sdir, 'index.json');
    if (!fs.existsSync(idxPath)) return { ok:false, reason:'no-data', sessions:[] };
    const data = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    const sessions = (data.sessions || []).map(s => {
      const folder = (s.folder || '').replace(/\//g, '\\');
      const rp  = path.join(sdir, folder, 'report.html');
      const has = !!folder && fs.existsSync(rp);
      return Object.assign({}, s, {
        reportUrl:  has ? pathToFileURL(rp).href : null,
        reportPath: has ? rp : null,
      });
    });
    const cr    = path.join(sdir, 'combined_report.html');
    const crHas = fs.existsSync(cr);
    LOG.info('perf-list-sessions: ' + sessions.length + ' flight(s) from ' + sdir);
    return {
      ok: true, sessions,
      combinedUrl:  crHas ? pathToFileURL(cr).href : null,
      combinedPath: crHas ? cr : null,
      lastUpdated:  data.last_updated || null,
    };
  } catch (e) {
    LOG.error('perf-list-sessions failed: ' + e.message);
    return { ok:false, reason:e.message, sessions:[] };
  }
});

// Per-flight metrics for the Compare view. Reads index.json + each flight's summary.json (avg_vram
// lives there; index.json only carries peak). Reads only the tiny summaries, so Compare survives raw
// frametimes.csv cleanup. Returns a flat array of flight metric records.
// v6.12.0 Settings A/B: watch metadata + per-flight subset come from the ONE module (no label maps
// re-declared in the renderer). Lazy require — perfDir() is hoisted, resolved at call time.
function _gfxWatchMod(){ return require(path.join(perfDir(), 'native', 'gfx_watch.js')); }
ipcMain.handle('perf-compare-data', () => {
  try {
    const sdir    = path.join(USER_DATA, 'Sessions');
    const idxPath = path.join(sdir, 'index.json');
    if (!fs.existsSync(idxPath)) return { ok:false, reason:'no-data', flights:[] };
    const data = JSON.parse(fs.readFileSync(idxPath, 'utf8'));
    const flights = (data.sessions || []).map(s => {
      let avg_vram_mb = null, spike_count = null, total_vram_mb = null, perceptible_count = null, duration_seconds = null;
      // v6.10.7: when the summary was trimmed by a GROUND-TRUTH anchor (parking brake / last-movement,
      // v6.6.1/v6.9.5), its max/spike/perceptible are more accurate than the sidecar's teardown recompute
      // — so the sidecar must NOT override them (it would slightly under-trim vs the brake/movement cut).
      let groundTruthTrim = false;
      // v6.3.8 5-phase model: departing + arrival taxi (each p99/stutter/peak-VRAM). New flights carry
      // it in summary.smoothness.phases; the 24 pre-v6.3.8 flights carry it in the phases_ext.json
      // sidecar (originals untouched). Also dep/arr ICAO + 3rd-party scenery flags.
      let dep_taxi = null, arr_taxi = null, dep_icao = s.dep_icao || null, arr_icao = s.arr_icao || null,
          dep_scenery = s.dep_scenery ?? null, arr_scenery = s.arr_scenery ?? null;
      // v6.11.0: AutoFPS effective-TLOD trace stats (from the autofps_trace.json sidecar) + VATSIM
      // 40nm traffic peak/avg (from summary settings) — the envelope card + traffic analytics inputs.
      let afps = null, traffic_peak = null, traffic_avg = null;
      // v6.12.0 Settings A/B: curated graphics-watch values + fingerprint + AutoFPS cfg snapshot +
      // GPU/CPU balance (avg busy ms + gpu-bound % — computed by stats.js since day one, never surfaced).
      let gfx = null, gfx_fp = s.gfx_fp || null, autofps_cfg = null,
          avg_gpu_busy = null, avg_cpu_busy = null, gpu_bound = null;
      // v6.15.1: a flight the sim exited mid-air (airborne, never landed) is tagged
      // settings.notes='mid-flight session' by the engine — auto-exclude it from all analysis.
      let midflight = false;
      // v6.12.1: periodic-stutter classification (engine-overload signature) — summary for new
      // flights, phases_ext sidecar for backfilled old ones.
      let periodic = null;
      try {
        const folder = (s.folder || '').replace(/\//g, '\\');
        const fdir = folder ? path.join(sdir, folder) : null;
        const sp = fdir ? path.join(fdir, 'summary.json') : null;
        if (fdir && s.autofps_active) { try {
          const tr = JSON.parse(fs.readFileSync(path.join(fdir, 'autofps_trace.json'), 'utf8'));
          if (tr && tr.stats) afps = tr.stats;
        } catch(_){} }
        if (sp && fs.existsSync(sp)) {
          const sj = JSON.parse(fs.readFileSync(sp, 'utf8'));
          if (sj && sj.settings && sj.settings.vatsim_traffic_peak != null) { traffic_peak = sj.settings.vatsim_traffic_peak; traffic_avg = sj.settings.vatsim_traffic_avg ?? null; }
          if (sj && sj.vram && sj.vram.avg_vram_mb != null) avg_vram_mb = sj.vram.avg_vram_mb;
          if (sj && sj.vram && sj.vram.total_vram_mb != null) total_vram_mb = sj.vram.total_vram_mb;
          if (sj && sj.smoothness && sj.smoothness.spike_count != null) spike_count = sj.smoothness.spike_count;
          if (sj && sj.smoothness && sj.smoothness.perceptible_count != null) perceptible_count = sj.smoothness.perceptible_count;
          if (sj && sj.smoothness && sj.smoothness.duration_seconds != null) duration_seconds = sj.smoothness.duration_seconds;
          const tm = sj && sj.smoothness && sj.smoothness.trim_method;
          if (tm === 'brake' || tm === 'movement') groundTruthTrim = true;
          if (sj && sj.settings) {
            if (/mid-flight session/i.test(sj.settings.notes || '')) midflight = true;
            if (!gfx_fp && sj.settings.gfx_fp) gfx_fp = sj.settings.gfx_fp;
            if (sj.settings.graphics) { try { gfx = _gfxWatchMod().watchValues(sj.settings.graphics); } catch(_){} }
            if (sj.settings.autofps_cfg) autofps_cfg = sj.settings.autofps_cfg;
          }
          if (sj && sj.smoothness) {
            avg_gpu_busy = sj.smoothness.avg_gpu_busy_ms ?? null;
            avg_cpu_busy = sj.smoothness.avg_cpu_busy_ms ?? null;
            gpu_bound    = sj.smoothness.gpu_bound_pct ?? null;
            if (sj.smoothness.periodic_stutter !== undefined) periodic = sj.smoothness.periodic_stutter;
          }
          const ph = sj && sj.smoothness && sj.smoothness.phases;
          if (ph && (ph.dep_taxi || ph.arr_taxi)) { dep_taxi = ph.dep_taxi || null; arr_taxi = ph.arr_taxi || null; }
        }
        // Sidecar: the 5-phase split for pre-v6.3.8 flights, AND (v6.6) the teardown-corrected
        // max/spike/perceptible + re-trimmed phases (trim_v:'teardown') — which SUPERSEDE the summary's
        // shutdown-inflated values so the Compare/felt-stutter surfaces show the real numbers.
        if (fdir) {
          const ext = path.join(fdir, 'phases_ext.json');
          if (fs.existsSync(ext)) { try {
            const e = JSON.parse(fs.readFileSync(ext, 'utf8')); const p = e.phases || {};
            // teardown recompute corrects OLD flights, but never overrides a brake/movement-trimmed summary
            const corrected = e.trim_v === 'teardown' && !groundTruthTrim;
            if ((corrected || (!dep_taxi && !arr_taxi)) && (p.dep_taxi || p.arr_taxi)) {
              dep_taxi = p.dep_taxi || dep_taxi; arr_taxi = p.arr_taxi || arr_taxi;
            }
            if (dep_icao == null) dep_icao = e.dep_icao || null;
            if (arr_icao == null) arr_icao = e.arr_icao || null;
            if (dep_scenery == null) dep_scenery = e.dep_scenery ?? null;
            if (arr_scenery == null) arr_scenery = e.arr_scenery ?? null;
            // teardown-corrected metrics win over the shutdown-inflated summary values
            if (corrected && e.spike_count != null) spike_count = e.spike_count;
            if (e.perceptible_count != null && (corrected || perceptible_count == null)) perceptible_count = e.perceptible_count;
            if (periodic === null && e.periodic_stutter !== undefined) periodic = e.periodic_stutter;
          } catch(_){} }
        }
      } catch(_){}
      const pv = (o, k) => (o && o[k] != null) ? o[k] : null;
      // "felt stutter" rate: big (>100ms) hitches per rendered hour — the ones Dean actually notices
      const felt_stutter_hr = (perceptible_count != null && duration_seconds) ? perceptible_count / (duration_seconds / 3600) : null;
      return {
        session_id: s.session_id || null, aircraft: s.aircraft || null, timestamp: s.timestamp || null,
        tlod: s.tlod ?? null, olod: s.olod ?? null,
        sim_version: s.sim_version || null, driver_version: s.driver_version || null,
        p99_ft_ms: s.p99_ft_ms ?? null, stutter_pct: s.stutter_pct ?? null,
        consistency_pct: s.consistency_pct ?? null, peak_vram_mb: s.peak_vram_mb ?? null,
        avg_vram_mb, spike_count, total_vram_mb, perceptible_count, felt_stutter_hr,
        dep_taxi_p99: pv(dep_taxi,'p99_ft'), dep_taxi_stutter: pv(dep_taxi,'stutter_pct'), dep_taxi_vram: pv(dep_taxi,'vram_peak'),
        arr_taxi_p99: pv(arr_taxi,'p99_ft'), arr_taxi_stutter: pv(arr_taxi,'stutter_pct'), arr_taxi_vram: pv(arr_taxi,'vram_peak'),
        dep_icao, arr_icao, dep_scenery, arr_scenery,
        experiment: s.experiment || null, autofps_active: s.autofps_active || null,
        // v6.11.0: effective TLOD the AutoFPS flight ACTUALLY ran (null = no trace recovered) + traffic
        autofps_tlod_med: pv(afps,'tlod_med'), autofps_tlod_p90: pv(afps,'tlod_p90'),
        autofps_tlod_max: pv(afps,'tlod_max'), autofps_at_cap_pct: pv(afps,'pct_at_cap'),
        vatsim_traffic_peak: traffic_peak, vatsim_traffic_avg: traffic_avg,
        // flight-context (v6.9.0): 'vatsim' / 'batc' / 'vatsim+batc' / 'offline' (all pre-tag flights
        // were offline — the two known VATSIM flights are backfilled). autofps_mode = readable Compare
        // group labels for the AutoFPS dimension.
        online_traffic: s.online_traffic || 'offline',
        autofps_mode: s.autofps_active ? 'autofps' : 'fixed tlod',
        // v6.12.0 Settings A/B: watched-settings values + fingerprint (null = flight predates the
        // snapshot), AutoFPS TLOD envelope, and the GPU/CPU balance trio (retroactive — from summary).
        gfx, gfx_fp, autofps_cfg,
        avg_gpu_busy_ms: avg_gpu_busy, avg_cpu_busy_ms: avg_cpu_busy, gpu_bound_pct: gpu_bound,
        // v6.12.1: periodic-stutter classification — episodes of engine-overload cadence vs one-off hitches
        periodic_episodes: (periodic && periodic.episodes) ? periodic.episodes.length : (periodic ? 0 : null),
        periodic_spikes: periodic ? (periodic.spikes_periodic ?? 0) : null,
        excluded: s.excluded || midflight || null,   // v6.15.1: auto-exclude mid-flight sim exits
        midflight: midflight || null,
        route: s.route || null
      };
    });
    let gfxWatch = null; try { gfxWatch = _gfxWatchMod().watchMeta(); } catch(_){}
    return { ok:true, flights, gfxWatch };
  } catch (e) {
    LOG.error('perf-compare-data failed: ' + e.message);
    return { ok:false, reason:e.message, flights:[] };
  }
});
ipcMain.handle('perf-open-path', (_, p) => {
  try { if (p) shell.openPath(p); return { ok:true }; }
  catch (e) { return { ok:false, error:e.message }; }
});

// List running apps that have a launchable path (same idea as the old list_running_apps.bat),
// for the "Apps to close during flight" picker. Protected system processes have no Path and
// are filtered out automatically.
ipcMain.handle('list-running-apps', () => new Promise((resolve) => {
  try {
    const ps = spawn('powershell', ['-NoProfile','-NonInteractive','-Command',
      "Get-Process | Where-Object {$_.Path} | Select-Object Name,Path | Sort-Object Name -Unique | ConvertTo-Json -Compress"],
      { windowsHide:true });
    let out = '';
    ps.stdout.on('data', d => out += d);
    ps.on('close', () => {
      try {
        let arr = JSON.parse(out || '[]');
        if (!Array.isArray(arr)) arr = [arr];
        resolve({ ok:true, apps: arr.filter(a=>a&&a.Name).map(a => ({ name:a.Name, path:a.Path })) });
      } catch (e) { resolve({ ok:false, error:'parse failed', apps:[] }); }
    });
    ps.on('error', e => resolve({ ok:false, error:e.message, apps:[] }));
  } catch (e) { resolve({ ok:false, error:e.message, apps:[] }); }
}));

// ── FLIGHT APP CLOSE/REOPEN (Phase 3) ─────────────────────────────────────────
// ABRP stays open through the flight, so ABRP closes the chosen apps before a capture and
// reopens them once the sim closes (watched here). The reopen list persists to disk so a
// catch-up on next launch can recover if ABRP/sim ended unexpectedly.
const FLIGHT_STATE = () => path.join(USER_DATA, 'flight_closed_apps.json');
let _flightReopenPending = false;
let _flightWatch = null;
function startFlightWatch(){
  if (_flightWatch) return;
  let sawSim = false; try { sawSim = isMsfsRunning(); } catch(_){}
  _flightWatch = setInterval(() => {
    let up = false; try { up = isMsfsRunning(); } catch(_){}
    if (up) { sawSim = true; return; }
    if (sawSim && !up) {
      clearInterval(_flightWatch); _flightWatch = null;
      if (_flightReopenPending) { _flightReopenPending = false; flightReopenApps(); }
    }
  }, 6000);
}
function flightReopenApps(){
  try {
    let killAfter = [];
    let compFolders = [];
    try { const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      killAfter = (c.flightCloseApps||[]).filter(a=>a&&a.enabled!==false&&a.mode==='kill-after').map(a=>a.name);
      // Companion apps flagged "close when the sim closes" (Navigraph, vPilot, …) get killed here too.
      const comps = (c.quickLaunchApps||[]).filter(a=>a&&a.closeOnSimExit&&a.name).map(a=>a.name);
      killAfter = [...new Set([...killAfter, ...comps])];
      // Multi-process companions can't be closed by a single process name. SayIntentions is the case
      // that exposed it (Dean 2026-08-23): the entry points at SayIntentionsUpdater3.exe — the updater,
      // which runs once at launch and has EXITED by sim-close — while the app persists as a different
      // exe (SayIntentionsAI.exe) plus children (si_sidecar/si_skynet/si_dispatcher). Killing the one
      // listed name closes nothing. So ALSO collect each closeOnSimExit companion's install folder and
      // kill every process running from under it. Fully general — the app's own path defines the folder,
      // no per-app names hardcoded (rule #3).
      compFolders = (c.quickLaunchApps||[]).filter(a=>a&&a.closeOnSimExit&&a.path)
        .map(a=>{ try { return path.dirname(a.path); } catch(_){ return null; } })
        .filter(Boolean);
    } catch(_){}
    const sf = FLIGHT_STATE();
    // Node owns the data: read + parse the state file here (Node's JSON is reliable across any
    // Windows PowerShell version — 5.1's `@(... | ConvertFrom-Json)` collapses an N-element array
    // to 1, which silently broke the reopen before). Embed the paths as a PowerShell array literal,
    // the same way the kill list is passed.
    let paths = [];
    try { const raw = fs.readFileSync(sf, 'utf8'); const j = JSON.parse(raw); if (Array.isArray(j)) paths = j.filter(Boolean); } catch(_){}
    const killPs  = killAfter.map(n=>`'${String(n).replace(/'/g,"''")}'`).join(',');
    const pathsPs = paths.map(p=>`'${String(p).replace(/'/g,"''")}'`).join(',');
    const dirsPs  = compFolders.map(f=>`'${String(f).replace(/'/g,"''")}'`).join(',');
    // PowerShell only does the OS actions: kill the kill-after apps, then for each path skip if it's
    // already running, relaunch via a matching Startup shortcut (the *arr suite / SABnzbd) else plain
    // exe launch (Plex, qbPortWeaver). Per-app outcome logged so any failure names the exact app.
    const ps = spawn('powershell', ['-NoProfile','-NonInteractive','-Command',
      `$kill=@(${killPs}); foreach($n in $kill){ Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
       $killDirs=@(${dirsPs})
       if($killDirs.Count -gt 0){
         Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object { $_.ExecutablePath } | ForEach-Object {
           $ep=$_.ExecutablePath.ToLower()
           foreach($d in $killDirs){ if($ep.StartsWith(($d.ToLower()+'\'))){ try{ Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }catch{}; break } } } }
       $paths=@(${pathsPs})
       $reopened=0; $log=@()
       $running=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {$_.ExecutablePath} | ForEach-Object { $_.ExecutablePath.ToLower() })
       $dirs=@("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup","$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup")
       $sh=New-Object -ComObject WScript.Shell; $byPath=@{}; $byName=@{}
       foreach($d in $dirs){ if(Test-Path $d){ Get-ChildItem $d -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
         try{ $lnk=$sh.CreateShortcut($_.FullName); $t=$lnk.TargetPath; if($t){ $k=$t.ToLower();
           if(-not $byPath.ContainsKey($k)){ $byPath[$k]=@() }
           $byPath[$k]=@($byPath[$k]) + $_.FullName
           $bn=[System.IO.Path]::GetFileName($t).ToLower(); if(-not $byName.ContainsKey($bn)){ $byName[$bn]=$_.FullName } } }catch{} } } }
       foreach($p in $paths){
         $nm=[System.IO.Path]::GetFileName($p)
         if(-not (Test-Path -LiteralPath $p)){ $log+=('MISSING:'+$nm); continue }
         if($running -contains $p.ToLower()){ $log+=('RUNNING:'+$nm); continue }
         $bn=[System.IO.Path]::GetFileName($p).ToLower()
         $lnks = if($byPath.ContainsKey($p.ToLower())){ @($byPath[$p.ToLower()]) } elseif($byName.ContainsKey($bn)){ @($byName[$bn]) } else { @() }
         $m=''
         if($lnks.Count -gt 0){ $c2=0; foreach($l in $lnks){ try{ Start-Process -FilePath $l; $c2++ }catch{} }; if($c2 -gt 0){ $m=('shortcut x'+$c2); $reopened+=$c2 } }
         if(-not $m){ try{ Start-Process -FilePath $p; $m='path'; $reopened++ }catch{ $log+=('ERR:'+$nm) } }
         if($m){ $log+=('OK['+$m+']:'+$nm) }
       }
       Write-Output ('REOPENED ' + $reopened + ' / killed ' + @(${killPs}).Count + ' | ' + ($log -join '; '))`],
      { windowsHide:true });
    let rout=''; ps.stdout.on('data',d=>rout+=d);
    ps.on('close', () => { LOG.info('[FLIGHT] reopen: ' + rout.trim()); try{ fs.unlinkSync(sf); }catch(_){} });
    ps.on('error', e => { try{LOG.warn('[FLIGHT] reopen failed: '+e.message);}catch(_){} });
  } catch (e) { try{LOG.warn('[FLIGHT] reopen error: '+e.message);}catch(_){} }
}
ipcMain.handle('flight-close-apps', (_, apps) => new Promise((resolve) => {
  try {
    apps = Array.isArray(apps) ? apps.filter(a=>a&&a.enabled!==false&&a.name) : [];
    const closeNow = apps.filter(a=>a.mode==='close-reopen'||a.mode==='close-only').map(a=>a.name);
    const reopen   = apps.filter(a=>a.mode==='close-reopen').map(a=>String(a.name).toLowerCase());
    const hasKill  = apps.some(a=>a.mode==='kill-after');
    if (!closeNow.length) { _flightReopenPending = hasKill; if (hasKill) startFlightWatch(); resolve({ ok:true, closed:0 }); return; }
    const namesPs  = closeNow.map(n=>`'${String(n).replace(/'/g,"''")}'`).join(',');
    const reopenPs = reopen.map(n=>`'${String(n).replace(/'/g,"''")}'`).join(',');
    // PowerShell does the OS work only: for each close-reopen app, emit its exe path to stdout
    // (RPATH|<path>), then stop every targeted process. Node parses stdout and writes the state file
    // itself — no PowerShell-side JSON/file round-trip (that was the 5.1 read-back bug).
    const ps = spawn('powershell', ['-NoProfile','-NonInteractive','-Command',
      `$names=@(${namesPs}); $reopen=@(${reopenPs});
       foreach($n in $names){ $procs=Get-Process -Name $n -ErrorAction SilentlyContinue;
         if($procs){
           if($reopen -contains $n.ToLower()){
             foreach($pr in $procs){
               $ep=$null
               try{ $ci=Get-CimInstance Win32_Process -Filter ("ProcessId="+$pr.Id) -ErrorAction SilentlyContinue; if($ci){ $ep=$ci.ExecutablePath } }catch{}
               if(-not $ep){ try{ $ep=$pr.Path }catch{} }
               if($ep){ Write-Output ('RPATH|'+$ep) }
             }
           }
           $procs | Stop-Process -Force -ErrorAction SilentlyContinue } }`],
      { windowsHide:true });
    let cout=''; ps.stdout.on('data',d=>cout+=d);
    ps.on('close', () => {
      const captured = [...new Set(cout.split(/\r?\n/).filter(l=>l.indexOf('RPATH|')===0).map(l=>l.slice(6).trim()).filter(Boolean))];
      // MERGE with any existing reopen list — re-arming (apps already closed → captured 0) must never
      // clobber the real list the first close saved. Union preserves it and absorbs new closes too.
      let existing = [];
      try { const j = JSON.parse(fs.readFileSync(FLIGHT_STATE(),'utf8')); if (Array.isArray(j)) existing = j.filter(Boolean); } catch(_){}
      const merged = [...new Set([...existing, ...captured])];
      try { fs.writeFileSync(FLIGHT_STATE(), JSON.stringify(merged)); } catch(e){ try{LOG.warn('[FLIGHT] state write failed: '+e.message);}catch(_){} }
      LOG.info('[FLIGHT] closed: '+closeNow.join(', ')+' | SAVED '+captured.length+' new (reopen list now '+merged.length+')');
      _flightReopenPending = true; startFlightWatch();
      resolve({ ok:true, closed:closeNow.length });
    });
    ps.on('error', e => resolve({ ok:false, error:e.message }));
  } catch (e) { resolve({ ok:false, error:e.message }); }
}));

// Arm the sim-close watcher for "close on sim exit" companions on a plain Quick Launch (Launch +
// Capture already arms it via flight-close-apps). On sim-close, flightReopenApps kills the flagged
// companions (it reopens nothing if no apps were closed).
ipcMain.handle('flight-watch-companions', () => {
  try { _flightReopenPending = true; startFlightWatch(); return { ok:true }; }
  catch (e) { return { ok:false, error:e.message }; }
});

// MSFS shader-cache cleaner (ported from Clear_MSFS2024_ShaderCache.bat). Clears the CONTENTS of the
// 7 cache locations (keeps the folders); caches regenerate. Hard-guards on any MSFS process running.
// Destructive — the renderer MUST confirm first. Manual pre/post steps (disable+re-enable NVIDIA
// shader cache, reboot) are surfaced as on-screen notes, not automated.
ipcMain.handle('clear-shader-cache', () => new Promise((resolve) => {
  try {
    const cp = require('child_process');
    const running = [];
    for (const pn of ['FlightSimulator2024.exe','sunrisex64_steam_pcr.exe','kittyhawkx64.exe']) {
      try { const r = cp.spawnSync('tasklist',['/FI','IMAGENAME eq '+pn,'/NH'],{encoding:'utf8',timeout:6000,windowsHide:true});
        if ((r.stdout||'').toLowerCase().includes(pn.toLowerCase())) running.push(pn); } catch(_){}
    }
    if (running.length) { resolve({ ok:false, blocked:true, running }); return; }
    const ps = `$cleared=@(); $skipped=@()
$targets=@("$env:LOCALAPPDATA\\D3DSCache","$env:APPDATA\\Microsoft Flight Simulator 2024\\SceneCache","$env:APPDATA\\Microsoft Flight Simulator 2024\\cache")
# NVIDIA GPU caches scatter across several roots depending on driver version: Local\\NVIDIA,
# Local\\NVIDIA Corporation (NV_Cache), Roaming\\NVIDIA (ComputeCache), and LocalLow\\NVIDIA\\
# PerDriverVersion (DXCache — the big one). Sweep them ALL for the known cache folder names.
$nvRoots=@("$env:LOCALAPPDATA\\NVIDIA","$env:LOCALAPPDATA\\NVIDIA Corporation","$env:APPDATA\\NVIDIA",(Join-Path $env:USERPROFILE 'AppData\\LocalLow\\NVIDIA'))
foreach($root in $nvRoots){ if(Test-Path -LiteralPath $root){ Get-ChildItem -LiteralPath $root -Recurse -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^(DXCache|GLCache|ComputeCache|NV_Cache)$' } | ForEach-Object { $targets+=$_.FullName } } }
$targets=@($targets | Select-Object -Unique)
foreach($t in $targets){ if(Test-Path -LiteralPath $t){ try{ Get-ChildItem -LiteralPath $t -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; $cleared+=$t }catch{ $skipped+=$t } } else { $skipped+=$t } }
$steamRoots=@("C:\\Program Files (x86)\\Steam","C:\\Program Files\\Steam","D:\\Steam","D:\\SteamLibrary","E:\\Steam","E:\\SteamLibrary")
$sFound=$false
foreach($r in $steamRoots){ $sp=Join-Path $r "steamapps\\shadercache\\2537590"; if(Test-Path -LiteralPath $sp){ try{ Get-ChildItem -LiteralPath $sp -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue; $cleared+=$sp; $sFound=$true }catch{} } }
if(-not $sFound){ $skipped+="Steam shadercache 2537590 (not at common paths)" }
foreach($c in $cleared){ Write-Output ("OK|"+$c) }
foreach($s in $skipped){ Write-Output ("SKIP|"+$s) }`;
    const proc = spawn('powershell',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true});
    let out=''; proc.stdout.on('data',d=>out+=d); proc.stderr.on('data',d=>out+=d);
    proc.on('close', () => {
      const lines = out.split(/\r?\n/);
      const cleared = lines.filter(l=>l.indexOf('OK|')===0).map(l=>l.slice(3));
      const skipped = lines.filter(l=>l.indexOf('SKIP|')===0).map(l=>l.slice(5));
      LOG.info('[CACHE] shader cache cleared '+cleared.length+' / skipped '+skipped.length);
      resolve({ ok:true, cleared, skipped });
    });
    proc.on('error', e => resolve({ ok:false, error:e.message }));
  } catch (e) { resolve({ ok:false, error:e.message }); }
}));

// Per-aircraft WASM cache cleaner (PMDG / Fenix). Deletes the COMPILED WASM modules so MSFS rebuilds
// them fresh (fixes stale-cache CTDs / "orange screen" after a Sim Update or an aircraft update), but
// PRESERVES each aircraft's "work" subfolder — that holds PMDG/Fenix saved state (panel states, options,
// airframe hours), which is NOT cache. Hard-guards on MSFS running. Renderer MUST confirm.
ipcMain.handle('clear-wasm-cache', (_, vendor) => new Promise((resolve) => {
  try {
    const map = { pmdg:'pmdg-aircraft-*', fenix:'fnx-aircraft-*' };
    const pattern = map[vendor];
    if (!pattern) { resolve({ ok:false, error:'unknown vendor' }); return; }
    const cp = require('child_process');
    const running = [];
    for (const pn of ['FlightSimulator2024.exe','sunrisex64_steam_pcr.exe','kittyhawkx64.exe']) {
      try { const r = cp.spawnSync('tasklist',['/FI','IMAGENAME eq '+pn,'/NH'],{encoding:'utf8',timeout:6000,windowsHide:true});
        if ((r.stdout||'').toLowerCase().includes(pn.toLowerCase())) running.push(pn); } catch(_){}
    }
    if (running.length) { resolve({ ok:false, blocked:true, running }); return; }
    const ps = `$wasm="$env:APPDATA\\Microsoft Flight Simulator 2024\\WASM"
foreach($ver in 'MSFS2020','MSFS2024'){ $base=Join-Path $wasm $ver
  if(Test-Path -LiteralPath $base){ Get-ChildItem -LiteralPath $base -Directory -Filter '${pattern}' -ErrorAction SilentlyContinue | ForEach-Object { $a=$_.FullName
    Get-ChildItem -LiteralPath $a -File -Force -ErrorAction SilentlyContinue | Remove-Item -Force -ErrorAction SilentlyContinue
    Get-ChildItem -LiteralPath $a -Directory -Force -ErrorAction SilentlyContinue | Where-Object { $_.Name -ne 'work' } | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output ('CLEARED|'+$_.Name); if(Test-Path -LiteralPath (Join-Path $a 'work')){ Write-Output ('KEPT|'+$_.Name) } } } }`;
    const proc = spawn('powershell',['-NoProfile','-NonInteractive','-Command',ps],{windowsHide:true});
    let out=''; proc.stdout.on('data',d=>out+=d); proc.stderr.on('data',d=>out+=d);
    proc.on('close', () => {
      const lines = out.split(/\r?\n/);
      const cleared = lines.filter(l=>l.indexOf('CLEARED|')===0).map(l=>l.slice(8));
      const kept    = lines.filter(l=>l.indexOf('KEPT|')===0).map(l=>l.slice(5));
      LOG.info('[WASM] '+vendor+' cleared '+cleared.length+' module folder(s), preserved '+kept.length+' work folder(s)');
      resolve({ ok:true, vendor, cleared, kept });
    });
    proc.on('error', e => resolve({ ok:false, error:e.message }));
  } catch (e) { resolve({ ok:false, error:e.message }); }
}));

// Maintenance version watcher inputs: current GPU driver (nvidia-smi) + MSFS Steam build id (changes
// on every sim update). The renderer compares these to the last-seen values it has stored and prompts
// to clear the right caches when either changed. Read-only; never throws.
ipcMain.handle('get-maintenance-versions', (_, aircraftRoot) => {
  let driver = null, simBuild = null;
  try {
    const r = require('child_process').spawnSync('nvidia-smi', ['--query-gpu=driver_version','--format=csv,noheader'],
      { encoding:'utf8', timeout:6000, windowsHide:true });
    const d = ((r.stdout||'').split(/\r?\n/)[0] || '').trim();
    if (d) driver = d;
  } catch(_){}
  try {
    const roots = ['C:\\Program Files (x86)\\Steam','C:\\Program Files\\Steam','D:\\Steam','D:\\SteamLibrary','E:\\Steam','E:\\SteamLibrary'];
    for (const root of roots) {
      const acf = root + '\\steamapps\\appmanifest_2537590.acf';
      try { if (fs.existsSync(acf)) { const m = fs.readFileSync(acf,'utf8').match(/"buildid"\s+"(\d+)"/); if (m) { simBuild = m[1]; break; } } } catch(_){}
    }
  } catch(_){}
  const ac = readAircraftVersions(aircraftRoot);
  return { driver, simBuild, pmdg: ac.pmdg, fenix: ac.fenix };
});

// ── SETUP EXPORT / IMPORT (backup & restore) ──────────────────────────────────
// One .zip of the three files that define an ABRP install: config.json (all settings) +
// routeRegistry.json + routeSnapshot.json. Flight logs (Sessions, GBs) are deliberately excluded.
// Import validates first, backs up the current files, then swaps in — reload finishes it.
const SETUP_FILES = ['config.json','routeRegistry.json','routeSnapshot.json','lab_state.json'];
function psq(s){ return `'${String(s).replace(/'/g,"''")}'`; }
ipcMain.handle('setup-export', async () => {
  try {
    const d = new Date(), p2 = n => String(n).padStart(2,'0');
    const defName = `abrp_setup_backup_${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}.zip`;
    const r = await dialog.showSaveDialog(win, { title:'Export ABRP setup', defaultPath: defName,
      filters:[{name:'Zip archive', extensions:['zip']}] });
    if (r.canceled || !r.filePath) return { ok:false, canceled:true };
    const have = SETUP_FILES.map(f => path.join(USER_DATA, f)).filter(p => fs.existsSync(p));
    if (!have.length) return { ok:false, error:'nothing to export' };
    const cp = require('child_process');
    const list = have.map(psq).join(',');
    const res = cp.spawnSync('powershell', ['-NoProfile','-NonInteractive','-Command',
      `Compress-Archive -LiteralPath ${list} -DestinationPath ${psq(r.filePath)} -Force`],
      { windowsHide:true, timeout:120000, encoding:'utf8' });
    if (res.status !== 0 || !fs.existsSync(r.filePath))
      return { ok:false, error:'zip failed: ' + ((res.stderr||'').trim().slice(0,200) || 'unknown') };
    LOG.info('[SETUP] exported ' + have.length + ' file(s) -> ' + r.filePath);
    return { ok:true, path: r.filePath, files: have.map(p => path.basename(p)) };
  } catch (e) { LOG.error('[SETUP] export failed: ' + e.message); return { ok:false, error:e.message }; }
});
ipcMain.handle('setup-import', async () => {
  try {
    const r = await dialog.showOpenDialog(win, { title:'Import ABRP setup', properties:['openFile'],
      filters:[{name:'ABRP setup backup', extensions:['zip']}] });
    if (r.canceled || !r.filePaths.length) return { ok:false, canceled:true };
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'abrpsetup-'));
    try {
      const cp = require('child_process');
      const ex = cp.spawnSync('powershell', ['-NoProfile','-NonInteractive','-Command',
        `Expand-Archive -LiteralPath ${psq(r.filePaths[0])} -DestinationPath ${psq(tmp)} -Force`],
        { windowsHide:true, timeout:120000 });
      if (ex.status !== 0) return { ok:false, error:'could not open the zip' };
      // validate BEFORE touching anything: config.json must exist and parse
      const newCfg = path.join(tmp, 'config.json');
      if (!fs.existsSync(newCfg)) return { ok:false, error:'not an ABRP setup backup (no config.json inside)' };
      JSON.parse(fs.readFileSync(newCfg, 'utf8'));
      for (const f of ['routeRegistry.json','routeSnapshot.json']) {
        const p = path.join(tmp, f);
        if (fs.existsSync(p)) JSON.parse(fs.readFileSync(p, 'utf8'));   // corrupt file in zip = abort
      }
      // safety net: current files -> timestamped backup folder (never overwritten blind)
      const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
      const bak = path.join(USER_DATA, 'setup_backup_pre_import_' + ts);
      fs.mkdirSync(bak, { recursive:true });
      for (const f of SETUP_FILES) { const p = path.join(USER_DATA, f); if (fs.existsSync(p)) fs.copyFileSync(p, path.join(bak, f)); }
      let imported = 0;
      for (const f of SETUP_FILES) { const p = path.join(tmp, f); if (fs.existsSync(p)) { writeFileAtomic(path.join(USER_DATA, f), fs.readFileSync(tmp+path.sep+f)); imported++; } }
      LOG.info('[SETUP] imported ' + imported + ' file(s); previous setup saved to ' + bak);
      return { ok:true, imported, backupDir: bak };
    } finally { try { fs.rmSync(tmp, { recursive:true, force:true }); } catch(_){} }
  } catch (e) { LOG.error('[SETUP] import failed: ' + e.message); return { ok:false, error:e.message }; }
});

// ── FLIGHT-LOG STORAGE (archive raw captures) ─────────────────────────────────
// Raw frametimes.csv files are 93% of Sessions (measured 1.4 of 1.5 GB). Baseline/Compare/reports
// read only the tiny summaries, so old raw files can be gzipped IN PLACE (~79% saving, reversible,
// NEVER deleted). Keep the newest N raw for instant re-analysis. Each gzip is verified by a full
// decompress-and-compare BEFORE the original is removed — flight data is irreplaceable.
const ARCHIVE_KEEP_RAW = 5;
function listRawCaptures(){
  const sdir = path.join(USER_DATA, 'Sessions');
  const out = [];
  (function walk(d){
    let ents; try { ents = fs.readdirSync(d, { withFileTypes:true }); } catch(_) { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) { if (e.name.toLowerCase() !== 'capframex') walk(p); }
      else if (/^frametimes\.csv(\.gz)?$/i.test(e.name)) out.push({ p, gz: e.name.toLowerCase().endsWith('.gz'), size: (()=>{try{return fs.statSync(p).size;}catch(_){return 0;}})(), mtime: (()=>{try{return fs.statSync(p).mtimeMs;}catch(_){return 0;}})() });
    }
  })(sdir);
  return out;
}
ipcMain.handle('perf-storage-stats', () => {
  try {
    const raws = listRawCaptures();
    const rawFiles = raws.filter(r=>!r.gz), gzFiles = raws.filter(r=>r.gz);
    const sum = a => a.reduce((x,y)=>x+y.size,0);
    let total = 0;
    (function walk(d){ let e2; try{ e2=fs.readdirSync(d,{withFileTypes:true}); }catch(_){ return; }
      for(const e of e2){ const p=path.join(d,e.name); if(e.isDirectory())walk(p); else { try{ total+=fs.statSync(p).size; }catch(_){} } } })(path.join(USER_DATA,'Sessions'));
    return { ok:true, totalBytes: total, rawCount: rawFiles.length, rawBytes: sum(rawFiles),
             gzCount: gzFiles.length, gzBytes: sum(gzFiles), keepRaw: ARCHIVE_KEEP_RAW };
  } catch (e) { return { ok:false, error:e.message }; }
});
ipcMain.handle('perf-archive-raw', () => new Promise((resolve) => {
  try {
    // Self-review findings (2026-07-05): (a) gzip of 100MB+ files is sync CPU work — run it in a
    // CHILD process (like the CapFrameX export), never on the Electron main thread; (b) never
    // archive while a capture could be mid-FILING — a partially-copied frametimes.csv could be
    // archived truncated. Capture ground truth is the same check the badge uses.
    if (isCaptureRunning()) { resolve({ ok:false, error:'A capture is armed or recording — archive after the flight files.' }); return; }
    const mod = path.join(perfDir(), 'native', 'archive.js');
    if (!fs.existsSync(mod)) { resolve({ ok:false, error:'archiver module not found' }); return; }
    const child = spawn(process.execPath, ['-e',
      'const a=require(process.env.ARC_MOD);' +
      'console.log(JSON.stringify(a.archiveRaw(process.env.ARC_SRC, parseInt(process.env.ARC_KEEP,10))));'],
      { windowsHide:true, env: Object.assign({}, process.env, {
          ELECTRON_RUN_AS_NODE:'1', ARC_MOD: mod, ARC_SRC: path.join(USER_DATA,'Sessions'), ARC_KEEP: String(ARCHIVE_KEEP_RAW) }) });
    let out=''; child.stdout.on('data', d => out += d);
    let err=''; child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { try{ child.kill(); }catch(_){}; resolve({ ok:false, error:'archive timed out' }); }, 600000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out.trim().split(/\r?\n/).pop());
        LOG.info('[STORAGE] archived ' + j.archived + ' raw capture(s), saved ' + Math.round(j.savedBytes/1048576) + ' MB, kept ' + j.kept + ' raw' + (j.errors.length ? ' | errors: ' + j.errors.join('; ') : ''));
        resolve({ ok:true, ...j });
      } catch(_) { LOG.error('[STORAGE] archive failed (code '+code+'): '+err.slice(0,300)); resolve({ ok:false, error: err.slice(0,200) || ('exit '+code) }); }
    });
    child.on('error', e => { clearTimeout(timer); resolve({ ok:false, error:e.message }); });
  } catch (e) { LOG.error('[STORAGE] archive failed: ' + e.message); resolve({ ok:false, error:e.message }); }
}));

// ── NVIDIA Control Panel (NVCP) settings backup/restore ──────────────────────
// Ports tools/backup_nvidia_settings.bat + restore_nvidia_settings.bat: the global 3D settings + all
// game profiles live in two driver .bin files under C:\ProgramData\NVIDIA Corporation\Drs. Back up =
// copy them into userData (archiving any previous with a timestamp); Restore = copy them back (reboot
// to apply). Reading/writing ProgramData needs admin — Dean runs ABRP elevated; otherwise we surface
// an admin-needed message instead of failing silently. Pure fs ops (no shell).
const NVCP_DRS   = 'C:\\ProgramData\\NVIDIA Corporation\\Drs';
const NVCP_FILES = ['nvdrsdb0.bin','nvdrsdb1.bin'];
function nvcpBackupDir(){ return path.join(USER_DATA, 'nvidia_settings_backup'); }
function nvcpTs(){ const d=new Date(), p=n=>String(n).padStart(2,'0'); return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'_'+p(d.getHours())+p(d.getMinutes()); }
function nvcpErr(e){ return (e && (e.code==='EPERM'||e.code==='EACCES')) ? 'Access denied — this needs ABRP running as Administrator.' : (e && e.message) || 'unknown error'; }

// ── DATA BACKUP & RESTORE (v6.13.0) ─────────────────────────────────────────
// Your flight logs, settings and route database are the only ABRP data GitHub can't hold — they
// existed in exactly one place until now. Logic lives in lib/data_backup.js, shared with
// tools/backup-data.js so the app and the CLI can never disagree.
const _dataBackup = require('./lib/data_backup.js');
function _backupCfg(){
  try {
    const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    return (c && c.backup) || {};
  } catch(_){ return {}; }
}
function _backupDest(){ const b = _backupCfg(); return (b.dest && String(b.dest).trim()) || _dataBackup.DEFAULT_DEST; }
// Record the outcome so the UI can show "last backed up ..." — and so a FAILING backup is visible
// instead of silently doing nothing for months.
function _backupRemember(res){
  try {
    const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    c.backup = Object.assign({}, c.backup, {
      dest: _backupDest(), lastRun: Date.now(), lastOk: !!res.ok,
      lastError: res.ok ? null : ((res.error || (res.errors || []).join('; ') || 'unknown').slice(0, 300)),
      lastBytes: res.bytes || 0, lastFlights: res.flights || 0
    });
    writeFileAtomic(CFG, JSON.stringify(c, null, 2));
  } catch(_){}
}
ipcMain.handle('data-backup-status', () => {
  try {
    const st = _dataBackup.backupStatus(USER_DATA, _backupDest());
    return Object.assign({ ok:true }, st, _backupCfg());
  } catch(e){ return { ok:false, error:e.message }; }
});
ipcMain.handle('data-backup-run', () => {
  try {
    // A capture writes into Sessions as it files; copying mid-write would grab a half-written flight.
    // (Harmless — the next run fixes it — but better to just wait.)
    if (isCaptureRunning()) return { ok:false, error:'A capture is armed or recording — back up once the flight has filed.' };
    const res = _dataBackup.backupData(USER_DATA, _backupDest(), m => LOG.info('[BACKUP] ' + m));
    _backupRemember(res);
    LOG.info('[BACKUP] ' + (res.ok ? ('ok — ' + res.human + ', ' + res.flights + ' flight days -> ' + res.dest) : ('FAILED — ' + (res.error || res.errors.join('; ')))));
    return res;
  } catch(e){ return { ok:false, error:e.message }; }
});
ipcMain.handle('data-backup-preview-restore', () => {
  try { return _dataBackup.restoreData(USER_DATA, _backupDest(), { dryRun:true }); }
  catch(e){ return { ok:false, error:e.message }; }
});
ipcMain.handle('data-backup-restore', () => {
  try {
    if (isCaptureRunning()) return { ok:false, error:'A capture is armed or recording — restore once the flight has filed.' };
    const res = _dataBackup.restoreData(USER_DATA, _backupDest(), {});
    LOG.info('[RESTORE] ' + (res.ok ? ('ok — ' + res.flights + ' flight days now present; pre-restore copy: ' + (res.safetyCopy || 'none')) : ('FAILED — ' + (res.error || res.errors.join('; ')))));
    return res;
  } catch(e){ return { ok:false, error:e.message }; }
});
ipcMain.handle('data-backup-browse', async () => {
  try {
    const r = await dialog.showOpenDialog(win, { title:'Choose a backup folder', properties:['openDirectory'] });
    if (r.canceled || !r.filePaths.length) return { ok:false, canceled:true };
    const dest = r.filePaths[0];
    const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    c.backup = Object.assign({}, c.backup, { dest });
    writeFileAtomic(CFG, JSON.stringify(c, null, 2));
    return { ok:true, dest };
  } catch(e){ return { ok:false, error:e.message }; }
});
ipcMain.handle('data-backup-open', () => {
  try { const d = _backupDest(); if (!fs.existsSync(d)) return { ok:false, error:'folder not found — is the drive connected?' };
        shell.openPath(d); return { ok:true }; }
  catch(e){ return { ok:false, error:e.message }; }
});
// Set the auto-after-flight flag with a read-modify-write on disk. Its own IPC (not save-config)
// because save-config shallow-merges cfg.backup and would wipe the lastRun/lastOk fields
// _backupRemember writes here.
ipcMain.handle('data-backup-set-auto', (_, on) => {
  try {
    const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    c.backup = Object.assign({}, c.backup, { auto: !!on });
    writeFileAtomic(CFG, JSON.stringify(c, null, 2));
    return { ok:true };
  } catch(e){ return { ok:false, error:e.message }; }
});

ipcMain.handle('nvcp-status', () => {
  try {
    const f0 = path.join(nvcpBackupDir(), 'nvdrsdb0.bin');
    if (fs.existsSync(f0)) return { hasBackup:true, ts: fs.statSync(f0).mtime.toISOString(), dir: nvcpBackupDir() };
    return { hasBackup:false, dir: nvcpBackupDir() };
  } catch(e){ return { hasBackup:false, error: e.message }; }
});

ipcMain.handle('nvcp-backup', () => {
  try {
    if (!fs.existsSync(path.join(NVCP_DRS,'nvdrsdb0.bin'))) return { ok:false, error:'NVIDIA settings not found — is the driver installed?' };
    const dir = nvcpBackupDir();
    fs.mkdirSync(dir, { recursive:true });
    let archived = null;
    if (fs.existsSync(path.join(dir,'nvdrsdb0.bin'))) {
      const ts = nvcpTs();
      for (const f of NVCP_FILES) { const p = path.join(dir,f); if (fs.existsSync(p)) fs.renameSync(p, path.join(dir, f.replace('.bin','_'+ts+'.bin'))); }
      archived = ts;
    }
    for (const f of NVCP_FILES) fs.copyFileSync(path.join(NVCP_DRS,f), path.join(dir,f));
    LOG.info('[NVCP] backed up to '+dir+(archived?' (archived previous as _'+archived+')':''));
    return { ok:true, dir, archived };
  } catch(e){ LOG.error('[NVCP] backup failed: '+e.message); return { ok:false, error: nvcpErr(e) }; }
});

ipcMain.handle('nvcp-restore', () => {
  try {
    const dir = nvcpBackupDir();
    if (!fs.existsSync(path.join(dir,'nvdrsdb0.bin'))) return { ok:false, error:'No backup found yet — back up first.' };
    if (!fs.existsSync(NVCP_DRS)) return { ok:false, error:'NVIDIA Drs folder not found — is the driver installed?' };
    for (const f of NVCP_FILES) fs.copyFileSync(path.join(dir,f), path.join(NVCP_DRS,f));
    LOG.info('[NVCP] restored from '+dir);
    return { ok:true, needsReboot:true };
  } catch(e){ LOG.error('[NVCP] restore failed: '+e.message); return { ok:false, error: nvcpErr(e) }; }
});

// Arm a performance capture for the next flight: spawn the engine headless + auto-start.
// Detached + unref so closing ABRP never kills an in-flight capture (matches the set-and-forget
// workflow). Uses the bundled perf-engine.exe when present, else system Python (dev). The engine
// writes into the data home via MSFS_PERF_ROOT.
// --- Native (Node) perf engine — v6 transition. OPT-IN behind config.nativePerfEngine (default OFF),
// so the proven Python path stays the default until the full-flight parity passes and we flip it.
function _perfCfg(){ try { return JSON.parse(fs.readFileSync(CFG,'utf8')) || {}; } catch(_){ return {}; } }
// v6.0.0: the NATIVE engine is the default (byte-parity proven vs Python over 21 flights + a live
// baseline flight; packaging runtime-probed). Setting nativePerfEngine:false in config falls back to
// the legacy Python paths — a DEV-ONLY escape hatch: the installer no longer ships perf-engine.exe.
function nativePerfEnabled(){ return _perfCfg().nativePerfEngine !== false; }
// Phase 10: NO hardcoded fallback username — a fresh install must never fetch the developer's
// SimBrief plans. null = SimBrief-dependent features explain themselves instead of misbehaving.
function simbriefUser(){ const u = String(_perfCfg().simbriefUser || '').trim(); return u || null; }
// Steam UserCfg.opt (matches the Python engine). Store-vs-Steam detection is a cutover TODO.
const USERCFG_PATH = path.join(app.getPath('appData'), 'Microsoft Flight Simulator 2024', 'UserCfg.opt');

ipcMain.handle('perf-start-capture', (_e, o) => {
  try {
    // ONE capture engine only. Arming repeatedly without flying (or re-arming) leaves engines
    // waiting; they ALL fire on the next takeoff and collide over _capture_tmp.csv + PresentMon's
    // ETW session (observed: 7 engines piling onto one flight, 6 "Nothing filed" errors). Kill any
    // existing engine + orphaned PresentMon before arming a fresh one.
    try {
      const cp = require('child_process');
      // Native engine first: it's an Electron-image process, INVISIBLE to a taskkill-by-name — kill it
      // by the pid it wrote to capture_status.json (deep-review finding 5: a surviving armed/recording
      // native engine collides with the fresh one exactly like the old "7 engines" pile-up).
      try {
        const sf = path.join(USER_DATA, 'capture_status.json');
        if (fs.existsSync(sf)) {
          const j = JSON.parse(fs.readFileSync(sf, 'utf8'));
          if (j && j.pid && j.pid !== process.pid) {
            cp.spawnSync('taskkill', ['/F','/PID', String(j.pid), '/T'], { windowsHide:true, timeout:5000 });
            LOG.info('[PERF] killed existing native capture (pid ' + j.pid + ', state ' + (j.state||'?') + ') before re-arm');
          }
          try { fs.unlinkSync(sf); } catch(_){}
        }
      } catch(_){}
      cp.spawnSync('taskkill', ['/F','/IM','perf-engine.exe','/T'],   { windowsHide:true, timeout:5000 });
      cp.spawnSync('taskkill', ['/F','/IM','PresentMon-x64.exe','/T'], { windowsHide:true, timeout:5000 });
    } catch(_){}
    const dir    = perfDir();
    if (nativePerfEnabled()) {
      // Native engine: run the capture in a DETACHED Electron-as-node process (survives closing ABRP
      // mid-flight, exactly like perf-engine.exe --auto). Config passed via env.
      const entry = path.join(dir, 'native', 'run_capture.js');
      if (!fs.existsSync(entry)) { LOG.error('[PERF] native capture entry not found: ' + entry); return { ok:false, error:'native entry not found' }; }
      const nenv = Object.assign({}, process.env, {
        ELECTRON_RUN_AS_NODE: '1', MSFS_PERF_ROOT: USER_DATA, ABRP_ASSET_DIR: dir,
        ABRP_SESSIONS_DIR: path.join(USER_DATA, 'Sessions'), ABRP_USERCFG: USERCFG_PATH,
        ...(simbriefUser() ? { ABRP_SIMBRIEF_USER: simbriefUser() } : {}),
        ABRP_BENCHMARK: JSON.stringify(benchCfg()),   // user grid + aircraft match terms (Phase 10)
        ABRP_THIRDPARTY_ICAOS: JSON.stringify(thirdPartyIcaos()),   // scenery attribution (v6.3.8)
        ...(vatsimCid() ? { ABRP_VATSIM_CID: vatsimCid() } : {}),   // confirm real VATSIM connection (v6.9.0)
        ...((o && o.recordNow) ? { ABRP_RECORD_NOW: '1' } : {}),    // v6.15.7: record from connect, no takeoff-roll wait
        // node-simconnect (+ its 13 deps) is asarUnpack'd; point the detached process at it.
        NODE_PATH: app.isPackaged ? path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules')
                                  : path.join(__dirname, 'node_modules'),
      });
      const nchild = spawn(process.execPath, [entry], { detached:true, stdio:'ignore', windowsHide:true, env:nenv });
      nchild.on('error', e => LOG.error('[PERF] native capture spawn failed: ' + e.message));
      nchild.unref();
      LOG.info('[PERF] native capture armed (Electron-as-node --auto' + ((o && o.recordNow) ? ', RECORD NOW' : '') + ') from ' + entry);
      return { ok:true, how:'native' };
    }
    const exe    = path.join(dir, 'perf-engine.exe');          // bundled, Python-free engine
    const script = path.join(dir, 'msfs_perf_logger.py');      // dev fallback (system Python)
    const env    = Object.assign({}, process.env, { MSFS_PERF_ROOT: USER_DATA });
    const opts   = { detached:true, stdio:'ignore', windowsHide:true, env, cwd: dir };
    let child, how;
    if (fs.existsSync(exe))         { child = spawn(exe, ['--headless','--auto'], opts); how = 'exe'; }
    else if (fs.existsSync(script)) { child = spawn('py', [script,'--headless','--auto'], opts); how = 'py'; }
    else { LOG.error('[PERF] capture: engine not found in ' + dir); return { ok:false, error:'engine not found in ' + dir }; }
    child.on('error', e => LOG.error('[PERF] capture spawn failed: ' + e.message));
    child.unref();
    LOG.info('[PERF] capture armed (headless --auto) [' + how + '] from ' + dir);
    return { ok:true, how };
  } catch (e) { LOG.error('[PERF] perf-start-capture failed: ' + e.message); return { ok:false, error:e.message }; }
});

// v6.15.7 — STOP & FILE without quitting the sim. The capture engine runs detached with stdio
// ignored, so the request is a file it polls (capture_status.json is the same channel in reverse).
// The engine consumes it, stops PresentMon and files the session through the normal path.
ipcMain.handle('perf-stop-capture', () => {
  try {
    if (!isCaptureRunning()) return { ok:false, error:'no capture is running' };
    fs.writeFileSync(path.join(USER_DATA, '_capture_stop'), String(Date.now()));
    LOG.info('[PERF] stop requested — engine will file the session');
    return { ok:true };
  } catch (e) { LOG.error('[PERF] perf-stop-capture failed: ' + e.message); return { ok:false, error:e.message }; }
});

// Auto-TLOD: run the engine's --prep-next to pick + write the next benchmark TLOD for the aircraft on
// the current SimBrief plan. This uses the SAME coverage model (compute_coverage + next_gap_for_aircraft)
// that renders the Performance tracker, so the set value can't diverge from the tracker. The engine
// backs up UserCfg.opt itself. Waits for exit, parses stdout, returns {set, aircraft, tlod} so ABRP can
// surface "Set TLOD X for <aircraft>". 30s timeout guard so a stuck prep can never block the launch.
ipcMain.handle('perf-prep-next', () => new Promise((resolve) => {
  try {
    if (nativePerfEnabled()) {
      // Native prep-next runs IN-PROCESS (quick: SimBrief fetch + coverage + UserCfg write, no Python).
      (async () => {
        try {
          const { prepNext } = require(path.join(perfDir(), 'native', 'prep.js'));  // perfDir = resources/perf when packaged
          let sessions = [];
          try { sessions = (JSON.parse(fs.readFileSync(path.join(USER_DATA, 'Sessions', 'index.json'), 'utf8')).sessions) || []; } catch(_){}
          const r = await prepNext(sessions, { username: simbriefUser(), usercfgPath: USERCFG_PATH, backupDir: path.join(USER_DATA, 'usercfg_backups'), benchmark: benchCfg() });
          LOG.info('[PERF] native prep-next: ' + (r.msg || ''));
          resolve({ ok: !!r.ok, set: !!r.set, aircraft: r.aircraft, tlod: r.tlod, reason: r.reason, msg: r.msg });
        } catch (e) { LOG.error('[PERF] native prep-next failed: ' + e.message); resolve({ ok:false, error:e.message }); }
      })();
      return;
    }
    const dir    = perfDir();
    const exe    = path.join(dir, 'perf-engine.exe');
    const script = path.join(dir, 'msfs_perf_logger.py');
    const env    = Object.assign({}, process.env, { MSFS_PERF_ROOT: USER_DATA });
    const opts   = { windowsHide:true, env, cwd: dir };
    let child;
    if (fs.existsSync(exe))         { child = spawn(exe, ['--prep-next'], opts); }
    else if (fs.existsSync(script)) { child = spawn('py', [script,'--prep-next'], opts); }
    else { LOG.error('[PERF] prep-next: engine not found in ' + dir); resolve({ ok:false, error:'engine not found' }); return; }
    let out=''; let done=false;
    const finish = (res) => { if(done) return; done=true; clearTimeout(timer); resolve(res); };
    const timer = setTimeout(() => { try{ child.kill(); }catch(_){}; LOG.warn('[PERF] prep-next timed out'); finish({ ok:false, error:'prep-next timed out' }); }, 30000);
    if (child.stdout) child.stdout.on('data', d => out += d);
    if (child.stderr) child.stderr.on('data', d => out += d);
    child.on('error', e => { LOG.error('[PERF] prep-next spawn failed: ' + e.message); finish({ ok:false, error:e.message }); });
    child.on('close', () => {
      const m = out.match(/->\s*(\S+).*?TLOD\s+(\d+)/i);
      const unchanged = /leaving TLOD unchanged/i.test(out);
      let res;
      if (m)              res = { ok:true, set:true, aircraft:m[1], tlod:parseInt(m[2],10) };
      else if (unchanged) res = { ok:true, set:false, reason: /not recognized/i.test(out) ? 'no-simbrief' : 'coverage-complete' };
      else                res = { ok:true, set:false, reason:'unknown' };
      LOG.info('[PERF] prep-next: ' + (res.set ? ('TLOD '+res.tlod+' for '+res.aircraft) : ('no change ('+res.reason+')')) + ' | ' + out.replace(/\s+/g,' ').trim().slice(0,300));
      finish(res);
    });
  } catch (e) { LOG.error('[PERF] perf-prep-next failed: ' + e.message); resolve({ ok:false, error:e.message }); }
}));
// Export all logged flights to CapFrameX-format CSVs (Sessions\CapFrameX\) via the native
// converter (byte-parity proven vs the old Python --convert-path). Runs in a CHILD process —
// it re-reads every raw frametimes.csv (can be GBs) and must never freeze the UI.
ipcMain.handle('perf-export-capframex', (_, args) => new Promise(async (resolve) => {
  try {
    const mod = path.join(perfDir(), 'native', 'capframex.js');
    if (!fs.existsSync(mod)) { resolve({ ok:false, error:'converter not found' }); return; }
    const sessions = path.join(USER_DATA, 'Sessions');
    // Dean (2026-07-06): convert ONE flight — the one being viewed — never the whole library.
    // The renderer passes the viewed report's session dir when it can read it off the iframe;
    // otherwise we ask via a folder picker defaulted to Sessions.
    let srcDir = args && args.dir ? String(args.dir) : null;
    if (srcDir && (!fs.existsSync(srcDir) || !path.resolve(srcDir).toLowerCase().startsWith(path.resolve(sessions).toLowerCase()))) srcDir = null;
    if (!srcDir) {
      const r = await dialog.showOpenDialog(win, { title:'Pick the flight to convert for CapFrameX',
        defaultPath: sessions, properties:['openDirectory'] });
      if (r.canceled || !r.filePaths.length) { resolve({ ok:false, canceled:true }); return; }
      srcDir = r.filePaths[0];
    }
    let gpu = '';
    try {
      const r = require('child_process').spawnSync('nvidia-smi', ['--query-gpu=name','--format=csv,noheader'],
        { encoding:'utf8', timeout:6000, windowsHide:true });
      gpu = ((r.stdout||'').split(/\r?\n/)[0]||'').trim();
    } catch(_){}
    const child = spawn(process.execPath, ['-e',
      'const c=require(process.env.CFX_MOD);' +
      'const r=c.convertPaths([process.env.CFX_SRC], process.env.CFX_OUTROOT, process.env.CFX_GPU||null);' +
      'console.log(JSON.stringify({outDir:r.outDir,count:r.count}));'],
      { windowsHide:true, env: Object.assign({}, process.env, {
          ELECTRON_RUN_AS_NODE:'1', CFX_MOD: mod, CFX_SRC: srcDir, CFX_OUTROOT: sessions, CFX_GPU: gpu }) });
    let out=''; child.stdout.on('data', d => out += d);
    let err=''; child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { try{ child.kill(); }catch(_){}; resolve({ ok:false, error:'export timed out' }); }, 180000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try { const j = JSON.parse(out.trim().split(/\r?\n/).pop()); LOG.info('[PERF] CapFrameX export: '+j.count+' flight(s) -> '+j.outDir); resolve({ ok:true, ...j }); }
      catch(_) { LOG.error('[PERF] CapFrameX export failed (code '+code+'): '+err.slice(0,300)); resolve({ ok:false, error: err.slice(0,200) || ('exit '+code) }); }
    });
    child.on('error', e => { clearTimeout(timer); resolve({ ok:false, error:e.message }); });
  } catch (e) { resolve({ ok:false, error:e.message }); }
}));
// ── SETTINGS LAB (Phase 9) ────────────────────────────────────────────────────
// Post-benchmark auto-experiment scheduler. All logic lives in perf/native/lab.js; these IPCs run
// it in-process like perf-prep-next does. Sessions (index.json) are the source of truth for
// alternation/counts. UserCfg writes reuse the proven backup+readback discipline.
function _labMod(){ return require(path.join(perfDir(), 'native', 'lab.js')); }
function _labSessions(){ try { return (JSON.parse(fs.readFileSync(path.join(USER_DATA,'Sessions','index.json'),'utf8')).sessions)||[]; } catch(_){ return []; } }
ipcMain.handle('perf-lab-status', () => {
  try { return _labMod().labStatus(_labSessions(), USER_DATA, USERCFG_PATH); }
  catch (e) { return { ok:false, error:e.message }; }
});
ipcMain.handle('perf-lab-next', (_, args) => {
  try {
    const lab = _labMod();
    if (args && args.disable) { const r = lab.labDisable(USER_DATA, USERCFG_PATH, path.join(USER_DATA,'usercfg_backups')); LOG.info('[LAB] disabled — restored '+r.restored+' setting(s)'); return r; }
    if (args && args.manual)  { const r = lab.labMarkManual(USER_DATA, args.manual); LOG.info('[LAB] manual mark: '+(r.msg||'')); return r; }
    const r = lab.labNext(_labSessions(), { usercfgPath: USERCFG_PATH, backupDir: path.join(USER_DATA,'usercfg_backups'), dataRoot: USER_DATA, aircraft: args && args.aircraft, benchLabels: benchLabels() });
    LOG.info('[LAB] ' + (r.msg || r.mode));
    return r;
  } catch (e) { LOG.error('[LAB] perf-lab-next failed: '+e.message); return { ok:false, mode:'error', msg:e.message }; }
});
// Lab RESULTS (Phase 9b): verdicts vs baseline noise + overlay chart SVGs. Reads raw
// frametimes.csv(.gz) on first run (then per-flight series.json caches make it cheap), so it runs
// in a CHILD process like the archiver — never on the Electron main thread.
ipcMain.handle('perf-lab-report', () => new Promise((resolve) => {
  try {
    const mod = path.join(perfDir(), 'native', 'lab_report.js');
    if (!fs.existsSync(mod)) { resolve({ ok:false, error:'lab_report module not found' }); return; }
    const child = spawn(process.execPath, ['-e',
      'const m=require(process.env.LABR_MOD);' +
      'console.log(JSON.stringify(m.buildLabReport(process.env.LABR_SRC)));'],
      { windowsHide:true, env: Object.assign({}, process.env, {
          ELECTRON_RUN_AS_NODE:'1', LABR_MOD: mod, LABR_SRC: path.join(USER_DATA,'Sessions'),
          ABRP_BENCHMARK: JSON.stringify(benchCfg()) }) });
    let out=''; child.stdout.on('data', d => out += d);
    let err=''; child.stderr.on('data', d => err += d);
    const timer = setTimeout(() => { try{ child.kill(); }catch(_){}; resolve({ ok:false, error:'lab report timed out' }); }, 120000);
    child.on('close', (code) => {
      clearTimeout(timer);
      try { const j = JSON.parse(out.trim().split(/\r?\n/).pop()); j.sessionsDir = path.join(USER_DATA,'Sessions'); resolve(j); }
      catch(_) { LOG.error('[LAB] report failed (code '+code+'): '+err.slice(0,300)); resolve({ ok:false, error: err.slice(0,200) || ('exit '+code) }); }
    });
    child.on('error', e => { clearTimeout(timer); resolve({ ok:false, error:e.message }); });
  } catch (e) { resolve({ ok:false, error:e.message }); }
}));
// Adopt (or un-adopt) a winning Lab finding into UserCfg.opt. The sim only reads UserCfg at
// launch, so this is refused while MSFS is running — the write would be silently overwritten
// when the sim exits.
ipcMain.handle('perf-lab-apply', (_, args) => {
  try {
    let simUp = false; try { simUp = isMsfsRunning(); } catch(_){}
    if (simUp) return { ok:false, msg:'MSFS is running — close the sim first (it only reads settings at launch, and overwrites them on exit).' };
    const r = _labMod().applyFinding(USER_DATA, USERCFG_PATH, path.join(USER_DATA,'usercfg_backups'), args && args.id, !!(args && args.undo));
    LOG.info('[LAB] apply '+(args&&args.id)+(args&&args.undo?' (undo)':'')+' -> '+(r.ok?('OK '+r.msg):('FAIL '+r.msg)));
    return r;
  } catch (e) { LOG.error('[LAB] perf-lab-apply failed: '+e.message); return { ok:false, msg:e.message }; }
});

// Capture status for the title-bar badge. v1: active = engine process running. state (armed /
// recording) is read from a status file the engine writes when present (engine pass adds it).
ipcMain.handle('perf-capture-status', () => {
  let active = false; try { active = isCaptureRunning(); } catch (_) {}
  let state = null;
  if (active) { try { const sf = path.join(USER_DATA, 'capture_status.json');
    if (fs.existsSync(sf)) { const j = JSON.parse(fs.readFileSync(sf,'utf8')); if (j && j.state) state = j.state; } } catch(_){} }
  return { active, state };
});
ipcMain.on('install-update', () => {
  // Exit FAST so the NSIS installer doesn't catch ABRP mid-shutdown ("cannot be closed / Retry").
  // electron-updater on Windows quits via the normal `before-quit` path (it does NOT emit
  // `before-quit-for-update` — that's the macOS/Squirrel path), so set the skip-flags here: bypass
  // the close-confirm dialog and the slow on-quit scenery cleanup. Junctions are left for the
  // freshly-installed copy to tidy on its next normal close.
  _perfAllowClose = true; _cleanupDone = true;
  // (true, true) = SILENT NSIS install (/S — no wizard, no next-buttons) + auto-relaunch the app.
  // Same assisted installer, just run non-interactively (Dean 2026-07-06: zero-click updates).
  require('electron-updater').autoUpdater.quitAndInstall(true, true);
});
// Renderer-side safety check for the auto-restart countdown: never yank the app out from under a
// running sim (an armed/recording capture is checked renderer-side via the capture badge).
ipcMain.handle('msfs-running', () => { try { return isMsfsRunning(); } catch (_) { return false; } });

// ── LIVE ATC (VATSIM frequency helper) ──────────────────────────────────────────────────────────
// A SEPARATE continuous SimConnect client "ABRP-LiveATC" (node-simconnect), safe alongside vPilot AND
// the capture engine — the sim serves many clients and this never touches the capture connection or
// PresentMon. Opt-in; zero overhead when off. Streams position at 1 Hz for the renderer's top-down
// frequency recommendation. Radio policy: READ everywhere (position + COM1 active/standby); the ONLY
// write is the per-aircraft STANDBY adapter below — explicit button click, closed-loop verified,
// never the active frequency, never automatic (the v6.7.0 lesson stands).
//
// PMDG STANDBY ADAPTER (2026-07-11, from the plan-file design): the PMDG ignores the sim's SET event
// but its cockpit knobs are drivable by the custom events published in Dean's own PMDG_NG3_SDK.h —
// EVT_COM1_OUTER_SELECTOR (69632+726) / EVT_COM1_INNER_SELECTOR (69632+727), one click per event with
// MOUSE_FLAG_WHEEL_UP (0x4000) / MOUSE_FLAG_WHEEL_DOWN (0x2000). The walk is a FEEDBACK LOOP: send a
// short burst, re-read the standby from the 1 Hz stream, re-plan from the fresh value (self-heals
// missed clicks, learns knob polarity AND the radio's channel step — 25 vs 8.33 kHz), verify at the
// end. Unexpected movement (pilot on the knob) aborts; a failed write disables the adapter for the
// session so it never spams or fights.
// Pure click planner — desk-testable. No wrap assumption (the PMDG outer knob's wrap behavior is
// unverified): always walks the direct direction, max 18 MHz clicks.
function _planClicks(curMhz, targetMhz, innerStepKhz){
  const curK=Math.round(curMhz*1000), tgtK=Math.round(targetMhz*1000);
  const outer=Math.trunc(tgtK/1000)-Math.trunc(curK/1000);
  const remK=(tgtK-Math.trunc(tgtK/1000)*1000)-(curK-Math.trunc(curK/1000)*1000);
  const inner=Math.round(remK/(innerStepKhz||25));
  return { outer, inner };
}
const RADIO_ADAPTERS=[
  { id:'pmdg737', label:'PMDG 737', match:t=>t.includes('pmdg')&&/73[7-9]/.test(t) },
];
function _radioAdapterFor(title){
  const t=String(title||'').toLowerCase(); if(!t) return null;
  for(const a of RADIO_ADAPTERS){ if(a.match(t)) return a; }
  return null;
}
const LiveATC = (() => {
  let handle = null, stopped = true, reconnecting = false, pos = null, status = 'off';
  const DEF = 20, REQ = 20;
  const CE_OUTER = 91, CE_INNER = 92;                      // our client-side ids for the mapped PMDG events
  let writing = false, adapterDisabled = false;
  function _open(){
    if(stopped) return;
    if(status !== 'live') status = 'connecting';
    let sc; try{ sc = require('node-simconnect'); }catch(e){ status='error'; LOG.error('[LiveATC] node-simconnect load failed: '+e.message); return; }
    const { open, Protocol, SimConnectDataType, SimConnectPeriod } = sc;
    open('ABRP-LiveATC', Protocol.SunRise).then(({ handle: h }) => {
      if(stopped){ try{h.close();}catch(_){} return; }
      handle = h; reconnecting = false;
      h.addToDataDefinition(DEF,'PLANE LATITUDE','Degrees',SimConnectDataType.FLOAT64);
      h.addToDataDefinition(DEF,'PLANE LONGITUDE','Degrees',SimConnectDataType.FLOAT64);
      h.addToDataDefinition(DEF,'PLANE ALTITUDE','Feet',SimConnectDataType.FLOAT64);
      h.addToDataDefinition(DEF,'PLANE ALT ABOVE GROUND','Feet',SimConnectDataType.FLOAT64);
      h.addToDataDefinition(DEF,'SIM ON GROUND','Bool',SimConnectDataType.INT32);
      h.addToDataDefinition(DEF,'GROUND VELOCITY','Knots',SimConnectDataType.FLOAT64);
      // Read COM1 standby + active (MHz). Active shows "you're on X → next is Y" (reads reliably on
      // every aircraft; vPilot needs it too). Standby is unreliable on custom aircraft generally, but
      // on the PMDG it reads correctly — which is exactly what the adapter's feedback loop relies on.
      h.addToDataDefinition(DEF,'COM STANDBY FREQUENCY:1','MHz',SimConnectDataType.FLOAT64);
      h.addToDataDefinition(DEF,'COM ACTIVE FREQUENCY:1','MHz',SimConnectDataType.FLOAT64);
      h.addToDataDefinition(DEF,'TITLE',null,SimConnectDataType.STRING256);   // adapter gating (strings last)
      h.requestDataOnSimObject(REQ,DEF,0,SimConnectPeriod.SECOND);
      // PMDG custom cockpit events ('#' = raw third-party event number, from PMDG_NG3_SDK.h)
      try{
        h.mapClientEventToSimEvent(CE_OUTER, '#70358');    // EVT_COM1_OUTER_SELECTOR (69632+726) — MHz knob
        h.mapClientEventToSimEvent(CE_INNER, '#70359');    // EVT_COM1_INNER_SELECTOR (69632+727) — kHz knob
      }catch(e){ LOG.info('[LiveATC] event map: '+e.message); }
      h.on('simObjectData',(recv)=>{
        if(recv.requestID!==REQ) return;
        try{
          const lat=recv.data.readFloat64(), lon=recv.data.readFloat64(), alt=recv.data.readFloat64(),
                agl=recv.data.readFloat64(), og=recv.data.readInt32(), gs=recv.data.readFloat64(),
                comStandbyMhz=recv.data.readFloat64(), comActiveMhz=recv.data.readFloat64(),
                title=(recv.data.readString(256)||'').trim();
          pos={lat,lon,alt,agl,onGround:!!og,gs,comStandbyMhz,comActiveMhz,title,ts:Date.now()}; status='live';
        }catch(_){}
      });
      const drop=()=>{ if(!stopped) _reconnect(); };
      try{ h.on('quit',drop); h.on('close',drop); }catch(_){}
      LOG.info('[LiveATC] connected');
    }).catch(()=>{ if(!stopped){ status='sim-off'; setTimeout(_open, 60000); } });   // sim not running → retry
  }
  function _reconnect(){
    if(stopped||reconnecting) return; reconnecting=true;
    try{ handle&&handle.close(); }catch(_){}
    handle=null; if(status==='live') status='connecting';
    setTimeout(()=>{ reconnecting=false; _open(); }, 3000);
  }
  function _click(ce, up, n){                                  // n wheel clicks on one knob, ~55ms apart
    const sc=require('node-simconnect');
    const flag=(sc.EventFlag&&sc.EventFlag.EVENT_FLAG_GROUPID_IS_PRIORITY)||16;
    const PARAM=up?0x4000:0x2000;                              // MOUSE_FLAG_WHEEL_UP / _DOWN
    return new Promise(res=>{ let i=0; const t=setInterval(()=>{
      try{ handle.transmitClientEvent(0, ce, PARAM, 1, flag); }catch(_){}   // objectId 0=user, groupId 1=HIGHEST priority
      if(++i>=n){ clearInterval(t); res(); }
    }, 55); });
  }
  function _freshRead(afterTs){                                // wait for a 1 Hz sample newer than the burst
    return new Promise(res=>{ const t0=Date.now(); const t=setInterval(()=>{
      if(pos&&pos.ts>afterTs){ clearInterval(t); res(pos.comStandbyMhz); }
      else if(Date.now()-t0>4000){ clearInterval(t); res(null); }
    }, 200); });
  }
  // Closed-loop standby walk (PMDG adapter). Never touches the ACTIVE frequency.
  async function writeStandby(targetMhz){
    if(writing) return {ok:false,msg:'a radio write is already running'};
    if(adapterDisabled) return {ok:false,msg:'radio adapter disabled for this session (a write failed) — tune manually'};
    if(!handle||status!=='live'||!pos) return {ok:false,msg:'sim not connected'};
    const ad=_radioAdapterFor(pos.title);
    if(!ad) return {ok:false,msg:'no radio adapter for this aircraft'};
    if(!(targetMhz>=118&&targetMhz<=137)) return {ok:false,msg:'not a COM frequency'};
    if(pos.comStandbyMhz==null) return {ok:false,msg:'aircraft is not reporting COM1 standby'};
    writing=true;
    const TOL=0.005;                                           // 5 kHz — 8.33-channel-label safe
    let outerDir=1, innerDir=1, innerStep=25, clicksSent=0;    // polarity + channel step LEARNED from observation
    try{
      let cur=pos.comStandbyMhz;
      for(let round=0; round<26; round++){
        if(Math.abs(cur-targetMhz)<=TOL){ LOG.info('[LiveATC] standby walk verified '+targetMhz.toFixed(3)+' ('+clicksSent+' clicks)'); return {ok:true,verified:true,read:cur}; }
        if(clicksSent>260) break;                              // runaway guard (8.33-kHz radios can genuinely need ~120 inner clicks)
        const plan=_planClicks(cur, targetMhz, innerStep);
        const useOuter=plan.outer!==0;
        const want=useOuter?plan.outer:plan.inner;
        const n=Math.min(Math.abs(want), useOuter?6:12);       // short bursts so the re-read can correct course
        const up=(want>0)?((useOuter?outerDir:innerDir)>0):((useOuter?outerDir:innerDir)<0);
        const t0=Date.now();
        await _click(useOuter?CE_OUTER:CE_INNER, up, n); clicksSent+=n;
        const fresh=await _freshRead(t0);
        if(fresh==null){ LOG.error('[LiveATC] standby walk: no fresh read'); break; }
        const moved=Math.round((fresh-cur)*1000);              // kHz actually moved
        const expect=(want>0?1:-1)*n*(useOuter?1000:innerStep);
        if(moved===0 && n>0){                                  // knob didn't respond (radio unpowered / events ignored)
          if(round>=1){ adapterDisabled=true; return {ok:false,msg:'the radio didn’t respond (unpowered, or the aircraft ignores the events) — tune manually'}; }
        } else if(Math.sign(moved)!==Math.sign(expect)&&moved!==0){
          // opposite movement: EITHER our polarity guess is wrong (learn + continue) or the pilot is
          // turning the knob (abort). Distinguish by magnitude: a clean polarity flip moves ~|expect|.
          if(Math.abs(Math.abs(moved)-Math.abs(expect))<=Math.abs(expect)*0.6+innerStep){ if(useOuter)outerDir=-outerDir; else innerDir=-innerDir; }
          else { return {ok:false,msg:'the standby moved unexpectedly (someone on the knob?) — aborted, no harm done'}; }
        } else if(!useOuter && n>0 && moved!==0){
          innerStep=Math.max(5, Math.min(50, Math.abs(moved)/n)); // learn the real channel step (25 vs 8.33)
        }
        cur=fresh;
      }
      adapterDisabled=true;
      return {ok:false,verified:false,read:pos&&pos.comStandbyMhz,msg:'couldn’t drive the radio to '+targetMhz.toFixed(3)+' — tune manually (adapter off for this session)'};
    } finally { writing=false; }
  }
  return {
    start(){ if(!stopped) return; stopped=false; status='connecting'; _open(); },
    stop(){ stopped=true; try{ handle&&handle.close(); }catch(_){} handle=null; status='off'; pos=null; },
    writeStandby,
    latest(){
      let st=status;
      if(status==='live' && pos && Date.now()-pos.ts>15000){ st='connecting'; if(!reconnecting) _reconnect(); }
      const ad=(st==='live'&&pos&&!adapterDisabled)?_radioAdapterFor(pos.title):null;
      return { status:st, pos:(st==='live'&&pos)?pos:null, writable:!!ad, adapterLabel:ad?ad.label:null };
    }
  };
})();
ipcMain.handle('live-atc-start', () => { LiveATC.start(); return {ok:true}; });
ipcMain.handle('live-atc-stop',  () => { LiveATC.stop();  return {ok:true}; });
ipcMain.handle('live-position',  () => LiveATC.latest());
// PMDG standby adapter — the ONLY radio write in the app: explicit button click, standby only,
// closed-loop verified, disables itself for the session on failure. Never the active frequency.
ipcMain.handle('live-write-standby', (_, o) => LiveATC.writeStandby(parseFloat(o&&o.mhz)));
// VATSIM datafeed proxied through main (avoids any renderer CORS issue); returns controllers + ATIS +
// pilots (pilots trimmed to the connection/flight-plan fields we use, to keep the payload small).
ipcMain.handle('live-vatsim-feed', async () => {
  try{
    const body=await _httpGetLarge('https://data.vatsim.net/v3/vatsim-data.json'); if(!body) return {ok:false};
    const j=JSON.parse(body);
    const pilots=(j.pilots||[]).map(p=>({cid:p.cid, callsign:p.callsign, latitude:p.latitude, longitude:p.longitude, altitude:p.altitude, transponder:p.transponder, flight_plan:p.flight_plan||null}));
    return {ok:true, controllers:j.controllers||[], atis:j.atis||[], pilots};
  }
  catch(e){ return {ok:false, error:e.message}; }
});
// VATSIM's own METAR (the weather injected into the sim on VATSIM) — separate from aviationweather.gov.
ipcMain.handle('vatsim-metar', async (_, o) => {
  try{ const icao=String((o&&o.icao)||'').toUpperCase(); if(!icao) return {ok:false}; const body=await _httpGetLarge('https://metar.vatsim.net/'+icao); const raw=(body||'').trim(); return {ok:!!raw, raw}; }
  catch(e){ return {ok:false, error:e.message}; }
});

// ── LIVE ATC IN-SIM OVERLAY ─────────────────────────────────────────────────────────────────────
// A SECOND transparent, frameless, click-through, always-on-top window pinned top-right — discrete
// toasts (freq change / new controller / logging started) that fade after a few seconds. Renders over
// borderless/windowed MSFS; exclusive fullscreen hides any external window (documented limitation).
let overlayWin=null;
// v6.12.8 (audit): tracks whether Live mode owns the overlay. A toast can legitimately arrive with
// Live mode OFF ("logging started" on an offline flight) and create the window — but then nothing
// ever tore it down, so the grey dot lingered on screen for the whole session. When a toast creates
// the window without Live mode, it self-closes after the toast; overlay-show (Live on) cancels that.
let _overlayWanted=false, _overlayTempTimer=null;
function overlayEnsure(){
  if(overlayWin && !overlayWin.isDestroyed()) return overlayWin;
  const { screen } = require('electron');
  // Big enough (transparent) to hold the dot AND its expanded panel + the hover ATC-chain flyout (v6.18.0);
  // only the dot/panel are painted, so the extra height is invisible + click-through.
  const wa=screen.getPrimaryDisplay().workArea, W=360, H=430, m=14;
  // Restore the user-dragged position when saved + still on a connected display (off-screen guard,
  // same idea as the main window's restore); else default to top-right.
  let ox=wa.x+wa.width-W-m, oy=wa.y+m;
  try{
    const pos=JSON.parse(fs.readFileSync(OVERLAY_POS,'utf8'));
    if(pos && Number.isFinite(pos.x) && Number.isFinite(pos.y)){
      const d=screen.getDisplayMatching({x:pos.x,y:pos.y,width:W,height:H}).workArea;
      if(pos.x>=d.x-W+80 && pos.x<=d.x+d.width-80 && pos.y>=d.y-10 && pos.y<=d.y+d.height-80){ ox=pos.x; oy=pos.y; }
    }
  }catch(_){}
  overlayWin=new BrowserWindow({
    width:W, height:H, x: ox, y: oy,
    frame:false, transparent:true, alwaysOnTop:true, skipTaskbar:true, resizable:false, movable:false,
    minimizable:false, maximizable:false, focusable:false, hasShadow:false, show:false,
    webPreferences:{ preload: path.join(__dirname,'preload.js'), contextIsolation:true, nodeIntegration:false, autoplayPolicy:'no-user-gesture-required' }   // v6.11.2: the overlay is shown inactive + click-through so it never gets a user gesture; without this the chime's AudioContext can start suspended and stay silent
  });
  try{ overlayWin.setAlwaysOnTop(true,'screen-saver'); }catch(_){}
  try{ overlayWin.setIgnoreMouseEvents(true,{forward:true}); }catch(_){}   // click-through by default; the renderer toggles it off only while the cursor is over the dot/panel (forward:true keeps mousemove flowing so it can detect that)
  overlayWin.loadFile('overlay.html');
  overlayWin.on('closed',()=>{ overlayWin=null; });
  return overlayWin;
}
// Eagerly show the persistent dot (called when Live mode turns on, if the overlay is enabled).
ipcMain.handle('overlay-show', () => {
  if(_cleanupDone) return {ok:false};
  _overlayWanted=true; clearTimeout(_overlayTempTimer);
  try{ const w=overlayEnsure(); w.showInactive(); }catch(e){ LOG.error('[Overlay] '+e.message); }
  return {ok:true};
});
// Push live recommendation state to the overlay each poll (dot/panel render + auto-expand on new-rec).
// v6.12.0: reads the capture engine's perf_live.json (written every 5s while recording; staleness-
// gated) and rides it along as payload.perf — the overlay's minimal RTSS-style strip. Zero new IPC;
// the LATC poll's 5s cadence is the clock.
function readPerfLive(){
  try{
    const j = JSON.parse(fs.readFileSync(path.join(USER_DATA, 'perf_live.json'), 'utf8'));
    if(!j || !j.ts || (Date.now() - j.ts) > 15000) return null;
    return j;
  }catch(_){ return null; }
}
ipcMain.handle('overlay-state', (_, payload) => {
  if(_cleanupDone) return {ok:false};
  // Self-heal (Dean 2026-07-18): if the overlay window died (renderer crash, OS kill) while Live mode
  // is still on, tell the renderer so it re-shows — the dot recreates on the next 5s poll instead of
  // staying gone until Live is toggled. Only when the push carries a LIVE state (an off state means
  // Live mode is being torn down — don't resurrect the window then).
  if(!overlayWin || overlayWin.isDestroyed()) return { ok:false, gone: !!(payload && payload.live) };
  try{
    payload = payload || {};
    payload.perf = readPerfLive();
    overlayWin.webContents.send('overlay-state', payload);
  }catch(_){}
  return {ok:true};
});
// The overlay renderer toggles click-through: false while the cursor is over the dot/panel, true otherwise.
// v6.11.6: drag-to-move the overlay dot. {dx,dy} nudges the window (clamped to the display's work
// area so the panel can never land off-screen); {save:true} persists the spot for next launch.
ipcMain.handle('overlay-move', (_, o) => {
  if(_cleanupDone || !overlayWin || overlayWin.isDestroyed()) return {ok:false};
  try{
    const { screen } = require('electron');
    if(o && o.save){ const [sx,sy]=overlayWin.getPosition(); writeFileAtomic(OVERLAY_POS, JSON.stringify({x:sx,y:sy})); return {ok:true, saved:true}; }
    const [x,y]=overlayWin.getPosition(), [w,h]=overlayWin.getSize();
    let nx=x+((o&&o.dx)||0), ny=y+((o&&o.dy)||0);
    const wa=screen.getDisplayMatching({x:nx,y:ny,width:w,height:h}).workArea;
    nx=Math.min(Math.max(nx,wa.x), wa.x+wa.width-w);
    ny=Math.min(Math.max(ny,wa.y), wa.y+wa.height-h);
    overlayWin.setPosition(Math.round(nx), Math.round(ny));
    return {ok:true};
  }catch(e){ return {ok:false}; }
});
ipcMain.handle('overlay-set-ignore', (_, o) => {
  try{ if(overlayWin && !overlayWin.isDestroyed()) overlayWin.setIgnoreMouseEvents(!!(o&&o.ignore), {forward:true}); }catch(_){}
  return {ok:true};
});
ipcMain.handle('overlay-toast', (_, payload) => {
  if(_cleanupDone) return {ok:false};   // QA fix (2026-07-09): a toast arriving mid-quit must not RE-CREATE the overlay window before-quit just destroyed
  try{
    const w=overlayEnsure(); w.showInactive(); w.webContents.send('overlay-toast', payload||{});
    // v6.12.8: toast with Live mode off → the window has no other owner; close it after the toast
    // instead of leaving a permanent grey dot. Re-armed per toast; overlay-show cancels it.
    if(!_overlayWanted){
      clearTimeout(_overlayTempTimer);
      _overlayTempTimer=setTimeout(()=>{ try{ if(!_overlayWanted && overlayWin && !overlayWin.isDestroyed()){ overlayWin.close(); overlayWin=null; } }catch(_){} }, ((payload&&payload.ms)||14000)+3000);
    }
  }catch(e){ LOG.error('[Overlay] '+e.message); } return {ok:true}; });
ipcMain.handle('overlay-hide', () => { _overlayWanted=false; clearTimeout(_overlayTempTimer); try{ if(overlayWin&&!overlayWin.isDestroyed())overlayWin.close(); }catch(_){} overlayWin=null; return {ok:true}; });



// Airspace boundaries (VATSpy Data Project) — FIR/ARTCC polygons + the callsign-prefix→boundary map, so
// the renderer can point-in-polygon-test whether a Center covers the user (V1 could only circle-guess
// airport positions). Cached in USER_DATA; Settings "refresh airspace data" re-pulls per AIRAC.
function _parseVatspyDat(txt){
  const prefixMap={}; let sec=null;
  for(const raw of txt.split('\n')){ const t=raw.replace(/\r/g,'').trim();
    if(/^\[.*\]$/.test(t)){ sec=t; continue; }
    if(!t||t.startsWith(';')) continue;
    if(sec==='[FIRs]'){ const c=t.split('|'); const pfx=(c[2]||c[0]||'').trim().toUpperCase(); const bnd=(c[3]||c[0]||'').trim(); if(pfx&&bnd)(prefixMap[pfx]=prefixMap[pfx]||[]).push(bnd); }
    else if(sec==='[UIRs]'){ const c=t.split('|'); const id=(c[0]||'').trim().toUpperCase(); const firs=(c[2]||'').split(',').map(s=>s.trim()).filter(Boolean); if(id&&firs.length)(prefixMap[id]=prefixMap[id]||[]).push(...firs); }
  }
  return prefixMap;
}
// v6.6 Stage 4b: SimAware TRACON boundaries (Approach/TRACON polygons). One combined GeoJSON published
// as a GitHub release asset; each feature carries properties.id (e.g. "A90") + properties.prefix[] (e.g.
// ["BOS"]) + a MultiPolygon. Build a map keyed by every id + prefix (uppercased) → geometry so an online
// Approach controller's callsign (BOS_APP→BOS, N90_APP→N90, NY_APP→NY, EGLL_APP→EGLL) resolves to its
// real TRACON shape. Renderer does the longest-prefix-first match (handles BOS_E_APP / EDGG_KL_APP).
function _parseSimawareTracons(txt){
  const tracons={}; let gj; try{ gj=JSON.parse(txt); }catch(_){ return tracons; }
  for(const f of (gj.features||[])){ if(!f.geometry) continue; const p=f.properties||{};
    const keys=new Set(); if(p.id) keys.add(String(p.id).toUpperCase());
    if(Array.isArray(p.prefix)) for(const pr of p.prefix){ if(pr) keys.add(String(pr).toUpperCase()); }
    // a big TRACON (N90, SCT, A90) is SPLIT across several sub-area features sharing one id — accumulate
    // ALL geometries per key so a combined position (N90_APP) covers the union of its sub-areas.
    for(const k of keys){ (tracons[k]=tracons[k]||[]).push(f.geometry); }
  }
  return tracons;
}
ipcMain.handle('airspace-data', async (_, o) => {
  const p=path.join(USER_DATA,'airspace.json');
  // sv:3 = adds VATGlasses sub-sector ownership data (altitude-aware, curated top-down); an older
  // cache (sv:2 TRACON-era or earlier) re-downloads once so users gain the new tier automatically.
  if(!(o&&o.refresh) && fs.existsSync(p)){ try{ const j=JSON.parse(fs.readFileSync(p,'utf8')); if(j.sv>=3 && j.boundaries && j.prefixMap && j.tracons && Object.keys(j.tracons).length) return {ok:true, cached:true, boundaries:j.boundaries, prefixMap:j.prefixMap, tracons:j.tracons, vg:j.vg||null}; }catch(_){} }
  try{
    const [geo,dat,trac]=await Promise.all([
      _httpGetLarge('https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson'),
      _httpGetLarge('https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat'),
      _httpGetLarge('https://github.com/vatsimnetwork/simaware-tracon-project/releases/latest/download/TRACONBoundaries.geojson')]);
    if(!geo||!dat) return {ok:false, error:'airspace data download failed'};
    const gj=JSON.parse(geo); const boundaries={};
    for(const f of (gj.features||[])){ const id=f.properties&&f.properties.id; if(id&&f.geometry) boundaries[id]=f.geometry; }
    const prefixMap=_parseVatspyDat(dat);
    const tracons=trac?_parseSimawareTracons(trac):{};
    // VATGlasses is an ENHANCER: a failed build ships null (FIR/TRACON tiers unaffected) and the cache
    // still writes sv:3 so launches don't re-download in a loop — Settings "refresh airspace data" retries.
    const vg=await _buildVatglasses();
    writeFileAtomic(p, JSON.stringify({boundaries, prefixMap, tracons, vg, ts:Date.now(), sv:3}));
    LOG.info('[Airspace] built: '+Object.keys(boundaries).length+' FIR boundaries, '+Object.keys(prefixMap).length+' prefixes, '+Object.keys(tracons).length+' TRACON keys, '
      +(vg?(Object.keys(vg.pos).length+' VATGlasses positions / '+vg.air.length+' airspaces'):'VATGlasses unavailable'));
    return {ok:true, cached:false, boundaries, prefixMap, tracons, vg};
  }catch(e){ LOG.error('[Airspace] failed: '+e.message); return {ok:false, error:e.message}; }
});
// Stage 4c — VATGlasses sub-sector data (github.com/lennycolton/vatglasses-data): one JSON per vACC
// with positions (callsign prefix + type + frequency), airspace volumes carrying ALTITUDE bounds, and
// owner lists in priority order. Compiled here ONCE into a slim index the renderer can point-test:
//   pos: { "ds/PID": {pre[], type, khz, cs} }
//   air: [ {o:[owner ids, priority order], ds, s:[{m,M (FL bounds), b:[bbox], r:[flat lat,lon ring]}]} ]
// Per-file try/catch — one malformed country file is skipped, never aborts the build. Runway-conditioned
// sectors are skipped in v1 (live runway config unknown). Coordinates arrive as "ddmmss"/"dddmmss"
// strings; parsed to decimal and rounded to 4 dp (~11 m — plenty for sector membership).
async function _buildVatglasses(){
  try{
    const listing=await _httpGetLarge('https://api.github.com/repos/lennycolton/vatglasses-data/contents/data');
    if(!listing) return null;
    const files=JSON.parse(listing).filter(f=>f&&f.type==='file'&&/\.json$/i.test(f.name)&&f.name!=='nodata.json');
    if(!files.length) return null;
    const pos={}, air=[];
    const dms=s=>{ s=String(s); const neg=s[0]==='-'; const t=neg?s.slice(1):s; const v=(+t.slice(0,-4))+(+t.slice(-4,-2))/60+(+t.slice(-2))/3600; return neg?-v:v; };
    let idx=0, skipped=0;
    const worker=async()=>{ for(;;){ const f=files[idx++]; if(!f) return;
      try{
        const txt=await _httpGetLarge('https://raw.githubusercontent.com/lennycolton/vatglasses-data/main/data/'+f.name);
        if(!txt){ skipped++; continue; }
        const j=JSON.parse(txt); const ds=f.name.replace(/\.json$/i,'');
        for(const pid of Object.keys(j.positions||{})){ const pp=j.positions[pid];
          const khz=pp.frequency?Math.round(parseFloat(pp.frequency)*1000):null;
          pos[ds+'/'+pid]={pre:(pp.pre||[]).map(x=>String(x).toUpperCase()), type:String(pp.type||'').toUpperCase(), khz:(isFinite(khz)&&khz>0)?khz:null, cs:pp.callsign||''};
        }
        for(const a of (j.airspace||[])){
          const owners=(a.owner||[]).map(o=>String(o).includes('/')?String(o):ds+'/'+o);
          if(!owners.length) continue;
          const secs=[];
          for(const s of (a.sectors||[])){
            if(s.runways) continue;
            const ring=[]; let bLat=90,BLat=-90,bLon=180,BLon=-180; let bad=false;
            for(const pt of (s.points||[])){
              const la=Math.round(dms(pt[0])*1e4)/1e4, lo=Math.round(dms(pt[1])*1e4)/1e4;
              if(!isFinite(la)||!isFinite(lo)||Math.abs(la)>90||Math.abs(lo)>180){ bad=true; break; }
              ring.push(la,lo); if(la<bLat)bLat=la; if(la>BLat)BLat=la; if(lo<bLon)bLon=lo; if(lo>BLon)BLon=lo;
            }
            if(!bad && ring.length>=6) secs.push({m:(s.min==null?0:s.min), M:(s.max==null?999:s.max), b:[bLat,bLon,BLat,BLon], r:ring});
          }
          if(secs.length) air.push({o:owners, ds, s:secs});
        }
      }catch(e){ skipped++; LOG.info('[Airspace] VATGlasses skip '+f.name+': '+e.message); }
    }};
    await Promise.all([worker(),worker(),worker(),worker(),worker(),worker()]);
    if(!Object.keys(pos).length || !air.length) return null;
    if(skipped) LOG.info('[Airspace] VATGlasses: '+skipped+' file(s) skipped');
    return {pos, air};
  }catch(e){ LOG.error('[Airspace] VATGlasses build failed: '+e.message); return null; }
}

// Global airport DB (OurAirports, public domain) — slim {icao,lat,lon,twr(MHz)} for medium+large
// airports, cached in USER_DATA. Powers nearest-airport, CTAF (tower freq), and geo-locating tower/
// ground/approach controllers from their callsign (the datafeed gives controllers no lat/lon).
function _httpGetLarge(url, depth=0){
  return new Promise(resolve=>{
    try{
      const req=https.get(url,{headers:{'User-Agent':'ABRP-RoutePlanner'}},res=>{
        if(res.statusCode>=300&&res.statusCode<400&&res.headers.location){ res.resume(); if(depth>=5) return resolve(''); return resolve(_httpGetLarge(res.headers.location, depth+1)); }
        if(res.statusCode!==200){ res.resume(); return resolve(''); }
        let d=''; res.on('data',c=>d+=c); res.on('end',()=>resolve(d));
      });
      req.on('error',()=>resolve('')); req.setTimeout(30000,()=>{ req.destroy(); resolve(''); });
    }catch(_){ resolve(''); }
  });
}
function _csvLine(line){ const out=[]; let cur='',q=false; for(let i=0;i<line.length;i++){ const c=line[i]; if(q){ if(c==='"'){ if(line[i+1]==='"'){cur+='"';i++;} else q=false; } else cur+=c; } else { if(c==='"')q=true; else if(c===','){out.push(cur);cur='';} else cur+=c; } } out.push(cur); return out; }
ipcMain.handle('live-airport-db', async (_, opts) => {
  const p = path.join(USER_DATA, 'airport_db.json');
  if(!(opts&&opts.refresh) && fs.existsSync(p)){ try{ return {ok:true, cached:true, airports:JSON.parse(fs.readFileSync(p,'utf8'))}; }catch(_){} }
  try{
    const [aptCsv, freqCsv] = await Promise.all([
      _httpGetLarge('https://davidmegginson.github.io/ourairports-data/airports.csv'),
      _httpGetLarge('https://davidmegginson.github.io/ourairports-data/airport-frequencies.csv'),
    ]);
    if(!aptCsv) return {ok:false, error:'airport data download failed (check your connection)'};
    const rank={TWR:3,CTAF:2,UNIC:1}, bestFreq={};
    if(freqCsv){ const L=freqCsv.split('\n'); const h=_csvLine(L[0]); const iId=h.indexOf('airport_ident'), iTy=h.indexOf('type'), iF=h.indexOf('frequency_mhz');
      for(let i=1;i<L.length;i++){ if(!L[i])continue; const f=_csvLine(L[i]); const id=f[iId], ty=(f[iTy]||'').toUpperCase(), mhz=parseFloat(f[iF]); const r=rank[ty]||0; if(!id||!r||!(mhz>0))continue; if(!bestFreq[id]||r>bestFreq[id].r) bestFreq[id]={r,mhz}; } }
    const airports=[]; { const L=aptCsv.split('\n'); const h=_csvLine(L[0]); const iIdent=h.indexOf('ident'), iType=h.indexOf('type'), iLat=h.indexOf('latitude_deg'), iLon=h.indexOf('longitude_deg');
      for(let i=1;i<L.length;i++){ if(!L[i])continue; const f=_csvLine(L[i]); const type=f[iType]; if(type!=='large_airport'&&type!=='medium_airport')continue; const icao=(f[iIdent]||'').trim().toUpperCase(); const lat=parseFloat(f[iLat]), lon=parseFloat(f[iLon]); if(!icao||isNaN(lat)||isNaN(lon))continue; const bf=bestFreq[icao]; airports.push({icao,lat,lon,twr:bf?bf.mhz:null}); } }
    writeFileAtomic(p, JSON.stringify(airports));
    LOG.info('[LiveATC] airport DB built: '+airports.length+' airports');
    return {ok:true, cached:false, airports};
  }catch(e){ LOG.error('[LiveATC] airport DB failed: '+e.message); return {ok:false, error:e.message}; }
});
ipcMain.on('renderer-log',(_,msg)=>LOG.info('[RENDERER]',msg));
ipcMain.on('win-minimize',()=>win.minimize());
ipcMain.on('win-maximize',()=>win.isMaximized()?win.unmaximize():win.maximize());
ipcMain.on('win-close',()=>win.close());
ipcMain.on('open-external',(_,url)=>shell.openExternal(url));
