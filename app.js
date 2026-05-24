const $=id=>document.getElementById(id);
const chart=$('chart'), tip=$('tooltip');
let flights=[], filtered=[], selectedDates=new Set(['ALL']);
let view={x0:0,x1:120}, full={x0:0,x1:120,y0:0,y1:90};
let picked=null, tab='chart', pointer=null;
const colors=['#005bd8','#ff7a00','#007a55','#7c3aed','#cf2138','#0084a8','#3347b8','#a85400','#0d7b2f','#8a1b52','#293241','#4d6b89'];
const LOG_DIR='./logs/';

if('serviceWorker' in navigator){navigator.serviceWorker.register('./service-worker.js').catch(()=>{});}
init();

async function init(){
  bindUI();
  loadTheme();
  try{await loadRepoLogs();}catch(e){console.error(e); showEmpty('Cannot load logs/index.csv');}
}

function bindUI(){
  $('themeBtn').onclick=toggleTheme;
  $('dateToggle').onclick=()=> $('datePanel').classList.toggle('hidden');
  $('zoomIn').onclick=()=>zoomX(.72);
  $('zoomOut').onclick=()=>zoomX(1.38);
  $('fitView').onclick=()=>fitX();
  $('tabChart').onclick=()=>setTab('chart');
  $('tabTable').onclick=()=>setTab('table');
  $('overlayBtn').onclick=()=>{picked=null; fitDomain(); render();};
  $('singleBtn').onclick=()=>{if(!picked && filtered[0]) picked=filtered[0].file; render();};
  $('clearSelection').onclick=()=>{picked=null; render();};
  document.querySelectorAll('.statCard').forEach(b=>b.onclick=()=>handleMetric(b.dataset.action));
  chart.addEventListener('pointerdown',onPointerDown);
  chart.addEventListener('pointermove',onPointerMove);
  chart.addEventListener('pointerup',onPointerUp);
  chart.addEventListener('pointercancel',onPointerUp);
  chart.addEventListener('wheel',onWheel,{passive:false});
}

async function loadRepoLogs(){
  const idxTxt=await fetchText(LOG_DIR+'index.csv');
  const rows=parseIndex(idxTxt);
  const out=[];
  for(const r of rows){
    try{
      const txt=await fetchText(LOG_DIR+r.file);
      const pts=parseFlightCsv(txt);
      if(pts.length) out.push({...r,pts});
    }catch(e){console.warn('missing flight',r.file,e)}
  }
  flights=out.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
  selectedDates=new Set(['ALL']); picked=null; fitDomain(); render();
}
async function fetchText(url){const r=await fetch(url+'?v='+(Date.now()),{cache:'no-store'}); if(!r.ok) throw new Error(url); return r.text();}
function parseIndex(txt){
  return txt.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(x=>x.trim())).filter(r=>r.length>=6 && r[0].toLowerCase()!=='date').map(r=>({date:r[0],time:r[1],launchAlt:+r[2],maxAlt:+r[3],duration:+r[4],file:r[5]}));
}
function parseFlightCsv(txt){
  const lines=txt.trim().split(/\r?\n/).filter(Boolean), pts=[];
  for(let i=1;i<lines.length;i++){const p=lines[i].split(','); const t=+p[0], alt=+p[1]; if(Number.isFinite(t)&&Number.isFinite(alt)) pts.push({t,alt});}
  return pts;
}

