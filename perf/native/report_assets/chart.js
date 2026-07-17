
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
    var c=colors();
    var datasets=[];
    if(altData){datasets.push({label:'Altitude',data:altData,yAxisID:'yAlt',
      borderColor:c.faint,borderWidth:1,pointRadius:0,fill:false,tension:0.35,order:3,spanGaps:true});}
    if(tlodData){datasets.push({label:'TLOD',data:tlodData,yAxisID:'yTlod',
      borderColor:c.target,borderWidth:1.4,pointRadius:0,fill:false,stepped:'before',order:2,spanGaps:true});}
    if(trafData){datasets.push({label:'Traffic',data:trafData,yAxisID:'yTraf',
      borderColor:c.bad,borderWidth:1,borderDash:[2,3],pointRadius:0,fill:false,tension:0.3,order:2,spanGaps:true});}
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
    // Shared crosshair + on-line target dots. Draws when THIS chart is hovered (its tooltip) OR when
    // the OTHER chart is hovered (ch._syncX) — so a hover on either chart marks the same instant on
    // both (Dean 2026-07-17). markLabels = dataset labels to put a dot on. The dot sits on the real
    // sample at that x so you can see exactly which point the readout refers to.
    function makeCrosshair(markLabels){return {id:'xhair',afterDatasetsDraw:function(ch){
      var xs=ch.scales.x;if(!xs)return;var a=ch.chartArea,x=ch.ctx;
      var tt=ch.tooltip,xv=null;
      if(tt&&tt.opacity&&tt.dataPoints&&tt.dataPoints.length)xv=tt.dataPoints[0].parsed.x;
      else if(ch._syncX!=null)xv=ch._syncX;
      if(xv==null)return;
      var px=xs.getPixelForValue(xv);if(px<a.left-1||px>a.right+1)return;
      x.save();
      x.strokeStyle=colors().faint;x.setLineDash([3,3]);x.lineWidth=1;x.globalAlpha=0.85;
      x.beginPath();x.moveTo(px,a.top);x.lineTo(px,a.bottom);x.stroke();
      x.setLineDash([]);x.globalAlpha=1;
      var ring=css('--panel','#242427');
      markLabels.forEach(function(m){
        var di=ch.data.datasets.findIndex(function(d){return d.label===m.label;});if(di<0)return;
        var data=ch.data.datasets[di].data;var idx=nearIdxX(data,xv);if(idx<0)return;
        var meta=ch.getDatasetMeta(di),el=meta.data[idx];if(!el)return;
        if(el.y<a.top-3||el.y>a.bottom+3)return;
        x.beginPath();x.arc(el.x,el.y,4.5,0,Math.PI*2);
        x.fillStyle=m.color?m.color():colors().line;x.fill();
        x.lineWidth=2;x.strokeStyle=ring;x.stroke();});
      x.restore();}};}
    var crosshair=makeCrosshair([
      {label:'Frametime',color:function(){return colors().line;}},
      {label:'Moving average',color:function(){return colors().amber;}}]);
    var chart=new Chart(document.getElementById('ftChart'),{
      type:'line',data:{datasets:datasets},plugins:[refLines,overCaret,crosshair],
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
            grid:{drawOnChartArea:false}}},
        plugins:{legend:{display:false},
          decimation:{enabled:true,algorithm:'lttb',samples:1500},
          tooltip:{mode:'index',intersect:false,
            filter:function(it){var l=it.dataset.label;return l!=='Altitude'&&l!=='TLOD'&&l!=='Traffic';},
            callbacks:{
            title:function(it){return it[0].parsed.x.toFixed(1)+' min into flight';},
            label:function(it){
              if(unit==='ms'){var t=(it.raw&&it.raw.t!=null)?it.raw.t:it.parsed.y;
                return it.dataset.label+': '+t.toFixed(1)+' ms';}
              return it.dataset.label+': '+it.parsed.y.toFixed(1)+' fps';},
            afterBody:function(items){if(!items.length)return;
              var xv=items[0].parsed.x,out=[];
              var alt=altAt(xv);
              if(alt!=null)out.push('Altitude: '+Math.round(alt).toLocaleString()+' ft');
              var tl=nearestAt(tlodData,xv);
              if(tl!=null)out.push('TLOD (AutoFPS): '+Math.round(tl));
              var tf=nearestAt(trafData,xv);
              if(tf!=null)out.push('VATSIM traffic ≤40nm: '+Math.round(tf));
              return out.length?out:undefined;}}},
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
    function renderLegend(){var el=document.getElementById('chartLegend');if(!el)return;
      var cc=colors();
      var a=(unit==='ms')?['Frame time',cc.line]:['FPS',cc.line];
      var bb=(unit==='ms')?['Moving average',cc.amber]:['Avg FPS',cc.target];
      var h='<span class="lg"><span class="sw" style="background:'+a[1]+'"></span>'+a[0]+'</span>'
        +'<span class="lg"><span class="sw" style="background:'+bb[1]+'"></span>'+bb[0]+'</span>';
      if(tlodData)h+='<span class="lg"><span class="sw" style="background:'+cc.target+'"></span>TLOD (AutoFPS)</span>';
      if(trafData)h+='<span class="lg"><span class="sw" style="background:'+cc.bad+'"></span>VATSIM traffic</span>';
      el.innerHTML=h;}
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
    applyScale(scaleMode);renderLegend();
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
      var avgXhair=makeCrosshair([{label:'Moving average',color:function(){return colors().amber;}}]);
      return new Chart(el,{type:'line',
        data:{datasets:[{label:'Moving average',data:SM,borderColor:colors().amber,
          borderWidth:2,pointRadius:0,fill:false,tension:0.45,cubicInterpolationMode:'monotone'}]},
        plugins:[tgtLine,avgXhair],
        options:{responsive:true,maintainAspectRatio:false,animation:false,
          parsing:false,normalized:true,interaction:{mode:'nearest',axis:'x',intersect:false},
          scales:{
            x:{type:'linear',min:xmin,max:xmax,grid:{color:colors().grid},
              ticks:{color:colors().faint,maxTicksLimit:12,
              callback:function(v){return v.toFixed(0);}}},
            y:{type:'linear',min:ymin,max:ymax,
              title:{display:true,text:'ms',color:colors().text},
              grid:{color:colors().grid},ticks:{color:colors().faint}}},
          plugins:{legend:{display:false},
            decimation:{enabled:true,algorithm:'lttb',samples:800},
            tooltip:{callbacks:{
              title:function(it){return it[0].parsed.x.toFixed(1)+' min';},
              label:function(it){return 'Avg: '+it.parsed.y.toFixed(1)+' ms';}}}}}});
    })();
    // Synced hover (Dean 2026-07-17): hovering EITHER chart marks the same instant on BOTH. On
    // mousemove over one, translate the cursor to a flight-minute and store it as _syncX on the other
    // so its crosshair plugin draws a matching line + on-line dot. Cleared on mouseleave. Cheap: two
    // charts, animation off — a draw() per move is sub-ms.
    (function(){var linked=[chart,avgChart].filter(Boolean);if(linked.length<2)return;
      linked.forEach(function(src){
        src.canvas.addEventListener('mousemove',function(ev){
          var xs=src.scales.x;if(!xs)return;
          var r=src.canvas.getBoundingClientRect(),xv=xs.getValueForPixel(ev.clientX-r.left);
          linked.forEach(function(o){if(o===src)return;if(o._syncX!==xv){o._syncX=xv;o.draw();}});});
        src.canvas.addEventListener('mouseleave',function(){
          linked.forEach(function(o){if(o===src)return;if(o._syncX!=null){o._syncX=null;o.draw();}});});});})();
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
