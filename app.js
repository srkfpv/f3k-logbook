const $=id=>document.getElementById(id);
const chart=$('chart'), tip=$('tooltip');
const state={flights:[],dates:new Set(),selDates:new Set(),allTime:true,viewMode:'charts',focus:'all',single:null,dark:false,x0:0,x1:120,y0:0,y1:90,pointers:new Map(),pinch:null,drag:null};
const C=['#0b4fc7','#0f766e','#a16207','#7c3aed','#be123c','#0369a1','#166534','#b45309','#4338ca','#9f1239'];
const W=390,H=380,M={l:42,r:8,t:12,b:28};
const LOG_DIR='logs/';

if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
init();
async function init(){bindUI(); loadTheme(); await loadRepoLogs(); renderAll();}
function bindUI(){
  $('themeBtn').onclick=()=>{state.dark=!state.dark;saveTheme();applyTheme();renderChart();};
  $('chartsTab').onclick=()=>setMode('charts'); $('tableTab').onclick=()=>setMode('table'); $('fitBtn').onclick=()=>{fitView();renderChart();}; $('backBtn').onclick=()=>{state.single=null;state.focus='all';setActiveMetric('all');fitView();renderAll();};
  $('allTimeBtn').onclick=()=>{state.allTime=true;state.selDates.clear();state.single=null;fitView();renderAll();};
  document.querySelectorAll('.metric').forEach(b=>b.onclick=()=>focusMetric(b.dataset.focus));
}
function setMode(m){state.viewMode=m;$('chartsTab').classList.toggle('active',m==='charts');$('tableTab').classList.toggle('active',m==='table');$('chartPanel').classList.toggle('hidden',m!=='charts');$('tablePanel').classList.toggle('hidden',m!=='table');}
function loadTheme(){state.dark=localStorage.getItem('f3kTheme')==='dark';applyTheme();}
function saveTheme(){localStorage.setItem('f3kTheme',state.dark?'dark':'light');applyTheme();}
function applyTheme(){document.documentElement.classList.toggle('dark',state.dark);$('themeBtn').textContent=state.dark?'☀':'☾';}

