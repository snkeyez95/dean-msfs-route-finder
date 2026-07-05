
  (function(){
    var VIEW='combined';
    var SHOW_REF=true;
    var TLODS=DD.tlods, COUNTS=DD.counts, SELECTED={};
    TLODS.forEach(function(t){SELECTED[t]=true;});
    function grade(v){return v<=20?'var(--good)':(v<=33.3?'var(--ok)':'var(--bad)');}
    function activeIdx(){return TLODS.map(function(t,i){return i;}).filter(function(i){return SELECTED[TLODS[i]];});}
    function barChart(series,maxY,refY,refLabel,colorMode){
      var W=420,H=230,padL=34,padR=12,padT=14,padB=34;
      var plotW=W-padL-padR,plotH=H-padT-padB;
      var idxs=activeIdx(),groups=Math.max(idxs.length,1),gw=plotW/groups;
      function y(v){return padT+plotH-(v/maxY)*plotH;}
      var isCeil=refLabel.indexOf('12')>-1, rc=isCeil?'var(--ceiling)':'var(--target)';
      var svg='<svg viewBox="0 0 '+W+' '+H+'" width="100%" role="img" aria-label="metric by TLOD">';
      [0,0.5,1].forEach(function(f){var yy=padT+plotH-f*plotH;
        svg+='<line x1="'+padL+'" y1="'+yy+'" x2="'+(W-padR)+'" y2="'+yy+'" stroke="var(--grid)" stroke-width="1"/>';
        svg+='<text x="'+(padL-5)+'" y="'+(yy+3)+'" font-size="9" fill="var(--text-faint)" text-anchor="end">'+(maxY*f).toFixed(0)+'</text>';});
      if(refY<=maxY){var ry=y(refY);
        svg+='<line x1="'+padL+'" y1="'+ry+'" x2="'+(W-padR)+'" y2="'+ry+'" stroke="'+rc+'" stroke-dasharray="5 4" stroke-width="1.2"/>';
        svg+='<text x="'+(W-padR)+'" y="'+(ry-4)+'" font-size="9" fill="'+rc+'" text-anchor="end">'+refLabel+'</text>';}
      if(idxs.length===0){svg+='<text x="'+(padL+plotW/2)+'" y="'+(padT+plotH/2)+'" font-size="11" fill="var(--text-faint)" text-anchor="middle">Select a TLOD to show data</text>';}
      idxs.forEach(function(oi,gi){var cx=padL+gi*gw;
        svg+='<text x="'+(cx+gw/2)+'" y="'+(H-padB+16)+'" font-size="10" fill="var(--text-dim)" text-anchor="middle">'+TLODS[oi]+'</text>';
        if(VIEW==='combined'){var v=series.combined[oi];if(v==null)return;
          var bw=gw*0.5,bx=cx+(gw-bw)/2,col=colorMode==='grade'?grade(v):'var(--accent)';
          svg+='<rect x="'+bx+'" y="'+y(v)+'" width="'+bw+'" height="'+(padT+plotH-y(v))+'" fill="'+col+'" rx="2"/>';
          svg+='<text x="'+(bx+bw/2)+'" y="'+(y(v)-4)+'" font-size="9" fill="var(--text)" text-anchor="middle">'+v.toFixed(1)+'</text>';
        }else{var bw2=gw*0.3;
          [['fenix','var(--fenix)'],['pmdg','var(--pmdg)']].forEach(function(s,si){var v=series[s[0]][oi];if(v==null)return;
            var bx=cx+gw/2-bw2+si*bw2;
            svg+='<rect x="'+bx+'" y="'+y(v)+'" width="'+(bw2-2)+'" height="'+(padT+plotH-y(v))+'" fill="'+s[1]+'" rx="2"/>';
            svg+='<text x="'+(bx+bw2/2-1)+'" y="'+(y(v)-4)+'" font-size="8" fill="var(--text)" text-anchor="middle">'+v.toFixed(1)+'</text>';});}
      });
      svg+='<line x1="'+padL+'" y1="'+(padT+plotH)+'" x2="'+(W-padR)+'" y2="'+(padT+plotH)+'" stroke="var(--border)" stroke-width="1"/>';
      svg+='<text x="'+(padL+plotW/2)+'" y="'+(H-3)+'" font-size="9" fill="var(--text-faint)" text-anchor="middle">TLOD setting</text>';
      return svg+'</svg>';
    }
    function legend(mode){
      if(VIEW==='byac')return '<span><span class="sw" style="background:var(--fenix)"></span>Fenix</span><span><span class="sw" style="background:var(--pmdg)"></span>PMDG</span>';
      if(mode==='grade')return '<span><span class="sw" style="background:var(--good)"></span>\u226420ms</span><span><span class="sw" style="background:var(--ok)"></span>\u226433ms</span><span><span class="sw" style="background:var(--bad)"></span>&gt;33ms</span>';
      return '<span><span class="sw" style="background:var(--accent)"></span>avg peak VRAM</span>';
    }
    function buildFilter(){var h='';
      TLODS.forEach(function(t){h+='<label class="tchip '+(SELECTED[t]?'on':'')+'" id="tc'+t+'">'+
        '<input type="checkbox" '+(SELECTED[t]?'checked':'')+' onchange="toggleTlod('+t+',this.checked)"/>'+
        t+' <span class="ct">('+(COUNTS[t]||0)+')</span></label>';});
      document.getElementById('tlodFilter').innerHTML=h;}
    window.toggleTlod=function(t,on){SELECTED[t]=on;document.getElementById('tc'+t).classList.toggle('on',on);render();};
    window.setView=function(v){VIEW=v;
      document.getElementById('segCombined').classList.toggle('active',v==='combined');
      document.getElementById('segByAc').classList.toggle('active',v==='byac');render();};
    function render(){
      document.getElementById('chartP99').innerHTML=barChart(DD.p99,30,16.67,'16.67ms target','grade');
      document.getElementById('chartVram').innerHTML=barChart(DD.vram,12.5,12,'12 GB ceiling','flat');
      document.getElementById('legP99').innerHTML=legend('grade');
      document.getElementById('legVram').innerHTML=legend('flat');
      Array.prototype.forEach.call(document.querySelectorAll('#tbody tr'),function(tr){
        var t=tr.getAttribute('data-tlod');
        var isRef=tr.getAttribute('data-primary')==='0';
        var tlodOk=(t==null||t==='n/a'||SELECTED[t]);
        tr.style.display=(tlodOk && (!isRef||SHOW_REF))?'':'none';});
    }
    window.toggleRefRows=function(on){SHOW_REF=on;render();};
    window.toggleRef=function(){
      var cards=document.getElementById('refCards');
      var showBtn=document.getElementById('refShowBtn');
      if(!cards)return;
      var hide=cards.style.display!=='none';
      cards.style.display=hide?'none':'';
      if(showBtn)showBtn.style.display=hide?'':'none';
      try{localStorage.setItem('cfxRefHidden',hide?'1':'0');}catch(e){}
    };
    try{if(localStorage.getItem('cfxRefHidden')==='1'){
      var c=document.getElementById('refCards'),b=document.getElementById('refShowBtn');
      if(c){c.style.display='none';if(b)b.style.display='';}
    }}catch(e){}
    buildFilter();render();
  })();
