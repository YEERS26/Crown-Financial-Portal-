// ================================================================
// app.js — The Crown Financial Portal v3
// GitHub + Cloudflare Pages + Neon Postgres
// All DB calls go through /api/* (Cloudflare Pages Functions)
// ================================================================

// ── API CLIENT ──────────────────────────────────────────────────
let _token = null;

async function api(method, path, body) {
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (_token) opts.headers['Authorization'] = `Bearer ${_token}`;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch(`/api/${path}`, opts);
  if (!res.ok) {
    const e = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(e.error || res.statusText);
  }
  return res.json();
}

const GET    = path        => api('GET',    path);
const POST   = (path, b)  => api('POST',   path, b);
const PUT    = (path, b)  => api('PUT',    path, b);
const DELETE = (path, b)  => api('DELETE', path, b);

// ── STATE ────────────────────────────────────────────────────────
let defs  = [];
let insts = [];
let activeTab = 'dashboard';
let calMonth  = { y: new Date().getFullYear(), m: new Date().getMonth() };

const CATS  = ['Alcohol & Stock Purchases','Finance & Loans','Kitchen & Equipment','Licences & Compliance','Media & Entertainment','Property & Premises Costs','Staff & Labour','Tax & Government','Telecoms & IT','Utilities & Energy'];
const FREQS = ['Weekly','Monthly','Yearly','One-off'];
const DAYS  = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];

// ── BOOT ─────────────────────────────────────────────────────────
(function boot() {
  const saved = sessionStorage.getItem('crown_token');
  if (saved) { _token = saved; loadAll().then(showApp).catch(() => showLogin()); }
  else showLogin();
})();

// ── AUTH ─────────────────────────────────────────────────────────
function showLogin() {
  document.getElementById('loginScreen').style.display = 'flex';
  document.getElementById('app').style.display = 'none';
}

function showApp() {
  document.getElementById('loginScreen').style.display = 'none';
  document.getElementById('app').style.display = 'flex';
  go('dashboard', document.querySelector('.tab'));
}

document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && document.getElementById('loginScreen').style.display !== 'none') login();
});

async function login() {
  const email = document.getElementById('lu').value.trim();
  const pass  = document.getElementById('lp').value;
  const btn   = document.getElementById('loginBtn');
  const errEl = document.getElementById('lerr');
  if (!email || !pass) { errEl.textContent = 'Please enter your email and password.'; return; }
  btn.textContent = 'Signing in\u2026'; btn.disabled = true; errEl.textContent = '';
  try {
    const res = await POST('login', { email, password: pass });
    _token = res.token;
    sessionStorage.setItem('crown_token', _token);
    await loadAll();
    showApp();
  } catch(e) {
    errEl.textContent = e.message;
    btn.textContent = 'Sign in'; btn.disabled = false;
  }
}

function logout() {
  _token = null;
  sessionStorage.removeItem('crown_token');
  showLogin();
  document.getElementById('lu').value = '';
  document.getElementById('lp').value = '';
}

// ── DATA LAYER ───────────────────────────────────────────────────
async function loadAll() {
  setSyncStatus('sv');
  const [rawDefs, rawInsts] = await Promise.all([GET('definitions'), GET('instances')]);
  defs  = rawDefs.map(mapDef);
  insts = rawInsts.map(mapInst);
  await generateUpcomingInstances();
  await autoSetStatuses();
  setSyncStatus('ok');
}

// Auto-set statuses based on date every time portal loads:
// past = Paid, today/future = To be paid
// Saves any changes back to DB
async function autoSetStatuses() {
  const today = getToday();
  const toUpdate = [];

  insts.forEach(i => {
    const shouldBe = i.date < today ? 'Paid' : 'To be paid';
    if (i.status !== shouldBe) {
      i.status = shouldBe;
      if (i.id && i.id > 0) toUpdate.push(i);
    }
  });

  // Save changed statuses to DB in parallel
  if (toUpdate.length) {
    try {
      await Promise.all(toUpdate.map(i =>
        PUT(`instances/${i.id}`, { status: i.status, amount: i.amount })
      ));
    } catch(e) { console.error('autoSetStatuses error:', e); }
  }
}

function mapDef(r) {
  return {
    id: r.id, name: r.name, cat: r.category, freq: r.freq,
    weekday: r.weekday, dayOfMonth: r.day_of_month, nextDate: r.next_date,
    amount: Number(r.amount),
    creditBal: r.credit_bal !== null ? Number(r.credit_bal) : null,
    creditMax: r.credit_max !== null ? Number(r.credit_max) : null,
    priority: r.priority || '',
  };
}

function mapInst(r) {
  return { id: r.id, defId: r.def_id, date: r.date, amount: Number(r.amount), status: r.status || '' };
}

function defToRow(def) {
  return {
    name: def.name, category: def.cat, freq: def.freq,
    weekday: def.weekday || null, day_of_month: def.dayOfMonth || null,
    next_date: def.nextDate || null, amount: def.amount,
    credit_bal: def.creditBal ?? null, credit_max: def.creditMax ?? null,
    priority: def.priority || '',
  };
}

async function saveDef(def) {
  setSyncStatus('sv');
  try { await PUT(`definitions/${def.id}`, defToRow(def)); setSyncStatus('ok'); }
  catch(e) { console.error(e); setSyncStatus('er'); }
}

async function insertDef(def) {
  setSyncStatus('sv');
  try {
    const row = await POST('definitions', defToRow(def));
    setSyncStatus('ok');
    return mapDef(row);
  } catch(e) { console.error(e); setSyncStatus('er'); return null; }
}

async function deleteDef(id) {
  setSyncStatus('sv');
  try { await DELETE(`definitions/${id}`); setSyncStatus('ok'); }
  catch(e) { console.error(e); setSyncStatus('er'); }
}

async function saveInst(inst) {
  setSyncStatus('sv');
  try {
    if (inst.id && inst.id > 0) {
      await PUT(`instances/${inst.id}`, { status: inst.status, amount: inst.amount });
    } else {
      const row = await POST('instances', { def_id: inst.defId, date: inst.date, amount: inst.amount, status: inst.status });
      inst.id = row.id;
    }
    setSyncStatus('ok');
  } catch(e) { console.error(e); setSyncStatus('er'); }
}

