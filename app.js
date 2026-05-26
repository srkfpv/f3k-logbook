const $=id=>document.getElementById(id);
const canvas=$('chartCanvas'), frame=$('chartFrame'), ctx=canvas.getContext('2d');
const state={flights:[],allTime:false,rangeMode:'last',selDates:new Set(),rangeStart:null,rangeEnd:null,openDate:false,openMonth:5,year:2026,viewMode:'charts',dataMode:'session',single:null,focus:null,sortKey:'datetime',sortDir:-1,tableScroll:0,x0:0,x1:120,y0:0,y1:80,fitX0:0,fitX1:120,fitY0:0,fitY1:80,pointers:new Map(),drag:null,pinch:null,momentum:null,hideBubblesUntil:0, chartAnimUntil:0, chartBubbleAnimUntil:0,raf:0,loading:false};
function chartBaseColor(){return css('--baseChart')||'#888';}
function chartRecordColor(){return css('--recordChart')||'#8f1d1d';}
const RECORD_COLORS={maxAlt:null,launchAlt:null,gain:null,duration:null};
const MONTHS=['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const LOG_DIR='logs/';
const M={l:46,r:14,t:18,b:34};

if('serviceWorker' in navigator) navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
init();
async function init(){bindUI();loadTheme();showLoad(true);await loadLogs();showLoad(false);renderAll();requestAnimationFrame(drawChart);}
function bindUI(){
  $('themeBtn').onclick=()=>{document.documentElement.classList.toggle('light');localStorage.setItem('f3kTheme',document.documentElement.classList.contains('light')?'light':'dark');$('themeBtn').textContent=document.documentElement.classList.contains('light')?'☾':'☼';drawChart();};
  $('dateToggle').onclick=()=>{state.openDate=!state.openDate;renderDate();};
  $('lastBtn').onclick=()=>{setPeriodMode('last');};
  $('last10Btn').onclick=()=>{setPeriodMode('last10');};
  $('allTimeBtn').onclick=()=>{setPeriodMode('all');};
  $('byDateBtn').onclick=()=>{state.openDate=true;state.rangeMode='dates';state.allTime=false;state.single=null;state.focus=null;setActiveRecord(null);setDataMode('session',{resetTable:true});fitView();renderAll();};
  $('prevMonthBtn').onclick=(e)=>{e.stopPropagation();shiftMonth(-1);};
  $('nextMonthBtn').onclick=(e)=>{e.stopPropagation();shiftMonth(1);};
  $('sessionTab').onclick=()=>setDataMode('session',{resetTable:true});
  $('flightTab').onclick=()=>setDataMode('flight');
  $('tableTab').onclick=()=>setDataMode('table');
  $('tablePanel').addEventListener('scroll',()=>{state.tableScroll=$('tablePanel').scrollTop||0;updateTableFade();},{passive:true});
  $('prevFlightBtn').onclick=()=>stepFlight(-1);
  $('nextFlightBtn').onclick=()=>stepFlight(1);
  $('chartFitBtn').onclick=(e)=>{e.stopPropagation();};
  document.querySelectorAll('.recordCard').forEach(b=>b.onclick=()=>focusMetric(b.dataset.focus));
  document.querySelectorAll('.sortable').forEach(th=>th.onclick=()=>sortBy(th.dataset.k));
  // Fit/reset button and double-tap reset removed: chart interaction stays where the user leaves it.

  frame.addEventListener('pointerdown',pointerDown); frame.addEventListener('pointermove',pointerMove); frame.addEventListener('pointerup',pointerUp); frame.addEventListener('pointercancel',pointerUp); frame.addEventListener('wheel',wheelZoom,{passive:false});
  new ResizeObserver(()=>drawChart()).observe(frame);
}
function loadTheme(){const saved=localStorage.getItem('f3kTheme');document.documentElement.classList.toggle('light',saved?saved==='light':true);$('themeBtn').textContent=document.documentElement.classList.contains('light')?'☾':'☼';}
function showLoad(v){state.loading=v;$('loader').classList.toggle('hidden',!v);}
function setDataMode(m,opt={}){ state.chartAnimUntil=performance.now()+360; state.chartBubbleAnimUntil=performance.now()+560;
  if(state.dataMode==='table') state.tableScroll=$('tablePanel').scrollTop||0;
  state.dataMode=m;
  if(m==='session'){
    state.viewMode='charts'; state.single=null; state.focus=null; setActiveRecord(null);
    if(opt.resetTable){state.sortKey='datetime';state.sortDir=-1;state.tableScroll=0; updateTableFade();}
  }
  if(m==='flight'){
    state.viewMode='charts';
    if(!state.single){state.single=best(flightsBase(),'duration')||flightsBase()[0]||null;}
  }
  if(m==='table'){
    state.viewMode='table';
  }
  $('sessionTab').classList.toggle('active',m==='session');
  $('flightTab').classList.toggle('active',m==='flight');
  $('tableTab').classList.toggle('active',m==='table');
  $('chartPanel').classList.toggle('hidden',m==='table');
  $('tablePanel').classList.toggle('hidden',m!=='table');
  renderTableHeader();
  if(m==='table') setTimeout(()=>{ $('tablePanel').scrollTop=state.tableScroll||0; updateTableFade(); },0);
  if(m!=='table'){fitView(false);setTimeout(drawChart,0);}
}
function setMode(m){setDataMode(m==='table'?'table':'session');}
function flightIndex(){const a=flightsBase(); if(!a.length||!state.single)return -1; return a.findIndex(f=>f.file===state.single.file);}
function stepFlight(dir){const a=flightsBase(); if(!a.length)return; let i=flightIndex(); if(i<0)i=0; i=(i+dir+a.length)%a.length; state.single=a[i]; state.focus=null; setActiveRecord(null); setDataMode('flight'); fitView(); renderAll();}
function resetTableState(){state.sortKey='datetime';state.sortDir=-1;state.tableScroll=0;updateTableFade();}
function updateTableFade(){
  const p=$('tablePanel');
  if(!p) return;
  const atBottom = p.scrollTop + p.clientHeight >= p.scrollHeight - 3;
  p.classList.toggle('atBottom', atBottom);
}



const DB_NAME='f3k-logbook-db';
const DB_STORE='files';
function openLogDb(){return new Promise((resolve,reject)=>{const req=indexedDB.open(DB_NAME,1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(DB_STORE))db.createObjectStore(DB_STORE,{keyPath:'path'});};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
async function getImportedFiles(){try{const db=await openLogDb();return await new Promise((resolve,reject)=>{const tx=db.transaction(DB_STORE,'readonly');const req=tx.objectStore(DB_STORE).getAll();req.onsuccess=()=>resolve(req.result||[]);req.onerror=()=>reject(req.error);});}catch(e){return [];}}
async function loadLogs(){const imported=await getImportedFiles(); const hasIndex=imported.some(f=>/index\.csv$/i.test(f.path||f.name||'')); if(hasIndex){loadImportedLogs(imported);return;} await loadRepoLogs();}
function loadImportedLogs(files){
  const map=new Map(files.map(f=>[(f.path||f.name||'').split('/').pop(),f.text||'']));
  const indexTxt=map.get('index.csv')||'';
  const rows=indexTxt.trim().split(/\r?\n/).filter(Boolean).map(l=>l.split(',').map(x=>x.trim())).filter(r=>r.length>=6);
  const out=[];
  for(const r of rows){const [date,time,lnh,maxAlt,duration,file]=r; const csv=map.get(file)||map.get(file.split('/').pop())||''; const pts=parseCsv(csv); if(pts.length){out.push({date,time,year:state.year,file,launchAlt:+lnh,maxAlt:+maxAlt,duration:+duration,gain:+maxAlt-+lnh,pts});}}
  state.flights=out.sort((a,b)=>(a.year*10000+dateNum(a.date)+timeNum(a.time))-(b.year*10000+dateNum(b.date)+timeNum(b.time)));
  state.year=2026; initCalendarMonth(); fitView();
}

async function loadRepoLogs(){
  try{const txt=await fetch(LOG_DIR+'index.csv',{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('index');return r.text();}); const rows=txt.trim().split(/\r?\n/).filter(Boolean).map(l=>l.split(',').map(x=>x.trim())).filter(r=>r.length>=6); const out=[];
    for(const r of rows){const [date,time,lnh,maxAlt,duration,file]=r; try{const csv=await fetch(LOG_DIR+file,{cache:'no-store'}).then(x=>x.ok?x.text():''); const pts=parseCsv(csv); if(pts.length){const yr=yearFromFile(file); out.push({date,time,year:yr,file,launchAlt:+lnh,maxAlt:+maxAlt,duration:+duration,gain:+maxAlt-+lnh,pts});}}catch{}}
    state.flights=out.sort((a,b)=>(a.year*10000+dateNum(a.date)+timeNum(a.time))-(b.year*10000+dateNum(b.date)+timeNum(b.time))); state.year=2026; initCalendarMonth(); fitView();
  }catch(e){state.flights=[];}
}
function yearFromFile(file){return 2026;}
function initCalendarMonth(){const now=new Date(); state.year=2026; state.openMonth=(now.getFullYear()===2026?now.getMonth()+1:5);}
function shiftMonth(delta){state.openMonth+=delta; if(state.openMonth<1){state.openMonth=12;state.year--;} if(state.openMonth>12){state.openMonth=1;state.year++;} renderDate();}
function dateNum(d){const [dd,mm]=d.split('/').map(Number);return mm*100+dd;} function timeNum(t){return Number(String(t).replace(/\D/g,''))||0;}
function parseCsv(txt){const lines=(txt||'').trim().split(/\r?\n/).filter(Boolean), pts=[]; for(let i=1;i<lines.length;i++){const p=lines[i].split(','); const t=+p[0], alt=+p[1]; if(Number.isFinite(t)&&Number.isFinite(alt)) pts.push({t,alt});} return pts;}

function flightDateKey(f){
  return String(f.date||'');
}
function flightDateSortValue(f){
  return (Number(f.year)||state.year||2026)*10000 + dateNum(f.date||'00/00');
}
function sessionDates(desc=true){
  const map=new Map();
  state.flights.forEach(f=>{
    const d=flightDateKey(f);
    if(!d) return;
    const v=flightDateSortValue(f);
    if(!map.has(d) || v>map.get(d).v) map.set(d,{date:d,v});
  });
  const arr=[...map.values()].sort((a,b)=>desc?b.v-a.v:a.v-b.v);
  return arr;
}
function setPeriodMode(mode){ state.chartAnimUntil=performance.now()+360; state.chartBubbleAnimUntil=performance.now()+560;
  state.openDate=true;
  state.rangeMode=mode;
  state.allTime=mode==='all';
  state.selDates.clear();
  state.rangeStart=null;
  state.rangeEnd=null;
  state.single=null;
  state.focus=null;
  setActiveRecord(null);
  const dates=selectedSessionDates();
  if(dates.length){
    const latest=dates[dates.length-1];
    const m=parseInt(String(latest).split('/')[1],10);
    if(Number.isFinite(m)) state.openMonth=m;
  }
  setDataMode('session',{resetTable:true});
  fitView();
  renderAll();
}
function selectedSessionDates(){
  const sessions=sessionDates(true).map(x=>x.date);
  if(state.rangeMode==='last') return sessions.slice(0,1).reverse();
  if(state.rangeMode==='last10') return sessions.slice(0,10).reverse();
  if(state.rangeMode==='all') return sessions.reverse();
  if(state.rangeMode==='dates') return [...state.selDates].sort((a,b)=>dateNum(a)-dateNum(b));
  return [];
}

function flightsBase(){
  const a=state.flights;
  if(state.rangeMode==='last' || state.rangeMode==='last10' || state.rangeMode==='all' || state.rangeMode==='dates'){
    const ds = new Set(selectedSessionDates());
    if(state.rangeMode==='all') return a;
    if(ds.size) return a.filter(f=>ds.has(f.date)).sort((x,y)=>(flightDateSortValue(x)+timeNum(x.time))-(flightDateSortValue(y)+timeNum(y.time)));
    return [];
  }
  return a;
}
function flightsShown(){let a=flightsBase(); if(state.single) a=a.filter(f=>f.file===state.single.file); return a;}
function renderAll(){renderDate();renderSummary();renderTable();renderTableHeader();fitView(false);drawChart();}
function formatFullDate(d){const [dd,mm]=String(d).split('/');return `${dd}/${mm}/${state.year}`;}
function dateLabelText(){
  if(state.rangeMode==='last') return 'LAST SESSION';
  if(state.rangeMode==='last10') return 'LAST 10 SESSIONS';
  if(state.rangeMode==='all') return 'ALL SESSIONS';
  if(state.rangeMode==='dates'){
    if(state.rangeStart && state.rangeEnd) return `${formatFullDate(state.rangeStart)} – ${formatFullDate(state.rangeEnd)}`;
    if(state.rangeStart) return formatFullDate(state.rangeStart);
    return 'BY DATE';
  }
  return 'SELECT';
}
function renderDate(){
  $('dateBody').classList.toggle('hidden',!state.openDate);
  $('dateChevron').textContent=state.openDate?'▴':'▾';
  $('dateLabel').textContent=dateLabelText();
  $('lastBtn').classList.toggle('active',state.rangeMode==='last');
  $('last10Btn').classList.toggle('active',state.rangeMode==='last10');
  $('allTimeBtn').classList.toggle('active',state.rangeMode==='all');
  $('byDateBtn').classList.toggle('active',state.rangeMode==='dates');
  const showCal = state.openDate && state.rangeMode==='dates';
  $('calendarWrap').classList.toggle('hidden',!showCal);
  renderCalendar();
}
function renderCalendar(){
  $('monthLabel').textContent=`${MONTHS[state.openMonth-1]} ${state.year}`;
  const byDate={}; state.flights.forEach(f=>{byDate[f.date]=(byDate[f.date]||0)+1;});
  const selected=new Set(selectedSessionDates());
  const cal=$('calendar'); cal.innerHTML='';
  const today=new Date(); const todayDate=String(today.getDate()).padStart(2,'0')+'/'+String(today.getMonth()+1).padStart(2,'0'); const isThisMonth=today.getFullYear()===state.year && today.getMonth()+1===state.openMonth;
  let firstDow=new Date(state.year,state.openMonth-1,1).getDay(); firstDow=(firstDow+6)%7; const days=new Date(state.year,state.openMonth,0).getDate();
  for(let i=0;i<firstDow;i++){const d=document.createElement('div');d.className='day spacer';cal.appendChild(d);}
  for(let day=1;day<=days;day++){
    const date=String(day).padStart(2,'0')+'/'+String(state.openMonth).padStart(2,'0'); const cnt=byDate[date]||0;
    const isSel=selected.has(date); const isEdge=state.rangeMode==='dates'&&isSel&&(date===state.rangeStart||date===state.rangeEnd); const b=document.createElement('button'); b.className='day '+(cnt?'has':'')+(isSel?' sel inRange':'')+(isEdge?' rangeEdge':'')+(isThisMonth&&date===todayDate?' today':'');
    b.innerHTML=cnt?`${day}<span class="cnt">${cnt}</span>`:`${day}`;
    b.onclick=(e)=>selectCalendarDate(date,e.detail>=2);
    cal.appendChild(b);
  }
}

function datesBetween(a,b){
  let start=dateNum(a), end=dateNum(b); if(start>end){const t=start;start=end;end=t;}
  const out=[];
  for(let m=1;m<=12;m++){
    const days=new Date(state.year,m,0).getDate();
    for(let d=1;d<=days;d++){
      const key=String(d).padStart(2,'0')+'/'+String(m).padStart(2,'0');
      const n=dateNum(key); if(n>=start&&n<=end) out.push(key);
    }
  }
  return out;
}
function applyDateRange(a,b){state.selDates.clear(); datesBetween(a,b).forEach(d=>state.selDates.add(d));}
function selectCalendarDate(date,isDouble){ state.chartAnimUntil=performance.now()+360; state.chartBubbleAnimUntil=performance.now()+560;
  state.openDate=true;
  state.rangeMode='dates';
  state.allTime=false;
  state.single=null;
  state.focus=null;
  setActiveRecord(null);
  setDataMode('session',{resetTable:true});
  if(isDouble){
    state.rangeStart=date;
    state.rangeEnd=date;
    applyDateRange(date,date);
    fitView();
    renderAll();
    return;
  }
  if(!state.rangeStart || state.rangeEnd){
    state.rangeStart=date;
    state.rangeEnd=null;
    state.selDates.clear();
    state.selDates.add(date);
  }else{
    state.rangeEnd=date;
    applyDateRange(state.rangeStart,state.rangeEnd);
  }
  fitView();
  renderAll();
}

function renderSummary(){const a=flightsBase(), total=a.reduce((s,f)=>s+f.duration,0); const maxAlt=best(a,'maxAlt'), launch=best(a,'launchAlt'), gain=best(a,'gain'), longest=best(a,'duration'); $('mFlights').textContent=a.length; $('mTime').textContent=fmtHMS(total); $('mMaxAlt').textContent=(maxAlt?Math.round(maxAlt.maxAlt):0)+' m'; $('mLaunch').textContent=(launch?Math.round(launch.launchAlt):0)+' m'; $('mGain').textContent=(gain?Math.round(gain.gain):0)+' m'; $('mLongest').textContent=fmtTime(longest?longest.duration:0);}
function best(a,k){return a.length?[...a].sort((x,y)=>y[k]-x[k])[0]:null;}
function focusMetric(k){state.focus=k; const key={maxAlt:'maxAlt',launch:'launchAlt',gain:'gain',longest:'duration'}[k]; state.single=best(flightsBase(),key); setActiveRecord(k); setDataMode('flight'); fitView(); renderAll();}
function setActiveRecord(k){document.querySelectorAll('.recordCard').forEach(b=>b.classList.toggle('active',b.dataset.focus===k));}
function valueForSort(f,k){
  if(k==='datetime') return f.year*100000000+dateNum(f.date)*10000+timeNum(f.time);
  if(k==='time') return timeNum(f.time);
  return Number(f[k]||0);
}
function renderTableHeader(){
  document.querySelectorAll('.sortable').forEach(th=>{
    const on=th.dataset.k===state.sortKey;
    th.classList.toggle('sorted',on);
    th.dataset.arrow=on?(state.sortDir>0?'▲':'▼'):'';
  });
}
function sortBy(k){
  state.sortDir = state.sortKey===k ? -state.sortDir : -1;
  state.sortKey = k;
  renderTable(); renderTableHeader();
  $('tablePanel').scrollTop = 0;
  state.tableScroll = 0;
  updateTableFade();
}
function renderTable(){
  const tb=$('logRows'); tb.innerHTML='';
  let rows=[...flightsBase()];
  rows.sort((a,b)=>(valueForSort(a,state.sortKey)-valueForSort(b,state.sortKey))*state.sortDir);
  const rankMaps={};
  ['launchAlt','maxAlt','gain','duration'].forEach(k=>{
    rankMaps[k]=new Map([...rows].sort((a,b)=>b[k]-a[k]).slice(0,5).map((f,i)=>[f.file,'top'+(i+1)]));
  });
  rows.forEach((f,idx)=>{
    const tr=document.createElement('tr');
    tr.className=state.single&&state.single.file===f.file?'selectedRow':'';
    tr.innerHTML=`<td>${f.date}</td><td>${f.time}</td><td class="${rankMaps.launchAlt.get(f.file)||''}">${Math.round(f.launchAlt)}</td><td class="${rankMaps.maxAlt.get(f.file)||''}">${Math.round(f.maxAlt)}</td><td class="${rankMaps.gain.get(f.file)||''}">${fmtGain(f.gain)}</td><td class="${rankMaps.duration.get(f.file)||''}"><span>${fmtTime(f.duration)}</span><i class="rowChevron">›</i></td>`;
    tr.onclick=()=>{state.tableScroll=$('tablePanel').scrollTop||0;state.single=f;state.focus=null;setActiveRecord(null);setDataMode('flight');fitView();renderAll();};
    tb.appendChild(tr);
  });
  updateTableFade();
}
function fmtGain(v){v=Math.round(v||0);return v===0?'–':(v>0?'+'+v:String(v));}
function fmtTime(s){s=Math.round(s||0);return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;} function fmtHMS(s){s=Math.round(s||0);return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;}
function fitView(redraw=true){const a=flightsShown(), base=flightsBase(); const dur=Math.max(60,...a.map(f=>f.duration)); const maxY=Math.max(30,...(state.single?a:base).map(f=>f.maxAlt))*1.08; state.x0=0; state.x1=dur; state.y0=0; state.y1=Math.ceil(maxY/10)*10; state.fitX0=state.x0; state.fitX1=state.x1; state.fitY0=state.y0; state.fitY1=state.y1; updateFitButton(); if(redraw)drawChart();}
function updateFitButton(){const b=$('chartFitBtn'); if(!b)return; b.classList.remove('active'); b.setAttribute('aria-disabled','true');}
function canvasSize(){const dpr=Math.max(1,window.devicePixelRatio||1), r=frame.getBoundingClientRect(); canvas.width=Math.max(1,Math.round(r.width*dpr)); canvas.height=Math.max(1,Math.round(r.height*dpr)); canvas.style.width=r.width+'px'; canvas.style.height=r.height+'px'; ctx.setTransform(dpr,0,0,dpr,0,0); return {w:r.width,h:r.height};}
function css(name){return getComputedStyle(document.documentElement).getPropertyValue(name).trim();}
function sx(t,w){return M.l+(t-state.x0)/(state.x1-state.x0)*(w-M.l-M.r);} function sy(y,h){return h-M.b-(y-state.y0)/(state.y1-state.y0)*(h-M.t-M.b);} function invx(px,w){return state.x0+(px-M.l)/(w-M.l-M.r)*(state.x1-state.x0);}

function chartAnimProgress(){
  if(!state.chartAnimUntil) return 1;
  const dur=360;
  const p=1-(state.chartAnimUntil-performance.now())/dur;
  if(p>=1) return 1;
  if(p<=0) return 0;
  // smooth ease-out, not spring
  return 1-Math.pow(1-p,3);
}
function bubbleAnimProgress(){
  if(!state.chartBubbleAnimUntil) return 1;
  const dur=560;
  const p=1-(state.chartBubbleAnimUntil-performance.now())/dur;
  if(p>=1) return 1;
  if(p<=0) return 0;
  return 1-Math.pow(1-p,3);
}

function drawChart(){if(state.viewMode!=='charts')return; cancelAnimationFrame(state.raf); state.raf=requestAnimationFrame(()=>{updateFitButton(); const {w,h}=canvasSize(); ctx.clearRect(0,0,w,h);
  const __animP=chartAnimProgress(); drawGrid(w,h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(M.l, M.t, (w-M.l-M.r)*__animP, h-M.t-M.b);
  ctx.clip();
  var __animClipApplied=true; const a=flightsShown(); updateChartHeader(); if(!a.length){if(!state.loading){ctx.fillStyle=css('--muted');ctx.textAlign='center';ctx.font='900 12px system-ui';ctx.fillText('',w/2,h/2);}return;} ctx.save(); ctx.beginPath(); ctx.rect(M.l,M.t,w-M.l-M.r,h-M.t-M.b); ctx.clip(); a.forEach(f=>drawFlight(f,colorForFlight(f),w,h,!!state.single)); ctx.restore(); if(state.single) drawSingleMarkers(state.single,w,h); ctx.strokeStyle=css('--line2');ctx.lineWidth=1;ctx.strokeRect(M.l+.5,M.t+.5,w-M.l-M.r,h-M.t-M.b);});}
function updateChartHeader(){
  const single=!!state.single;
  $('prevFlightBtn').classList.toggle('hidden',!single);
  $('nextFlightBtn').classList.toggle('hidden',!single);
  if(single){
    const i=flightIndex();
    $('chartLabel').textContent=`${state.single.date}/${state.year} ${state.single.time}`;
    $('chartSub').textContent=`FLIGHT ${i>=0?i+1:'—'} OF ${flightsBase().length}`;
  }else{
    $('chartLabel').textContent='ALL FLIGHTS';
    $('chartSub').textContent='OVERLAY';
  }
}

function stableMaxPoint(f){
  if(!f || !Array.isArray(f.pts) || !f.pts.length) return null;
  if(f.__stableMaxPoint && f.__stableMaxPoint.file===f.file) return f.__stableMaxPoint;
  const target = Number.isFinite(+f.maxAlt) ? +f.maxAlt : null;
  let bestPoint = f.pts[0];

  if(target !== null){
    // Use the absolute index.csv max altitude when available, then choose the
    // first full-log point closest to that value. Never use the visible slice.
    let bestDiff = Infinity;
    for(const p of f.pts){
      const d = Math.abs((+p.alt) - target);
      if(d < bestDiff){
        bestDiff = d;
        bestPoint = p;
      }
    }
  }else{
    for(const p of f.pts){
      if((+p.alt) > (+bestPoint.alt)) bestPoint = p;
    }
  }

  f.__stableMaxPoint = {
    file: f.file,
    t: +bestPoint.t,
    alt: target !== null ? target : +bestPoint.alt
  };
  return f.__stableMaxPoint;
}

function drawSingleMarkers(f,w,h){
  if(chartAnimProgress()<0.98){ requestAnimationFrame(drawChart); return; }
  const __bubbleP=bubbleAnimProgress();
  const pts=f.pts||[]; if(!pts.length)return;

  // Stable absolute markers:
  // MAX is anchored to the full-flight max point, never to the currently
  // visible chart slice. It disappears when outside the viewport instead of
  // being recalculated at the edge of the visible window.
  const maxPt=stableMaxPoint(f);
  const endPt=pts[pts.length-1];
  const color=chartRecordColor();
  const panel=css('--panel')||'#fff';
  const hideBubbles=Date.now()<state.hideBubblesUntil || !!state.drag || !!state.pinch || !!state.momentum;

  ctx.save();

  if(maxPt){
    const maxVisible=maxPt.t>=state.x0&&maxPt.t<=state.x1&&maxPt.alt>=state.y0&&maxPt.alt<=state.y1;
    if(maxVisible){
      const mx=sx(maxPt.t,w), my=sy(maxPt.alt,h);
      ctx.beginPath();
      ctx.arc(mx,my,5.8,0,Math.PI*2);
      ctx.fillStyle=color;
      ctx.fill();
      ctx.lineWidth=3;
      ctx.strokeStyle=panel;
      ctx.stroke();
      if(!hideBubbles){
        ctx.font='800 9px ui-monospace,monospace';
        drawBubble(`MAX ${Math.round(maxPt.alt)} m`,mx,my,w,h,'max',color);
      }
    }
  }

  const endVisible=endPt.t>=state.x0&&endPt.t<=state.x1&&endPt.alt>=state.y0&&endPt.alt<=state.y1;
  if(endVisible){
    const ex=sx(endPt.t,w), ey=sy(endPt.alt,h);
    ctx.beginPath();
    ctx.arc(ex,ey,4.8,0,Math.PI*2);
    ctx.fillStyle=color;
    ctx.fill();
    ctx.lineWidth=2.5;
    ctx.strokeStyle=panel;
    ctx.stroke();
    if(!hideBubbles){
      ctx.font='800 9px ui-monospace,monospace';
      drawBubble(`DUR ${fmtTime(f.duration)}`,ex,ey,w,h,'duration',color);
    }
  }

  if(__animClipApplied){ctx.restore(); __animClipApplied=false;}
  ctx.restore();
}
function drawBubble(label,px,py,w,h,type,color){
  ctx.font='800 9px ui-monospace,monospace';
  const tw=ctx.measureText(label).width+12, th=20;
  if(px<M.l||px>w-M.r||py<M.t||py>h-M.b)return;

  let candidates;
  if(type==='duration'){
    candidates=[
      [px-tw-8, py-30],
      [px-tw-8, py+10],
      [px+8, py-30],
      [px+8, py+10]
    ];
  }else{
    candidates=[
      [px+8, py-30],
      [px+8, py+10],
      [px-tw-8, py-30],
      [px-tw-8, py+10]
    ];
  }

  let lx=null, ly=null;
  for(const c of candidates){
    const x=c[0], y=c[1];
    if(x>=M.l+2 && x+tw<=w-M.r-2 && y>=M.t+2 && y+th<=h-M.b-2){
      lx=x; ly=y; break;
    }
  }
  if(lx===null)return;

  const bp=bubbleAnimProgress();
  const scale=.92+.08*bp;
  const cx=lx+tw/2, cy=ly+th/2;
  ctx.save();
  ctx.globalAlpha=bp;
  ctx.translate(cx,cy);
  ctx.scale(scale,scale);
  ctx.translate(-cx,-cy);

  ctx.fillStyle=css('--panel')||'#fff';
  ctx.strokeStyle=color;
  roundRect(ctx,lx,ly,tw,th,6); ctx.fill();
  ctx.save();ctx.globalAlpha=.55*bp;ctx.lineWidth=.8;ctx.stroke();ctx.restore();
  ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label,cx,cy);
  ctx.restore();
}
function roundRect(ctx,x,y,w,h,r){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}


function colorForFlight(f){
  if(state.single && f.file===state.single.file){
    const key={maxAlt:'maxAlt',launch:'launchAlt',gain:'gain',longest:'duration'}[state.focus];
    return chartRecordColor();
  }
  const base=flightsBase();
  if(best(base,'maxAlt')?.file===f.file) return chartRecordColor();
  if(best(base,'launchAlt')?.file===f.file) return chartRecordColor();
  if(best(base,'gain')?.file===f.file) return chartRecordColor();
  if(best(base,'duration')?.file===f.file) return chartRecordColor();
  return chartBaseColor();
}
function drawGrid(w,h){const grid=css('--grid'), line=css('--line2'), muted=css('--muted'); ctx.fillStyle='transparent'; ctx.fillRect(0,0,w,h); ctx.font='800 11px system-ui'; ctx.textBaseline='middle'; ctx.lineWidth=1; const yt=ticks(0,state.y1,6), xt=ticks(state.x0,state.x1,5); ctx.strokeStyle=grid; ctx.fillStyle=muted; ctx.textAlign='right'; yt.forEach(v=>{const y=sy(v,h); crispLine(M.l,y,w-M.r,y); ctx.fillText(Math.round(v),M.l-7,y);}); ctx.textAlign='center'; xt.forEach(v=>{const x=sx(v,w); crispLine(x,M.t,x,h-M.b); ctx.fillText(Math.round(v),x,h-M.b+16);}); ctx.strokeStyle=line; crispLine(M.l,M.t,M.l,h-M.b); crispLine(M.l,h-M.b,w-M.r,h-M.b); drawAxisLabels(w,h,muted);}
function drawAxisLabels(w,h,color){ctx.save();ctx.fillStyle=color;ctx.globalAlpha=.58;ctx.font='800 8px system-ui';ctx.textBaseline='middle';ctx.textAlign='left';ctx.fillText('meters',M.l+4,M.t+8);ctx.textAlign='right';ctx.fillText('seconds',w-M.r-4,h-M.b-8);ctx.restore();}
function crispLine(x1,y1,x2,y2){ctx.beginPath(); ctx.moveTo(Math.round(x1)+.5,Math.round(y1)+.5); ctx.lineTo(Math.round(x2)+.5,Math.round(y2)+.5); ctx.stroke();}
function drawFlight(f,color,w,h,single){const pts=f.pts.filter(p=>p.t>=state.x0&&p.t<=state.x1); if(pts.length<2)return; ctx.beginPath(); pts.forEach((p,i)=>{const x=sx(p.t,w), y=sy(p.alt,h); i?ctx.lineTo(x,y):ctx.moveTo(x,y);}); ctx.strokeStyle=color; ctx.globalAlpha=single?1:.82; ctx.lineWidth=single?1.8:0.9; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke(); ctx.globalAlpha=1; }
function ticks(a,b,n){const span=b-a;if(span<=0)return[a];const raw=span/n, mag=10**Math.floor(Math.log10(raw)), step=(raw/mag>=5?5:raw/mag>=2?2:1)*mag;const out=[];for(let v=Math.ceil(a/step)*step;v<=b+1e-6;v+=step)out.push(v);return out;}
function point(e){const r=frame.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function stopMomentum(){if(state.momentum){cancelAnimationFrame(state.momentum.raf);state.momentum=null;}}
function pointerDown(e){
  stopMomentum();
  if(e.pointerType==='mouse'||e.pointerType==='touch'){
    try{frame.setPointerCapture(e.pointerId);}catch{}
  }
  const p=point(e), now=performance.now();
  state.pointers.set(e.pointerId,p);
  state.hideBubblesUntil=Date.now()+240;
  if(state.pointers.size===1) state.drag={x:p.x,y:p.y,x0:state.x0,x1:state.x1,mode:null,lastX:p.x,lastT:now,vx:0};
  if(state.pointers.size===2){
    e.preventDefault();
    const ps=[...state.pointers.values()], dist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y), mid=(ps[0].x+ps[1].x)/2;
    state.pinch={dist,mid,x0:state.x0,x1:state.x1};
    state.drag=null;
  }
}
function pointerMove(e){
  if(!state.pointers.has(e.pointerId))return;
  const p=point(e), w=frame.getBoundingClientRect().width, now=performance.now();
  state.pointers.set(e.pointerId,p);
  state.hideBubblesUntil=Date.now()+260;
  if(state.pointers.size===2&&state.pinch){
    e.preventDefault();
    const ps=[...state.pointers.values()], dist=Math.max(24,Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y)), mid=(ps[0].x+ps[1].x)/2;
    const oldSpan=state.pinch.x1-state.pinch.x0, newSpan=oldSpan*(state.pinch.dist/dist), center=state.pinch.x0+(state.pinch.x1-state.pinch.x0)/2+(state.pinch.mid-mid)/(w-M.l-M.r)*newSpan;
    state.x0=center-newSpan/2; state.x1=center+newSpan/2; clampView(); drawChart(); return;
  }
  if(state.drag&&state.pointers.size===1){
    const dx=p.x-state.drag.x, dy=p.y-state.drag.y, adx=Math.abs(dx), ady=Math.abs(dy);
    if(!state.drag.mode&&adx>5&&adx>ady*.8) state.drag.mode='pan';
    if(state.drag.mode==='pan'){
      e.preventDefault();
      const dtMs=Math.max(1,now-state.drag.lastT);
      state.drag.vx=(p.x-state.drag.lastX)/dtMs;
      state.drag.lastX=p.x; state.drag.lastT=now;
      const span=state.drag.x1-state.drag.x0, dt=-dx/(w-M.l-M.r)*span;
      state.x0=state.drag.x0+dt; state.x1=state.drag.x1+dt; clampView(); drawChart();
    }
  }
}
function pointerUp(e){
  const drag=state.drag;
  state.pointers.delete(e.pointerId);
  if(state.pointers.size<2)state.pinch=null;
  if(state.pointers.size===0){
    state.drag=null;
    if(drag&&drag.mode==='pan'&&Math.abs(drag.vx)>0.22) startMomentum(drag.vx);
    else {state.hideBubblesUntil=Date.now()+180; setTimeout(drawChart,190);}
  }
}
function startMomentum(vx){
  const w=frame.getBoundingClientRect().width;
  const plotW=Math.max(1,w-M.l-M.r);
  let v=vx, last=performance.now();
  state.momentum={raf:0};
  const step=(now)=>{
    const dt=Math.min(32,now-last); last=now;
    const span=state.x1-state.x0;
    const delta=-v*dt/plotW*span;
    const before0=state.x0, before1=state.x1;
    state.x0+=delta; state.x1+=delta; clampView();
    state.hideBubblesUntil=Date.now()+220;
    drawChart();
    const hitEdge=Math.abs(state.x0-before0)<1e-4&&Math.abs(state.x1-before1)<1e-4;
    v*=Math.pow(.94,dt/16);
    if(Math.abs(v)>0.035&&!hitEdge) state.momentum.raf=requestAnimationFrame(step);
    else {state.momentum=null; state.hideBubblesUntil=Date.now()+160; setTimeout(drawChart,170);}
  };
  state.momentum.raf=requestAnimationFrame(step);
}
function wheelZoom(e){e.preventDefault(); stopMomentum(); const w=frame.getBoundingClientRect().width, p=point(e), cx=invx(p.x,w), z=e.deltaY>0?1.18:.82; state.x0=cx-(cx-state.x0)*z; state.x1=cx+(state.x1-cx)*z; clampView(); state.hideBubblesUntil=Date.now()+200; drawChart(); setTimeout(drawChart,220);}
function clampView(){const a=flightsShown(), maxDur=Math.max(60,...a.map(f=>f.duration)); let span=state.x1-state.x0; const minSpan=Math.min(10,maxDur); span=Math.max(minSpan,Math.min(span,maxDur)); if(state.x0<0){state.x0=0;state.x1=span;} if(state.x1>maxDur){state.x1=maxDur;state.x0=maxDur-span;} if(state.x0<0)state.x0=0; state.x1=state.x0+span;}



