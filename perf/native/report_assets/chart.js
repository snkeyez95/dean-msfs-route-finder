
  (function(){
    if(typeof Chart==='undefined'||!window.CHART||!CHART.ft||!CHART.ft.length)return;
    var css=function(n,f){var v=getComputedStyle(document.documentElement)
      .getPropertyValue(n).trim();return v||f;};
    function colors(){return{line:css('--accent','#4ba3e6'),target:css('--target','#7ac142'),
      grid:css('--grid','#2f2f35'),faint:css('--text-faint','#6f6f77'),text:css('--text-dim','#9a9aa2'),
      amber:css('--amber','#e0a030'),bad:css('--bad','#e0564e')};}
    var unit='ms';
    var scaleMode='100';
    var rawT=CHART.ft.map(function(p){return {x:p[0],t:p[1]};});
    var rawTasXY=rawT.map(function(p){return {x:p.x,y:p.t};});   // true (uncapped) frametime for the hover readout
    var dataMax=0,xmin=rawT[0].x,xmax=rawT[rawT.length-1].x;
    rawT.forEach(function(p){if(p.t>dataMax)dataMax=p.t;});
    var curCeil=100;
    function buildMs(){var fixed=isFinite(parseFloat(scaleMode));
      return rawT.map(function(p){return {x:p.x,y:(fixed&&p.t>curCeil)?curCeil:p.t,t:p.t};});}
    var mavgData=(CHART.mavg||[]).map(function(p){return {x:p[0],y:p[1]};});
    var altData=CHART.alt?CHART.alt.map(function(p){return {x:p[0],y:p[1]};}):null;
    // v6.11.0: the REAL dynamic TLOD AutoFPS applied (step line) + VATSIM 40nm traffic count — both
    // pre-windowed server-side to the trimmed chart span (no quit/park samples exist in the data).
    var tlodData=(CHART.tlod&&CHART.tlod.length)?CHART.tlod.map(function(p){return {x:p[0],y:p[1]};}):null;
    var trafData=(CHART.traffic&&CHART.traffic.length)?CHART.traffic.map(function(p){return {x:p[0],y:p[1]};}):null;
    // v6.13.11: VRAM used (MB, every flight) + busiest-core load (%, AutoFPS flights only), toggleable.
    var vramData=(CHART.vram&&CHART.vram.length)?CHART.vram.map(function(p){return {x:p[0],y:p[1]};}):null;
    var cpuData=(CHART.cpu&&CHART.cpu.length)?CHART.cpu.map(function(p){return {x:p[0],y:p[1]};}):null;
    // Colour-blind-safe (Dean is red-green colorblind): the line MUST NOT use --vram — that theme var
    // is AMBER (#e8a13a, the metrics-panel VRAM bar), and amber-vs-green is the classic deutan
    // confusable pair (this is exactly what bit us in v6.13.11/12). Dedicated var, blue-violet default:
    // blue-family is the safe separation from TLOD's green. Solid line — Dean vetoed dashes.
    var vramCol=function(){return css('--vram-line','#6a7dff');};   // blue-violet
    var cpuCol=function(){return css('--cpu','#2fb6a8');};     // teal
    var c=colors();
    var datasets=[];
    if(altData){datasets.push({label:'Altitude',data:altData,yAxisID:'yAlt',
      borderColor:c.faint,borderWidth:1,pointRadius:0,fill:false,tension:0.35,order:3,spanGaps:true});}
    if(tlodData){datasets.push({label:'TLOD',data:tlodData,yAxisID:'yTlod',
      borderColor:c.target,borderWidth:1.4,pointRadius:0,fill:false,stepped:'before',order:2,spanGaps:true});}
    if(trafData){datasets.push({label:'Traffic',data:trafData,yAxisID:'yTraf',
      borderColor:c.bad,borderWidth:1,borderDash:[2,3],pointRadius:0,fill:false,tension:0.3,order:2,spanGaps:true});}
    // VRAM + busiest-core start HIDDEN (the chart is already busy) — one click on their chip shows them.
    if(vramData){datasets.push({label:'VRAM',data:vramData,yAxisID:'yVram',hidden:true,
      borderColor:vramCol(),borderWidth:1.4,pointRadius:0,fill:false,tension:0.25,order:3,spanGaps:true});}
    if(cpuData){datasets.push({label:'Busiest core',data:cpuData,yAxisID:'yCpu',hidden:true,
      borderColor:cpuCol(),borderWidth:1.2,pointRadius:0,fill:false,tension:0.25,order:3,spanGaps:true});}
    datasets.push({label:'Frametime',data:buildMs(),yAxisID:'yMs',
      borderColor:c.line,borderWidth:1,pointRadius:0,fill:false,tension:0,order:1});
    datasets.push({label:'Moving average',data:mavgData,yAxisID:'yMs',
      borderColor:c.amber,borderWidth:1.6,pointRadius:0,fill:false,tension:0.25,order:0});
    // nearest sample INDEX in an {x,y} array (binary search on x) — shared by markers + sync
    function nearIdxX(arr,xv){if(!arr||!arr.length)return -1;
      if(xv<=arr[0].x)return 0;var hi=arr.length-1;if(xv>=arr[hi].x)return hi;
      var lo=0;while(lo<hi){var m=(lo+hi)>>1;if(arr[m].x<xv)lo=m+1;else hi=m;}
      var A=arr[Math.max(0,lo-1)],B=arr[lo];return (Math.abs(A.x-xv)<=Math.abs(B.x-xv))?Math.max(0,lo-1):lo;}
    // Reference lines drawn in afterDatasetsDraw (i.e. BEFORE the tooltip) so the tooltip is always on
    // top — the old afterDraw ran AFTER the tooltip and painted the labels over it (Dean 2026-07-17).
    // Labels sit at the RIGHT edge, out of the way of the data start + where the tooltip usually is.
    var refLines={id:'tgt',afterDatasetsDraw:function(ch){
      if(unit!=='ms')return;var sc=ch.scales.yMs;if(!sc)return;
      var a=ch.chartArea,x=ch.ctx;
      function line(val,col,lbl,dy){var y=sc.getPixelForValue(val);
        if(y<a.top||y>a.bottom)return;
        x.save();x.strokeStyle=col;x.setLineDash([5,4]);x.lineWidth=1;
        x.beginPath();x.moveTo(a.left,y);x.lineTo(a.right,y);x.stroke();x.setLineDash([]);
        x.font='bold 11.5px sans-serif';x.textAlign='left';
        var tw=x.measureText(lbl).width,ty=y+(dy||-6),lx=a.right-tw-9;
        x.fillStyle='rgba(15,15,17,0.72)';x.fillRect(lx-1,ty-12,tw+9,16);
        x.fillStyle=col;x.fillText(lbl,lx+3,ty);x.restore();}
      line(CHART.target,colors().target,CHART.target+' ms target',14);
      if(CHART.stutter)line(CHART.stutter,colors().amber,CHART.stutter+' ms stutter',-6);}};
    var overCaret={id:'ovc',afterDatasetsDraw:function(ch){
      if(unit!=='ms'||!isFinite(parseFloat(scaleMode)))return;
      var sc=ch.scales.yMs,xs=ch.scales.x;if(!sc||!xs)return;
      var a=ch.chartArea,x=ch.ctx,top=sc.getPixelForValue(curCeil);
      x.save();x.fillStyle=colors().bad;
      rawT.forEach(function(p){if(p.t>curCeil){var px=xs.getPixelForValue(p.x);
        if(px<a.left||px>a.right)return;
        x.beginPath();x.moveTo(px,top+1);x.lineTo(px-4,top+8);x.lineTo(px+4,top+8);
        x.closePath();x.fill();}});x.restore();}};
    // nearest sample of a series at a given x (minutes) — for the shared tooltip readouts
    function nearestAt(arr,xv){if(!arr||!arr.length)return null;
      if(xv<=arr[0].x)return arr[0].y;
      var hiIdx=arr.length-1;if(xv>=arr[hiIdx].x)return arr[hiIdx].y;
      var lo=0,hi=hiIdx;while(lo<hi){var mid=(lo+hi)>>1;if(arr[mid].x<xv)lo=mid+1;else hi=mid;}
      var A=arr[Math.max(0,lo-1)],B=arr[lo];
      return (Math.abs(A.x-xv)<=Math.abs(B.x-xv))?A.y:B.y;}
    function altAt(xv){return nearestAt(altData,xv);}
    // ── Unified hover (Dean 2026-07-17, rebuilt from scratch) ──────────────────────────────────────
    // ONE shared inspected time (HOVER.x) drives everything: a crosshair, a coloured BULLSEYE on
    // every line (so hovering the TLOD line marks the TLOD line, etc.), a readout box, and the SAME
    // crosshair + bullseye at the same time on the other chart. The cursor SNAPS to the nearest
    // frametime spike so you grab the hitch you're pointing at, not the sample beside it. Chart.js's
    // own tooltip is turned off — this replaces it entirely, so both charts behave identically.
    var HOVER={x:null};
    var ringCol=function(){return css('--panel','#242427');};
    function bullseye(x,px,py,col){                       // outer bg ring + coloured ring + filled centre
      x.beginPath();x.arc(px,py,6.5,0,Math.PI*2);x.fillStyle=ringCol();x.fill();
      x.lineWidth=2.2;x.strokeStyle=col;x.stroke();
      x.beginPath();x.arc(px,py,2.7,0,Math.PI*2);x.fillStyle=col;x.fill();}
    function markSeries(ch){                              // which lines to bullseye on this chart
      var out=[],ds=ch.data.datasets;
      function add(label,axis,colf){var d=ds.find(function(z){return z.label===label;});
        if(d&&d.data&&d.data.length&&ch.scales[axis])out.push({data:d.data,axis:axis,color:colf});}
      if(ch===chart){
        // Bullseye only the lines you actively TRACE (frametime, moving-average, TLOD). Altitude and
        // VATSIM traffic are context — their value shows in the readout box, but a dot on those faint
        // lines (on compressed hidden axes, near the red traffic dashes) just clutters (Dean 2026-07-18).
        add(unit==='fps'?'Avg FPS':'Frametime','yMs',function(){return colors().line;});
        add(unit==='fps'?'Avg FPS':'Moving average','yMs',function(){return colors().amber;});
        add('TLOD','yTlod',function(){return colors().target;});
      } else { add('Moving average','y',function(){return colors().amber;}); }
      return out;}
    var xhairPlugin={id:'xhair',afterDatasetsDraw:function(ch){
      if(HOVER.x==null)return;var xs=ch.scales.x;if(!xs)return;var a=ch.chartArea,x=ch.ctx;
      var px=xs.getPixelForValue(HOVER.x);if(px<a.left-1||px>a.right+1)return;
      x.save();
      x.strokeStyle=colors().text;x.setLineDash([4,3]);x.lineWidth=1;x.globalAlpha=0.5;
      x.beginPath();x.moveTo(px,a.top);x.lineTo(px,a.bottom);x.stroke();
      x.setLineDash([]);x.globalAlpha=1;
      markSeries(ch).forEach(function(m){var v=nearestAt(m.data,HOVER.x);if(v==null)return;
        var py=ch.scales[m.axis].getPixelForValue(v);if(py<a.top-5||py>a.bottom+5)return;
        bullseye(x,px,py,m.color());});
      x.restore();}};
    // readout box (over-flight chart only) — every line's value at the inspected time, colour-keyed.
    var readoutPlugin={id:'readout',afterDraw:function(ch){
      if(HOVER.x==null)return;var xs=ch.scales.x;if(!xs)return;var a=ch.chartArea,x=ch.ctx;
      var px=xs.getPixelForValue(HOVER.x);if(px<a.left||px>a.right)return;
      var rows=[{t:HOVER.x.toFixed(1)+' min into flight',bold:true,col:colors().text}];
      var ftv=nearestAt(rawTasXY,HOVER.x);
      if(unit==='fps'){ if(ftv!=null)rows.push({t:'FPS   '+(ftv?Math.round(1000/ftv):0),col:colors().line}); }
      else { if(ftv!=null)rows.push({t:'Frametime   '+ftv.toFixed(1)+' ms',col:colors().line});
        var mv=nearestAt(mavgData,HOVER.x); if(mv!=null)rows.push({t:'Moving avg   '+mv.toFixed(1)+' ms',col:colors().amber}); }
      var tl=nearestAt(tlodData,HOVER.x); if(tl!=null)rows.push({t:'TLOD (AutoFPS)   '+Math.round(tl),col:colors().target});
      var al=altAt(HOVER.x); if(al!=null)rows.push({t:'Altitude   '+Math.round(al).toLocaleString()+' ft',col:colors().faint});
      var tf=nearestAt(trafData,HOVER.x); if(tf!=null)rows.push({t:'VATSIM ≤40nm   '+Math.round(tf),col:colors().bad});
      var vr=nearestAt(vramData,HOVER.x); if(vr!=null)rows.push({t:'VRAM   '+Math.round(vr).toLocaleString()+' MB',col:vramCol()});
      var cp=nearestAt(cpuData,HOVER.x); if(cp!=null)rows.push({t:'Busiest core   '+Math.round(cp)+'%',col:cpuCol()});
      x.save();x.font='12px sans-serif';var w=0;
      rows.forEach(function(r){x.font=(r.bold?'bold ':'')+'12px sans-serif';w=Math.max(w,x.measureText(r.t).width);});
      var padX=11,padY=8,lh=16.5,bw=w+padX*2,bh=rows.length*lh+padY*2;
      var bx=px+16;if(bx+bw>a.right)bx=px-16-bw;if(bx<a.left+2)bx=a.left+2;
      var by=a.top+8;
      x.fillStyle='rgba(10,10,12,0.93)';x.strokeStyle=colors().grid;x.lineWidth=1;
      if(x.roundRect){x.beginPath();x.roundRect(bx,by,bw,bh,6);x.fill();x.stroke();}
      else{x.fillRect(bx,by,bw,bh);x.strokeRect(bx,by,bw,bh);}
      x.textAlign='left';
      rows.forEach(function(r,i){x.font=(r.bold?'bold ':'')+'12px sans-serif';x.fillStyle=r.col;
        x.fillText(r.t,bx+padX,by+padY+i*lh+11);});
      x.restore();}};
    var chart=new Chart(document.getElementById('ftChart'),{
      type:'line',data:{datasets:datasets},plugins:[refLines,overCaret,xhairPlugin,readoutPlugin],
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        parsing:false,normalized:true,interaction:{mode:'index',axis:'x',intersect:false},
        scales:{
          x:{type:'linear',min:0,max:(CHART.total_min>0?CHART.total_min:undefined),
            title:{display:true,text:'minutes into flight',color:c.text},
            grid:{color:c.grid},ticks:{color:c.faint,maxTicksLimit:12,
            callback:function(v){return v.toFixed(0);}}},
          yMs:{type:'linear',position:'left',min:0,max:100,
            title:{display:true,text:'ms',color:c.text},
            grid:{color:c.grid},ticks:{color:c.faint}},
          yAlt:{type:'linear',position:'right',display:!!altData,
            title:{display:!!altData,text:'altitude',color:c.faint},
            grid:{drawOnChartArea:false},ticks:{color:c.faint,
            callback:function(v){return v>=1000?'FL'+Math.round(v/100):Math.round(v);}}},
          yTlod:{type:'linear',position:'right',display:false,min:0,
            max:tlodData?Math.max.apply(null,tlodData.map(function(p){return p.y;}))*1.15:100,
            grid:{drawOnChartArea:false}},
          yTraf:{type:'linear',position:'right',display:false,min:0,
            max:trafData?Math.max(4,Math.max.apply(null,trafData.map(function(p){return p.y;}))*1.3):10,
            grid:{drawOnChartArea:false}},
          yVram:{type:'linear',position:'right',display:false,min:0,
            max:vramData?Math.max.apply(null,vramData.map(function(p){return p.y;}))*1.12:12288,
            grid:{drawOnChartArea:false}},
          yCpu:{type:'linear',position:'right',display:false,min:0,max:100,
            grid:{drawOnChartArea:false}}},
        plugins:{legend:{display:false},
          decimation:{enabled:true,algorithm:'lttb',samples:1500},
          tooltip:{enabled:false},   // replaced by the unified hover (xhairPlugin + readoutPlugin) above
          zoom:{zoom:{wheel:{enabled:true},pinch:{enabled:true},mode:'x'},
            pan:{enabled:true,mode:'x'},limits:{x:{min:'original',max:'original'}}}}}});
    function bucketsAbove(ceil){var n=0;rawT.forEach(function(p){if(p.t>ceil)n++;});return n;}
    function updateBadge(){var b=document.getElementById('spikeBadge');if(!b)return;
      if(unit==='ms'&&scaleMode!=='fit'){
        var cnt=(Math.round(curCeil)===100)?CHART.over_count:bucketsAbove(curCeil);
        if(cnt>0){b.style.display='';
          b.textContent=cnt+' frame'+(cnt>1?'s':'')+' \u003e '+Math.round(curCeil)
            +' ms \u00b7 max '+CHART.over_max.toFixed(1)+' ms';return;}}
      b.style.display='none';}
    // v6.15.3 (Dean 2026-07-28): the two charts must share an IDENTICAL plot area, or the hover
    // bullseyes sit at different screen positions for the same instant. The frametime chart carries
    // up to five right-hand axes (altitude/TLOD/traffic/VRAM/core) while the moving-average chart has
    // none, so its plot area ran wider. Mirror the frametime chart's left+right gutters onto the
    // average chart through afterFit; re-sync whenever the axis count or window size changes.
    var _geo={l:0,r:0};
    function _syncGeo(){
      if(!chart||!chart.chartArea||typeof avgChart==='undefined'||!avgChart)return;
      var l=Math.round(chart.chartArea.left),r=Math.round(chart.width-chart.chartArea.right);
      if(l===_geo.l&&r===_geo.r)return;                       // no change → no update (no render loop)
      _geo.l=l;_geo.r=r;avgChart.update('none');
    }
    // VRAM avg/peak for the legend chip (Dean's ask: put the range on the label itself).
    var _vramStat=(function(){
      if(!vramData||!vramData.length)return null;
      var mx=0,su=0;for(var i=0;i<vramData.length;i++){var v=vramData[i].y;if(v>mx)mx=v;su+=v;}
      return{peak:mx,avg:su/vramData.length};})();
    function _mb(v){return Math.round(v).toLocaleString();}
    // v6.13.11: the legend is now a row of CLICKABLE toggle chips — one per charted line (Dean's ask).
    // Clicking a chip shows/hides that dataset (and its own right-hand axis), state remembered in
    // localStorage. Data-driven off the live datasets so it tracks the fps/ms unit rename automatically.
    function chipColor(d){var cc=colors();
      if(d.label==='Frametime')return cc.line; if(d.label==='Avg FPS')return cc.target;
      if(d.label==='Moving average')return cc.amber; if(d.label==='TLOD')return cc.target;
      if(d.label==='Traffic')return cc.bad; if(d.label==='Altitude')return cc.faint;
      if(d.label==='VRAM')return vramCol(); if(d.label==='Busiest core')return cpuCol(); return cc.text;}
    function chipName(d){
      if(d.label==='Frametime')return unit==='fps'?'FPS':'Frame time';
      if(d.label==='TLOD')return 'TLOD (AutoFPS)'; if(d.label==='Traffic')return 'VATSIM traffic';
      if(d.label==='Busiest core')return 'Busiest core (AutoFPS)';
      if(d.label==='VRAM')return _vramStat
        ?('VRAM (avg '+_mb(_vramStat.avg)+' · peak '+_mb(_vramStat.peak)+' MB)'):'VRAM';
      return d.label;}
    // First run (no saved key) → the two new lines start hidden; everything else shown. After any
    // toggle the saved list is authoritative for EVERY series (so a line you turn ON stays on too).
    function seriesHidden(){try{var v=localStorage.getItem('cfxSeriesHidden');
      if(v==null)return ['VRAM','Busiest core'];
      return JSON.parse(v)||[];}catch(e){return ['VRAM','Busiest core'];}}
    function renderLegend(){var el=document.getElementById('chartLegend');if(!el)return;
      var h='';
      chart.data.datasets.forEach(function(d){
        var col=chipColor(d),off=!!d.hidden,
          sw=off?('background:transparent;box-shadow:inset 0 0 0 1.6px '+col):('background:'+col);
        h+='<span class="lg" role="button" tabindex="0" title="click to show/hide" '
          +'style="cursor:pointer;user-select:none;opacity:'+(off?'0.45':'1')
          +'" onclick="window.toggleSeries(\''+d.label.replace(/'/g,"")+'\')">'
          +'<span class="sw" style="'+sw+'"></span>'+chipName(d)+'</span>';});
      el.innerHTML=h;}
    window.toggleSeries=function(label){
      var d=chart.data.datasets.find(function(z){return z.label===label;});if(!d)return;
      d.hidden=!d.hidden;
      var ax=chart.options.scales[d.yAxisID];                 // hide the secondary axis with its line
      if(ax&&d.yAxisID!=='yMs')ax.display=!d.hidden;
      var hid=seriesHidden().filter(function(x){return x!==label;});
      if(d.hidden)hid.push(label);
      try{localStorage.setItem('cfxSeriesHidden',JSON.stringify(hid));}catch(e){}
      renderLegend();chart.update();_syncGeo();};   // axis count changed → re-match the lower chart
    function applyHidden(){var hid=seriesHidden();
      chart.data.datasets.forEach(function(d){
        d.hidden=hid.indexOf(d.label)>=0;
        var ax=chart.options.scales[d.yAxisID];
        if(ax&&d.yAxisID!=='yMs')ax.display=!d.hidden;});}
    window.applyScale=function(mode){scaleMode=mode;window.__yscale=mode;
      try{localStorage.setItem('cfxYScale',mode);}catch(e){}
      if(unit!=='ms')return;
      var y=chart.options.scales.yMs;
      if(mode==='fit'){y.min=0;y.max=undefined;curCeil=dataMax;}
      else if(mode==='iqr'){var q1=(CHART.q1!=null?CHART.q1:0),q3=(CHART.q3!=null?CHART.q3:q1+2);
        var iqr=q3-q1,pad=0.5*iqr+0.5;y.min=Math.max(0,q1-pad);y.max=q3+pad;curCeil=y.max;}
      else{var n=parseFloat(mode)||100;y.min=0;y.max=n;curCeil=n;}
      var ds=chart.data.datasets.find(function(d){return d.label==='Frametime';});
      ds.data=buildMs();updateBadge();chart.update();};
    (function(){var ok=function(v){return v&&/^(fit|iqr|\d+)$/.test(v);};
      var q=null,ls=null;
      try{q=new URLSearchParams(location.search||'').get('y');}catch(e){}
      try{ls=localStorage.getItem('cfxYScale');}catch(e){}
      var pick=ok(q)?q:(ok(ls)?ls:'100');
      scaleMode=pick;window.__yscale=pick;
      var s0=document.getElementById('yScale');if(s0)s0.value=pick;})();
    applyHidden();applyScale(scaleMode);renderLegend();
    var avgChart=(function(){
      var el=document.getElementById('ftAvgChart');
      if(!el||!mavgData.length)return null;
      // Extra smoothing pass: rolling mean to soften the moving-average's stair-steps.
      var SM=mavgData;
      (function(){var n=mavgData.length;if(n<5)return;
        var w=Math.max(3,Math.round(n/60)),half=Math.floor(w/2),out=[];
        for(var i=0;i<n;i++){var s=0,c=0;
          for(var j=i-half;j<=i+half;j++){if(j>=0&&j<n){s+=mavgData[j].y;c++;}}
          out.push({x:mavgData[i].x,y:s/c});}
        SM=out;})();
      var lo=SM[0].y,hi=SM[0].y;
      SM.forEach(function(p){if(p.y<lo)lo=p.y;if(p.y>hi)hi=p.y;});
      var tgt=CHART.target||16.7;
      // Zoom to THIS flight's average band so the line fills the box instead of floating:
      // ceiling = highest average + 1.5% headroom; floor sits just below the lower of the line
      // and the 16.67ms target (which stays visible as the reference the line rides on).
      var ymax=hi*1.015;
      var ymin=Math.min(lo,tgt)-0.5;
      var tgtLine={id:'avgtgt',afterDatasetsDraw:function(ch){   // before the tooltip → tooltip on top
        var sc=ch.scales.y;if(!sc)return;var a=ch.chartArea,x=ch.ctx;
        var y=sc.getPixelForValue(tgt);if(y<a.top||y>a.bottom)return;
        x.save();x.strokeStyle=colors().target;x.setLineDash([5,4]);x.lineWidth=1;
        x.beginPath();x.moveTo(a.left,y);x.lineTo(a.right,y);x.stroke();
        x.setLineDash([]);x.font='bold 11.5px sans-serif';x.textAlign='left';
        var l2=tgt+' ms target',w2=x.measureText(l2).width,lx=a.right-w2-9;   // right edge, out of the way
        x.fillStyle='rgba(15,15,17,0.72)';x.fillRect(lx-1,y+2,w2+9,16);
        x.fillStyle=colors().target;x.fillText(l2,lx+3,y+14);x.restore();}};
      return new Chart(el,{type:'line',
        data:{datasets:[{label:'Moving average',data:SM,borderColor:colors().amber,
          borderWidth:2,pointRadius:0,fill:false,tension:0.45,cubicInterpolationMode:'monotone'}]},
        plugins:[tgtLine,xhairPlugin],
        options:{responsive:true,maintainAspectRatio:false,animation:false,
          parsing:false,normalized:true,interaction:{mode:'nearest',axis:'x',intersect:false},
          scales:{
            x:{type:'linear',min:xmin,max:xmax,grid:{color:colors().grid},
              ticks:{color:colors().faint,maxTicksLimit:12,
              callback:function(v){return v.toFixed(0);}}},
            y:{type:'linear',min:ymin,max:ymax,
              title:{display:true,text:'ms',color:colors().text},
              grid:{color:colors().grid},ticks:{color:colors().faint},
              afterFit:function(sc){if(_geo.l)sc.width=_geo.l;}},          // match the upper chart's left gutter
            // invisible right-hand spacer mirroring the upper chart's stacked right axes, so both
            // plot areas end at the same x and the hover dots line up (v6.15.3)
            yPad:{type:'linear',position:'right',display:true,min:0,max:1,
              ticks:{display:false},border:{display:false},
              grid:{display:false,drawOnChartArea:false,drawTicks:false},
              afterFit:function(sc){sc.width=_geo.r||0;}}},
          plugins:{legend:{display:false},
            decimation:{enabled:true,algorithm:'lttb',samples:800},
            tooltip:{enabled:false}}}});   // unified hover (xhairPlugin) draws the crosshair + dot
    })();
    // Unified hover wiring (Dean 2026-07-17, rebuilt). Mousemove over EITHER chart sets the shared
    // HOVER.x and redraws BOTH, so the crosshair + bullseyes line up on the same instant everywhere.
    // Over the frametime chart the cursor snaps to a nearby frametime SPIKE — but ONLY when there's a
    // genuine hitch to grab: the window's peak must be ≥33 ms AND clearly taller (>1.4×) than the
    // frametime right under the cursor. On smooth stretches nothing qualifies, so the readout tracks
    // the cursor continuously instead of hopping between spikes (Dean 2026-07-18 — the ~0.8 min jump).
    // Match the plot areas now that both charts exist, and again on any resize (v6.15.3).
    _syncGeo();
    try{ window.addEventListener('resize',function(){setTimeout(_syncGeo,60);}); }catch(e){}
    (function(){var linked=[chart,avgChart].filter(Boolean);if(!linked.length)return;
      var raf=0;var RAF=window.requestAnimationFrame||function(f){return setTimeout(f,16);};
      function redraw(){if(raf)return;raf=RAF(function(){raf=0;linked.forEach(function(c){c.draw();});});}
      function snapX(src,px,py){var xs=src.scales.x,xv=xs.getValueForPixel(px);
        if(src===chart&&rawT.length){var win=6,
          i0=nearIdxX(rawT,xs.getValueForPixel(px-win)),i1=nearIdxX(rawT,xs.getValueForPixel(px+win)),
          best=null,bt=-1;for(var i=Math.max(0,i0);i<=i1&&i<rawT.length;i++){if(rawT[i].t>bt){bt=rawT[i].t;best=rawT[i].x;}}
          var cur=nearestAt(rawTasXY,xv)||0;
          if(best!=null&&bt>=33&&bt>cur*1.4){
            // Snap ONLY when the cursor is near the spike VERTICALLY too. Up on the TLOD / altitude
            // lines the nearest frametime spike is far below the cursor, so it tracks continuously —
            // letting you read every ~10 s TLOD step instead of getting yanked down (Dean 2026-07-18).
            var yMs=chart.scales.yMs,spY=yMs.getPixelForValue(Math.min(bt,curCeil));
            if(py==null||Math.abs(spY-py)<=45)xv=best;}}
        return xv;}
      linked.forEach(function(src){
        src.canvas.addEventListener('mousemove',function(ev){
          var r=src.canvas.getBoundingClientRect();HOVER.x=snapX(src,ev.clientX-r.left,ev.clientY-r.top);redraw();});
        src.canvas.addEventListener('mouseleave',function(){if(HOVER.x!=null){HOVER.x=null;redraw();}});});})();
    window.setChartUnit=function(u){unit=u;
      var tr=chart.data.datasets.find(function(d){return d.label==='Frametime';});
      var ov=chart.data.datasets[chart.data.datasets.length-1];
      var sel=document.getElementById('yScale');
      if(u==='fps'){
        tr.data=rawT.map(function(p){return {x:p.x,y:p.t?1000/p.t:0};});
        ov.label='Avg FPS';ov.borderColor=colors().target;ov.tension=0;
        ov.data=[{x:xmin,y:CHART.avg_fps||0},{x:xmax,y:CHART.avg_fps||0}];
        chart.options.scales.yMs.min=undefined;chart.options.scales.yMs.max=undefined;
        chart.options.scales.yMs.title.text='fps';
        if(sel)sel.style.display='none';}
      else{
        tr.data=buildMs();
        ov.label='Moving average';ov.borderColor=colors().amber;ov.tension=0.25;
        ov.data=mavgData;
        chart.options.scales.yMs.title.text='ms';
        if(sel)sel.style.display='';
        applyScale(scaleMode);}
      updateBadge();renderLegend();chart.update();};
    window.resetZoom=function(){chart.resetZoom();};
    document.getElementById('ftChart').addEventListener('dblclick',function(){chart.resetZoom();});
    new MutationObserver(function(){var cc=colors();
      chart.data.datasets.forEach(function(d){
        if(d.label==='Frametime')d.borderColor=cc.line;
        else if(d.label==='Moving average')d.borderColor=cc.amber;
        else if(d.label==='Avg FPS')d.borderColor=cc.target;
        else if(d.label==='TLOD')d.borderColor=cc.target;
        else if(d.label==='Traffic')d.borderColor=cc.bad;
        else if(d.label==='VRAM')d.borderColor=vramCol();
        else if(d.label==='Busiest core')d.borderColor=cpuCol();
        else d.borderColor=cc.faint;});
      ['x','yMs','yAlt'].forEach(function(k){var s=chart.options.scales[k];if(!s)return;
        if(s.grid&&s.grid.color)s.grid.color=cc.grid;
        if(s.ticks)s.ticks.color=cc.faint;if(s.title)s.title.color=cc.text;});
      renderLegend();chart.update();
      if(avgChart){avgChart.data.datasets[0].borderColor=cc.amber;
        ['x','y'].forEach(function(k){var s=avgChart.options.scales[k];if(!s)return;
          if(s.grid)s.grid.color=cc.grid;if(s.ticks)s.ticks.color=cc.faint;
          if(s.title)s.title.color=cc.text;});
        avgChart.update();}})
      .observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  })();
