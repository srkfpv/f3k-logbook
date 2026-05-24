const $=id=>document.getElementById(id);
const chart=$('chart'), scroller=$('chartScroller'), tip=$('tooltip');
let flights=[], dates=[], selectedDates=new Set(), focusFile=null, focusMetric=null, zoom=1;
const colors=['#0b7bbf','#ff8a3d','#22a06b','#7c3aed','#ef4444','#0891b2','#2563eb','#f59e0b','#10b981','#db2777'];
const LOG_DIR='./logs/';
const INDEX_URL=LOG_DIR+'index.csv';
if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').catch(()=>{});} 
init();
async function init(){
  setupUi();
  await loadRepoLogs();
  renderAll();
}
function setupUi(){
  const savedTheme=localStorage.getItem('theme')||'light'; setTheme(savedTheme);
  $('themeToggle').onclick=()=>setTheme(document.documentElement.dataset.theme==='dark'?'light':'dark');
  $('allTime').onclick=()=>{selectedDates=new Set(dates); focusFile=null; focusMetric=null; zoom=1; renderAll();};
  $('zoomIn').onclick=()=>{zoom=Math.min(5,zoom*1.35); renderChart(true);};
  $('zoomOut').onclick=()=>{zoom=Math.max(1,zoom/1.35); renderChart(true);};
  $('zoomReset').onclick=()=>{zoom=1; scroller.scrollLeft=0; renderChart(true);};
  document.querySelectorAll('[data-focus]').forEach(btn=>btn.onclick=()=>toggleFocus(btn.dataset.focus));
  $('cardFlights').onclick=()=>{focusFile=null;focusMetric=null;renderAll();};
  $('cardTime').onclick=()=>{focusFile=null;focusMetric=null;renderAll();};
}
function setTheme(t){document.documentElement.dataset.theme=t; localStorage.setItem('theme',t); $('themeToggle').textContent=t==='dark'?'☾':'☀︎';}
async function loadRepoLogs(){
  try{
    const index=await fetchText(INDEX_URL+'?v='+Date.now());
    const rows=index.trim().split(/\r?\n/).filter(Boolean).map(l=>l.split(',').map(x=>x.trim())).filter(r=>r.length>=6);
    const out=[];
    for(const r of rows){
      const [date,time,lnh,maxAlt,duration,file]=r;
      const txt=await fetchText(LOG_DIR+file+'?v='+Date.now());
      const pts=parseFlightCsv(txt); if(!pts.length) continue;
      out.push({date,time,launchAlt:+lnh,maxAlt:+maxAlt,duration:+duration,file,pts,gain:+maxAlt-(+lnh)});
    }
    flights=out.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    dates=[...new Set(flights.map(f=>f.date))]; selectedDates=new Set(dates);
    $('status').textContent='Repo logs loaded';
  }catch(e){$('status').textContent='Cannot load logs/ from GitHub'; console.error(e);}
}
async function fetchText(url){const r=await fetch(url,{cache:'no-store'}); if(!r.ok) throw new Error(url+' '+r.status); return await r.text();}
function parseFlightCsv(txt){const lines=txt.trim().split(/\r?\n/).filter(Boolean), pts=[]; for(let i=1;i<lines.length;i++){const p=lines[i].split(','); const t=+p[0], alt=+p[1]; if(Number.isFinite(t)&&Number.isFinite(alt)) pts.push({t,alt});} return pts;}
function renderAll(){renderDates(); renderStats(); renderChart();}
function currentFlights(){return flights.filter(f=>selectedDates.has(f.date));}
function shownFlights(){const a=currentFlights(); return focusFile?a.filter(f=>f.file===focusFile):a;}
function renderDates(){
  $('allCount').textContent=flights.length; $('allTime').classList.toggle('active', selectedDates.size===dates.length && !focusFile);
  const box=$('dateChips'); box.innerHTML='';
  dates.forEach(d=>{const c=flights.filter(f=>f.date===d).length; const b=document.createElement('button'); b.className='date-chip'+(selectedDates.has(d)&&selectedDates.size!==dates.length?' active':''); b.innerHTML=`${d} <span>${c}</span>`; b.onclick=()=>{if(selectedDates.size===dates.length) selectedDates.clear(); selectedDates.has(d)?selectedDates.delete(d):selectedDates.add(d); if(!selectedDates.size) selectedDates.add(d); focusFile=null;focusMetric=null;zoom=1;renderAll();}; box.appendChild(b);});
}
function renderStats(){
  const a=currentFlights();
  const total=a.reduce((s,f)=>s+f.duration,0), maxAlt=maxBy(a,'maxAlt'), launch=maxBy(a,'launchAlt'), gain=maxBy(a,'gain'), longest=maxBy(a,'duration');
  $('mFlights').textContent=a.length; $('mTime').textContent=fmtHMS(total);
  $('mMaxAlt').textContent=maxAlt?Math.round(maxAlt.maxAlt)+' m':'0 m'; $('mMaxAltSub').textContent=maxAlt?`${maxAlt.time} · ${maxAlt.file}`:'—';
  $('mLaunch').textContent=launch?Math.round(launch.launchAlt)+' m':'0 m'; $('mLaunchSub').textContent=launch?`${launch.time} · ${launch.file}`:'—';
  $('mGain').textContent=gain?Math.round(gain.gain)+' m':'0 m'; $('mGainSub').textContent=gain?`${gain.time} · ${gain.file}`:'—';
  $('mLongest').textContent=longest?fmtTime(longest.duration):'00:00'; $('mLongestSub').textContent=longest?`${longest.time} · ${longest.file}`:'—';
  document.querySelectorAll('.metric').forEach(x=>x.classList.remove('active'));
  if(focusMetric){const el=document.querySelector(`[data-focus="${focusMetric}"]`); if(el) el.classList.add('active');}
  const scope=selectedDates.size===dates.length?'All time':[...selectedDates].join(' + '); $('scopeLabel').textContent=focusFile?`Selected · ${scope}`:scope;
  $('selectedInfo').textContent=focusFile?'Single flight':'Overlay';
}
function maxBy(a,k){return a.length?[...a].sort((x,y)=>y[k]-x[k])[0]:null;}
function toggleFocus(metric){const a=currentFlights(); if(!a.length)return; const f=maxBy(a,metric); if(!f)return; if(focusFile===f.file&&focusMetric===metric){focusFile=null;focusMetric=null;} else {focusFile=f.file;focusMetric=metric;} zoom=1; scroller.scrollLeft=0; renderAll();}
function fmtTime(s){s=Math.round(s||0); const m=Math.floor(s/60), sec=s%60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function fmtHMS(s){s=Math.round(s||0); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function renderChart(keepScroll=false){
  const a=shownFlights(), all=currentFlights(); const rect=scroller.getBoundingClientRect(); const boxW=Math.max(320,rect.width||360), boxH=Math.max(270,rect.height||290);
  const W=Math.round(boxW*zoom), H=Math.round(boxH), M={l:38,r:12,t:12,b:30};
  const xMax=Math.max(60,...all.map(f=>f.duration))*1.04, yMax=Math.max(30,...all.map(f=>f.maxAlt))*1.12;
  chart.setAttribute('width',W); chart.setAttribute('height',H); chart.setAttribute('viewBox',`0 0 ${W} ${H}`); chart.innerHTML='';
  const svg=(n,at={},txt='')=>{const e=document.createElementNS('http://www.w3.org/2000/svg',n); for(const k in at)e.setAttribute(k,at[k]); if(txt)e.textContent=txt; chart.appendChild(e); return e;};
  const sx=x=>M.l+x/xMax*(W-M.l-M.r), sy=y=>H-M.b-y/yMax*(H-M.t-M.b);
  svg('rect',{x:0,y:0,width:W,height:H,fill:'transparent'});
  drawAxes(svg,W,H,M,sx,sy,xMax,yMax);
  if(!a.length){svg('text',{x:W/2,y:H/2,'text-anchor':'middle',class:'ticktext'},'No logs in selected scope');return;}
  a.forEach((f,i)=>{
    const color=focusFile?getCss('--sun2'):colors[flights.indexOf(f)%colors.length];
    const d=f.pts.map((p,j)=>(j?'L':'M')+sx(p.t).toFixed(1)+' '+sy(p.alt).toFixed(1)).join(' ');
    svg('path',{d,class:'flight-line'+(focusFile?' focus':''),stroke:color});
    const cap=svg('path',{d,class:'touch-capture'}); cap.addEventListener('click',ev=>showTip(ev,f)); cap.addEventListener('touchstart',ev=>showTip(ev.touches[0]||ev,f),{passive:true});
  });
  if(!keepScroll) scroller.scrollLeft=0;
}
function drawAxes(svg,W,H,M,sx,sy,xMax,yMax){
  const xTicks=niceTicks(0,xMax,5), yTicks=niceTicks(0,yMax,5);
  yTicks.forEach(v=>{svg('line',{x1:M.l,y1:sy(v),x2:W-M.r,y2:sy(v),class:'grid'}); svg('text',{x:M.l-7,y:sy(v)+4,'text-anchor':'end',class:'ticktext'},Math.round(v));});
  xTicks.forEach(v=>{svg('line',{x1:sx(v),y1:M.t,x2:sx(v),y2:H-M.b,class:'grid'}); svg('text',{x:sx(v),y:H-9,'text-anchor':'middle',class:'ticktext'},Math.round(v));});
  svg('line',{x1:M.l,y1:M.t,x2:M.l,y2:H-M.b,class:'axis'}); svg('line',{x1:M.l,y1:H-M.b,x2:W-M.r,y2:H-M.b,class:'axis'});
}
function niceTicks(a,b,n){const span=b-a||1, raw=span/n, mag=10**Math.floor(Math.log10(raw)), err=raw/mag, step=(err>=5?5:err>=2?2:1)*mag, out=[]; for(let v=Math.ceil(a/step)*step;v<=b+1e-9;v+=step) out.push(v); return out;}
function getCss(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}
function showTip(ev,f){const r=scroller.getBoundingClientRect(); tip.classList.remove('hidden'); tip.innerHTML=`<b>${f.time} · ${f.file}</b><br>Lnh ${f.launchAlt} m · Max ${f.maxAlt} m · Gain ${Math.round(f.gain)} m<br>Dur ${fmtTime(f.duration)}`; clearTimeout(showTip.t); showTip.t=setTimeout(()=>tip.classList.add('hidden'),2800);}
