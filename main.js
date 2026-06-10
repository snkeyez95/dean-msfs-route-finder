const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path   = require('path');
const fs     = require('fs');
const os     = require('os');
const https  = require('https');
const { spawn } = require('child_process');

// ── USER DATA DIR ─────────────────────────────────────────────────────────────
// All writable files live under %APPDATA%\A Better Route Planner\
const USER_DATA = app.getPath('userData');
if (!fs.existsSync(USER_DATA)) fs.mkdirSync(USER_DATA, { recursive: true });

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
function createWindow() {
  win = new BrowserWindow({
    width:1440, height:900, minWidth:1100, minHeight:700,
    frame:false, backgroundColor:'#000000',
    webPreferences:{
      preload: path.join(__dirname,'preload.js'),
      contextIsolation:true, nodeIntegration:false
    }
  });
  win.loadFile('index.html');
  win.webContents.once('did-finish-load', checkForUpdate);
}
app.whenReady().then(createWindow);
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

const CFG = path.join(USER_DATA, 'config.json');
// One-time migration: copy old home-root config to new userData location
(()=>{
  const OLD_CFG = path.join(os.homedir(), '.dean_msfs_v4.json');
  if (!fs.existsSync(CFG) && fs.existsSync(OLD_CFG)) {
    try { fs.copyFileSync(OLD_CFG, CFG); LOG.info('Config migrated from', OLD_CFG); }
    catch(e) { LOG.warn('Config migration failed:', e.message); }
  }
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
    filters: [{name: 'Executables', extensions: ['exe']}],
  });
  return res.canceled ? null : {filePath: res.filePaths[0]};
});

ipcMain.handle('launch-app', (_, {path: appPath}) => {
  try {
    const child = spawn(appPath, [], {detached: true, stdio: 'ignore'});
    child.unref();
    LOG.info('[LAUNCH] App launched:', appPath);
    return {ok: true};
  } catch(e) {
    LOG.error('[LAUNCH] Failed to launch app:', e.message);
    return {ok: false, error: e.message};
  }
});

ipcMain.handle('get-log-path',()=>LOG_PATH);
ipcMain.on('install-update', () => { require('electron-updater').autoUpdater.quitAndInstall(); });
ipcMain.on('renderer-log',(_,msg)=>LOG.info('[RENDERER]',msg));
ipcMain.on('win-minimize',()=>win.minimize());
ipcMain.on('win-maximize',()=>win.isMaximized()?win.unmaximize():win.maximize());
ipcMain.on('win-close',()=>win.close());
ipcMain.on('open-external',(_,url)=>shell.openExternal(url));
