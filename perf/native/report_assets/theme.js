
  window.toggleTheme=function(){var h=document.documentElement;
    var n=h.getAttribute('data-theme')==='dark'?'light':'dark';
    h.setAttribute('data-theme',n);try{localStorage.setItem('cfxTheme',n);}catch(e){}
    var b=document.getElementById('themeBtn');if(b)b.textContent=n==='dark'?'\u25D0 Light':'\u25D0 Dark';};
  (function(){try{var s=localStorage.getItem('cfxTheme');
    if(s){document.documentElement.setAttribute('data-theme',s);}}catch(e){}
    var b=document.getElementById('themeBtn');
    if(b)b.textContent=document.documentElement.getAttribute('data-theme')==='dark'?'\u25D0 Light':'\u25D0 Dark';})();
  // When embedded in ABRP, follow the host's light/dark: ABRP posts {cfxSetTheme} on load
  // and passes ?theme=, overriding the localStorage default so the report matches the app.
  function _cfxApply(n){n=(n==='light')?'light':'dark';
    document.documentElement.setAttribute('data-theme',n);
    try{localStorage.setItem('cfxTheme',n);}catch(e){}
    var b=document.getElementById('themeBtn');if(b)b.textContent=n==='dark'?'\u25D0 Light':'\u25D0 Dark';}
  window.addEventListener('message',function(e){if(e&&e.data&&e.data.cfxSetTheme)_cfxApply(e.data.cfxSetTheme);});
  (function(){try{var q=new URLSearchParams(location.search||'').get('theme');
    if(q==='light'||q==='dark')_cfxApply(q);}catch(e){}})();