function applyDateFilter(){
  if(selectedDates.has('ALL')) filtered=[...flights];
  else filtered=flights.filter(f=>selectedDates.has(f.date));
  if(picked && !filtered.some(f=>f.file===picked)) picked=null;
}
function fitDomain(){
  applyDateFilter();
  const list=filtered.length?filtered:flights;
  const maxDur=Math.max(60,...list.map(f=>f.duration||0));
  const maxAlt=Math.max(30,...list.map(f=>f.maxAlt||0));
  full={x0:0,x1:Math.ceil(maxDur/10)*10,y0:0,y1:Math.ceil((maxAlt*1.08)/10)*10};
  view={x0:full.x0,x1:full.x1};
}
function currentFlights(){
  const list=filtered.length?filtered:flights;
  return picked?list.filter(f=>f.file===picked):list;
}
function bestBy(kind){
  const a=filtered.length?filtered:flights; if(!a.length)return null;
  if(kind==='maxAlt') return [...a].sort((x,y)=>y.maxAlt-x.maxAlt)[0];
  if(kind==='launch') return [...a].sort((x,y)=>y.launchAlt-x.launchAlt)[0];
  if(kind==='gain') return [...a].sort((x,y)=>(y.maxAlt-y.launchAlt)-(x.maxAlt-x.launchAlt))[0];
  if(kind==='longest'||kind==='time') return [...a].sort((x,y)=>y.duration-x.duration)[0];
  return null;
}
function handleMetric(action){
  if(action==='all'){picked=null; render(); return;}
  const f=bestBy(action); if(f){picked=f.file; setTab('chart'); fitX(); render();}
}
function setTab(t){tab=t; $('tabChart').classList.toggle('active',t==='chart'); $('tabTable').classList.toggle('active',t==='table'); $('chartTools').classList.toggle('hidden',t!=='chart'); $('tablePanel').classList.toggle('hidden',t!=='table');}

function render(){applyDateFilter(); renderHeader(); renderDates(); renderStats(); renderTable(); renderChart();}
function renderHeader(){
  const dates=[...new Set(flights.map(f=>f.date))];
  const label=selectedDates.has('ALL')?'All time':[...selectedDates].join(' + ');
  $('sessionLabel').textContent=label;
  $('sessionMeta').textContent=`${filtered.length} flights · ${dates.length} day${dates.length===1?'':'s'}`;
}
function renderDates(){
  const box=$('datePanel'); box.innerHTML='';
  const counts={}; flights.forEach(f=>counts[f.date]=(counts[f.date]||0)+1);
  addChip('ALL',`All time · ${flights.length}`);
  Object.keys(counts).sort().forEach(d=>addChip(d,`${d} · ${counts[d]}`));
  function addChip(val,label){
    const b=document.createElement('button'); b.type='button'; b.className='dateChip'+(selectedDates.has(val)?' active':''); b.textContent=label;
    b.onclick=()=>{
      if(val==='ALL'){selectedDates=new Set(['ALL']);}
      else{selectedDates.delete('ALL'); selectedDates.has(val)?selectedDates.delete(val):selectedDates.add(val); if(!selectedDates.size) selectedDates.add('ALL');}
      picked=null; fitDomain(); render();
    };
    box.appendChild(b);
  }
}
function renderStats(){
  const a=filtered; const total=a.reduce((s,f)=>s+f.duration,0);
  const maxAlt=Math.max(0,...a.map(f=>f.maxAlt));
  const launch=Math.max(0,...a.map(f=>f.launchAlt));
  const gain=Math.max(0,...a.map(f=>f.maxAlt-f.launchAlt));
  const longest=Math.max(0,...a.map(f=>f.duration));
  $('mFlights').textContent=a.length;
  $('mTime').textContent=fmtHMS(total);
  $('mMaxAlt').textContent=Math.round(maxAlt)+'m';
  $('mLaunch').textContent=Math.round(launch)+'m';
  $('mGain').textContent=Math.round(gain)+'m';
  $('mLongest').textContent=fmtTime(longest);
  document.querySelectorAll('.statCard').forEach(b=>b.classList.remove('active'));
  if(picked){const f=flights.find(x=>x.file===picked); if(f){
    const map=[['maxAlt',f.maxAlt],['launch',f.launchAlt],['gain',f.maxAlt-f.launchAlt],['longest',f.duration]];
    for(const [k] of map){const el=document.querySelector(`.statCard[data-action="${k}"]`); if(el) el.classList.add('active');}
  }}
}
function renderTable(){
  const box=$('flightTable'); box.innerHTML='';
  if(!filtered.length){box.innerHTML='<div class="empty">No logs</div>'; return;}
  filtered.forEach(f=>{
    const row=document.createElement('button'); row.type='button'; row.className='flightRow'+(picked===f.file?' selected':'');
    const gain=Math.round(f.maxAlt-f.launchAlt);
    row.innerHTML=`<span>${f.date}</span><span>${f.time}</span><span>${Math.round(f.launchAlt)}</span><span>${Math.round(f.maxAlt)}</span><span class="gain">${gain}</span><span>${fmtTime(f.duration)}</span>`;
    row.onclick=()=>{picked=f.file; setTab('chart'); fitX(); render();};
    box.appendChild(row);
  });
}