async function cascadeAmount(defId, amount) {
  const today = getToday();
  insts.forEach(i => { if (i.defId===defId && i.status!=='Paid' && i.date>=today) i.amount=amount; });
  setSyncStatus('sv');
  try { await PUT('instances/cascade', { def_id: defId, amount, from_date: today }); setSyncStatus('ok'); }
  catch(e) { console.error(e); setSyncStatus('er'); }
}

async function deleteFutureInsts(defId) {
  const today = getToday();
  insts = insts.filter(i => !(i.defId===defId && i.status!=='Paid' && i.date>=today));
  try { await DELETE('instances/future', { def_id: defId, from_date: today }); }
  catch(e) { console.error(e); }
}

async function generateUpcomingInstances() {
  const now     = new Date(); now.setHours(0,0,0,0);
  const horizon = new Date(now); horizon.setDate(horizon.getDate()+56);
  const newRows = [];

  defs.forEach(def => {
    if (def.freq==='Weekly' && def.weekday) {
      const wdMap = {Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
      const target = wdMap[def.weekday];
      for (let d=new Date(now); d<=horizon; d.setDate(d.getDate()+1)) {
        if (d.getDay()===target) {
          const ds = toDateStr(d);
          if (!insts.find(i=>i.defId===def.id&&i.date===ds)) {
            insts.push({id:-1, defId:def.id, date:ds, amount:def.amount, status:''});
            newRows.push({def_id:def.id, date:ds, amount:def.amount, status:''});
          }
        }
      }
    }
    if (def.freq==='Monthly' && def.dayOfMonth) {
      for (let offset=0; offset<=3; offset++) {
        const d  = new Date(now.getFullYear(), now.getMonth()+offset, def.dayOfMonth);
        const ds = toDateStr(d);
        if (!insts.find(i=>i.defId===def.id&&i.date===ds)) {
          insts.push({id:-1, defId:def.id, date:ds, amount:def.amount, status:''});
          newRows.push({def_id:def.id, date:ds, amount:def.amount, status:''});
        }
      }
    }
  });

  if (newRows.length) {
    try { await POST('instances', newRows); } catch(e) { console.error(e); }
  }
}

// ── SYNC STATUS ──────────────────────────────────────────────────
function setSyncStatus(s) {
  const dot=document.getElementById('sdot'), txt=document.getElementById('stxt');
  if (!dot) return;
  dot.className='sdot';
  if (s==='sv') { dot.classList.add('sv'); txt.textContent='Saving\u2026'; }
  else if (s==='ok') { txt.textContent='Saved '+new Date().toLocaleTimeString('en-GB',{hour:'2-digit',minute:'2-digit'}); }
  else { dot.classList.add('er'); txt.textContent='Error \u2014 check connection'; }
}

// ── ROUTING ──────────────────────────────────────────────────────
function go(tab, el) {
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  el.classList.add('active');
  activeTab=tab;
  render(tab);
}

function render(tab) {
  const c=document.getElementById('tc'); if(!c) return;
  if      (tab==='dashboard') { c.innerHTML=renderDash();      initCharts(); }
  else if (tab==='payments')  { c.innerHTML=renderPayments();  attachPayFilters(); }
  else if (tab==='pricelist') { c.innerHTML=renderPricelist(); }
  else if (tab==='credits')   { c.innerHTML=renderCredits();   attachCrEvents(); }
}

// ── HELPERS ──────────────────────────────────────────────────────
const fmt      = n=>(n==null)?'\u2014':'\u00a3'+Number(n).toLocaleString('en-GB',{minimumFractionDigits:2,maximumFractionDigits:2});
const getToday = ()=>toDateStr(new Date());
const toDateStr = d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const defById  = id=>defs.find(d=>d.id===id);

function toMonthly(def) {
  if (def.freq==='Weekly')  return def.amount*52/12;
  if (def.freq==='Monthly') return def.amount;
  if (def.freq==='One-off') return 0;
  return def.amount/12;
}

function formatDate(d) {
  if (!d) return '\u2014';
  if (typeof d==='string') d=new Date(d.replace(/-/g,'/'));
  return d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
}

function nextOccurrence(def) {
  const now=new Date(); now.setHours(0,0,0,0);
  if (def.freq==='Weekly') {
    const wdMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6};
    const d=new Date(now); let diff=(wdMap[def.weekday]-d.getDay()+7)%7; if(!diff) diff=7;
    d.setDate(d.getDate()+diff); return d;
  }
  if (def.freq==='Monthly'&&def.dayOfMonth) {
    const d=new Date(now.getFullYear(),now.getMonth(),def.dayOfMonth);
    if(d<=now) d.setMonth(d.getMonth()+1); return d;
  }
  if (def.nextDate) { const p=def.nextDate.split('-'); return new Date(+p[0],+p[1]-1,+p[2]); }
  return null;
}

function weeklyCountInMonth(weekday,y,m) {
  const wdMap={Sun:0,Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6}; const target=wdMap[weekday];
  let count=0; const days=new Date(y,m+1,0).getDate();
  for(let d=1;d<=days;d++) { if(new Date(y,m,d).getDay()===target) count++; }
  return count;
}

function freqBadge(f)   { if(f==='Weekly') return `<span class="badge bweekly">Weekly</span>`; if(f==='Monthly') return `<span class="badge bmonthly">Monthly</span>`; if(f==='Yearly') return `<span class="badge byearly">Yearly</span>`; if(f==='One-off') return `<span class="badge" style="background:#f0f9e8;color:#2d6a0a;border:1px solid rgba(45,106,10,.2)">One-off</span>`; return f; }
function statusBadge(s) { if(s==='Paid') return `<span class="badge bpaid">Paid</span>`; if(s==='To be paid') return `<span class="badge btopay">To pay</span>`; return `<span class="badge bna">\u2014</span>`; }
function priBadge(p)    { if(p==='Urgent') return `<span class="badge burgent">Urgent</span>`; if(p==='High') return `<span class="badge bhigh">High</span>`; if(p==='Low') return `<span class="badge blow">Low</span>`; return '\u2014'; }


// ── DASHBOARD ────────────────────────────────────────────────────
let _activeCatFilter = null;

