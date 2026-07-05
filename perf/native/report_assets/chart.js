
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
    var c=colors();
    var datasets=[];
    if(altData){datasets.push({label:'Altitude',data:altData,yAxisID:'yAlt',
      borderColor:c.faint,borderWidth:1,pointRadius:0,fill:false,tension:0.35,order:3,spanGaps:true});}
    datasets.push({label:'Frametime',data:buildMs(),yAxisID:'yMs',
      borderColor:c.line,borderWidth:1,pointRadius:0,fill:false,tension:0,order:1});
    datasets.push({label:'Moving average',data:mavgData,yAxisID:'yMs',
      borderColor:c.amber,borderWidth:1.6,pointRadius:0,fill:false,tension:0.25,order:0});
    var refLines={id:'tgt',afterDraw:function(ch){
      if(unit!=='ms')return;var sc=ch.scales.yMs;if(!sc)return;
      var a=ch.chartArea,x=ch.ctx;
      function line(val,col,lbl,dy){var y=sc.getPixelForValue(val);
        if(y<a.top||y>a.bottom)return;
        x.save();x.strokeStyle=col;x.setLineDash([5,4]);x.lineWidth=1;
        x.beginPath();x.moveTo(a.left,y);x.lineTo(a.right,y);x.stroke();x.setLineDash([]);
        x.font='bold 11.5px sans-serif';x.textAlign='left';
        var tw=x.measureText(lbl).width,ty=y+(dy||-6);
        x.fillStyle='rgba(15,15,17,0.72)';x.fillRect(a.left+3,ty-12,tw+9,16);
        x.fillStyle=col;x.fillText(lbl,a.left+7,ty);x.restore();}
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
    // altitude at a given x (minutes) — nearest telemetry sample, for the shared tooltip
    function altAt(xv){if(!altData||!altData.length)return null;
      if(xv<=altData[0].x)return altData[0].y;
      var hiIdx=altData.length-1;if(xv>=altData[hiIdx].x)return altData[hiIdx].y;
      var lo=0,hi=hiIdx;while(lo<hi){var mid=(lo+hi)>>1;if(altData[mid].x<xv)lo=mid+1;else hi=mid;}
      var A=altData[Math.max(0,lo-1)],B=altData[lo];
      return (Math.abs(A.x-xv)<=Math.abs(B.x-xv))?A.y:B.y;}
    // vertical crosshair at the hovered point, tying the frametime + altitude readouts together
    var crosshair={id:'xhair',afterDatasetsDraw:function(ch){
      var tt=ch.tooltip;if(!tt||!tt.opacity||!tt.dataPoints||!tt.dataPoints.length)return;
      var a=ch.chartArea,x=ch.ctx,px=tt.caretX;if(px<a.left||px>a.right)return;
      x.save();x.strokeStyle=colors().faint;x.setLineDash([3,3]);x.lineWidth=1;x.globalAlpha=0.85;
      x.beginPath();x.moveTo(px,a.top);x.lineTo(px,a.bottom);x.stroke();x.restore();}};
    var chart=new Chart(document.getElementById('ftChart'),{
      type:'line',data:{datasets:datasets},plugins:[refLines,overCaret,crosshair],
      options:{responsive:true,maintainAspectRatio:false,animation:false,
        parsing:false,normalized:true,interaction:{mode:'index',axis:'x',intersect:false},
        scales:{
          x:{type:'linear',title:{display:true,text:'minutes into flight',color:c.text},
            grid:{color:c.grid},ticks:{color:c.faint,maxTicksLimit:12,
            callback:function(v){return v.toFixed(0);}}},
          yMs:{type:'linear',position:'left',min:0,max:100,
            title:{display:true,text:'ms',color:c.text},
            grid:{color:c.grid},ticks:{color:c.faint}},
          yAlt:{type:'linear',position:'right',display:!!altData,
            title:{display:!!altData,text:'altitude',color:c.faint},
            grid:{drawOnChartArea:false},ticks:{color:c.faint,
            callback:function(v){return v>=1000?'FL'+Math.round(v/100):Math.round(v);}}}},
        plugins:{legend:{display:false},
          decimation:{enabled:true,algorithm:'lttb',samples:1500},
          tooltip:{mode:'index',intersect:false,
            filter:function(it){return it.dataset.label!=='Altitude';},
            callbacks:{
            title:function(it){return it[0].parsed.x.toFixed(1)+' min into flight';},
            label:function(it){
              if(unit==='ms'){var t=(it.raw&&it.raw.t!=null)?it.raw.t:it.parsed.y;
                return it.dataset.label+': '+t.toFixed(1)+' ms';}
              return it.dataset.label+': '+it.parsed.y.toFixed(1)+' fps';},
            afterBody:function(items){if(!altData||!items.length)return;
              var alt=altAt(items[0].parsed.x);
              if(alt!=null)return 'Altitude: '+Math.round(alt).toLocaleString()+' ft';}}},
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
      el.innerHTML='<span class="lg"><span class="sw" style="background:'+a[1]+'"></span>'+a[0]+'</span>'
        +'<span class="lg"><span class="sw" style="background:'+bb[1]+'"></span>'+bb[0]+'</span>';}
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
      var tgtLine={id:'avgtgt',afterDraw:function(ch){
        var sc=ch.scales.y;if(!sc)return;var a=ch.chartArea,x=ch.ctx;
        var y=sc.getPixelForValue(tgt);if(y<a.top||y>a.bottom)return;
        x.save();x.strokeStyle=colors().target;x.setLineDash([5,4]);x.lineWidth=1;
        x.beginPath();x.moveTo(a.left,y);x.lineTo(a.right,y);x.stroke();
        x.setLineDash([]);x.font='bold 11.5px sans-serif';x.textAlign='left';
        var l2=tgt+' ms target',w2=x.measureText(l2).width;
        x.fillStyle='rgba(15,15,17,0.72)';x.fillRect(a.left+3,y+2,w2+9,16);
        x.fillStyle=colors().target;x.fillText(l2,a.left+7,y+14);x.restore();}};
      return new Chart(el,{type:'line',
        data:{datasets:[{label:'Moving average',data:SM,borderColor:colors().amber,
          borderWidth:2,pointRadius:0,fill:false,tension:0.45,cubicInterpolationMode:'monotone'}]},
        plugins:[tgtLine],
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
