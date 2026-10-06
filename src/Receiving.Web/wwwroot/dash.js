/* dashboard for intake: where packets are, how long steps take, what is stuck, what is rejected */
async function viewDashboard(){
  $('#app').innerHTML='<div class="card empty">Loading...</div>';
  let d;try{d=await api('GET','/api/reports/summary')}catch(e){$('#app').innerHTML='<div class="card empty err">'+esc(e.message)+'</div>';return}
  const maxW=Math.max(1,...d.weeks.map(w=>w.n)),maxH=Math.max(1,...d.averages.map(a=>a.hours||0));
  const fmtH=h=>h==null?'-':h<48?h+' h':Math.round(h/24*10)/10+' d';
  const vendors=d.vendors.filter(v=>v.items>0);
  $('#app').innerHTML=`
  <div class="pagehead"><div class="grow"><h1>Dashboard</h1><p>${d.total} packet${d.total===1?'':'s'} in the system.</p></div></div>${howTo('dashboard')}
  <div class="stats">${d.byStage.map(s=>`<a class="stat" href="#/board" style="text-decoration:none"><div class="n">${s.n}</div><div class="l">${SL[s.stage]}</div></a>`).join('')}</div>
  <div class="dgrid">
   <div class="card"><h2>Packets per week</h2><div class="bars">${d.weeks.map(w=>`<div class="bcol"><div class="bval">${w.n||''}</div><div class="bar1" style="height:${Math.max(3,w.n/maxW*110)}px"></div><div class="blab">${esc(w.label)}</div></div>`).join('')}</div></div>
   <div class="card"><h2>Average time per step</h2><p class="hint" style="margin:-4px 0 10px">From packets that finished that step.</p>
    ${d.averages.map(a=>`<div class="hrow"><span class="hl">${esc(a.step)}</span><span class="hb"><i style="width:${a.hours?Math.max(2,a.hours/maxH*100):0}%"></i></span><span class="hv">${fmtH(a.hours)}</span><span class="muted hn">${a.samples?'n='+a.samples:''}</span></div>`).join('')}</div>
   <div class="card"><h2>Stuck for a day or more</h2>
    ${d.stuck.length?`<table class="lines"><thead><tr><th>BOL</th><th>Vendor</th><th>Step</th><th>Waiting</th></tr></thead><tbody>${d.stuck.map(s=>`<tr class="r" onclick="nav('/p/${s.id}')" style="cursor:pointer"><td><b>${esc(s.bol)}</b></td><td>${esc(s.vendor)}</td><td><span class="chip ${s.stage}">${SL[s.stage]}</span></td><td class="${s.hours>72?'err':''}">${fmtH(s.hours)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty" style="padding:20px">Nothing is stuck.</div>'}</div>
   <div class="card"><h2>Rejects by vendor</h2>
    ${vendors.length?`<table class="lines"><thead><tr><th>Vendor</th><th>Items</th><th>Rejected</th><th>Rate</th></tr></thead><tbody>${vendors.map(v=>`<tr><td><b>${esc(v.vendor)}</b></td><td>${v.items}</td><td class="${v.rejected?'err':''}">${v.rejected}</td><td>${Math.round(v.rejected/v.items*100)}%</td></tr>`).join('')}</tbody></table>`:'<div class="empty" style="padding:20px">No inspections yet.</div>'}</div>
  </div>
  ${(d.reasons||[]).length?`<div class="card" style="margin-top:16px"><h2>Rejects by reason</h2><p class="hint" style="margin:-4px 0 10px">The reason picked when a receiver rejected a field.</p>${d.reasons.map(r=>`<div class="hrow"><span class="hl">${esc(r.reason)}</span><span class="hb"><i style="width:${Math.max(3,r.n/d.reasons[0].n*100)}%"></i></span><span class="hv">${r.n}</span></div>`).join('')}</div>`:''}
  <div class="card" style="margin-top:16px"><h2>Recent rejected items</h2>
   ${d.rejects.length?`<table class="lines"><thead><tr><th>BOL</th><th>Vendor</th><th>PO</th><th>CC #</th><th>Sheet</th><th>Rejected</th><th>Date</th></tr></thead><tbody>${d.rejects.map(r=>`<tr class="r" onclick="nav('/p/${r.id}')" style="cursor:pointer"><td><b>${esc(r.bol)}</b></td><td>${esc(r.vendor)}</td><td>${esc(r.po)}</td><td>${esc(r.cc)}</td><td>${esc((TYPES.find(t=>t.k===r.sheet)||{n:r.sheet}).n)}</td><td class="err">${esc(r.fields.join(', '))}</td><td>${esc(r.date)}</td></tr>`).join('')}</tbody></table>`:'<div class="empty" style="padding:20px">No rejected items.</div>'}</div>
  <div class="card" style="margin-top:16px"><h2>Export inspections</h2><p class="hint" style="margin:-4px 0 10px">One row per inspected item, with every measurement. Opens in Excel.</p>
   <div class="frm12">
    <div class="fld c3"><label>From</label><input type="date" id="xf"></div><div class="fld c3"><label>To</label><input type="date" id="xt"></div>
    <div class="fld c3"><label>Vendor contains</label><input id="xv"></div>
    <div class="fld c3"><label>Step</label><select id="xs"><option value="">All</option>${STAGES.map(([k,l])=>`<option value="${k}">${l}</option>`).join('')}</select></div></div>
   <div class="bar"><a class="btn pri" id="xgo" href="#">${ic('dl')} Download CSV</a></div></div>`;
  $('#xgo').onclick=e=>{e.preventDefault();const q=new URLSearchParams({from:$('#xf').value,to:$('#xt').value,vendor:$('#xv').value,stage:$('#xs').value});[...q.keys()].forEach(k=>{if(!q.get(k))q.delete(k)});location.href='/api/reports/export.csv?'+q}
}