function renderDash() {
  const now=new Date(); const y=now.getFullYear(),m=now.getMonth();
  const mi=insts.filter(i=>{const d=new Date(i.date.replace(/-/g,'/')); return d.getFullYear()===y&&d.getMonth()===m;}).sort((a,b)=>a.date.localeCompare(b.date));
  const monthTotal=mi.reduce((s,i)=>s+i.amount,0);
  const monthPaid=mi.filter(i=>i.status==='Paid').reduce((s,i)=>s+i.amount,0);
  const monthToPay=mi.filter(i=>i.status!=='Paid').reduce((s,i)=>s+i.amount,0);
  const totalCredit=defs.reduce((s,d)=>s+(d.creditBal||0),0);
  const urgentDefs=defs.filter(d=>d.priority==='Urgent'||d.priority==='High');
  const weeklyDefs=defs.filter(d=>d.freq==='Weekly');
  const catMap={}; mi.forEach(i=>{const def=defById(i.defId);if(!def)return;catMap[def.cat]=(catMap[def.cat]||0)+i.amount;});
  const topCats=Object.entries(catMap).sort((a,b)=>b[1]-a[1]);
  const alertHtml=urgentDefs.length?`<div class="alert"><span>&#9888;</span><span><strong>${urgentDefs.length} urgent/high priority:</strong> ${urgentDefs.map(d=>d.name).join(', ')}</span></div>`:'';
  _activeCatFilter=null;

  const breakdownRows=mi.map(i=>{
    const def=defById(i.defId); if(!def) return '';
    return `<tr>
      <td style="font-size:12px;color:var(--inkl)">${formatDate(i.date)}</td>
      <td style="font-weight:600">${def.name}</td>
      <td><span class="cattag">${def.cat}</span></td>
      <td>${freqBadge(def.freq)}</td>
      <td style="text-align:right;font-weight:600">${fmt(i.amount)}</td>
      <td>${statusBadge(i.status)}</td>
    </tr>`;
  }).join('');

  return `
    <div class="mgrid">
      <div class="mcard"><div class="mlbl">This month total</div><div class="mval danger">${fmt(monthTotal)}</div><div class="msub">${mi.length} payments due</div></div>
      <div class="mcard"><div class="mlbl">Paid this month</div><div class="mval success">${fmt(monthPaid)}</div><div class="msub">${mi.filter(i=>i.status==='Paid').length} completed</div></div>
      <div class="mcard"><div class="mlbl">Still to pay</div><div class="mval warning">${fmt(monthToPay)}</div><div class="msub">${mi.filter(i=>i.status!=='Paid').length} remaining</div></div>
      <div class="mcard"><div class="mlbl">Total credit owed</div><div class="mval danger">${fmt(totalCredit)}</div><div class="msub">${defs.filter(d=>d.creditBal>0).length} accounts</div></div>
    </div>
    ${alertHtml}
    ${weeklyDefs.length?`<div class="card section-gap">
      <div class="chead"><span class="ctitle">Weekly payments \u2014 ${now.toLocaleString('en-GB',{month:'long',year:'numeric'})}</span></div>
      <div style="padding:14px;overflow-x:auto"><table style="min-width:500px">
        <thead><tr><th>Payment</th><th>Category</th><th>Day</th><th style="text-align:right">Per payment</th><th style="text-align:right">Times this month</th><th style="text-align:right">Month total</th></tr></thead>
        <tbody>${weeklyDefs.map(def=>{const count=weeklyCountInMonth(def.weekday,y,m);return`<tr>
          <td style="font-weight:600">${def.name}</td><td><span class="cattag">${def.cat}</span></td>
          <td><span class="wkbadge">${def.weekday}</span></td>
          <td style="text-align:right">${fmt(def.amount)}</td>
          <td style="text-align:right;font-weight:600;color:var(--b)">${count}&times;</td>
          <td style="text-align:right;font-weight:600">${fmt(def.amount*count)}</td>
        </tr>`;}).join('')}</tbody>
        <tfoot><tr class="totalrow"><td colspan="5">Total weekly payments this month</td>
          <td style="text-align:right">${fmt(weeklyDefs.reduce((s,def)=>s+def.amount*weeklyCountInMonth(def.weekday,y,m),0))}</td>
        </tr></tfoot>
      </table></div></div>`:''}
    <div class="dgrid2">
      <div class="card">
        <div class="chead"><span class="ctitle">Spend by category \u2014 click a segment to filter</span></div>
        <div class="chartbox" style="height:260px"><canvas id="catChart"></canvas></div>
        <div id="catFilterBar" style="display:none;padding:8px 16px;border-top:1px solid var(--bdrlt);background:var(--parch);display:none;align-items:center;justify-content:space-between">
          <span id="catFilterLabel" style="font-size:13px;font-weight:600"></span>
          <button class="btnsm" onclick="clearCatFilter()" style="font-size:11px">\u2715 Clear filter</button>
        </div>
      </div>
      <div class="card"><div class="chead"><span class="ctitle">Paid vs still to pay \u2014 click to filter</span></div><div class="chartbox" style="height:260px"><canvas id="statusChart"></canvas></div></div>
    </div>
    <div class="card section-gap">
      <div class="chead">
        <span class="ctitle" id="breakdownTitle">All payments \u2014 ${now.toLocaleString('en-GB',{month:'long',year:'numeric'})}</span>
        <span style="font-size:12px;color:var(--inkl)" id="breakdownCount">${mi.length} payments \u00b7 ${fmt(monthTotal)}</span>
      </div>
      <div style="overflow-x:auto">
        <table id="breakdownTable">
          <thead><tr><th>Date</th><th>Payment</th><th>Category</th><th>Frequency</th><th style="text-align:right">Amount</th><th>Status</th></tr></thead>
          <tbody id="breakdownBody">${breakdownRows}</tbody>
          <tfoot><tr class="totalrow"><td colspan="4">Total</td><td style="text-align:right" id="breakdownTotal">${fmt(monthTotal)}</td><td></td></tr></tfoot>
        </table>
      </div>
    </div>
    <div class="dgrid3">
      <div class="card"><div class="chead"><span class="ctitle">Payment calendar</span></div><div id="calContainer">${renderCalendar(calMonth.y,calMonth.m)}</div></div>
      <div class="card">
        <div class="chead"><span class="ctitle">Category breakdown</span></div>
        ${topCats.map(([cat,val])=>`<div class="srow"><span class="slbl">${cat}</span><span class="sval">${fmt(val)}</span></div>`).join('')}
        <div style="padding:12px 16px;border-top:1px solid var(--bdrlt)"><div class="srow" style="padding:0"><span class="slbl" style="font-weight:600">Month total</span><span class="sval danger">${fmt(monthTotal)}</span></div></div>
      </div>
    </div>`;
}

