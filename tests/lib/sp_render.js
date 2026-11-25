'use strict';
// The REAL Sim Profiles page renderer, pulled out of index.html (v6.37.0 layout): status line, the three
// cards with their "flies next" dot, details, next test, More. Feed it what the store's list() returns and
// it gives back the HTML Dean would see. Only browser globals are stubbed — never our own logic.
const X = require('./extract.js');

const FNS = ['_spK', '_spEq', '_spDisp', '_spDir', '_spDirTag', '_spMatches', '_spDiff', '_spChips', '_spTrack', 'profilesRange',
  '_spSection', '_spRender', '_spCard', '_spSettingsTable', '_spExpCard', '_spPastePanel', '_spDots', '_spStartCard', '_spClipCard',
  '_spDupOf', '_spExpActions', '_spStatus', '_spNotices', '_spMetrics', '_spTri', '_spTriDetail', '_spIdeas'];
const line = re => { const m = X.html.match(re); if (!m) throw new Error('not found in index.html: ' + re); return m[0]; };

function makeRenderer() {
  const els = {};
  const src = 'let _SP=null, _spOpen={}, _spDiffOnly=true, _spConfirm=null, _spMsg=null, _spRenaming=null, _spShowSafety=false, _spShowRuns=false;\n'
    + 'let _spPaste={open:false,text:"",preview:null}, _spShowFinished=false;\n'
    + line(/let _spClip=null[^\n]*/) + '\n'
    + line(/const _SP_BAN=[^\n]*/) + '\n'
    + 'const document={getElementById:id=>(els[id]=els[id]||{innerHTML:"",focus(){},select(){},scrollIntoView(){}}),querySelector:()=>null};\n'
    + line(/const _LABV=\{[\s\S]*?\n\};/) + '\n' + line(/const _SP_EXP_STATUS=[^\n]*/) + '\n'
    + line(/const _SPT=[^\n]*/) + '\n' + line(/const _spWord=[^\n]*/) + '\n' + line(/const _spShort=[^\n]*/) + '\n' + line(/const _spPri=[^\n]*/) + '\n'
    + X.grab('esc') + '\n' + FNS.map(n => X.grab(n)).join('\n')
    + '\nreturn { set:(o)=>{ for(const k in o){ eval(k+"=o[k]"); } }, render:()=>{ _SP._keys={}; for(const k of _SP.schema.keys)_SP._keys[k.id]=k; _spRender(); return els["prof-body"].innerHTML; } };';
  return new Function('els', src)(els);
}
module.exports = { makeRenderer, FNS };