const W=390,H=260,M={l:40,r:9,t:12,b:27};
function px(t){return M.l+(t-view.x0)/(view.x1-view.x0)*(W-M.l-M.r)}
function py(a){return H-M.b-(a-full.y0)/(full.y1-full.y0)*(H-M.t-M.b)}
function invx(x){return view.x0+(x-M.l)/(W-M.l-M.r)*(view.x1-view.x0)}
function renderChart(){
  chart.innerHTML=''; tip.classList.add('hidden');
  const svg=(name,attrs={},text='')=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name); Object.entries(attrs).forEach(([k,v])=>el.setAttribute(k,v)); if(text) el.textContent=text; chart.appendChild(el); return el;};
  defs(svg);
  svg('rect',{x:0,y:0,width:W,height:H,fill:'var(--panel)'});
  drawGrid(svg);
  const list=currentFlights();
  if(!list.length){svg('text',{x:W/2,y:H/2,'text-anchor':'middle',class:'axisText'},'NO LOGS'); return;}
  const overlay=!picked;
  list.forEach((f,i)=>drawFlight(svg,f,overlay?colors[flights.indexOf(f)%colors.length]:'var(--accent)',overlay));
  drawAxes(svg);
  $('chartModeLabel').textContent=picked?`Flight ${flights.find(f=>f.file===picked)?.time||''}`:'Overlay';
}
function defs(svg){
  const d=document.createElementNS('http://www.w3.org/2000/svg','defs');
  const c=document.createElementNS('http://www.w3.org/2000/svg','clipPath'); c.setAttribute('id','plotClip');
  const r=document.createElementNS('http://www.w3.org/2000/svg','rect'); r.setAttribute('x',M.l); r.setAttribute('y',M.t); r.setAttribute('width',W-M.l-M.r); r.setAttribute('height',H-M.t-M.b); c.appendChild(r); d.appendChild(c); chart.appendChild(d);
}
function drawGrid(svg){
  niceTicks(full.y0,full.y1,6).forEach(v=>{svg('line',{x1:M.l,y1:py(v),x2:W-M.r,y2:py(v),class:'grid'}); svg('text',{x:M.l-6,y:py(v)+3,'text-anchor':'end',class:'axisText'},Math.round(v));});
  niceTicks(view.x0,view.x1,5).forEach(v=>{svg('line',{x1:px(v),y1:M.t,x2:px(v),y2:H-M.b,class:'grid'}); svg('text',{x:px(v),y:H-8,'text-anchor':'middle',class:'axisText'},Math.round(v));});
}
function drawAxes(svg){
  svg('line',{x1:M.l,y1:M.t,x2:M.l,y2:H-M.b,class:'axisMain'});
  svg('line',{x1:M.l,y1:H-M.b,x2:W-M.r,y2:H-M.b,class:'axisMain'});
  svg('text',{x:M.l-29,y:M.t+10,class:'axisText'},'m');
  svg('text',{x:W-M.r-4,y:H-8,'text-anchor':'end',class:'axisText'},'s');
}
function drawFlight(svg,f,color,overlay){
  const pts=f.pts; if(!pts.length)return;
  let d='';
  for(let i=0;i<pts.length;i++){const x=px(pts[i].t), y=py(pts[i].alt); d+=(i?'L':'M')+x.toFixed(1)+' '+y.toFixed(1)+' ';}
  const p=svg('path',{d,class:'flightLine'+(!overlay?' selected':''),stroke:color,'clip-path':'url(#plotClip)'});
  p.addEventListener('pointermove',ev=>showTip(ev,f)); p.addEventListener('pointerleave',hideTip); p.addEventListener('click',ev=>{picked=f.file; render(); showTip(ev,f);});
  if(!overlay){
    const imax=pts.reduce((bi,p,i)=>p.alt>pts[bi].alt?i:bi,0);
    svg('circle',{cx:px(pts[imax].t),cy:py(pts[imax].alt),r:3.2,fill:'var(--accent2)',class:'point','clip-path':'url(#plotClip)'});
  }
}
function showTip(ev,f){
  const rect=chart.getBoundingClientRect(); const gain=Math.round(f.maxAlt-f.launchAlt);
  tip.classList.remove('hidden'); tip.style.left=Math.min(rect.width-230,Math.max(8,ev.clientX-rect.left+12))+'px'; tip.style.top=Math.max(45,ev.clientY-rect.top+12)+'px';
  tip.innerHTML=`<b>${f.date} ${f.time}</b><br>${f.file}<br>Lnh ${Math.round(f.launchAlt)}m · Max ${Math.round(f.maxAlt)}m · Gain ${gain}m<br>Dur ${fmtTime(f.duration)}`;
}
function hideTip(){tip.classList.add('hidden')}
function showEmpty(msg){$('sessionMeta').textContent=msg; renderChart();}