function _renderBreakdown(filtered) {
  const body=document.getElementById('breakdownBody');
  const totalEl=document.getElementById('breakdownTotal');
  const countEl=document.getElementById('breakdownCount');
  if(!body) return;
  const sum=filtered.reduce((s,i)=>s+i.amount,0);
  body.innerHTML=filtered.map(i=>{
    const def=defById(i.defId); if(!def) return '';
    return `<tr>
      <td style="font-size:12px;color:var(--inkl)">${formatDate(i.date)}</td>
      <td style="font-weight:600">${def.name}</td>
      <td><span class="cattag">${def.cat}</span></td>
      <td>${freqBadge(def.freq)}</td>
      <td style="text-align:right;font-weight:600">${fmt(i.amount)}</td>
      <td>${statusBadge(i.status)}</td>
    </tr>`;
  }).join('') || `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--inkl)">No payments.</td></tr>`;
  if(totalEl) totalEl.textContent=fmt(sum);
  if(countEl) countEl.textContent=`${filtered.length} payments \u00b7 ${fmt(sum)}`;
}

function clearCatFilter() {
  _activeCatFilter=null;
  const bar=document.getElementById('catFilterBar'); if(bar) bar.style.display='none';
  const title=document.getElementById('breakdownTitle');
  if(title) title.textContent='All payments \u2014 '+new Date().toLocaleString('en-GB',{month:'long',year:'numeric'});
  const now=new Date(); const y=now.getFullYear(),m=now.getMonth();
  const mi=insts.filter(i=>{const d=new Date(i.date.replace(/-/g,'/')); return d.getFullYear()===y&&d.getMonth()===m;}).sort((a,b)=>a.date.localeCompare(b.date));
  _renderBreakdown(mi);
}