async function loadRepoLogs(){
  try{
    const txt=await fetch(LOG_DIR+'index.csv',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('index');return r.text();});
    const rows=txt.trim().split(/\r?\n/).filter(Boolean).map(line=>line.split(',').map(x=>x.trim())).filter(r=>r.length>=6);
    const out=[];
    for(const r of rows){
      const [date,time,lnh,maxAlt,duration,file]=r;
      try{const csv=await fetch(LOG_DIR+file,{cache:'no-store'}).then(x=>x.ok?x.text():''); const pts=parseCsv(csv); if(pts.length) out.push({date,time,file,launchAlt:+lnh,maxAlt:+maxAlt,duration:+duration,gain:+maxAlt-+lnh,pts});}catch{}
    }
    state.flights=out.sort((a,b)=>(a.date+a.time).localeCompare(b.date+b.time));
    state.dates=new Set(state.flights.map(f=>f.date));
    fitView();
  }catch(e){state.flights=[];}
}
function parseCsv(txt){const lines=(txt||'').trim().split(/\r?\n/).filter(Boolean); const pts=[]; for(let i=1;i<lines.length;i++){const p=lines[i].split(','); const t=+p[0], alt=+p[1]; if(Number.isFinite(t)&&Number.isFinite(alt)) pts.push({t,alt});}return pts;}
function flightsFiltered(){let a=state.flights; if(!state.allTime&&state.selDates.size) a=a.filter(f=>state.selDates.has(f.date)); if(state.single) a=a.filter(f=>f.file===state.single.file); return a;}
function renderAll(){renderSummary();renderCalendar();renderTable();renderChart();}
function renderSummary(){const a=flightsFilteredBase(); const total=a.reduce((s,f)=>s+f.duration,0); const maxAlt=best(a,'maxAlt'), launch=best(a,'launchAlt'), gain=best(a,'gain'), longest=best(a,'duration'); $('mFlights').textContent=a.length; $('mTime').textContent=fmtHMS(total); $('mMaxAlt').textContent=(maxAlt?Math.round(maxAlt.maxAlt):0)+' m'; $('mLaunch').textContent=(launch?Math.round(launch.launchAlt):0)+' m'; $('mGain').textContent=(gain?Math.round(gain.gain):0)+' m'; $('mLongest').textContent=fmtTime(longest?longest.duration:0);}
function flightsFilteredBase(){let a=state.flights; if(!state.allTime&&state.selDates.size) a=a.filter(f=>state.selDates.has(f.date)); return a;}
function best(a,k){return a.length?[...a].sort((x,y)=>y[k]-x[k])[0]:null;}
function focusMetric(k){state.focus=k;setActiveMetric(k); if(k==='all'||k==='time'){state.single=null;} else {const a=flightsFilteredBase(); const map={maxAlt:'maxAlt',launch:'launchAlt',gain:'gain',longest:'duration'}; state.single=best(a,map[k]);} setMode('charts'); fitView(); renderAll();}
function setActiveMetric(k){document.querySelectorAll('.metric').forEach(b=>b.classList.toggle('active',b.dataset.focus===k));}
function renderCalendar(){
  const byDate={}; state.flights.forEach(f=>{byDate[f.date]=(byDate[f.date]||0)+1;});
  const firstDate=state.flights[0]?.date||'23/05'; const [dd,mm]=firstDate.split('/').map(Number); const year=2026; const month=mm||5;
  const monthName=new Date(year,month-1,1).toLocaleDateString('en',{month:'long',year:'numeric'}); $('monthLabel').textContent=monthName;
  $('allTimeBtn').classList.toggle('active',state.allTime);
  const cal=$('calendar'); cal.innerHTML='';
  let firstDow=new Date(year,month-1,1).getDay(); firstDow=(firstDow+6)%7; const days=new Date(year,month,0).getDate();
  for(let i=0;i<firstDow;i++){const d=document.createElement('div');d.className='day disabled';cal.appendChild(d);}
  for(let day=1;day<=days;day++){const date=String(day).padStart(2,'0')+'/'+String(month).padStart(2,'0'); const has=byDate[date]||0; const b=document.createElement('button'); b.className='day '+(has?'has':'disabled')+(state.selDates.has(date)&&!state.allTime?' sel':''); b.disabled=!has; b.innerHTML=has?`${day}<span class="cnt">${has}</span>`:day; b.onclick=()=>{state.allTime=false; if(state.selDates.has(date))state.selDates.delete(date); else state.selDates.add(date); if(!state.selDates.size)state.allTime=true; state.single=null; fitView(); renderAll();}; cal.appendChild(b);}
}
function renderTable(){const tb=$('logRows'); tb.innerHTML=''; flightsFilteredBase().forEach(f=>{const tr=document.createElement('tr');tr.innerHTML=`<td>${f.date}</td><td>${f.time}</td><td>${Math.round(f.launchAlt)}</td><td>${Math.round(f.maxAlt)}</td><td>${Math.round(f.gain)}</td><td>${fmtTime(f.duration)}</td>`; tr.onclick=()=>{state.single=f;state.focus='all';setActiveMetric('all');setMode('charts');fitView();renderAll();}; tb.appendChild(tr);});}
function fmtTime(s){s=Math.round(s||0);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}
function fmtHMS(s){s=Math.round(s||0);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`}

function fitView(){const a=flightsFiltered(); const base=flightsFilteredBase(); const dur=Math.max(60,...a.map(f=>f.duration)); const maxY=Math.max(30,...base.map(f=>f.maxAlt))*1.08; state.x0=0; state.x1=dur; state.y0=0; state.y1=Math.ceil(maxY/10)*10;}
function sx(t){return M.l+(t-state.x0)/(state.x1-state.x0)*(W-M.l-M.r)}
function sy(y){return H-M.b-(y-state.y0)/(state.y1-state.y0)*(H-M.t-M.b)}
function invx(px){return state.x0+(px-M.l)/(W-M.l-M.r)*(state.x1-state.x0)}
function clampView(){const a=flightsFiltered(); const maxDur=Math.max(60,...a.map(f=>f.duration)); const minSpan=Math.min(12,maxDur), maxSpan=maxDur; let span=state.x1-state.x0; if(span<minSpan)span=minSpan; if(span>maxSpan)span=maxSpan; if(state.x0<0){state.x0=0;state.x1=span;} if(state.x1>maxDur){state.x1=maxDur;state.x0=maxDur-span;} if(state.x0<0)state.x0=0; state.x1=state.x0+span;}
function renderChart(){
  const a=flightsFiltered(); const label=$('chartLabel'); $('backBtn').classList.toggle('hidden',!state.single); label.textContent=state.single?`${state.single.date} ${state.single.time} · ${state.single.file}`:'All flights overlay';
  chart.innerHTML=''; tip.classList.add('hidden');
  const make=(n,attrs={},text='')=>{const e=document.createElementNS('http://www.w3.org/2000/svg',n);Object.entries(attrs).forEach(([k,v])=>e.setAttribute(k,v));if(text)e.textContent=text;chart.appendChild(e);return e;};
  make('rect',{x:0,y:0,width:W,height:H,fill:'var(--panel)'}); drawAxes(make); if(!a.length){make('text',{x:W/2,y:H/2,'text-anchor':'middle',class:'tickText'},'No logs');return;}
  const clip=make('clipPath',{id:'plotClip'}); const r=document.createElementNS('http://www.w3.org/2000/svg','rect'); r.setAttribute('x',M.l); r.setAttribute('y',M.t); r.setAttribute('width',W-M.l-M.r); r.setAttribute('height',H-M.t-M.b); clip.appendChild(r);
  a.forEach((f,i)=>drawFlight(make,f,C[state.flights.indexOf(f)%C.length], state.single?1:0.95, state.single));
  make('rect',{x:M.l,y:M.t,width:W-M.l-M.r,height:H-M.t-M.b,fill:'none',class:'axis'});
  bindChartGestures();
}
function drawAxes(make){
  const yt=ticks(0,state.y1,6), xt=ticks(state.x0,state.x1,5);
  yt.forEach(v=>{make('line',{x1:M.l,y1:sy(v),x2:W-M.r,y2:sy(v),class:'grid'}); make('text',{x:M.l-7,y:sy(v)+3,'text-anchor':'end',class:'tickText'},Math.round(v));});
  xt.forEach(v=>{make('line',{x1:sx(v),y1:M.t,x2:sx(v),y2:H-M.b,class:'grid'}); make('text',{x:sx(v),y:H-M.b+17,'text-anchor':'middle',class:'tickText'},Math.round(v));});
  make('line',{x1:M.l,y1:M.t,x2:M.l,y2:H-M.b,class:'axis'}); make('line',{x1:M.l,y1:H-M.b,x2:W-M.r,y2:H-M.b,class:'axis'});
}
function ticks(a,b,n){const span=b-a;if(span<=0)return[a];const raw=span/n;const mag=10**Math.floor(Math.log10(raw));const step=(raw/mag>=5?5:raw/mag>=2?2:1)*mag;const out=[];let v=Math.ceil(a/step)*step;for(;v<=b+1e-6;v+=step)out.push(v);return out;}
function drawFlight(make,f,color,op,single){const pts=f.pts.filter(p=>p.t>=state.x0-2&&p.t<=state.x1+2); if(!pts.length)return; const d=pts.map((p,i)=>(i?'L':'M')+sx(p.t).toFixed(1)+' '+sy(p.alt).toFixed(1)).join(' '); make('path',{d,stroke:color,opacity:op,clipPath:'url(#plotClip)',class:'flightLine '+(single?'singleLine':'')}); const hit=make('path',{d,clipPath:'url(#plotClip)',class:'hitLine'}); hit.addEventListener('pointerdown',e=>{e.stopPropagation(); showTip(e,f);}); hit.addEventListener('click',e=>{state.single=f;fitView();renderAll();});}
function showTip(ev,f){const rect=chart.getBoundingClientRect(); tip.classList.remove('hidden'); tip.style.left=Math.min(rect.width-180,Math.max(10,ev.clientX-rect.left+12))+'px'; tip.style.top=Math.min(rect.height-70,Math.max(10,ev.clientY-rect.top+12))+'px'; tip.innerHTML=`<b>${f.date} ${f.time}</b><br>Lnh ${Math.round(f.launchAlt)} · Max ${Math.round(f.maxAlt)} · Gain ${Math.round(f.gain)}<br>Dur ${fmtTime(f.duration)}`;}
function bindChartGestures(){chart.onpointerdown=pointerDown; chart.onpointermove=pointerMove; chart.onpointerup=pointerUp; chart.onpointercancel=pointerUp; chart.onwheel=wheelZoom;}
function getPoint(e){const r=chart.getBoundingClientRect();return{x:(e.clientX-r.left)/r.width*W,y:(e.clientY-r.top)/r.height*H,clientX:e.clientX,clientY:e.clientY};}
function pointerDown(e){tip.classList.add('hidden'); chart.setPointerCapture(e.pointerId); const p=getPoint(e); state.pointers.set(e.pointerId,p); if(state.pointers.size===1){state.drag={x:p.x,x0:state.x0,x1:state.x1};} if(state.pointers.size===2){const ps=[...state.pointers.values()]; const dist=Math.abs(ps[0].x-ps[1].x); const mid=(ps[0].x+ps[1].x)/2; state.pinch={dist,mid,x0:state.x0,x1:state.x1}; state.drag=null;}}
function pointerMove(e){if(!state.pointers.has(e.pointerId))return; const p=getPoint(e); state.pointers.set(e.pointerId,p); if(state.pointers.size===2&&state.pinch){const ps=[...state.pointers.values()]; const dist=Math.max(20,Math.abs(ps[0].x-ps[1].x)); const mid=(ps[0].x+ps[1].x)/2; const oldSpan=state.pinch.x1-state.pinch.x0; const newSpan=oldSpan*(state.pinch.dist/dist); const center=state.pinch.x0+(invxStatic(state.pinch.mid,state.pinch.x0,state.pinch.x1)-state.pinch.x0)+(state.pinch.mid-mid)/(W-M.l-M.r)*newSpan; state.x0=center-newSpan/2; state.x1=center+newSpan/2; clampView(); renderChart(); return;} if(state.drag&&state.pointers.size===1){const dx=p.x-state.drag.x; const span=state.drag.x1-state.drag.x0; const dt=-dx/(W-M.l-M.r)*span; state.x0=state.drag.x0+dt; state.x1=state.drag.x1+dt; clampView(); renderChart();}}
function invxStatic(px,x0,x1){return x0+(px-M.l)/(W-M.l-M.r)*(x1-x0)}
function pointerUp(e){state.pointers.delete(e.pointerId); if(state.pointers.size<2)state.pinch=null; if(state.pointers.size===0)state.drag=null;}
function wheelZoom(e){e.preventDefault(); const p=getPoint(e); const cx=invx(p.x); const z=e.deltaY>0?1.18:.82; state.x0=cx-(cx-state.x0)*z; state.x1=cx+(state.x1-cx)*z; clampView(); renderChart();}
