
  (function(){
    var all=window.SESSIONS_NAV||[];
    // Find this report's track (primary = Fenix/PMDG, reference = Citation etc.), then cycle
    // prev/next only within the same track so a baseline sweep is never interrupted.
    var me=null;for(var m=0;m<all.length;m++){if(all[m].id===window.THIS_SESSION){me=all[m];break;}}
    var track=me?me.track:null;
    var nav=track?all.filter(function(e){return e.track===track;}):all;
    var i=-1;for(var k=0;k<nav.length;k++){if(nav[k].id===window.THIS_SESSION){i=k;break;}}
    var prev=document.getElementById('navPrev'),next=document.getElementById('navNext');
    var older=(i>0)?nav[i-1]:null, newer=(i>=0&&i<nav.length-1)?nav[i+1]:null;
    function urlFor(entry){
      var y=window.__yscale||'100';
      return '../../'+entry.folder+'/report.html?y='+encodeURIComponent(y);}
    function go(entry){if(entry)location.href=urlFor(entry);}
    function wire(el,entry){if(!el)return;
      if(entry){el.href='../../'+entry.folder+'/report.html';
        el.classList.remove('disabled');el.title=entry.label;
        el.onclick=function(ev){ev.preventDefault();go(entry);};}
      else{el.classList.add('disabled');el.removeAttribute('href');el.onclick=null;}}
    wire(prev,older);wire(next,newer);
    document.addEventListener('keydown',function(e){
      if(e.target&&/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName))return;
      if(e.key==='ArrowLeft')go(older);
      else if(e.key==='ArrowRight')go(newer);});
  })();