function initCharts() {
  const now=new Date(); const y=now.getFullYear(),m=now.getMonth();
  const mi=insts.filter(i=>{const d=new Date(i.date.replace(/-/g,'/')); return d.getFullYear()===y&&d.getMonth()===m;});
  const catMap={}; mi.forEach(i=>{const def=defById(i.defId);if(!def)return;catMap[def.cat]=(catMap[def.cat]||0)+i.amount;});
  const catLabels=Object.keys(catMap), catVals=catLabels.map(k=>catMap[k]);
  const palette=['#c8911c','#1a3c6e','#255c1f','#781818','#3d2fa0','#7a1f50','#196e4a','#7a4300','#3a3a3a','#6e3d1a'];

  const catCtx=document.getElementById('catChart');
  if(catCtx) new Chart(catCtx,{
    type:'doughnut',
    data:{labels:catLabels,datasets:[{data:catVals,backgroundColor:palette.slice(0,catLabels.length),borderWidth:2,borderColor:'#fff',hoverOffset:8}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'55%',
      plugins:{legend:{position:'right',labels:{font:{size:11},padding:10,boxWidth:12}},
        tooltip:{callbacks:{label:ctx=>ctx.label+': \u00a3'+ctx.raw.toLocaleString('en-GB',{minimumFractionDigits:2})}}},
      onClick:(e,els)=>{
        if(!els.length){clearCatFilter();return;}
        const cat=catLabels[els[0].index];
        _activeCatFilter=cat;
        const bar=document.getElementById('catFilterBar'), lbl=document.getElementById('catFilterLabel');
        const title=document.getElementById('breakdownTitle');
        if(bar){bar.style.display='flex';}
        if(lbl) lbl.textContent='Showing: '+cat;
        if(title) title.textContent=cat+' \u2014 '+now.toLocaleString('en-GB',{month:'long',year:'numeric'});
        const filtered=mi.filter(i=>{const def=defById(i.defId);return def&&def.cat===cat;}).sort((a,b)=>a.date.localeCompare(b.date));
        _renderBreakdown(filtered);
        const bt=document.getElementById('breakdownTable');
        if(bt) bt.closest('.card').scrollIntoView({behavior:'smooth',block:'start'});
      }
    }
  });

  const paid=mi.filter(i=>i.status==='Paid').reduce((s,i)=>s+i.amount,0);
  const topay=mi.filter(i=>i.status!=='Paid').reduce((s,i)=>s+i.amount,0);
  const stCtx=document.getElementById('statusChart');
  if(stCtx) new Chart(stCtx,{
    type:'doughnut',
    data:{labels:['Paid','Still to pay'],datasets:[{data:[paid,topay],backgroundColor:['#255c1f','#c8911c'],borderWidth:0,hoverOffset:6}]},
    options:{responsive:true,maintainAspectRatio:false,cutout:'65%',
      plugins:{legend:{position:'bottom',labels:{font:{size:11},padding:12}},
        tooltip:{callbacks:{label:ctx=>'\u00a3'+ctx.raw.toLocaleString('en-GB',{minimumFractionDigits:2})}}},
      onClick:(e,els)=>{
        if(!els.length) return;
        const isPaid=els[0].index===0;
        const title=document.getElementById('breakdownTitle');
        if(title) title.textContent=(isPaid?'Paid':'Still to pay')+' \u2014 '+now.toLocaleString('en-GB',{month:'long',year:'numeric'});
        const filtered=mi.filter(i=>isPaid?i.status==='Paid':i.status!=='Paid').sort((a,b)=>a.date.localeCompare(b.date));
        _renderBreakdown(filtered);
        const bt=document.getElementById('breakdownTable');
        if(bt) bt.closest('.card').scrollIntoView({behavior:'smooth',block:'start'});
      }
    }
  });
}


// ── CALENDAR ─────────────────────────────────────────────────────
function renderCalendar(y,m) {
  const firstDay=new Date(y,m,1).getDay(), daysInMonth=new Date(y,m+1,0).getDate(), daysInPrev=new Date(y,m,0).getDate();
  const todayDate=new Date(); todayDate.setHours(0,0,0,0);
  const byDate={};
  insts.forEach(i=>{const d=new Date(i.date.replace(/-/g,'/'));if(d.getFullYear()===y&&d.getMonth()===m){if(!byDate[i.date])byDate[i.date]=[];const def=defById(i.defId);if(def)byDate[i.date].push({name:def.name,amount:i.amount,status:i.status,instId:i.id});}});
  const offset=(firstDay+6)%7; let cells='';
  for(let i=0;i<offset;i++) cells+=`<div class="cal-day othermonth"><div class="cal-daynum">${daysInPrev-offset+i+1}</div></div>`;
  for(let d=1;d<=daysInMonth;d++){
    const dd=new Date(y,m,d), ds=toDateStr(dd), isToday=dd.getTime()===todayDate.getTime();
    const pips=byDate[ds]||[];
    const cls=['cal-day',isToday?'today':'',pips.length?'haspay':''].filter(Boolean).join(' ');
    const pipHtml=pips.slice(0,3).map(p=>{let pc=p.status==='Paid'?'paid':p.status==='To be paid'?'topay':'future';return`<div class="cal-pip ${pc}" title="${p.name}: \u00a3${p.amount.toFixed(2)}">${p.name.split(' ')[0]}</div>`;}).join('');
    const extra=pips.length>3?`<div style="font-size:10px;color:var(--inkl)">+${pips.length-3} more</div>`:'';
    const oc=pips.length?`onclick="showCalDay('${ds}')"` :'';
    cells+=`<div class="${cls}" ${oc}><div class="cal-daynum">${d}</div>${pipHtml}${extra}</div>`;
  }
  const total=Math.ceil((offset+daysInMonth)/7)*7;
  for(let i=1;i<=total-(offset+daysInMonth);i++) cells+=`<div class="cal-day othermonth"><div class="cal-daynum">${i}</div></div>`;
  const mn=['January','February','March','April','May','June','July','August','September','October','November','December'];
  return `<div class="cal-wrap">
    <div class="cal-nav"><button onclick="changeCalMonth(-1)">&#8249; Prev</button><span class="cal-title">${mn[m]} ${y}</span><button onclick="changeCalMonth(1)">Next &#8250;</button></div>
    <div class="cal-grid">${['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map(d=>`<div class="cal-daylbl">${d}</div>`).join('')}${cells}</div>
    <div class="cal-legend"><span><span class="cal-dot" style="background:var(--gbg);border:1px solid var(--gt)"></span>Paid</span><span><span class="cal-dot" style="background:var(--abg);border:1px solid var(--at)"></span>To pay</span><span><span class="cal-dot" style="background:var(--bbg);border:1px solid var(--bt)"></span>Upcoming</span></div>
  </div>`;
}

function changeCalMonth(dir) {
  calMonth.m+=dir; if(calMonth.m>11){calMonth.m=0;calMonth.y++;} if(calMonth.m<0){calMonth.m=11;calMonth.y--;}
  const c=document.getElementById('calContainer'); if(c) c.innerHTML=renderCalendar(calMonth.y,calMonth.m);
}

function showCalDay(ds) {
  const dayInsts=insts.filter(i=>i.date===ds); if(!dayInsts.length) return;
  const d=new Date(ds.replace(/-/g,'/')), title=d.toLocaleDateString('en-GB',{weekday:'long',day:'numeric',month:'long',year:'numeric'});
  const total=dayInsts.reduce((s,i)=>s+i.amount,0);
  const rows=dayInsts.map(i=>{const def=defById(i.defId);return`<tr>
    <td style="font-weight:600">${def?def.name:i.defId}</td>
    <td>${statusBadge(i.status)}</td>
    <td style="text-align:right;font-weight:600">${fmt(i.amount)}</td>
    <td><select class="esel" onchange="updateInstStatus(${i.id},this.value)">
      <option value="" ${i.status===''?'selected':''}>&#8212;</option>
      <option value="Paid" ${i.status==='Paid'?'selected':''}>Paid</option>
      <option value="To be paid" ${i.status==='To be paid'?'selected':''}>To be paid</option>
    </select></td>
  </tr>`;}).join('');
  showModal(title,`<p class="hint" style="margin-bottom:12px">Update status \u2014 saves to database immediately.</p>
    <div class="twrap"><table><thead><tr><th>Payment</th><th>Status</th><th style="text-align:right">Amount</th><th>Update</th></tr></thead>
    <tbody>${rows}</tbody><tfoot><tr class="totalrow"><td colspan="2">Day total</td><td style="text-align:right">${fmt(total)}</td><td></td></tr></tfoot></table></div>`,
    `<button class="btnsm" onclick="hideModal()">Close</button>`);
}

async function updateInstStatus(instId, val) {
  const inst=insts.find(i=>i.id===instId); if(!inst) return;
  inst.status=val; await saveInst(inst);
}

// ── PAYMENTS TAB ─────────────────────────────────────────────────
function renderPayments() {
  const cats=[...new Set(defs.map(d=>d.cat))].sort();
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:8px">
    <div class="frow" style="margin-bottom:0">
      <select id="fCat"><option value="">All categories</option>${cats.map(c=>`<option>${c}</option>`).join('')}</select>
      <select id="fFreq"><option value="">All frequencies</option><option>Weekly</option><option>Monthly</option><option>Yearly</option></select>
      <input type="text" id="fQ" placeholder="Search\u2026" style="width:130px"/>
    </div>
    <button class="btnprimary" onclick="openAddPayment()">+ Add payment</button>
  </div>
  <div class="twrap"><table>
    <thead><tr><th>Payment</th><th>Category</th><th>Frequency</th><th>Schedule</th><th style="text-align:right">Amount</th><th>Next due</th><th>Priority</th><th>Actions</th></tr></thead>
    <tbody id="payBody"></tbody>
  </table></div>`;
}

function payRows(filtered) {
  if(!filtered.length) return `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--inkl)">No results.</td></tr>`;
  return filtered.map(def=>{
    const next=nextOccurrence(def);
    const sched=def.freq==='Weekly'?`Every ${def.weekday}`:def.freq==='Monthly'?`Day ${def.dayOfMonth} monthly`:'Yearly';
    return `<tr><td style="font-weight:600">${def.name}</td><td><span class="cattag">${def.cat}</span></td><td>${freqBadge(def.freq)}</td><td style="font-size:12px;color:var(--inkl)">${sched}</td><td style="text-align:right;font-weight:600">${fmt(def.amount)}</td><td style="font-size:12px;color:var(--inkl)">${next?formatDate(next):'\u2014'}</td><td>${priBadge(def.priority)}</td><td><button class="btnsm" onclick="editDef(${def.id})">Edit</button></td></tr>`;
  }).join('');
}

