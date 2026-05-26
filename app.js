
const APP_BUILD = '57.0';
const LOG_DIR = 'logs/';
const CACHE_BUST = 'v57-' + Date.now();

const $ = id => document.getElementById(id);
const canvas = $('chartCanvas');
const frame = $('chartFrame');
const ctx = canvas.getContext('2d');

const M = { l: 46, r: 14, t: 18, b: 34 };
const state = {
  flights: [],
  dataMode: 'session',
  single: null,
  focus: null,
  x0: 0, x1: 120, y0: 0, y1: 80,
  drag: null,
  pointers: new Map(),
  pinch: null,
  momentum: null,
  hideBubblesUntil: 0,
  raf: 0,
  loading: false,
  year: 2026
};

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./service-worker.js').catch(()=>{});
}

async function fetchTextAny(urls){
  let lastErr=null;
  for(const raw of urls){
    const url=String(raw||'').replace(/^\/+/, '');
    if(!url) continue;
    try{
      const r=await fetch(bustUrl(url),{cache:'no-store'});
      if(r.ok) return await r.text();
      lastErr=new Error(url+' HTTP '+r.status);
    }catch(e){lastErr=e;}
  }
  throw lastErr || new Error('fetch failed');
}
function normalizeFlightPath(file){
  return String(file||'').trim().replace(/^\.?\//,'');
}
function flightUrlCandidates(file){
  const f=normalizeFlightPath(file);
  const base=f.split('/').pop();
  const out=[];
  if(f.includes('/')) out.push(f);
  out.push(LOG_DIR+f);
  if(base) out.push(LOG_DIR+base);
  if(base) out.push(base);
  return [...new Set(out.filter(Boolean))];
}
function splitCsvLine(line){
  const out=[]; let cur='', q=false;
  for(let i=0;i<line.length;i++){
    const ch=line[i];
    if(ch==='"'){q=!q; continue;}
    if(ch===',' && !q){out.push(cur.trim()); cur=''; continue;}
    cur+=ch;
  }
  out.push(cur.trim());
  return out;
}
function parseIndexRows(txt){
  return (txt||'').trim().split(/\r?\n/)
    .map(l=>splitCsvLine(l))
    .filter(r=>r.length>=6)
    .filter(r=>{
      const joined=r.join(',').toLowerCase();
      if(joined.includes('date') && joined.includes('time')) return false;
      return r.some(x=>/\.csv$/i.test(x));
    });
}

function bustUrl(url){
  const sep = url.includes('?') ? '&' : '?';
  return url + sep + 'cb=' + encodeURIComponent(CACHE_BUST);
}
function css(name){ return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
function setLogStatus(text){ const el=$('logStatus'); if(el) el.textContent=text || ''; }
function showLoad(v){ state.loading=v; const el=$('loader'); if(el) el.classList.toggle('hidden', !v); }

function parseCsv(txt){
  const lines=(txt||'').trim().split(/\r?\n/).filter(Boolean);
  const pts=[];
  for(let i=1;i<lines.length;i++){
    const p=lines[i].split(',');
    const t=+p[0], alt=+p[1];
    if(Number.isFinite(t) && Number.isFinite(alt)) pts.push({t,alt});
  }
  return pts;
}
function dateNum(d){ const [dd,mm]=String(d).split('/').map(Number); return (mm||0)*100+(dd||0); }
function timeNum(t){ return Number(String(t).replace(/\D/g,'')) || 0; }
function yearFromFile(file){ return 2026; }
function fmtGain(v){ v=Math.round(v||0); return v===0?'–':(v>0?'+'+v:String(v)); }
function fmtTime(s){ s=Math.round(s||0); return `${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`; }
function fmtHMS(s){
  s=Math.round(s||0);
  return `${String(Math.floor(s/3600)).padStart(2,'0')}:${String(Math.floor((s%3600)/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
}
function best(a,k){ return a.length ? [...a].sort((x,y)=>(y[k]||0)-(x[k]||0))[0] : null; }
function top10Flights(){ return [...state.flights].sort((a,b)=>b.duration-a.duration).slice(0,10); }
function bestCardFlights(){
  const keys=['duration','maxAlt','launchAlt','gain'];
  const out=[];
  keys.forEach(k=>{
    const f=best(state.flights,k);
    if(f && !out.some(x=>x.file===f.file)) out.push(f);
  });
  return out;
}
function chartFlights(){
  const out=[...top10Flights()];
  bestCardFlights().forEach(f=>{ if(!out.some(x=>x.file===f.file)) out.push(f); });
  return out;
}
function sessionsCount(){ return new Set(state.flights.map(f=>f.date)).size; }
function flightsShown(){let a=chartFlights(); if(state.single) a=a.filter(f=>f.file===state.single.file); return a;}
async function loadFlightFile(f){
  if(!f || f.loaded) return f;
  try{
    const csv=await fetchTextAny(flightUrlCandidates(f.file));
    const pts=parseCsv(csv);
    f.pts=pts;
    f.loaded=pts.length>0;
  }catch(e){
    console.warn('missing log', f && f.file, e);
    f.pts=[];
    f.loaded=false;
  }
  return f;
}
async function ensureFlightsLoaded(list){
  const need = [...new Set((list||[]).filter(f=>f && !f.loaded).map(f=>f.file))]
    .map(file => state.flights.find(f=>f.file===file))
    .filter(Boolean);
  for(const f of need) await loadFlightFile(f);
  setLogStatus(`ver. ${APP_BUILD} • logs: ${chartFlights().filter(f=>f.loaded).length}/${state.flights.length} loaded`);
}

async function loadRepoLogs(){
  setLogStatus(`ver. ${APP_BUILD} • logs: loading index`);
  const txt = await fetchTextAny([LOG_DIR + 'index.csv', 'index.csv']);
  const rows = parseIndexRows(txt);
  const out=[];

  for(const r of rows){
    try{
      const fileIdx = r.findIndex(x=>/\.csv$/i.test(x));
      const file = fileIdx>=0 ? r[fileIdx] : r[5];
      const vals = fileIdx>=0 ? r.filter((_,i)=>i!==fileIdx) : r.slice(0,5);

      const date = vals[0];
      const time = vals[1];
      const launch = Number(String(vals[2]).replace(',', '.'));
      const maxAlt = Number(String(vals[3]).replace(',', '.'));
      const duration = Number(String(vals[4]).replace(',', '.'));

      if(!date || !time || !file || !Number.isFinite(duration)) continue;

      const lnh = Number.isFinite(launch) ? launch : 0;
      const alt = Number.isFinite(maxAlt) ? maxAlt : lnh;

      out.push({
        date, time, year: yearFromFile(file), file: normalizeFlightPath(file),
        launchAlt: lnh,
        maxAlt: alt,
        duration,
        gain: alt-lnh,
        pts: [],
        loaded: false
      });
    }catch(e){
      console.warn('bad index row', r, e);
    }
  }

  state.flights = out.sort((a,b)=>(a.year*10000+dateNum(a.date)+timeNum(a.time))-(b.year*10000+dateNum(b.date)+timeNum(b.time)));
  state.year = 2026;
  setLogStatus(`ver. ${APP_BUILD} • logs: index ${state.flights.length}`);
  await ensureFlightsLoaded(chartFlights());
}
async function init(){
  bindUI();
  loadTheme();
  showLoad(true);
  try{
    await loadRepoLogs();
  }catch(e){
    console.warn(e);
    state.flights = [];
    setLogStatus(`ver. ${APP_BUILD} • index load error`);
  }
  showLoad(false);
  setDataMode('session');
  renderAll();
}

function bindUI(){
  $('themeBtn').onclick = () => {
    document.documentElement.classList.toggle('light');
    localStorage.setItem('f3kTheme', document.documentElement.classList.contains('light') ? 'light' : 'dark');
    $('themeBtn').textContent = document.documentElement.classList.contains('light') ? '☾' : '☼';
    drawChart();
  };
  $('sessionTab').onclick = () => setDataMode('session');
  $('tableTab').onclick = () => setDataMode('table');
  const ft = $('flightTab'); if(ft) ft.onclick = () => setDataMode('flight');

  $('prevFlightBtn').onclick = () => stepFlight(-1);
  $('nextFlightBtn').onclick = () => stepFlight(1);
  const fit = $('chartFitBtn'); if(fit) fit.onclick = e => { e.stopPropagation(); fitView(); };

  document.querySelectorAll('.recordCard').forEach(b => b.onclick = () => focusMetric(b.dataset.focus));

  frame.addEventListener('pointerdown', pointerDown);
  frame.addEventListener('pointermove', pointerMove);
  frame.addEventListener('pointerup', pointerUp);
  frame.addEventListener('pointercancel', pointerUp);
  frame.addEventListener('wheel', wheelZoom, { passive:false });
  new ResizeObserver(()=>drawChart()).observe(frame);
  bindPressFeedback();
}
function loadTheme(){
  const saved=localStorage.getItem('f3kTheme');
  document.documentElement.classList.toggle('light', saved ? saved==='light' : true);
  $('themeBtn').textContent = document.documentElement.classList.contains('light') ? '☾' : '☼';
}


function addPressFeedback(el){
  if(!el) return;
  const on=()=>el.classList.add('isPressed');
  const off=()=>el.classList.remove('isPressed');
  el.addEventListener('pointerdown',on,{passive:true});
  el.addEventListener('pointerup',off,{passive:true});
  el.addEventListener('pointercancel',off,{passive:true});
  el.addEventListener('pointerleave',off,{passive:true});
}
function bindPressFeedback(){
  document.querySelectorAll('.flightNav').forEach(addPressFeedback);
}

function setDataMode(m){
  state.dataMode = m;

  if(m==='session'){
    state.single = null;
    state.focus = null;
    setActiveRecord(null);
  }
  if(m==='table'){
    state.focus = null;
    setActiveRecord(null);
  }

  if(m==='flight'){
    if(!state.single){
      state.single = top10Flights()[0] || null;
      state.focus = null;
      setActiveRecord(null);
    }
    if(state.single && !state.single.loaded){
      ensureFlightsLoaded([state.single]).then(()=>{fitView(false);renderSummary();renderTable();drawChart();});
    }
  }

  $('sessionTab').classList.toggle('active', m==='session');
  $('tableTab').classList.toggle('active', m==='table');
  const ft=$('flightTab'); if(ft) ft.classList.toggle('active', m==='flight');

  $('chartPanel').classList.toggle('hidden', m==='table');
  $('tablePanel').classList.toggle('hidden', m!=='table');

  fitView(false);
  renderSummary();
  renderTable();
  drawChart();
}
function setActiveRecord(k){
  document.querySelectorAll('.recordCard').forEach(b => b.classList.toggle('active', b.dataset.focus===k));
}
async function focusMetric(k){
  state.focus = k;
  const key = { longest:'duration', maxAlt:'maxAlt', launch:'launchAlt', gain:'gain' }[k];
  state.single = best(state.flights, key);
  setActiveRecord(k);
  await ensureFlightsLoaded([state.single]);
  setDataMode('flight');
}
async function stepFlight(dir){
  const a=top10Flights();
  if(!a.length) return;
  let i=a.findIndex(f=>state.single&&f.file===state.single.file);
  if(i<0) i=0;
  i=(i+dir+a.length)%a.length;
  state.single=a[i];
  state.focus=null;
  setActiveRecord(null);
  await ensureFlightsLoaded([state.single]);
  setDataMode('flight');
}

function renderAll(){
  renderSummary();
  renderTable();
  fitView(false);
  drawChart();
}
function renderSummary(){
  const a=state.flights;
  const total=a.reduce((s,f)=>s+f.duration,0);
  const maxAlt=best(a,'maxAlt'), launch=best(a,'launchAlt'), gain=best(a,'gain'), longest=best(a,'duration');
  const ms=$('mSessions'); if(ms) ms.textContent=sessionsCount();
  $('mFlights').textContent = a.length;
  $('mTime').textContent = fmtHMS(total);
  $('mLongest').textContent = fmtTime(longest ? longest.duration : 0);
  $('mMaxAlt').textContent = (maxAlt ? Math.round(maxAlt.maxAlt) : 0) + ' m';
  $('mLaunch').textContent = (launch ? Math.round(launch.launchAlt) : 0) + ' m';
  $('mGain').textContent = gain ? (fmtGain(gain.gain) + (Math.round(gain.gain||0)===0 ? '' : ' m')) : '–';
}
function renderTable(){
  const tb=$('logRows');
  tb.innerHTML='';
  top10Flights().forEach((f,idx)=>{
    const tr=document.createElement('tr');
    tr.className = (idx<3 ? `rank rank${idx+1}` : '');
    tr.innerHTML = `<td class="rankNum">${idx+1}</td><td>${f.date}</td><td class="timeCell">${f.time}</td><td class="durationCell">${fmtTime(f.duration)}</td><td>${Math.round(f.maxAlt)}</td><td>${Math.round(f.launchAlt)}</td><td><span>${fmtGain(f.gain)}</span><i class="rowChevron">›</i></td>`;
    tr.onclick = async () => {
      state.single = f;
      state.focus = null;
      setActiveRecord(null);
      await ensureFlightsLoaded([f]);
      setDataMode('flight');
    };
    addPressFeedback(tr);
    tb.appendChild(tr);
  });
}

function canvasSize(){
  const dpr=Math.max(1,window.devicePixelRatio||1), r=frame.getBoundingClientRect();
  canvas.width=Math.max(1,Math.round(r.width*dpr));
  canvas.height=Math.max(1,Math.round(r.height*dpr));
  canvas.style.width=r.width+'px';
  canvas.style.height=r.height+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  return {w:r.width,h:r.height};
}
function sx(t,w){ return M.l+(t-state.x0)/(state.x1-state.x0)*(w-M.l-M.r); }
function sy(y,h){ return h-M.b-(y-state.y0)/(state.y1-state.y0)*(h-M.t-M.b); }
function invx(px,w){ return state.x0+(px-M.l)/(w-M.l-M.r)*(state.x1-state.x0); }
function chartBaseColor(){ return css('--baseChart') || '#888'; }
function chartRecordColor(){ return css('--recordChart') || '#db2777'; }

function fitView(redraw=true){
  const a=flightsShown();
  const base=state.single ? a : chartFlights();
  const dur=Math.max(60,...base.map(f=>f.duration||0));
  const maxY=Math.max(30,...base.map(f=>f.maxAlt||0))*1.08;
  state.x0=0; state.x1=dur; state.y0=0; state.y1=Math.ceil(maxY/10)*10;
  clampXRange();
  if(redraw) drawChart();
}
function updateFitButton(){
  const b=$('chartFitBtn'); if(!b) return;
  b.classList.remove('active');
  b.setAttribute('aria-disabled','true');
}
function updateChartHeader(){
  const single=!!state.single;
  const top=document.querySelector('.chartTop');
  if(top) top.classList.toggle('overlayHidden', !single);
  $('prevFlightBtn').classList.toggle('hidden',!single);
  $('nextFlightBtn').classList.toggle('hidden',!single);
  if(single){
    const list=top10Flights();
    const i=list.findIndex(f=>f.file===state.single.file);
    $('chartLabel').textContent=`${state.single.date}/${state.year} ${state.single.time}`;
    $('chartSub').textContent=`FLIGHT TOP ${i>=0?i+1:'—'} OF ${Math.min(10,state.flights.length)}`;
  }else{
    $('chartLabel').textContent='';
    $('chartSub').textContent='';
  }
}
function drawGrid(w,h){
  ctx.save();
  ctx.strokeStyle=css('--line2') || '#ddd';
  ctx.lineWidth=1;
  ctx.font='9px ui-monospace,monospace';
  ctx.fillStyle=css('--muted') || '#777';
  ctx.textAlign='right';
  ctx.textBaseline='middle';
  ticks(state.y0,state.y1,4).forEach(v=>{
    const y=sy(v,h);
    ctx.globalAlpha=.55;
    ctx.beginPath(); ctx.moveTo(M.l,y); ctx.lineTo(w-M.r,y); ctx.stroke();
    ctx.globalAlpha=1;
    ctx.fillText(Math.round(v),M.l-7,y);
  });
  ctx.textAlign='center';
  ctx.textBaseline='top';
  ticks(state.x0,state.x1,4).forEach(v=>{
    const x=sx(v,w);
    ctx.globalAlpha=.35;
    ctx.beginPath(); ctx.moveTo(x,M.t); ctx.lineTo(x,h-M.b); ctx.stroke();
    ctx.globalAlpha=1;
    ctx.fillText(Math.round(v),x,h-M.b+8);
  });
  ctx.textAlign='left';
  ctx.fillText('meters',M.l,M.t-14);
  ctx.textAlign='right';
  ctx.fillText('seconds',w-M.r,h-15);
  ctx.restore();
}
function ticks(a,b,n){
  const span=b-a; if(span<=0) return [a];
  const raw=span/n, mag=10**Math.floor(Math.log10(raw));
  const step=(raw/mag>=5?5:raw/mag>=2?2:1)*mag;
  const out=[];
  for(let v=Math.ceil(a/step)*step; v<=b+1e-6; v+=step) out.push(v);
  return out;
}
function colorForFlight(f){
  if(state.single) return chartRecordColor();
  return top10Flights().slice(0,3).some(x=>x.file===f.file) ? chartRecordColor() : chartBaseColor();
}
function drawFlight(f,color,w,h,single){
  if(!f||!f.pts||!f.pts.length) return;
  const pts=f.pts.filter(p=>p.t>=state.x0&&p.t<=state.x1);
  if(pts.length<2) return;
  ctx.beginPath();
  pts.forEach((p,i)=>{
    const x=sx(p.t,w), y=sy(p.alt,h);
    i ? ctx.lineTo(x,y) : ctx.moveTo(x,y);
  });
  ctx.strokeStyle=color;
  ctx.globalAlpha=single?1:.78;
  ctx.lineWidth=single?1.8:0.9;
  ctx.lineJoin='round';
  ctx.lineCap='round';
  ctx.stroke();
  ctx.globalAlpha=1;
}
function stableMaxPoint(f){
  if(!f||!f.pts||!f.pts.length) return null;
  let best=f.pts[0];
  f.pts.forEach(p=>{ if(p.alt>best.alt) best=p; });
  return best;
}
function drawBubble(label,px,py,w,h,type,color){
  ctx.font='800 9px ui-monospace,monospace';
  const tw=ctx.measureText(label).width+12, th=20;
  const opts=type==='duration'
    ? [[px-tw-8,py-30],[px-tw-8,py+10],[px+8,py-30],[px+8,py+10]]
    : [[px+8,py-30],[px+8,py+10],[px-tw-8,py-30],[px-tw-8,py+10]];
  let lx=null,ly=null;
  for(const [x,y] of opts){
    if(x>=M.l+2 && x+tw<=w-M.r-2 && y>=M.t+2 && y+th<=h-M.b-2){lx=x;ly=y;break;}
  }
  if(lx===null) return;
  ctx.save();
  ctx.fillStyle=css('--panel')||'#fff';
  ctx.strokeStyle=color;
  roundRect(ctx,lx,ly,tw,th,6); ctx.fill();
  ctx.globalAlpha=.55; ctx.lineWidth=.8; ctx.stroke(); ctx.globalAlpha=1;
  ctx.fillStyle=color; ctx.textAlign='center'; ctx.textBaseline='middle';
  ctx.fillText(label,lx+tw/2,ly+th/2);
  ctx.restore();
}
function roundRect(c,x,y,w,h,r){
  c.beginPath();
  c.moveTo(x+r,y); c.arcTo(x+w,y,x+w,y+h,r); c.arcTo(x+w,y+h,x,y+h,r); c.arcTo(x,y+h,x,y,r); c.arcTo(x,y,x+w,y,r); c.closePath();
}
function drawSingleMarkers(f,w,h){
  if(!f||!f.pts||!f.pts.length) return;
  const color=chartRecordColor();
  const panel=css('--panel')||'#fff';
  const maxPt=stableMaxPoint(f);
  const endPt=f.pts[f.pts.length-1];
  const hide=Date.now()<state.hideBubblesUntil || !!state.drag || !!state.momentum;

  ctx.save();
  if(maxPt && maxPt.t>=state.x0 && maxPt.t<=state.x1 && maxPt.alt>=state.y0 && maxPt.alt<=state.y1){
    const mx=sx(maxPt.t,w), my=sy(maxPt.alt,h);
    ctx.beginPath(); ctx.arc(mx,my,5.8,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
    ctx.lineWidth=3; ctx.strokeStyle=panel; ctx.stroke();
    if(!hide) drawBubble(`MAX ${Math.round(maxPt.alt)} m`,mx,my,w,h,'max',color);
  }
  if(endPt && endPt.t>=state.x0 && endPt.t<=state.x1){
    const ex=sx(endPt.t,w), ey=sy(endPt.alt,h);
    ctx.beginPath(); ctx.arc(ex,ey,4.8,0,Math.PI*2); ctx.fillStyle=color; ctx.fill();
    ctx.lineWidth=2.5; ctx.strokeStyle=panel; ctx.stroke();
    if(!hide) drawBubble(`DUR ${fmtTime(f.duration)}`,ex,ey,w,h,'duration',color);
  }
  ctx.restore();
}
function drawChart(){
  if(state.dataMode==='table') return;
  cancelAnimationFrame(state.raf);
  state.raf=requestAnimationFrame(()=>{
    updateFitButton();
    const {w,h}=canvasSize();
    ctx.clearRect(0,0,w,h);
    drawGrid(w,h);
    const a=flightsShown();
    updateChartHeader();
    ctx.save();
    ctx.beginPath(); ctx.rect(M.l,M.t,w-M.l-M.r,h-M.t-M.b); ctx.clip();
    a.forEach(f=>drawFlight(f,colorForFlight(f),w,h,!!state.single));
    ctx.restore();
    if(state.single) drawSingleMarkers(state.single,w,h);
    ctx.strokeStyle=css('--line2')||'#ddd';
    ctx.lineWidth=1;
    ctx.strokeRect(M.l+.5,M.t+.5,w-M.l-M.r,h-M.t-M.b);
  });
}


function chartMaxDuration(){
  const base = state.single ? [state.single] : chartFlights();
  return Math.max(60, ...base.map(f=>f.duration||0));
}
function clampXRange(){
  const maxDur = chartMaxDuration();
  let span = state.x1 - state.x0;
  const minSpan = Math.min(8, maxDur);
  const maxSpan = Math.max(10, maxDur);
  if(span < minSpan){
    const mid=(state.x0+state.x1)/2;
    span=minSpan;
    state.x0=mid-span/2;
    state.x1=mid+span/2;
  }
  if(span > maxSpan){
    state.x0=0;
    state.x1=maxDur;
    return;
  }
  if(state.x0 < 0){
    state.x1 -= state.x0;
    state.x0 = 0;
  }
  if(state.x1 > maxDur){
    const d = state.x1 - maxDur;
    state.x0 -= d;
    state.x1 = maxDur;
  }
  if(state.x0 < 0) state.x0=0;
  if(state.x1 > maxDur) state.x1=maxDur;
}

function point(e){const r=frame.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};}
function stopMomentum(){ if(state.momentum){ cancelAnimationFrame(state.momentum.raf); state.momentum=null; } }
function pointerDown(e){
  stopMomentum();
  try{frame.setPointerCapture(e.pointerId);}catch{}
  const p=point(e), now=performance.now();
  state.pointers.set(e.pointerId,p);
  state.hideBubblesUntil=Date.now()+240;
  if(state.pointers.size===1) state.drag={x:p.x,y:p.y,x0:state.x0,x1:state.x1,lastX:p.x,lastT:now,vx:0};
  if(state.pointers.size===2){
    const ps=[...state.pointers.values()];
    const dist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    const mid=(ps[0].x+ps[1].x)/2;
    state.pinch={dist,mid,x0:state.x0,x1:state.x1};
    state.drag=null;
  }
}
function pointerMove(e){
  if(!state.pointers.has(e.pointerId)) return;
  const p=point(e);
  state.pointers.set(e.pointerId,p);
  if(state.pointers.size===2 && state.pinch){
    e.preventDefault();
    const ps=[...state.pointers.values()];
    const dist=Math.hypot(ps[0].x-ps[1].x,ps[0].y-ps[1].y);
    const r=frame.getBoundingClientRect();
    const center=state.pinch.x0+(state.pinch.mid-M.l)/(r.width-M.l-M.r)*(state.pinch.x1-state.pinch.x0);
    const scale=state.pinch.dist/Math.max(1,dist);
    const span=(state.pinch.x1-state.pinch.x0)*scale;
    state.x0=center-(center-state.pinch.x0)*scale;
    state.x1=state.x0+span;
    clampXRange();
    drawChart();
    return;
  }
  if(!state.drag) return;
  e.preventDefault();
  const r=frame.getBoundingClientRect();
  const span=state.drag.x1-state.drag.x0;
  const dx=p.x-state.drag.x;
  state.x0=state.drag.x0-dx/(r.width-M.l-M.r)*span;
  state.x1=state.drag.x1-dx/(r.width-M.l-M.r)*span;
  clampXRange();

  const now=performance.now(), dt=Math.max(1,now-state.drag.lastT);
  state.drag.vx=(p.x-state.drag.lastX)/dt;
  state.drag.lastX=p.x; state.drag.lastT=now;
  drawChart();
}
function pointerUp(e){
  state.pointers.delete(e.pointerId);
  if(state.pointers.size<2) state.pinch=null;
  if(state.drag){
    const vx=state.drag.vx;
    state.drag=null;
    startMomentum(vx);
  }
}
function startMomentum(vx){
  if(Math.abs(vx)<.05) return;
  const r=frame.getBoundingClientRect();
  let v=vx, last=performance.now();
  const tick=()=>{
    const now=performance.now(), dt=now-last; last=now;
    const span=state.x1-state.x0;
    const dx=v*dt;
    state.x0-=dx/(r.width-M.l-M.r)*span;
    state.x1-=dx/(r.width-M.l-M.r)*span;
    clampXRange();
    v*=.94;
    drawChart();
    if(Math.abs(v)>.01) state.momentum={raf:requestAnimationFrame(tick)};
    else state.momentum=null;
  };
  state.momentum={raf:requestAnimationFrame(tick)};
}
function wheelZoom(e){
  e.preventDefault();
  const {w}=canvasSize();
  const mx=invx(point(e).x,w);
  const scale=e.deltaY<0?.88:1.14;
  const nx0=mx-(mx-state.x0)*scale;
  const nx1=mx+(state.x1-mx)*scale;
  if(nx1-nx0>6){state.x0=nx0;state.x1=nx1; clampXRange();}
  drawChart();
}

init();
