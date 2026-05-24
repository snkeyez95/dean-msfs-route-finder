const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');
const https = require('https');

// ── FILE LOGGER ──────────────────────────────────────────────────────────────
const LOG_PATH = path.join(os.homedir(), 'dean_msfs_debug.log');
function redact(str) {
  // Redact AirLabs API keys (32-char hex strings)
  return String(str).replace(/[a-f0-9]{32}/gi, '***REDACTED***');
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
    `Dean's MSFS Route Finder — Session started ${new Date().toISOString()}\n` +
    `Platform: ${process.platform} | Node: ${process.version} | Electron: ${process.versions.electron}\n` +
    '='.repeat(80) + '\n'
  );
} catch(e) {}
LOG.info('App starting');

// Fix GPU cache errors when running as Administrator on Windows
app.setPath('userData',    path.join(os.homedir(), '.dean-msfs-cache'));
app.setPath('sessionData', path.join(os.homedir(), '.dean-msfs-session'));

app.commandLine.appendSwitch('disable-gpu');
app.commandLine.appendSwitch('disable-gpu-sandbox');
app.commandLine.appendSwitch('no-sandbox');
app.commandLine.appendSwitch('disable-software-rasterizer');
app.commandLine.appendSwitch('disable-gpu-compositing');
app.commandLine.appendSwitch('in-process-gpu');
app.commandLine.appendSwitch('disable-dev-shm-usage');
app.commandLine.appendSwitch('disable-features', 'VizDisplayCompositor,UseSkiaRenderer');
app.commandLine.appendSwitch('use-angle', 'swiftshader');

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

const CFG=path.join(os.homedir(),'.dean_msfs_v4.json');
ipcMain.handle('load-config',()=>{try{const c=JSON.parse(fs.readFileSync(CFG,'utf8'));LOG.info('load-config: loaded, savedRows='+((c.savedRows||[]).length)+' routeCache airports='+(Object.keys(c.routeCache||{}).length));return c;}catch(e){LOG.warn('load-config: no config found, starting fresh');return {};}});
ipcMain.handle('save-config',(_,cfg)=>{try{fs.writeFileSync(CFG,JSON.stringify(cfg,null,2));LOG.info('save-config: saved savedRows='+(cfg.savedRows||[]).length);}catch(e){LOG.error('save-config failed:',e.message);}});

ipcMain.handle('airlabs-routes',(_,{icao,key})=>new Promise(resolve=>{
  const opts={
    hostname:'airlabs.co',
    path:`/api/v9/routes?dep_icao=${encodeURIComponent(icao)}&api_key=${encodeURIComponent(key)}`,
    method:'GET',
    headers:{'Accept':'application/json','User-Agent':'DeanMSFSRouteFinder/4.0'}
  };
  const req=https.request(opts,res=>{
    let data='';
    res.on('data',c=>data+=c);
    res.on('end',()=>{
      try{
        const parsed=JSON.parse(data);
        const count=(parsed.response||[]).length;
        LOG.info('airlabs-routes response: status='+res.statusCode+' routes='+count+' icao='+icao);
        resolve({ok:res.statusCode<300,status:res.statusCode,data:parsed});
      }catch(e){
        LOG.error('airlabs-routes parse error: status='+res.statusCode+' raw='+data.slice(0,200));
        resolve({ok:false,status:res.statusCode,data:null});
      }
    });
  });
  req.on('error',e=>{LOG.error('airlabs-routes network error:',e.message);resolve({ok:false,error:e.message});});
  req.setTimeout(15000,()=>{req.destroy();resolve({ok:false,error:'timeout'});});
  req.end();
}));

ipcMain.handle('get-log-path',()=>LOG_PATH);
ipcMain.on('renderer-log',(_,msg)=>LOG.info('[RENDERER]',msg));
ipcMain.on('win-minimize',()=>win.minimize());
ipcMain.on('win-maximize',()=>win.isMaximized()?win.unmaximize():win.maximize());
ipcMain.on('win-close',()=>win.close());
ipcMain.on('open-external',(_,url)=>shell.openExternal(url));