function attachPayFilters() {
  const run=()=>{
    const cat=document.getElementById('fCat').value, fr=document.getElementById('fFreq').value, q=document.getElementById('fQ').value.toLowerCase();
    document.getElementById('payBody').innerHTML=payRows(defs.filter(d=>(!cat||d.cat===cat)&&(!fr||d.freq===fr)&&(!q||d.name.toLowerCase().includes(q)||d.cat.toLowerCase().includes(q))));
  };
  ['fCat','fFreq','fQ'].forEach(id=>{document.getElementById(id).addEventListener('change',run);document.getElementById(id).addEventListener('input',run);});
  run();
}

// ── PRICE LIST ───────────────────────────────────────────────────
function renderPricelist() {
  return `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
    <p class="hint" style="margin-bottom:0">Edit any field \u2014 saves to database instantly.</p>
    <button class="btnprimary" onclick="openAddPayment()">+ Add payment</button>
  </div>
  <div class="twrap"><table>
    <thead><tr><th>Payment</th><th>Category</th><th>Frequency</th><th>Pay day / Date</th><th style="text-align:right">Amount (\u00a3)</th><th>Status</th><th>Priority</th><th>Actions</th></tr></thead>
    <tbody id="plBody">${defs.map(def=>{
      const li=insts.filter(i=>i.defId===def.id).sort((a,b)=>b.date.localeCompare(a.date))[0];
      const cs=li?li.status:'';
      return `<tr data-id="${def.id}">
        <td style="font-weight:600">${def.name}</td>
        <td><select class="esel" data-id="${def.id}" data-f="cat" onchange="plChange(this)">${CATS.map(c=>`<option value="${c}" ${def.cat===c?'selected':''}>${c}</option>`).join('')}</select></td>
        <td><select class="esel" data-id="${def.id}" data-f="freq" onchange="plFreqChange(this)">${FREQS.map(f=>`<option value="${f}" ${def.freq===f?'selected':''}>${f}</option>`).join('')}</select></td>
        <td id="dayCell_${def.id}">${renderDayCell(def)}</td>
        <td style="text-align:right"><input class="enum" type="number" step="0.01" min="0" value="${def.amount}" data-id="${def.id}" data-f="amount" onchange="plChange(this)"/></td>
        <td><select class="esel" data-id="${def.id}" data-f="status" onchange="plStatusChange(this)">
          <option value="" ${cs===''?'selected':''}>&#8212;</option>
          <option value="Paid" ${cs==='Paid'?'selected':''}>Paid</option>
          <option value="To be paid" ${cs==='To be paid'?'selected':''}>To be paid</option>
        </select></td>
        <td><select class="esel" data-id="${def.id}" data-f="priority" onchange="plChange(this)">
          <option value="" ${def.priority===''?'selected':''}>&#8212;</option>
          <option value="Low" ${def.priority==='Low'?'selected':''}>Low</option>
          <option value="High" ${def.priority==='High'?'selected':''}>High</option>
          <option value="Urgent" ${def.priority==='Urgent'?'selected':''}>Urgent</option>
        </select></td>
        <td><button class="btnsm btndanger" onclick="confirmDelete(${def.id})">Delete</button></td>
      </tr>`;
    }).join('')}</tbody>
  </table></div>`;
}

function renderDayCell(def) {
  if(def.freq==='Weekly') return `<select class="esel" data-id="${def.id}" data-f="weekday" onchange="plChange(this)">${DAYS.map(d=>`<option value="${d}" ${def.weekday===d?'selected':''}>${d}</option>`).join('')}</select>`;
  if(def.freq==='Monthly') return `<input class="enum" type="number" min="1" max="31" step="1" value="${def.dayOfMonth||1}" data-id="${def.id}" data-f="dayOfMonth" onchange="plChange(this)" style="width:60px"/>`;
  if(def.freq==='One-off') return `<input class="enum" type="date" value="${def.nextDate||''}" data-id="${def.id}" data-f="nextDate" onchange="plChange(this)" style="width:130px"/>`;
  return `<input class="enum" type="text" value="${def.nextDate||''}" placeholder="YYYY-MM-DD" data-id="${def.id}" data-f="nextDate" onchange="plChange(this)" style="width:110px"/>`;
}

async function plChange(el) {
  const def=defs.find(d=>d.id===+el.dataset.id); if(!def) return;
  const f=el.dataset.f, oldAmt=def.amount;
  if(f==='amount') def.amount=parseFloat(el.value)||0;
  else if(f==='cat') def.cat=el.value;
  else if(f==='priority') def.priority=el.value;
  else if(f==='weekday') def.weekday=el.value;
  else if(f==='dayOfMonth') def.dayOfMonth=parseInt(el.value)||1;
  else if(f==='nextDate') def.nextDate=el.value;
  if(f==='amount'&&def.amount!==oldAmt) await cascadeAmount(def.id,def.amount);
  await saveDef(def);
}

async function plFreqChange(el) {
  const def=defs.find(d=>d.id===+el.dataset.id); if(!def) return;
  def.freq=el.value;
  if(el.value==='Weekly'&&!def.weekday) def.weekday='Mon';
  if(el.value==='Monthly'&&!def.dayOfMonth) def.dayOfMonth=1;
  await deleteFutureInsts(def.id);
  await generateUpcomingInstances();
  document.getElementById(`dayCell_${def.id}`).innerHTML=renderDayCell(def);
  await saveDef(def);
}

async function plStatusChange(el) {
  const def=defs.find(d=>d.id===+el.dataset.id); if(!def) return;
  const inst=insts.filter(i=>i.defId===def.id).sort((a,b)=>b.date.localeCompare(a.date))[0];
  if(inst){inst.status=el.value; await saveInst(inst);}
}

