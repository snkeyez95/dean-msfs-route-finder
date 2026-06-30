'use strict';
// Phase 8a — native port of read_settings (msfs_perf_logger.py:344) + _search_float (334). Reads
// TLOD/OLOD + upscaler/frame-gen from UserCfg.opt's flat {Graphics} block (NOT {GraphicsVR}).
// PORT — must match Python (validated by _parity_settings.js against the real UserCfg.opt).
const fs = require('fs');
const { pyRound } = require('./stats.js');

function searchFloat(text, re){ const m = text.match(re); if(!m) return null; const v = Number(m[1]); return Number.isNaN(v) ? null : v; }
function pyTitle(s){ return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase(); }  // single-word .title()

function readSettings(usercfgPath){
  const settings = { tlod:null, olod:null, upscaling:null, frame_gen:null, target_fps:null, fg_multiplier:null, texture_quality:null, usercfg_found:false };
  try {
    if(!fs.existsSync(usercfgPath)) return settings;
    const text = fs.readFileSync(usercfgPath, 'utf8');
    settings.usercfg_found = true;

    // scope to the flat {Graphics} section (desktop), not {GraphicsVR}
    let gfx = text;
    const mGfx = text.match(/\{Graphics(?!VR)/i);
    if(mGfx){
      const start = mGfx.index + mGfx[0].length;
      const mVr = text.match(/\{GraphicsVR/i);
      const end = (mVr && mVr.index > start) ? mVr.index : text.length;
      gfx = text.slice(start, end);
    }
    const mTlod = gfx.match(/\{Terrain\b[\s\S]*?LoDFactor\s+([0-9.]+)/i);
    if(mTlod) settings.tlod = pyRound(parseFloat(mTlod[1]) * 100, 0);
    const mOlod = gfx.match(/\{ObjectsLoD\b[\s\S]*?LoDFactor\s+([0-9.]+)/i);
    if(mOlod) settings.olod = pyRound(parseFloat(mOlod[1]) * 100, 0);

    const aa = text.match(/AntiAliasing\s+(\w+)/i);
    if(aa){
      const method = aa[1].toUpperCase();
      let up = method;
      if(method.startsWith('FSR')){ const mode = text.match(/FSRMode\s+(\w+)/i); if(mode) up = 'FSR ' + pyTitle(mode[1]); }
      else if(method === 'DLSS' || method === 'DLAA'){ const mode = text.match(/DLSSMode\s+(\w+)/i); if(mode) up = method + ' ' + pyTitle(mode[1]); }
      settings.upscaling = up;
    }
    const fg = text.match(/FrameGeneration\s+(\w+)/i);
    if(fg){ const k = fg[1].toUpperCase(); settings.frame_gen = ({ FSRFG:'FSR FG', DLSSFG:'DLSS FG', NONE:'off', OFF:'off' })[k] || fg[1]; }

    const tfps = searchFloat(text, /TargetFrameRate\s+([0-9.]+)/i);
    if(tfps != null) settings.target_fps = Math.trunc(tfps);
    const nbf = searchFloat(text, /NBFramesToGenerate\s+([0-9.]+)/i);
    if(nbf != null) settings.fg_multiplier = Math.trunc(nbf) + 1;
    // texture_quality intentionally left null (mirrors Python — unreliable to parse)
  } catch(e){}
  return settings;
}

// Pure-string side of write_settings (msfs_perf_logger.py:534) — the surgical TLOD/OLOD swap in the
// flat {Graphics} block. Returns {ok, text} (the new file content) or {ok:false, reason}. File I/O +
// backup live in the caller (main.js later). Newlines normalized to \n to match Python's text-mode read.
function writeSettingsText(rawText, tlod, olod){
  tlod = Math.max(10, Math.min(Math.trunc(tlod), 400));
  olod = Math.max(10, Math.min(Math.trunc(olod), 400));
  const text = rawText.replace(/\r\n?/g, '\n');            // universal newlines (Python read does this)
  const mGfx = text.match(/\{Graphics(?!VR)/i);
  if(!mGfx) return { ok:false, reason:'no-graphics' };
  const start = mGfx.index + mGfx[0].length;
  const mVr = text.match(/\{GraphicsVR/i);
  const end = (mVr && mVr.index > start) ? mVr.index : text.length;
  const head = text.slice(0, start); let gfx = text.slice(start, end); const tail = text.slice(end);
  function replaceInBlock(block, name, value){
    const re = new RegExp('(\\{' + name + '\\b[\\s\\S]*?LoDFactor\\s+)([0-9.]+)', 'i');  // first match only (count=1)
    let n = 0;
    const out = block.replace(re, (m, g1) => { n++; return g1 + (value / 100.0).toFixed(6); });
    return { out, n };
  }
  const rt = replaceInBlock(gfx, 'Terrain', tlod); gfx = rt.out;
  const ro = replaceInBlock(gfx, 'ObjectsLoD', olod); gfx = ro.out;
  if(rt.n === 0 || ro.n === 0) return { ok:false, reason:'no-lod-lines', nT:rt.n, nO:ro.n };
  return { ok:true, text: head + gfx + tail };
}

module.exports = { readSettings, searchFloat, writeSettingsText };