function zoomX(factor){
  const c=(view.x0+view.x1)/2, span=(view.x1-view.x0)*factor; setView(c-span/2,c+span/2); renderChart();
}
function fitX(){view={x0:full.x0,x1:full.x1}; renderChart();}
function setView(a,b){
  const minSpan=20, maxSpan=full.x1-full.x0; let span=Math.max(minSpan,Math.min(maxSpan,b-a)); let c=(a+b)/2;
  let x0=c-span/2, x1=c+span/2; if(x0<full.x0){x0=full.x0;x1=x0+span;} if(x1>full.x1){x1=full.x1;x0=x1-span;} view={x0,x1};
}
function onWheel(e){e.preventDefault(); zoomX(e.deltaY>0?1.25:.8);}
function onPointerDown(e){const r=chart.getBoundingClientRect(); pointer={id:e.pointerId,x:e.clientX-r.left,view:{...view}}; chart.setPointerCapture(e.pointerId);}
function onPointerMove(e){if(!pointer)return; const r=chart.getBoundingClientRect(); const x=e.clientX-r.left; const dx=x-pointer.x; const secShift=-(dx/(r.width))*((pointer.view.x1-pointer.view.x0)); setView(pointer.view.x0+secShift,pointer.view.x1+secShift); renderChart();}
function onPointerUp(){pointer=null;}

function niceTicks(a,b,n){const span=b-a||1, step0=span/n, mag=10**Math.floor(Math.log10(step0)), err=step0/mag, step=(err>=5?5:err>=2?2:1)*mag; const out=[]; for(let v=Math.ceil(a/step)*step;v<=b+.0001;v+=step) out.push(v); return out;}
function fmtTime(s){s=Math.round(s||0); const m=Math.floor(s/60), sec=s%60; return `${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function fmtHMS(s){s=Math.round(s||0); const h=Math.floor(s/3600),m=Math.floor((s%3600)/60),sec=s%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`;}
function loadTheme(){const t=localStorage.getItem('f3kTheme')||'dark'; document.documentElement.classList.toggle('dark',t==='dark'); $('themeBtn').textContent=t==='dark'?'NIGHT':'DAY';}
function toggleTheme(){const dark=!document.documentElement.classList.contains('dark'); document.documentElement.classList.toggle('dark',dark); localStorage.setItem('f3kTheme',dark?'dark':'day'); $('themeBtn').textContent=dark?'NIGHT':'DAY'; renderChart();}