// ── ADD / EDIT MODAL ─────────────────────────────────────────────
function openAddPayment() {
  showModal('Add new payment',`
    <div class="mgrid2">
      <div class="mfld"><label>Payment name</label><input id="mName" type="text" placeholder="e.g. Water rates"/></div>
      <div class="mfld"><label>Category</label><select id="mCat">${CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
    </div>
    <div class="mgrid2">
      <div class="mfld"><label>Frequency</label><select id="mFreq" onchange="modalFreqChange()">${FREQS.map(f=>`<option>${f}</option>`).join('')}</select></div>
      <div class="mfld"><label id="mDayLbl">Pay day</label><div id="mDayWrap"><select id="mDay">${DAYS.map(d=>`<option>${d}</option>`).join('')}</select></div></div>
    </div>
    <div class="mgrid2">
      <div class="mfld"><label>Amount (\u00a3)</label><input id="mAmt" type="number" step="0.01" min="0" placeholder="0.00"/></div>
      <div class="mfld"><label>Priority</label><select id="mPri"><option value="">&#8212;</option><option>Low</option><option>High</option><option>Urgent</option></select></div>
    </div>
    <div class="mfld"><label>Credit balance (\u00a3) \u2014 leave blank if not applicable</label><input id="mCredit" type="number" step="0.01" min="0" placeholder="Optional"/></div>`,
    `<button class="btnsm" onclick="hideModal()">Cancel</button><button class="btnprimary" onclick="addPayment()">Add payment</button>`
  );
}

function modalFreqChange() {
  const f=document.getElementById('mFreq').value, lbl=document.getElementById('mDayLbl');
  const wrap=document.getElementById('mDayWrap');
  if(f==='Weekly'){
    lbl.textContent='Pay day';
    wrap.innerHTML=`<select id="mDay">${DAYS.map(d=>`<option>${d}</option>`).join('')}</select>`;
  } else if(f==='Monthly'){
    lbl.textContent='Day of month';
    wrap.innerHTML=`<select id="mDay">${Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('')}</select>`;
  } else if(f==='One-off'){
    lbl.textContent='Payment date';
    wrap.innerHTML=`<input id="mDay" type="date" style="width:100%;padding:8px 10px;border:1px solid #d8ccb0;border-radius:4px;font-size:13px;color:var(--ink)"/>`;
  } else {
    lbl.textContent='Next date (YYYY-MM-DD)';
    wrap.innerHTML=`<select id="mDay"><option value="">Optional</option></select>`;
  }
}

async function addPayment() {
  const name=document.getElementById('mName').value.trim(); if(!name){alert('Please enter a payment name.');return;}
  const freq=document.getElementById('mFreq').value;
  const dayEl=document.getElementById('mDay');
  const dayVal=dayEl?dayEl.value:'';
  const credit=document.getElementById('mCredit').value;
  const defData={
    name, cat:document.getElementById('mCat').value, freq,
    priority:document.getElementById('mPri').value,
    amount:parseFloat(document.getElementById('mAmt').value)||0,
    creditBal:credit?parseFloat(credit):null,
    creditMax:credit?parseFloat(credit)*2:null,
    weekday:freq==='Weekly'?dayVal:null,
    dayOfMonth:freq==='Monthly'?parseInt(dayVal)||1:null,
    nextDate:(freq==='Yearly'||freq==='One-off')?dayVal||null:null
  };
  const newDef=await insertDef(defData);
  if(newDef){
    if(!defs.find(d=>d.id===newDef.id)) defs.push(newDef);
    if(freq==='One-off'&&dayVal){
      // Create single instance for one-off payment
      const inst={id:-1,defId:newDef.id,date:dayVal,amount:defData.amount,status:''};
      await saveInst(inst);
      insts.push(inst);
    } else {
      await generateUpcomingInstances();
    }
  }
  hideModal(); render(activeTab);
}

function editDef(id) {
  const def=defs.find(d=>d.id===id); if(!def) return;
  showModal(`Edit \u2014 ${def.name}`,`
    <div class="mgrid2">
      <div class="mfld"><label>Payment name</label><input id="eName" type="text" value="${def.name}"/></div>
      <div class="mfld"><label>Category</label><select id="eCat">${CATS.map(c=>`<option ${def.cat===c?'selected':''}>${c}</option>`).join('')}</select></div>
    </div>
    <div class="mgrid2">
      <div class="mfld"><label>Frequency</label><select id="eFreq" onchange="editFreqChange(${id})">${FREQS.map(f=>`<option ${def.freq===f?'selected':''}>${f}</option>`).join('')}</select></div>
      <div class="mfld"><label id="eDayLbl">${def.freq==='Weekly'?'Pay day':def.freq==='Monthly'?'Day of month':'Next date'}</label>
        <select id="eDay" ${def.freq==='Yearly'?'style="display:none"':''}>${def.freq==='Weekly'?DAYS.map(d=>`<option ${def.weekday===d?'selected':''}>${d}</option>`).join(''):Array.from({length:31},(_,i)=>`<option value="${i+1}" ${def.dayOfMonth===i+1?'selected':''}>${i+1}</option>`).join('')}</select>
        <input id="eDateInp" type="text" placeholder="YYYY-MM-DD" value="${def.nextDate||''}" style="${def.freq==='Yearly'?'':'display:none'}"/>
      </div>
    </div>
    <div class="mgrid2">
      <div class="mfld"><label>Amount (\u00a3)</label><input id="eAmt" type="number" step="0.01" value="${def.amount}"/></div>
      <div class="mfld"><label>Priority</label><select id="ePri"><option value="" ${def.priority===''?'selected':''}>&#8212;</option><option ${def.priority==='Low'?'selected':''}>Low</option><option ${def.priority==='High'?'selected':''}>High</option><option ${def.priority==='Urgent'?'selected':''}>Urgent</option></select></div>
    </div>
    <div class="mfld"><label>Credit balance (\u00a3)</label><input id="eCredit" type="number" step="0.01" min="0" value="${def.creditBal!==null?def.creditBal:''}"/></div>`,
    `<button class="btnsm btndanger" onclick="confirmDelete(${id});hideModal()">Delete</button>
     <button class="btnsm" onclick="hideModal()">Cancel</button>
     <button class="btnprimary" onclick="saveEdit(${id})">Save changes</button>`
  );
}

