
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
      var items=RD.pies[which];
      // real to-scale pie (CapFrameX-style): a mostly-smooth flight is a near-solid disc — that's the point
      var total=0;items.forEach(function(s){total+=(s.pct!=null?s.pct:0);});
      var cx=60,cy=60,r=52,ang=-Math.PI/2,svg='';
      if(total<=0){svg='<circle cx="60" cy="60" r="52" fill="var(--panel-2)"/>';}
      else items.forEach(function(s){var p=(s.pct!=null?s.pct:0);if(p<=0)return;
        var frac=p/total,a2=ang+frac*2*Math.PI;
        if(frac>=0.99995){svg+='<circle cx="60" cy="60" r="52" fill="'+s.color+'"/>';ang=a2;return;}
        var x1=cx+r*Math.cos(ang),y1=cy+r*Math.sin(ang),x2=cx+r*Math.cos(a2),y2=cy+r*Math.sin(a2);
        var lg=frac>0.5?1:0;
        svg+='<path d="M'+cx+' '+cy+' L'+x1.toFixed(2)+' '+y1.toFixed(2)+' A'+r+' '+r+' 0 '+lg+' 1 '+x2.toFixed(2)+' '+y2.toFixed(2)+' Z" fill="'+s.color+'"><title>'+s.label+'</title></path>';
        ang=a2;});
      var ps=document.getElementById('pieSvg');if(ps)ps.innerHTML=svg;
      var html='';items.forEach(function(s){
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
