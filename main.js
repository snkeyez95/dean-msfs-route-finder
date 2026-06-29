const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const https  = require('https');
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

function checkForUpdate() {
  if (app.isPackaged) {
    // Installed .exe — use electron-updater to download and apply updates
    const { autoUpdater } = require('electron-updater');
    autoUpdater.logger = { info: m => LOG.info('[AU]', m), warn: m => LOG.warn('[AU]', m), error: m => LOG.error('[AU]', m) };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.on('update-available', info => {
      LOG.info('[AU] Update available: v' + info.version);
      if (win && !win.isDestroyed()) win.webContents.send('update-available', info.version);
    });
    autoUpdater.on('update-downloaded', info => {
      LOG.info('[AU] Update downloaded: v' + info.version);
      if (win && !win.isDestroyed()) win.webContents.send('update-downloaded', info.version);
    });
    autoUpdater.on('error', e => LOG.error('[AU] Error:', e.message));
    autoUpdater.checkForUpdates().catch(e => LOG.warn('[AU] Check failed:', e.message));
  } else {
    // Dev mode — compare raw GitHub index.html version string, prompt to run update.bat
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
      const d = path.join(dest, f);
      if(!fs.existsSync(d)) fs.copyFileSync(path.join(vendor, f), d);
    }
  }catch(e){ try{LOG.warn('seedPerfLibs failed: '+e.message);}catch(_){} }
}
let _perfAllowClose = false;
function createWindow() {
  seedPerfLibs();
  // Catch-up: if a prior run closed apps but never reopened them (ABRP/sim ended early) and the
  // sim isn't running now, reopen them so nothing stays closed.
  try { if (fs.existsSync(FLIGHT_STATE()) && !isMsfsRunning()) { _flightReopenPending = true; flightReopenApps(); } } catch(_){}
  win = new BrowserWindow({
    width:1440, height:900, minWidth:1100, minHeight:700,
    frame:false, backgroundColor:'#000000',
    webPreferences:{
      preload: path.join(__dirname,'preload.js'),
      contextIsolation:true, nodeIntegration:false
    }
  });
  // "Sim is running — confirm close" guard (Dean's ask). Capture runs detached, so closing
  // ABRP never affects it; this is just a deliberate heads-up.
  win.on('close', (e) => {
    if (_perfAllowClose) return;
    let simUp = false; try { simUp = isMsfsRunning(); } catch (_) {}
    if (!simUp) return;
    e.preventDefault();
    const choice = dialog.showMessageBoxSync(win, {
      type:'question', buttons:['Close ABRP','Cancel'], defaultId:0, cancelId:1, noLink:true,
      title:'MSFS is running', message:'MSFS 2024 is still running.',
      detail:'Closing ABRP is fine — any active performance capture runs independently and will keep recording, filing on its own when you close the sim. Close ABRP now?'
    });
    if (choice === 0) { _perfAllowClose = true; win.close(); }
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
    if(win){ if(win.isMinimized()) win.restore(); win.focus(); }
  });
  app.whenReady().then(createWindow);
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
    LOG.info('scan-folder found', folders.length, 'subfolders');
    return {success:true,folders};
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

ipcMain.handle('gsx-install-bundled', (_, {files, gsxFolder})=>{
  const dir=gsxResolveDir(gsxFolder);
  const copied=[], errors=[];
  try{ fs.mkdirSync(dir,{recursive:true}); }catch(e){}
  for(const src of (files||[])){
    try{
      const dest=path.join(dir, path.basename(src));
      fs.copyFileSync(src, dest);
      copied.push(path.basename(src));
      LOG.info('[GSX] installed', path.basename(src), '->', dir);
    }catch(e){ errors.push(path.basename(src)+': '+e.message); LOG.error('[GSX] install failed:', e.message); }
  }
  return {ok:errors.length===0, copied, errors};
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
    const r=cp.spawnSync('powershell',
      ['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath "${archivePath}" -DestinationPath "${tmp}" -Force`],
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
ipcMain.handle('gsx-install-dropped', (_, {paths, gsxFolder})=>{
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
  for(const src of collect){
    try{
      const dest=path.join(dir, path.basename(src));
      fs.copyFileSync(src, dest);
      copied.push(path.basename(src));
      LOG.info('[GSX] dropped install', path.basename(src), '->', dir);
    }catch(e){ errors.push(path.basename(src)+': '+e.message); LOG.error('[GSX] dropped copy failed:', e.message); }
  }
  for(const t of tmpDirs){ try{ fs.rmSync(t,{recursive:true,force:true}); }catch(e){} }
  return {ok:errors.length===0, copied, skipped, errors, needTool};
});

const CFG = path.join(USER_DATA, 'config.json');
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
ipcMain.handle('load-config',()=>{try{const c=JSON.parse(fs.readFileSync(CFG,'utf8'));LOG.info('load-config: loaded, savedRows='+((c.savedRows||[]).length)+' registry='+(Object.keys(c.routeRegistry||{}).length));return c;}catch(e){LOG.warn('load-config: no config found, starting fresh');return {};}});
ipcMain.handle('save-config',(_,cfg)=>{
  try{
    // Read existing file so we never clobber routeRegistry, which is written
    // independently by si-save-registry and is not held in the renderer's S.cfg.
    let existing={};
    try{existing=JSON.parse(fs.readFileSync(CFG,'utf8'));}catch(e){}
    const merged=Object.assign({},existing,cfg);
    // Carry forward routeRegistry if the incoming cfg doesn't include it
    if(existing.routeRegistry&&!cfg.routeRegistry)merged.routeRegistry=existing.routeRegistry;
    // Remove retired AirLabs key
    delete merged.routeCache;
    fs.writeFileSync(CFG,JSON.stringify(merged,null,2));
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
    const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    const reg = c.routeRegistry || {};
    LOG.info('[SI] Registry loaded: ' + Object.keys(reg).length + ' entries');
    return reg;
  } catch(e) {
    LOG.warn('si-get-registry: error', e.message);
    return {};
  }
});

ipcMain.handle('si-save-registry', (_, registry) => {
  try {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch(e) {}
    c.routeRegistry = registry;
    // Remove retired AirLabs key
    delete c.routeCache;
    LOG.info('[SI] Saving registry: ' + Object.keys(registry).length + ' entries');
    fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
    LOG.info('[SI] Registry saved successfully');
  } catch(e) {
    LOG.error('si-save-registry failed:', e.message);
  }
});

ipcMain.handle('si-get-snapshot', () => {
  try {
    const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
    const snap = c.routeRegistrySnapshot || {};
    LOG.info('[SI] Snapshot loaded: ' + Object.keys(snap).length + ' entries');
    return snap;
  } catch(e) {
    LOG.warn('si-get-snapshot: error', e.message);
    return {};
  }
});

ipcMain.handle('si-save-snapshot', (_, snapshot) => {
  try {
    let c = {};
    try { c = JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch(e) {}
    c.routeRegistrySnapshot = snapshot;
    delete c.routeCache;
    LOG.info('[SI] Saving snapshot: ' + Object.keys(snapshot).length + ' entries');
    fs.writeFileSync(CFG, JSON.stringify(c, null, 2));
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
    fs.writeFileSync(COMMUNITY_ROUTES, JSON.stringify({routes}, null, 2));
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
    fs.writeFileSync(COMMUNITY_ROUTES, JSON.stringify({routes}, null, 2));
    LOG.info('[SI] community_routes.json updated: ' + routes.length + ' routes to ' + COMMUNITY_ROUTES);
    // Auto-publish only makes sense in dev where git is set up
    if (!app.isPackaged) {
      const pub = spawn('cmd', ['/c', path.join(__dirname, 'publish.bat')], {
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

ipcMain.handle('activate-scenery', (_, {dep, arr, depFolder, arrFolder, libraryFolder, communityFolder}) => {
  const created = [], skipped = [], errors = [];
  for (const [icao, folder] of [[dep, depFolder], [arr, arrFolder]]) {
    if (!folder) continue;
    const src = path.join(libraryFolder, folder);
    const dest = path.join(communityFolder, folder);
    try {
      if (fs.existsSync(dest)) {
        skipped.push(folder);
        LOG.info(`[SCENE] ${icao}: junction already exists at ${dest}`);
      } else {
        fs.symlinkSync(src, dest, 'junction');
        created.push(folder);
        LOG.info(`[SCENE] ${icao}: junction created ${dest} -> ${src}`);
      }
    } catch(e) {
      errors.push(folder + ': ' + e.message);
      LOG.error(`[SCENE] ${icao}: junction failed:`, e.message);
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
    try{ fs.writeFileSync(CFG, JSON.stringify(cfg, null, 2)); LOG.info('[QUIT] cleared scenery + aircraft activations'); }
    catch(e){ LOG.error('[QUIT] config write failed: ' + e.message); }
  }
}
let _cleanupDone = false;
app.on('before-quit', () => { if(_cleanupDone) return; _cleanupDone = true; cleanupActivationsOnQuit(); });
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
function datisGet(url){
  return new Promise(resolve => {
    try{
      const req = https.get(url, {headers:{'User-Agent':'ABRP-RoutePlanner'}}, res => {
        // follow one redirect (atis.info → datis.clowd.io etc.)
        if(res.statusCode >= 300 && res.statusCode < 400 && res.headers.location){
          res.resume();
          return resolve(datisGet(res.headers.location));
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
function parseAtisInfo(body){
  let arr=null, dep=null, combined=null, metar=null;
  let json; try{ json = JSON.parse(body); }catch(e){ return {hasData:false}; }
  if(!Array.isArray(json) || !json.length) return {hasData:false};
  for(const el of json){
    if(!el || !el.datis) continue;
    const block = {letter: el.code || datisLetterOf(el.datis), time: el.time || datisTimeOf(el.datis), text: el.datis.trim()};
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
    if(!res || res.status < 200 || res.status >= 400 || !res.body){
      LOG.info(`[DATIS] ${id} via ${source}: no data (status ${res&&res.status})`);
      return {...base, source};
    }
    const parsed = source === 'atis.info' ? parseAtisInfo(res.body) : parseAtisGuru(res.body);
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
  if (fs.existsSync(steamCommunity)) {
    LOG.info('[DETECT] MSFS 2024 Steam detected. Community:', steamCommunity);
    return {version: 'steam', communityFolder: steamCommunity, steamExe: defaultSteamExe};
  }
  if (fs.existsSync(storeCommunity)) {
    LOG.info('[DETECT] MSFS 2024 Store detected. Community:', storeCommunity);
    return {version: 'store', communityFolder: storeCommunity};
  }
  LOG.info('[DETECT] MSFS 2024 not found at known paths');
  return {version: null, communityFolder: null};
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
    const ringsToPath = rings =>
      rings.map(ring =>
        'M' + ring.map(([lon, lat]) => px(lon).toFixed(1) + ',' + py(lat).toFixed(1)).join('L') + 'Z'
      ).join('');
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
    try { const c = JSON.parse(fs.readFileSync(CFG, 'utf8'));
      killAfter = (c.flightCloseApps||[]).filter(a=>a&&a.enabled!==false&&a.mode==='kill-after').map(a=>a.name); } catch(_){}
    const sf = FLIGHT_STATE();
    // Node owns the data: read + parse the state file here (Node's JSON is reliable across any
    // Windows PowerShell version — 5.1's `@(... | ConvertFrom-Json)` collapses an N-element array
    // to 1, which silently broke the reopen before). Embed the paths as a PowerShell array literal,
    // the same way the kill list is passed.
    let paths = [];
    try { const raw = fs.readFileSync(sf, 'utf8'); const j = JSON.parse(raw); if (Array.isArray(j)) paths = j.filter(Boolean); } catch(_){}
    const killPs  = killAfter.map(n=>`'${String(n).replace(/'/g,"''")}'`).join(',');
    const pathsPs = paths.map(p=>`'${String(p).replace(/'/g,"''")}'`).join(',');
    // PowerShell only does the OS actions: kill the kill-after apps, then for each path skip if it's
    // already running, relaunch via a matching Startup shortcut (the *arr suite / SABnzbd) else plain
    // exe launch (Plex, qbPortWeaver). Per-app outcome logged so any failure names the exact app.
    const ps = spawn('powershell', ['-NoProfile','-NonInteractive','-Command',
      `$kill=@(${killPs}); foreach($n in $kill){ Get-Process -Name $n -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue }
       $paths=@(${pathsPs})
       $reopened=0; $log=@()
       $running=@(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {$_.ExecutablePath} | ForEach-Object { $_.ExecutablePath.ToLower() })
       $dirs=@("$env:APPDATA\\Microsoft\\Windows\\Start Menu\\Programs\\Startup","$env:ProgramData\\Microsoft\\Windows\\Start Menu\\Programs\\Startup")
       $sh=New-Object -ComObject WScript.Shell; $byPath=@{}; $byName=@{}
       foreach($d in $dirs){ if(Test-Path $d){ Get-ChildItem $d -Filter '*.lnk' -ErrorAction SilentlyContinue | ForEach-Object {
         try{ $lnk=$sh.CreateShortcut($_.FullName); $t=$lnk.TargetPath; if($t){ $byPath[$t.ToLower()]=$_.FullName; $bn=[System.IO.Path]::GetFileName($t).ToLower(); if(-not $byName.ContainsKey($bn)){ $byName[$bn]=$_.FullName } } }catch{} } } }
       foreach($p in $paths){
         $nm=[System.IO.Path]::GetFileName($p)
         if(-not (Test-Path -LiteralPath $p)){ $log+=('MISSING:'+$nm); continue }
         if($running -contains $p.ToLower()){ $log+=('RUNNING:'+$nm); continue }
         $bn=[System.IO.Path]::GetFileName($p).ToLower()
         $lnk = if($byPath.ContainsKey($p.ToLower())){$byPath[$p.ToLower()]} elseif($byName.ContainsKey($bn)){$byName[$bn]} else {$null}
         $m=''
         if($lnk){ try{ Start-Process -FilePath $lnk; $m='shortcut' }catch{} }
         if(-not $m){ try{ Start-Process -FilePath $p; $m='path' }catch{ $log+=('ERR:'+$nm) } }
         if($m){ $reopened++; $log+=('OK['+$m+']:'+$nm) }
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
             foreach($pr in $procs){ try{
               $ep=$pr.Path
               if(-not $ep){ $ci=Get-CimInstance Win32_Process -Filter ("ProcessId="+$pr.Id) -ErrorAction SilentlyContinue; if($ci){ $ep=$ci.ExecutablePath } }
               if($ep){ Write-Output ('RPATH|'+$ep) }
             }catch{} }
           }
           $procs | Stop-Process -Force -ErrorAction SilentlyContinue } }`],
      { windowsHide:true });
    let cout=''; ps.stdout.on('data',d=>cout+=d);
    ps.on('close', () => {
      const reopenPaths = [...new Set(cout.split(/\r?\n/).filter(l=>l.indexOf('RPATH|')===0).map(l=>l.slice(6).trim()).filter(Boolean))];
      try { fs.writeFileSync(FLIGHT_STATE(), JSON.stringify(reopenPaths)); } catch(e){ try{LOG.warn('[FLIGHT] state write failed: '+e.message);}catch(_){} }
      LOG.info('[FLIGHT] closed: '+closeNow.join(', ')+' | SAVED '+reopenPaths.length+' reopen target(s)');
      _flightReopenPending = true; startFlightWatch();
      resolve({ ok:true, closed:closeNow.length });
    });
    ps.on('error', e => resolve({ ok:false, error:e.message }));
  } catch (e) { resolve({ ok:false, error:e.message }); }
}));

// Arm a performance capture for the next flight: spawn the engine headless + auto-start.
// Detached + unref so closing ABRP never kills an in-flight capture (matches the set-and-forget
// workflow). Uses the bundled perf-engine.exe when present, else system Python (dev). The engine
// writes into the data home via MSFS_PERF_ROOT.
ipcMain.handle('perf-start-capture', () => {
  try {
    const dir    = perfDir();
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
ipcMain.on('install-update', () => {
  // Exit FAST so the NSIS installer doesn't catch ABRP mid-shutdown ("cannot be closed / Retry").
  // electron-updater on Windows quits via the normal `before-quit` path (it does NOT emit
  // `before-quit-for-update` — that's the macOS/Squirrel path), so set the skip-flags here: bypass
  // the close-confirm dialog and the slow on-quit scenery cleanup. Junctions are left for the
  // freshly-installed copy to tidy on its next normal close.
  _perfAllowClose = true; _cleanupDone = true;
  require('electron-updater').autoUpdater.quitAndInstall();
});
ipcMain.on('renderer-log',(_,msg)=>LOG.info('[RENDERER]',msg));
ipcMain.on('win-minimize',()=>win.minimize());
ipcMain.on('win-maximize',()=>win.isMaximized()?win.unmaximize():win.maximize());
ipcMain.on('win-close',()=>win.close());
ipcMain.on('open-external',(_,url)=>shell.openExternal(url));