function editFreqChange(id) {
  const f=document.getElementById('eFreq').value, lbl=document.getElementById('eDayLbl'), sel=document.getElementById('eDay'), inp=document.getElementById('eDateInp');
  if(f==='Weekly'){lbl.textContent='Pay day';sel.innerHTML=DAYS.map(d=>`<option>${d}</option>`).join('');sel.style.display='';inp.style.display='none';}
  else if(f==='Monthly'){lbl.textContent='Day of month';sel.innerHTML=Array.from({length:31},(_,i)=>`<option value="${i+1}">${i+1}</option>`).join('');sel.style.display='';inp.style.display='none';}
  else if(f==='One-off'){lbl.textContent='Payment date';sel.style.display='none';inp.type='date';inp.placeholder='';inp.style.display='';}
  else{lbl.textContent='Next date';sel.style.display='none';inp.type='text';inp.placeholder='YYYY-MM-DD';inp.style.display='';}
}

async function saveEdit(id) {
  const def=defs.find(d=>d.id===id); if(!def) return;
  const oldFreq=def.freq, oldAmt=def.amount;
  def.name=document.getElementById('eName').value.trim()||def.name;
  def.cat=document.getElementById('eCat').value;
  def.freq=document.getElementById('eFreq').value;
  def.amount=parseFloat(document.getElementById('eAmt').value)||0;
  def.priority=document.getElementById('ePri').value;
  const cr=document.getElementById('eCredit').value; def.creditBal=cr!==''?parseFloat(cr):null;
  if(def.freq==='Weekly') def.weekday=document.getElementById('eDay').value;
  else if(def.freq==='Monthly') def.dayOfMonth=parseInt(document.getElementById('eDay').value)||1;
  else def.nextDate=document.getElementById('eDateInp').value||null;
  if(def.amount!==oldAmt) await cascadeAmount(def.id,def.amount);
  if(oldFreq!==def.freq){await deleteFutureInsts(def.id); await generateUpcomingInstances();}
  await saveDef(def); hideModal(); render(activeTab);
}

function confirmDelete(id) {
  const def=defs.find(d=>d.id===id); if(!def) return;
  showModal(`Delete \u2014 ${def.name}`,
    `<p style="font-size:14px;line-height:1.6">Are you sure you want to delete <strong>${def.name}</strong> and all its payment history?<br/><br/><span style="color:var(--r)">This cannot be undone.</span></p>`,
    `<button class="btnsm" onclick="hideModal()">Cancel</button><button class="btnsm btndanger" onclick="doDelete(${id})">Yes, delete</button>`
  );
}

async function doDelete(id) {
  await deleteDef(id); defs=defs.filter(d=>d.id!==id); insts=insts.filter(i=>i.defId!==id);
  hideModal(); render(activeTab);
}

// ── CREDIT TRACKER ───────────────────────────────────────────────
function renderCredits() {
  const wc=defs.filter(d=>d.creditBal!==null&&d.creditBal!==undefined);
  const total=wc.reduce((s,d)=>s+(d.creditBal||0),0), maxC=Math.max(...wc.map(d=>d.creditBal||0),1);
  return `<div class="mgrid" style="margin-bottom:16px">
    <div class="mcard"><div class="mlbl">Total credit remaining</div><div class="mval danger">${fmt(total)}</div></div>
    <div class="mcard"><div class="mlbl">Accounts with balance</div><div class="mval">${wc.filter(d=>d.creditBal>0).length}</div></div>
  </div>
  <p class="hint">Update the remaining balance after each payment \u2014 saves to database instantly.</p>
  <div class="twrap"><table>
    <thead><tr><th>Payment</th><th>Category</th><th>Freq.</th><th style="text-align:right">Per payment</th><th style="text-align:right">Monthly equiv.</th><th style="text-align:right">Remaining balance</th><th style="text-align:right">Est. months left</th></tr></thead>
    <tbody id="crBody">${defs.map(def=>{
      const mo=toMonthly(def), left=(def.creditBal&&mo)?Math.ceil(def.creditBal/mo):null;
      const pct=def.creditBal&&def.creditMax?Math.min(100,(def.creditBal/def.creditMax)*100):0;
      return`<tr><td style="font-weight:600">${def.name}</td><td><span class="cattag">${def.cat}</span></td><td>${freqBadge(def.freq)}</td><td style="text-align:right">${fmt(def.amount)}</td><td style="text-align:right;color:var(--inkl)">${fmt(mo)}</td>
      <td style="text-align:right">${def.creditBal!==null?`<div class="crwrap"><div class="crbar"><div class="crfill" style="width:${pct}%"></div></div><input class="enum" type="number" step="0.01" min="0" value="${def.creditBal||0}" data-id="${def.id}" style="width:90px"/></div>`:'<span style="color:var(--inkf);font-size:12px">n/a</span>'}</td>
      <td style="text-align:right;color:var(--inkl);font-size:12px">${left?left+' mo':'\u2014'}</td></tr>`;
    }).join('')}</tbody>
    <tfoot><tr class="totalrow"><td colspan="5">Total credit remaining</td><td style="text-align:right">${fmt(total)}</td><td></td></tr></tfoot>
  </table></div>`;
}

function attachCrEvents() {
  document.querySelectorAll('#crBody input.enum').forEach(inp=>{
    inp.addEventListener('change', async e=>{
      const def=defs.find(d=>d.id===+e.target.dataset.id); if(!def) return;
      def.creditBal=parseFloat(e.target.value)||0;
      await saveDef(def);
      const row=e.target.closest('tr');
      if(row){const mo=toMonthly(def),left=(def.creditBal&&mo)?Math.ceil(def.creditBal/mo):null;const td=row.querySelector('td:last-child');if(td)td.textContent=left?left+' mo':'\u2014';}
    });
  });
}

// ── MODAL ────────────────────────────────────────────────────────
function showModal(title,body,footer){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=body;document.getElementById('modalFooter').innerHTML=footer||'';document.getElementById('modal').style.display='flex';}
function hideModal(){document.getElementById('modal').style.display='none';}
function closeModal(e){if(e.target===document.getElementById('modal'))hideModal();}
