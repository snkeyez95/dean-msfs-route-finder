
  (function(){
    var UNIT='fps';
    function renderMetrics(){
      var m=RD.metrics,maxFps=0,maxMs=0;
      m.forEach(function(x){ if(x.fps>maxFps)maxFps=x.fps; if(x.ms>maxMs)maxMs=x.ms; });
      var html='';
      m.forEach(function(x){
        var val=UNIT==='fps'?x.fps:x.ms;
        var w=UNIT==='fps'?(maxFps?x.fps/maxFps*100:0):(maxMs?x.ms/maxMs*100:0);
        var txt=(val==null)?'\u2014':val.toFixed(1);
        html+='<div class="mrow"><span class="k">'+x.k+'</span><div class="mbar-track">'+
          '<div class="mbar" style="width:'+(w||0).toFixed(0)+'%"></div></div>'+
          '<span class="v">'+txt+'</span></div>';
      });
      document.getElementById('metrics').innerHTML=html;
    }
    window.toggleUnit=function(){UNIT=UNIT==='fps'?'ms':'fps';
      document.getElementById('unitBtn').textContent=UNIT.toUpperCase();renderMetrics();};
    window.showPie=function(which){
      document.getElementById('ptStut').classList.toggle('active',which==='stut');
      document.getElementById('ptVar').classList.toggle('active',which==='var');
      var html='';RD.pies[which].forEach(function(s){
        html+='<div class="row"><span class="sw" style="background:'+s.color+'"></span>'+s.label+'</div>';});
      document.getElementById('pieLegend').innerHTML=html;};
    window.showGraph=function(which){
      var ft=which==='frametime';
      document.getElementById('tabFt').classList.toggle('active',ft);
      document.getElementById('tabFps').classList.toggle('active',!ft);
      var t=document.getElementById('graphTitle');
      if(t&&t.firstChild)t.firstChild.nodeValue=ft?
        'Frametime over flight \u00b7 ms (lower = smoother) ':
        'FPS over flight \u00b7 frames/s (higher = smoother) ';
      if(window.setChartUnit)window.setChartUnit(ft?'ms':'fps');};
    renderMetrics();showPie('stut');
  })();
