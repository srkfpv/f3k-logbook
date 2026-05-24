const $=id=>document.getElementById(id);
const chart=$('chart'), tip=$('tooltip');
let flights=[], view={x0:0,x1:360,y0:0,y1:90}, selected=new Set(), mode='overlay';
let drag=null, brush=null;
const colors=['#1d64d8','#16844a','#b26b00','#9333ea','#dc2626','#0891b2','#4f46e5','#be123c','#15803d','#a16207'];

if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').catch(()=>{});}
boot();

async function boot(){
  const ok=await loadBundledLogs();
  if(!ok){ loadLocal(); setStatus(flights.length ? 'Loaded saved local logs.' : 'No bundled logs found. Import CSV files.'); }
  resetViewForMode();
  renderAll();
}
function setStatus(t){ const el=$('dataStatus'); if(el) el.textContent=t; }

$('fileInput').addEventListener('change',async e=>{await importFiles([...e.target.files]); e.target.value='';});
$('mode').addEventListener('change',e=>{mode=e.target.value; resetViewForMode(); renderAll();});
$('minDuration').addEventListener('input',e=>{$('minDurationLabel').textContent=e.target.value+' s'; applyFilters(); renderAll();});
$('opacity').addEventListener('input',renderAll); $('lineWidth').addEventListener('input',renderAll);
$('showAll').onclick=()=>{selected=new Set(flights.map(f=>f.file)); renderAll();};
$('showTopAlt').onclick=()=>{const a=[...flights].sort((a,b)=>b.maxAlt-a.maxAlt).slice(0,5); selected=new Set(a.map(f=>f.file)); renderAll();};
$('showLongest').onclick=()=>{const a=[...flights].sort((a,b)=>b.duration-a.duration).slice(0,5); selected=new Set(a.map(f=>f.file)); renderAll();};
$('resetView').onclick=()=>{resetViewForMode(); renderAll();};
$('reloadRepo').onclick=async()=>{ if(await loadBundledLogs()){ resetViewForMode(); renderAll(); } };
$('clearData').onclick=()=>{if(confirm('Clear locally stored logs?')){localStorage.removeItem('f3kFlights');flights=[];selected=new Set();renderAll();}};
$('exportSvg').onclick=()=>{const s=new XMLSerializer().serializeToString(chart); const blob=new Blob([s],{type:'image/svg+xml'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='f3k-chart.svg'; a.click(); URL.revokeObjectURL(a.href);};

async function importFiles(files){
  const csvs={}; let indexText=null;
  for(const f of files){ const txt=await f.text(); if(f.name.toLowerCase()==='index.csv') indexText=txt; else if(f.name.toLowerCase().endsWith('.csv')) csvs[f.name]=txt; }
  if(!indexText){ alert('Wybierz index.csv razem z plikami lotów CSV.'); return; }
  const out=parseIndexWithCsvs(indexText,csvs);
  if(!out.length){ alert('Nie udało się dopasować lotów. Upewnij się, że wybrałeś index.csv i pliki f*.csv.'); return; }
  flights=out; selected=new Set(flights.map(f=>f.file));
  saveLocal(); setStatus('Imported '+flights.length+' flights from local files.'); resetViewForMode(); renderAll();
}
async function loadBundledLogs(){
  try{
    setStatus('Loading bundled logs from GitHub…');
    const indexText=await fetchTextNoCache('./logs/index.csv');
    const rows=parseIndexRows(indexText);
    if(!rows.length) return false;
    const csvs={};
    await Promise.all(rows.map(async r=>{ csvs[r.file]=await fetchTextNoCache('./logs/'+r.file); }));
    const out=parseIndexWithCsvs(indexText,csvs);
    if(!out.length) return false;
    flights=out; selected=new Set(flights.map(f=>f.file));
    saveLocal(); setStatus('Loaded '+flights.length+' bundled flights from repository.');
    return true;
  }catch(e){ console.warn('Bundled logs not loaded',e); return false; }
}
async function fetchTextNoCache(url){
  const sep=url.includes('?')?'&':'?';
  const r=await fetch(url+sep+'v='+Date.now(),{cache:'no-store'});
  if(!r.ok) throw new Error(url+' '+r.status);
  return await r.text();
}
function parseIndexRows(indexText){
  return indexText.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(x=>x.trim())).filter(r=>r.length>=6 && r[0].toLowerCase()!=='date').map(r=>({date:r[0],time:r[1],launchAlt:+r[2],maxAlt:+r[3],duration:+r[4],file:r[5]}));
}
function parseIndexWithCsvs(indexText,csvs){
  const out=[];
  for(const r of parseIndexRows(indexText)){
    const txt=csvs[r.file]; if(!txt) continue;
    const pts=parseFlightCsv(txt); if(!pts.length) continue;
    out.push({...r,pts,visible:true});
  }
  return out.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
}
function parseFlightCsv(txt){
  const lines=txt.trim().split(/\r?\n/).filter(Boolean); const pts=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split(','); const t=+p[0], a=+p[1]; if(Number.isFinite(t)&&Number.isFinite(a)) pts.push({t,alt:a});}
  return pts;
}
function saveLocal(){localStorage.setItem('f3kFlights',JSON.stringify(flights));}
function loadLocal(){try{flights=JSON.parse(localStorage.getItem('f3kFlights')||'[]');selected=new Set(flights.map(f=>f.file));}catch{flights=[];selected=new Set();}}
function activeFlights(){const min=+$('minDuration').value; return flights.filter(f=>selected.has(f.file)&&f.duration>=min);}
function applyFilters(){const min=+$('minDuration').value; selected=new Set(flights.filter(f=>f.duration>=min).map(f=>f.file)); renderList();}
function resetViewForMode(){
  const a=activeFlights().length?activeFlights():flights; if(!a.length){view={x0:0,x1:360,y0:0,y1:90};return;}
  if(mode==='scatter'){view={x0:Math.max(0,min(a,'launchAlt')-5),x1:max(a,'launchAlt')+8,y0:0,y1:max(a,'duration')+20};return;}
  if(mode==='launch'||mode==='duration'||mode==='gain'){view={x0:0,x1:Math.max(10,a.length+1),y0:0,y1:(mode==='duration'?max(a,'duration'):mode==='gain'?Math.max(10,...a.map(f=>f.maxAlt-f.launchAlt)):max(a,'launchAlt'))*1.15};return;}
  view={x0:0,x1:Math.max(60,...a.map(f=>f.duration))*1.05,y0:0,y1:Math.max(30,...a.map(f=>f.maxAlt))*1.1};
}
function min(a,k){return Math.min(...a.map(x=>x[k]));} function max(a,k){return Math.max(...a.map(x=>x[k]));}
function fmtTime(s){s=Math.round(s||0); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return h?`${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function fmtHMS(s){s=Math.round(s||0); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}

function renderAll(){renderStats(); renderChart(); renderList();}
function renderStats(){const a=flights; $('sFlights').textContent=a.length; $('sTime').textContent=fmtHMS(a.reduce((s,f)=>s+f.duration,0)); $('sMaxAlt').textContent=Math.round(Math.max(0,...a.map(f=>f.maxAlt)))+' m'; $('sLaunch').textContent=Math.round(Math.max(0,...a.map(f=>f.launchAlt)))+' m'; $('sGain').textContent=Math.round(Math.max(0,...a.map(f=>f.maxAlt-f.launchAlt)))+' m'; $('sLongest').textContent=fmtTime(Math.max(0,...a.map(f=>f.duration)));}
function renderList(){const box=$('flightList'); box.innerHTML=''; flights.forEach((f,i)=>{const div=document.createElement('label');div.className='flightItem';div.innerHTML=`<input type="checkbox" ${selected.has(f.file)?'checked':''}><span><b style="color:${colors[i%colors.length]}">${f.time} · ${f.file}</b><small>Lnh ${f.launchAlt} m · Max ${f.maxAlt} m · Gain ${Math.round(f.maxAlt-f.launchAlt)} m · Dur ${fmtTime(f.duration)}</small></span>`; const cb=div.querySelector('input'); cb.onchange=()=>{cb.checked?selected.add(f.file):selected.delete(f.file); renderChart();}; box.appendChild(div);});}

const W=1200,H=720,M={l:72,r:28,t:70,b:62};
function sx(x){return M.l+(x-view.x0)/(view.x1-view.x0)*(W-M.l-M.r)}
function sy(y){return H-M.b-(y-view.y0)/(view.y1-view.y0)*(H-M.t-M.b)}
function invx(px){return view.x0+(px-M.l)/(W-M.l-M.r)*(view.x1-view.x0)}
function invy(py){return view.y0+(H-M.b-py)/(H-M.t-M.b)*(view.y1-view.y0)}
function pathFrom(points,fx,fy){return points.map((p,i)=>(i?'L':'M')+sx(fx(p)).toFixed(1)+' '+sy(fy(p)).toFixed(1)).join(' ')}
function varioPts(f){const out=[]; for(let i=1;i<f.pts.length;i++){out.push({t:f.pts[i].t, v:f.pts[i].alt-f.pts[i-1].alt});} return out;}
function renderChart(){
  chart.innerHTML=''; const a=activeFlights();
  const svg=(name,attrs={},text='')=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name); for(const k in attrs)el.setAttribute(k,attrs[k]); if(text)el.textContent=text; chart.appendChild(el); return el;};
  svg('rect',{x:0,y:0,width:W,height:H,fill:'#fff'});
  svg('text',{x:M.l,y:33,class:'title'},'F3K DLG'); svg('text',{x:205,y:34,class:'subtitle'}, modeTitle()); svg('text',{x:W-M.r,y:34,class:'subtitle','text-anchor':'end'},`${a.length} selected / ${flights.length} flights`);
  drawGrid(svg);
  if(!a.length){svg('text',{x:W/2,y:H/2,'text-anchor':'middle',class:'label'},'Import index.csv + flight CSV files'); return;}
  if(mode==='overlay') drawOverlay(svg,a,'alt');
  else if(mode==='vario') drawOverlay(svg,a,'vario');
  else if(mode==='scatter') drawScatter(svg,a);
  else drawTrend(svg,a,mode);
  svg('rect',{x:M.l,y:M.t,width:W-M.l-M.r,height:H-M.t-M.b,fill:'none',stroke:'#111','stroke-width':1.2});
  addChartEvents();
}
function modeTitle(){return {overlay:'SESSION ALTITUDE OVERLAY',launch:'LAUNCH HEIGHT TREND',duration:'DURATION TREND',gain:'GAIN TREND',scatter:'DURATION VS LAUNCH',vario:'VERTICAL SPEED OVERLAY'}[mode];}
function drawGrid(svg){
  const gx=niceTicks(view.x0,view.x1,8), gy=niceTicks(view.y0,view.y1,7);
  gx.forEach(v=>{svg('line',{x1:sx(v),y1:M.t,x2:sx(v),y2:H-M.b,class:'grid'}); svg('text',{x:sx(v),y:H-M.b+25,'text-anchor':'middle',class:'smallLabel'},Math.round(v));});
  gy.forEach(v=>{svg('line',{x1:M.l,y1:sy(v),x2:W-M.r,y2:sy(v),class:'grid'}); svg('text',{x:M.l-12,y:sy(v)+4,'text-anchor':'end',class:'smallLabel'},Math.round(v));});
  const xlab=mode==='scatter'?'Launch height [m]':(mode==='launch'||mode==='duration'||mode==='gain')?'Flight number':'Time from launch [s]';
  const ylab=mode==='duration'?'Duration [s]':mode==='gain'?'Gain [m]':mode==='scatter'?'Duration [s]':mode==='vario'?'Vario [m/s]':'Altitude [m]';
  svg('text',{x:W/2,y:H-16,'text-anchor':'middle',class:'smallLabel'},xlab);
  const ytext=svg('text',{x:18,y:H/2,'text-anchor':'middle',class:'smallLabel',transform:`rotate(-90 18 ${H/2})`},ylab);
}
function niceTicks(a,b,n){const span=b-a; if(span<=0)return [a]; const step0=span/n; const mag=10**Math.floor(Math.log10(step0)); const err=step0/mag; const step=(err>=5?5:err>=2?2:1)*mag; const out=[]; let v=Math.ceil(a/step)*step; for(;v<=b+1e-9;v+=step)out.push(v); return out;}
function drawOverlay(svg,a,type){
  const op=+$('opacity').value/100, lw=+$('lineWidth').value;
  a.forEach((f,i)=>{let pts=type==='vario'?varioPts(f):f.pts; if(type==='vario'){const ys=pts.map(p=>p.v);}
    const d=type==='vario'?pathFrom(pts,p=>p.t,p=>p.v):pathFrom(pts,p=>p.t,p=>p.alt);
    const el=svg('path',{d,class:'line',stroke:colors[flights.indexOf(f)%colors.length],opacity:op,'stroke-width':lw,fill:'none','data-file':f.file});
    el.addEventListener('pointermove',ev=>showTip(ev,f)); el.addEventListener('pointerleave',hideTip); el.addEventListener('click',ev=>showTip(ev,f));
  });
}
function drawTrend(svg,a,what){
  const pts=a.map((f,i)=>({x:i+1,y:what==='launch'?f.launchAlt:what==='duration'?f.duration:f.maxAlt-f.launchAlt,f}));
  const d=pathFrom(pts,p=>p.x,p=>p.y); svg('path',{d,class:'line',stroke:'#1d64d8','stroke-width':2.5,fill:'none'});
  pts.forEach((p,i)=>{const c=svg('circle',{cx:sx(p.x),cy:sy(p.y),r:6,fill:colors[i%colors.length],stroke:'#fff','stroke-width':2}); c.addEventListener('pointermove',ev=>showTip(ev,p.f)); c.addEventListener('click',ev=>showTip(ev,p.f));});
}
function drawScatter(svg,a){
  a.forEach((f,i)=>{const c=svg('circle',{cx:sx(f.launchAlt),cy:sy(f.duration),r:7,fill:colors[i%colors.length],opacity:.85,stroke:'#fff','stroke-width':2}); c.addEventListener('pointermove',ev=>showTip(ev,f)); c.addEventListener('click',ev=>showTip(ev,f));});
}
function showTip(ev,f){const rect=chart.getBoundingClientRect(); tip.classList.remove('hidden'); tip.style.left=(ev.clientX-rect.left+16)+'px'; tip.style.top=(ev.clientY-rect.top+16)+'px'; tip.innerHTML=`<b>${f.time} · ${f.file}</b><br>Lnh ${f.launchAlt} m · Max ${f.maxAlt} m<br>Gain ${Math.round(f.maxAlt-f.launchAlt)} m · Dur ${fmtTime(f.duration)}`;}
function hideTip(){tip.classList.add('hidden')}
function addChartEvents(){
  chart.onwheel=e=>{e.preventDefault(); const r=chart.getBoundingClientRect(); const px=(e.clientX-r.left)/r.width*W, py=(e.clientY-r.top)/r.height*H; const cx=invx(px), cy=invy(py); const z=e.deltaY>0?1.18:.85; view={x0:cx-(cx-view.x0)*z,x1:cx+(view.x1-cx)*z,y0:cy-(cy-view.y0)*z,y1:cy+(view.y1-cy)*z}; renderChart();};
  chart.onpointerdown=e=>{const r=chart.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width*W,y=(e.clientY-r.top)/r.height*H; if(e.shiftKey){brush={x,y};} else {drag={x,y,v:{...view}};} chart.setPointerCapture(e.pointerId);};
  chart.onpointermove=e=>{if(!drag&&!brush)return; const r=chart.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width*W,y=(e.clientY-r.top)/r.height*H; if(drag){const dx=invx(drag.x)-invx(x), dy=invy(drag.y)-invy(y); view={x0:drag.v.x0+dx,x1:drag.v.x1+dx,y0:drag.v.y0+dy,y1:drag.v.y1+dy}; renderChart();} else if(brush){renderChart(); const rect=document.createElementNS('http://www.w3.org/2000/svg','rect'); rect.setAttribute('x',Math.min(brush.x,x)); rect.setAttribute('y',Math.min(brush.y,y)); rect.setAttribute('width',Math.abs(x-brush.x)); rect.setAttribute('height',Math.abs(y-brush.y)); rect.setAttribute('class','brush'); chart.appendChild(rect);}};
  chart.onpointerup=e=>{if(brush){const r=chart.getBoundingClientRect(); const x=(e.clientX-r.left)/r.width*W,y=(e.clientY-r.top)/r.height*H; if(Math.abs(x-brush.x)>10&&Math.abs(y-brush.y)>10){view={x0:Math.min(invx(brush.x),invx(x)),x1:Math.max(invx(brush.x),invx(x)),y0:Math.min(invy(brush.y),invy(y)),y1:Math.max(invy(brush.y),invy(y))};} brush=null; renderChart();} drag=null;};
}
