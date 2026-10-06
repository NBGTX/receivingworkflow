/* views: inbox, reviews, board, packet, form, pdf drawer */
function pkCard(p,note){
  const n=pos(p).length,c=covered(p);
  return `<div class="card pk ${p.stage}" data-id="${p.id}">
   <div class="row1"><div><div class="bol">BOL ${esc(p.bol)}</div><div class="vendor">${esc(p.vendor)}</div></div><span class="chip ${p.stage}">${SL[p.stage]}</span></div>
   <div class="pos">${pos(p).map(x=>`<span class="chip po">${esc(x)}</span>`).join('')}${p.claimedBy?`<span class="chip on">${p.claimedBy.id===S.me.id?'Claimed by you':'Claimed by '+esc(p.claimedBy.name)}</span>`:''}${(p.locks||[]).length?`<span class="chip pend">${esc([...new Set(p.locks.map(l=>l.name))].join(', '))} working</span>`:''}</div>
   <div><div class="prog"><div style="width:${n?c/n*100:0}%"></div></div></div>
   <div class="foot"><span>${note||c+' of '+n+' PO'+(n===1?'':'s')+' inspected'}</span><span>${p.rows.length} item${p.rows.length===1?'':'s'} &middot; ${ago(p.created)} ago</span></div></div>`;
}
function bindCards(){$$('.pk').forEach(c=>c.onclick=()=>nav('/p/'+c.dataset.id))}

let inboxF='todo';
function viewInbox(){
  const open=S.packets.filter(p=>p.stage==='new'||p.stage==='inspecting');
  const mine=open.filter(p=>p.claimedBy&&p.claimedBy.id===S.me.id);
  const done=S.packets.filter(p=>p.stage!=='new'&&p.stage!=='inspecting');
  const base=inboxF==='todo'?open:inboxF==='mine'?mine:done;
  const list=base.slice().sort((a,b)=>{
    if(inboxF==='todo'){const am=a.claimedBy&&a.claimedBy.id===S.me.id?0:1,bm=b.claimedBy&&b.claimedBy.id===S.me.id?0:1;if(am!==bm)return am-bm;return a.created-b.created}
    return inboxF==='mine'?a.created-b.created:b.created-a.created});
  $('#app').innerHTML=`
  <div class="pagehead"><div class="grow"><h1>My inbox</h1><p>Packets waiting for inspection on the dock. Open one to start, or claim it so the others know it is yours.</p></div></div>
  <div class="filters"><button class="pill ${inboxF==='todo'?'on':''}" data-f="todo">To inspect <i>${open.length}</i></button><button class="pill ${inboxF==='mine'?'on':''}" data-f="mine">Mine <i>${mine.length}</i></button><button class="pill ${inboxF==='done'?'on':''}" data-f="done">Submitted <i>${done.length}</i></button></div>
  ${list.length?`<div class="cards">${list.map(p=>pkCard(p)).join('')}</div>`:`<div class="card empty">${inboxF==='done'?'No submitted packets.':inboxF==='mine'?'You have not claimed any packets.':'Nothing to inspect right now.'}</div>`}`;
  $$('.pill[data-f]').forEach(b=>b.onclick=()=>{inboxF=b.dataset.f;viewInbox()});bindCards();
}

function viewReviews(){
  const mine=p=>p.stage==='review'&&(p.requiredReviewers||[]).some(r=>r.id===S.me.id)&&!(p.approvals||[]).some(a=>a.id===S.me.id);
  const wait=S.packets.filter(mine),other=S.packets.filter(p=>p.stage==='review'&&!mine(p));
  $('#app').innerHTML=`<div class="pagehead"><div class="grow"><h1>Reviews</h1><p>Packets with inspections finished, waiting for approval.</p></div></div>
  <h2 style="margin:0 0 10px;color:var(--dg)">Waiting for you <span class="num" style="background:var(--pg);padding:3px 10px;border-radius:99px;font-size:13px">${wait.length}</span></h2>
  ${wait.length?`<div class="cards">${wait.map(p=>pkCard(p,'Needs your approval')).join('')}</div>`:'<div class="card empty">Nothing waiting for you.</div>'}
  ${other.length?`<h2 style="margin:26px 0 10px;color:var(--dg)">Other packets in review</h2><div class="cards">${other.map(p=>pkCard(p,(p.approvals||[]).length+' of '+(p.requiredReviewers||[]).length+' approved')).join('')}</div>`:''}`;
  bindCards();
}

let boardF='all',boardQ='';
function viewBoard(){
  const cnt=k=>S.packets.filter(p=>p.stage===k).length;
  const rows=S.packets.filter(p=>(boardF==='all'||p.stage===boardF)&&(!boardQ||(p.bol+p.vendor+pos(p).join(' ')+p.rows.map(r=>r.heat+r.cc).join(' ')).toLowerCase().includes(boardQ.toLowerCase())));
  $('#app').innerHTML=`
  <div class="pagehead"><div class="grow"><h1>Packets</h1><p>Every steel packet and where it stands.</p></div>${has('coordinator')?`<a class="btn pri" href="#/new">${ic('plus')} New packet</a>`:''}</div>
  <div class="stats">${STAGES.map(([k,l])=>`<button class="stat ${boardF===k?'on':''}" data-s="${k}"><div class="n">${cnt(k)}</div><div class="l">${l}</div></button>`).join('')}</div>
  <div class="toolbar"><div class="search">${ic('search')}<input id="q" placeholder="Search BOL, PO, vendor, heat, CC #" value="${esc(boardQ)}"></div><button class="pill ${boardF==='all'?'on':''}" data-s="all">All <i>${S.packets.length}</i></button></div>
  <table class="list"><thead><tr><th>BOL #</th><th>Vendor</th><th>POs</th><th>Items</th><th>Inspections</th><th>Status</th><th>In stage</th></tr></thead><tbody>
  ${rows.length?rows.map(p=>{const n=pos(p).length,c=covered(p),hot=p.stage!=='filed'&&Date.now()-lastT(p)>24*3600e3;
   return `<tr class="r" data-id="${p.id}"><td class="b">${esc(p.bol)}</td><td>${esc(p.vendor)}</td><td>${pos(p).map(x=>`<span class="chip po">${esc(x)}</span>`).join(' ')}</td><td class="mono">${p.rows.length}</td>
   <td><span class="mini"><span class="prog"><div style="width:${n?c/n*100:0}%"></div></span><span class="mono muted">${c}/${n}</span></span></td>
   <td>${p.ready===false?'<span class="chip pend">Draft, no PDF yet</span>':`<span class="chip ${p.stage}">${SL[p.stage]}</span>`}</td><td class="age ${hot?'hot':''}">${ago(lastT(p))}</td></tr>`}).join(''):`<tr><td colspan="7" class="empty">No packets match.</td></tr>`}
  </tbody></table>`;
  $$('[data-s]').forEach(b=>b.onclick=()=>{boardF=b.dataset.s===boardF?'all':b.dataset.s;viewBoard()});
  $('#q').oninput=e=>{boardQ=e.target.value;const at=e.target.selectionStart;viewBoard();const q=$('#q');q.focus();q.setSelectionRange(at,at)};
  $$('tr.r').forEach(r=>r.onclick=()=>nav('/p/'+r.dataset.id));
}

/* ---- packet detail ---- */
function viewPacket(id){
  const p=P(id);if(!p){$('#app').innerHTML='<div class="card empty">Packet not found.</div>';return}
  const canInspect=has('receiver','coordinator'),editable=p.stage==='new'||p.stage==='inspecting';
  const si=STAGES.findIndex(s=>s[0]===p.stage),allCov=covered(p)===pos(p).length;
  const names={'/board':'All packets','/reviews':'Reviews','/inbox':'My inbox','/dashboard':'Dashboard'};
  const back=S.lastList&&names[S.lastList]?[S.lastList,names[S.lastList]]:(has('coordinator','reviewer')?['/board','All packets']:['/inbox','My inbox']);
  $('#app').innerHTML=`
  <button class="crumb" id="back">${ic('back')} ${back[1]}</button>
  <div class="pagehead"><div class="grow"><h1>BOL ${esc(p.bol)}</h1><p>${esc(p.vendor)} &middot; ${esc(p.carrier||'')} &middot; shipped ${esc(p.ship||'')}</p></div>
   <span class="chip ${p.stage}" style="font-size:14px;padding:6px 14px">${SL[p.stage]}</span>
   ${has('coordinator')&&p.stage!=='filed'?`<a class="btn" href="/api/packets/${p.id}/final.pdf?inline=1" target="_blank">${ic('file')} Preview final packet</a>`:''}
   ${p.hasPdf?`<button class="btn" id="viewpdf">${ic('file')} View packet PDF</button>`:''}</div>
  ${draftBanner(p)}
  <div class="card" style="margin-bottom:18px"><div class="steps">${STAGES.map(([k,l],i)=>`<div class="step ${i<si?'done':i===si?'cur':''}"><i></i>${l}</div>`).join('')}</div></div>
  <div class="grid2"><div>
    <div class="card"><h2>Inspections by PO</h2>
    <p class="muted" style="margin:-4px 0 4px">One inspection per PO and material type. Items of the same type go in the same form.</p>
    ${pos(p).map(po=>{const rs=p.rows.filter(r=>r.po===po);
     return `<div class="pobox"><div class="ph"><h3>${esc(po)}</h3><span class="muted">${rs.length} item${rs.length===1?'':'s'}</span>${subForms(p,po).length?`<span class="chip on">${ic('check')} Inspected</span>`:`<span class="chip new">Needs inspection</span>`}</div>
      <div class="types">${TYPES.map(t=>{const f=p.forms[po+'|'+t.k];const lk=(p.locks||[]).find(l=>l.k===p.id+'|'+po+'|'+t.k);const cls=f&&f.submitted?'done':(f||lk)?'draft':'';
       return `<button class="type ${cls}" data-po="${esc(po)}" data-t="${t.k}">${t.n}<small>${f&&f.submitted?'Submitted by '+esc(f.inspector||''):lk?esc(lk.name)+' is working on it':f?'Draft saved':(editable&&canInspect?'Start inspection':'Not used')}</small></button>`}).join('')}</div>
      <table class="lines"><thead><tr><th>Heat #</th><th>Coil / bundle #</th><th>CC #</th><th>Description</th><th>Length</th><th>Weight</th></tr></thead><tbody>${rs.map(r=>`<tr><td>${esc(r.heat)}</td><td>${esc(r.coil)}</td><td><b>${esc(r.cc)}</b></td><td>${esc(r.desc)}</td><td>${esc(r.len)}</td><td>${esc(r.wt)}</td></tr>`).join('')}</tbody></table></div>`}).join('')}
    ${editable&&canInspect?`<div class="action"><h3>Finish inspection</h3><p class="muted" style="margin:0 0 10px">${allCov?'Every PO has an inspection. Send the packet to review.':'Submit at least one inspection for every PO first ('+covered(p)+' of '+pos(p).length+' done).'}</p><button class="btn pri big" id="complete" ${allCov?'':'disabled'}>${ic('check')} Inspection complete</button></div>`:''}
    ${stageAction(p)}
    </div></div>
    <div><div class="card"><h2>Packet</h2><div class="kv"><div><label>BOL #</label><div>${esc(p.bol)}</div></div><div><label>Items</label><div>${p.rows.length}</div></div><div><label>Received</label><div>${ago(p.created)} ago</div></div>${p.d365?`<div><label>D365 receipt</label><div>${esc(p.d365)}</div></div>`:''}</div>${reviewersBlock(p)}${claimBlock(p)}</div>
    <div class="card" style="margin-top:18px"><h2>Activity</h2><ul class="timeline">${[...p.log].reverse().map(l=>`<li><b>${esc(l.what)}</b><span class="muted">${esc(l.who)} &middot; ${fdate(l.t)}</span></li>`).join('')}</ul></div></div>
  </div>`;
  $('#back').onclick=()=>nav(back[0]);
  const vp=$('#viewpdf');if(vp)vp.onclick=()=>openPdf(p);
  $$('.type').forEach(b=>b.onclick=()=>nav('/p/'+p.id+'/f/'+encodeURIComponent(b.dataset.po)+'/'+b.dataset.t));
  const act=async(path,body,msg)=>{try{const r=await api('POST','/api/packets/'+p.id+'/'+path,body||{});upsert(r);if(msg)toast(msg);viewPacket(p.id)}catch(e){toast(e.message,1)}};
  const c=$('#complete');if(c)c.onclick=()=>{const w=shortShipCheck(p);if(w&&!confirm(w))return;act('complete',null,'Sent to review')};
  const ap=$('#approve');if(ap)ap.onclick=()=>act('approve',null,'Approved');
  const r=$('#recv');if(r)r.onclick=()=>{const v=$('#d365').value.trim();if(!v)return toast('Enter the D365 receipt number',1);act('receive',{d365:v})};
  const a=$('#auth');if(a)a.onclick=()=>act('authorize',null,'Packet filed');
  const cr=$('#chrev');if(cr)cr.onclick=()=>reviewerModal(p);
  const call=async(path,msg)=>{try{upsert(await api('POST','/api/packets/'+p.id+'/'+path,{}));if(msg)toast(msg);viewPacket(p.id)}catch(e){toast(e.message,1)}};
  const cl=$('#claim');if(cl)cl.onclick=()=>call('claim','Claimed');
  const uc=$('#unclaim');if(uc)uc.onclick=()=>call('unclaim','Released');
  const sr=$('#skiprev');if(sr)sr.onclick=()=>reasonModal('Skip review','Use this when a reviewer is out. The packet moves on to receiving and your reason goes on the record.','Skip review',async reason=>{upsert(await api('POST','/api/packets/'+p.id+'/skip-review',{reason}));toast('Review skipped');viewPacket(p.id)});
  const rp=$('#reopenpk');if(rp)rp.onclick=()=>reasonModal('Reopen packet','The packet goes back to Ready to authorize and the saved final packet is discarded. A new one is saved when you authorize again.','Reopen',async reason=>{upsert(await api('POST','/api/packets/'+p.id+'/reopen',{reason}));toast('Packet reopened');viewPacket(p.id)});
  const dp=$('#delpk');if(dp)dp.onclick=async()=>{if(!confirm('Delete BOL '+p.bol+'? This removes its PDF and cannot be undone.'))return;try{await api('DELETE','/api/packets/'+p.id);S.packets=S.packets.filter(x=>x.id!==p.id);toast('Packet deleted');nav('/board')}catch(e){toast(e.message,1)}};
  const ap2=$('#attachpdf');if(ap2)ap2.onchange=async e=>{const f=e.target.files[0];if(!f)return;try{toast('Uploading...');await api('POST','/api/packets/'+p.id+'/pdf',await f.arrayBuffer(),'application/pdf');upsert(await api('GET','/api/packets/'+p.id));toast('PDF attached, packet sent to receivers');viewPacket(p.id)}catch(x){toast(x.message,1)}};
}
function stageAction(p){
  const req=p.requiredReviewers||[],apr=p.approvals||[];
  if(p.stage==='review'){
    const mine=req.some(r=>r.id===S.me.id),done=apr.some(a=>a.id===S.me.id);
    return `<div class="action"><h3>Review approvals</h3><div class="approvals">${req.map(r=>{const a=apr.find(x=>x.id===r.id);return `<div class="apr"><span class="nm">${esc(r.name)}</span>${a?`<span class="chip on">${ic('check')} Approved ${fdate(a.t)}</span>`:'<span class="chip pend">Waiting</span>'}</div>`}).join('')}</div>
    ${mine&&!done?`<button class="btn pri big" id="approve" style="margin-top:12px">${ic('check')} Approve</button>`:`<p class="muted" style="margin:10px 0 0;font-size:13px">${mine?'You approved this packet.':'Only listed reviewers can approve.'}</p>`}
    ${has('coordinator')?`<button class="btn" id="skiprev" style="margin-top:12px">Skip review...</button>`:''}
</div>`;
  }
  if(!has('coordinator'))return p.stage==='filed'?'':'';
  if(p.stage==='receive')return `<div class="action"><h3>Receive in D365</h3><p class="muted" style="margin:0 0 10px">Receive the PO lines in D365, then record the receipt number.</p><div class="fld" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap"><div style="flex:1;min-width:200px"><label>D365 receipt #</label><input id="d365" placeholder="PR-000000"></div><button class="btn pri" id="recv" style="min-height:52px">Mark received</button></div></div>`;
  if(p.stage==='authorize')return `<div class="action"><h3>Authorize</h3><p class="muted" style="margin:0 0 10px">D365 receipt ${esc(p.d365)}. Authorizing files the packet and sends the final notification.</p><button class="btn pri big" id="auth">${ic('check')} Authorize and file</button></div>`;
  if(p.stage==='filed')return `<div class="action"><h3>Filed</h3><p class="muted" style="margin:0 0 10px">Authorized by ${esc(p.authBy||'')} ${p.authAt?fdate(p.authAt):''}. Upload the final packet PDF to DocuWare. Its cover sheet holds every index field as typed text.</p><a class="btn dark" href="/api/packets/${p.id}/final.pdf">${ic('dl')} Download final packet (PDF)</a> <a class="btn" href="/api/packets/${p.id}/csv">${ic('dl')} Index data (CSV)</a> ${p.hasPdf?`<a class="btn" href="/api/packets/${p.id}/pdf" download="BOL ${esc(p.bol)}.pdf">${ic('dl')} Packet PDF</a>`:''} <button class="btn" id="reopenpk">Reopen packet...</button></div>`;
  return '';
}

/* ---- inspection form (tablet) ---- */
function cell([k,l,kind],it,ro){
  if(kind==='ok')return `<div class="fld"><label>${l}</label><div class="toggle" data-ok="${k}"><button type="button" class="ok ${it[k]==='ok'?'on':''}" ${ro}>OK</button><button type="button" class="bad ${it[k]==='bad'?'on':''}" ${ro}>Reject</button></div></div>`;
  return `<div class="fld"><label>${l}</label><input data-k="${k}" ${kind==='text'?'':'inputmode="decimal"'} value="${esc(it[k]||'')}" ${ro}></div>`;
}
async function openTol(T){
  $('#dtitle').textContent=T.n+' tolerance tables';$('#drawer').classList.add('open','wide');
  const body=$('#dbody');
  if(!T.tol){body.innerHTML='<div class="card empty">The paper '+esc(T.n)+' sheet ('+T.form+') has no tolerance tables.</div>';return}
  if(typeof TOLTAB!=='undefined'&&TOLTAB[T.tol]){body.innerHTML=`<div class="ttabs">${tolTablesHtml(T.tol)}<p class="tfoot">From paper sheet ${esc(T.form)}. Advisory only.</p></div>`;return}
  body.innerHTML='<div class="card empty">Loading...</div>';
  try{
    const r=await fetch('/tolerances/'+T.tol+'.pdf');if(!r.ok)throw new Error('Not found');
    const doc=await pdfjsLib.getDocument({data:await r.arrayBuffer()}).promise;const pg=await doc.getPage(1);
    const vp=pg.getViewport({scale:3});const full=document.createElement('canvas');full.width=vp.width;full.height=vp.height;
    await pg.render({canvasContext:full.getContext('2d'),viewport:vp}).promise;
    const y0=Math.floor(full.height*T.tolRegion[0]),y1=Math.floor(full.height*T.tolRegion[1]);
    const c=document.createElement('canvas');c.width=full.width;c.height=y1-y0;c.getContext('2d').drawImage(full,0,y0,full.width,y1-y0,0,0,full.width,y1-y0);
    body.innerHTML='';const w=document.createElement('div');w.className='pg';w.appendChild(c);body.appendChild(w);
    const n=document.createElement('p');n.style.cssText='color:#fff;text-align:center;font-size:12px';n.textContent='From paper sheet '+T.form;body.appendChild(n);
  }catch(e){body.innerHTML='<div class="card empty err">Could not load tolerance tables: '+esc(e.message)+'</div>'}
}
async function viewForm(id,po,tk){
  const p=P(id),T=TYPES.find(t=>t.k===tk);if(!p||!T){nav('/inbox');return}
  const key=po+'|'+tk,rs=p.rows.filter(r=>r.po===po);
  const f=JSON.parse(JSON.stringify(p.forms[key]||{submitted:false,date:new Date().toISOString().slice(0,10),items:[]}));
  f.items=(f.items||[]).filter(it=>!it.skip);if(!f.items.length)f.items=[{}];
  let canEdit=!f.submitted&&(p.stage==='new'||p.stage==='inspecting')&&has('receiver','coordinator');
  let lockMsg='';
  if(canEdit){try{await api('POST',lockUrl(id,po,tk)+'/lock',{});startLock(id,po,tk)}catch(e){canEdit=false;lockMsg=e.message}}
  const ro=canEdit?'':'readonly disabled';
  const ident=[...(T.k==='coil'?[['coil','Coil #']]:[]),['heat','Heat #'],['desc','Description'],['cc','NBS # (CC #)']];
  const used=()=>new Set(f.items.map(it=>it.src).filter(x=>x!==undefined&&x!==''));
  const label=r=>'CC '+r.cc+' · Heat '+r.heat+' · '+r.desc+(r.len?' · '+r.len:'');
  const fromRow=(r,it)=>{Object.assign(it,{heat:r.heat,desc:r.desc,cc:r.cc});if(T.k==='coil')it.coil=r.coil||'';if(T.k==='sheet'&&r.len)it.len=r.len;return it};
  $('#app').innerHTML=`
  <button class="crumb" id="back">${ic('back')} BOL ${esc(p.bol)}</button>
  <div class="pagehead"><div class="grow"><h1>${T.n} inspection</h1><p>${esc(po)} &middot; ${esc(p.vendor)} &middot; sheet ${T.form}</p></div>${f.submitted?'<span class="chip on" style="font-size:14px;padding:6px 14px">Submitted</span>':''}${p.hasPdf?`<button class="btn" id="viewpdf">${ic('file')} View packet PDF</button>`:''}</div>
  ${lockMsg?`<div class="banner"><b>${esc(lockMsg)}</b> You can look, but not change it until they close it.${has('coordinator')?` <button class="btn sm" id="forcelock">Release their lock</button>`:''}</div>`:''}
  <div class="card" style="margin-bottom:14px"><div class="fh">
    <div class="fld"><label>PO #</label><input value="${esc(po)}" readonly></div><div class="fld"><label>BOL #</label><input value="${esc(p.bol)}" readonly></div>
    <div class="fld"><label>Vendor</label><input value="${esc(p.vendor)}" readonly></div><div class="fld"><label>Date</label><input type="date" id="fdate" value="${esc(f.date||'')}" ${ro}></div>
    <div class="fld"><label>Inspector</label><input value="${esc(f.submitted?f.inspector:S.me.initials)}" readonly></div></div>
    ${T.tol?`<button class="tol" type="button" id="tol">${ic('info')} Tolerance tables for ${T.n.toLowerCase()} <span style="margin-left:auto;font-weight:normal">tap to open</span></button>`:''}</div>
  <div id="items"></div>
  ${canEdit?`<div class="addbar"><button class="btn big" id="addrow">${ic('plus')} Add blank row</button><button class="btn big" id="addrest" title="Adds one row for each line on the BOL that is not in this inspection yet, already filled with its heat, description and CC #">${ic('plus')} Add rows from BOL</button><span class="muted">Add rows from BOL: one row per BOL line not yet inspected, pre-filled.</span></div>`:''}
  <div class="sticky"><button class="btn big" id="cancel">${canEdit?'Save draft':'Back'}</button><span class="muted" id="saved"></span><span style="flex:1"></span>
   ${canEdit?`<button class="btn pri big" id="submit">${ic('check')} Submit inspection</button>`:(f.submitted&&(p.stage==='new'||p.stage==='inspecting')&&has('receiver','coordinator')?'<button class="btn big" id="reopen">Reopen to edit</button>':'')}</div>`;

  const itemHtml=(it,i)=>{
    const u=used();
    return `<div class="item" data-i="${i}">
    <div class="ih"><span class="n">${i+1}</span><span class="t">${esc(it.cc?'CC # '+it.cc:'New row')}</span><span class="s">${esc([it.heat&&'Heat '+it.heat,it.desc,(it.src!==undefined&&it.src!==''&&rs[+it.src]?.len)||''].filter(Boolean).join(' · '))}</span><span style="flex:1"></span>
    ${canEdit?`<select data-k="src"><option value="">Fill from packet item...</option>${rs.map((r,j)=>`<option value="${j}" ${String(it.src)===String(j)?'selected':''}>${esc(label(r))}${u.has(String(j))&&String(it.src)!==String(j)?' (added)':''}</option>`).join('')}</select>`:''}
    ${canEdit&&f.items.length>1?`<button class="btn sm" data-rm="${i}">Remove</button>`:''}</div>
    <div class="ib"><div class="ida ${T.k==='coil'?'c4':'c3'}">${ident.map(([k,l])=>`<div class="fld"><label>${l}</label><input data-k="${k}" value="${esc(it[k]||'')}" ${ro}></div>`).join('')}</div>
    <div class="meas">${T.meas.filter(m=>m[2]!=='ok').map(m=>cell(m,it,ro)).join('')}</div>
    <div class="oks">${[...T.meas.filter(m=>m[2]==='ok'),...(T.post||[])].map(m=>cell(m,it,ro)).join('')}</div>
     <div class="fld" style="grid-column:1/-1"><label>Comments</label><textarea data-k="comments" rows="4" ${ro}>${esc(it.comments||'')}</textarea></div></div></div>`};

  const collect=()=>{f.date=$('#fdate').value;$$('#items .item').forEach(c=>{const it=f.items[+c.dataset.i];$$('[data-k]',c).forEach(i=>it[i.dataset.k]=i.value)})};
  const push=async(submit)=>{collect();const r=await api('PUT',`/api/packets/${id}/forms/${encodeURIComponent(po)}/${tk}`,{date:f.date,items:f.items,submit});upsert(r)};
  let t=null;const autosave=()=>{clearTimeout(t);$('#saved').textContent='Saving...';t=setTimeout(async()=>{try{await push(false);$('#saved').textContent='Draft saved'}catch(e){$('#saved').textContent=e.message}},700)};
  const draw=()=>{
    $('#items').innerHTML=f.items.map(itemHtml).join('');
    enhanceItems({id,po,tk,T,f,canEdit,collect,autosave,draw});
    if(!canEdit)return;
    $$('#items input').forEach(i=>i.addEventListener('input',autosave));
    $$('#items [data-k=src]').forEach(sel=>sel.addEventListener('change',()=>{
      collect();const i=+sel.closest('.item').dataset.i,it=f.items[i];
      if(sel.value!==''){const r=rs[+sel.value];it.src=sel.value;fromRow(r,it)}
      else it.src='';
      draw();autosave()}));
    $$('#items [data-rm]').forEach(b=>b.onclick=()=>{collect();f.items.splice(+b.dataset.rm,1);draw();autosave()});
    $$('#items .toggle').forEach(tg=>$$('button',tg).forEach(b=>b.onclick=()=>{const it=f.items[+tg.closest('.item').dataset.i];const v=b.classList.contains('ok')?'ok':'bad';it[tg.dataset.ok]=it[tg.dataset.ok]===v?'':v;$$('button',tg).forEach(x=>x.classList.remove('on'));if(it[tg.dataset.ok])b.classList.add('on');autosave()}));
  };
  draw();

  $('#back').onclick=async()=>{if(canEdit){clearTimeout(t);try{await push(false)}catch(e){}}nav('/p/'+id)};
  const fl=$('#forcelock');if(fl)fl.onclick=async()=>{try{await api('POST',lockUrl(id,po,tk)+'/unlock',{force:true});toast('Lock released');viewForm(id,po,tk)}catch(e){toast(e.message,1)}};
  const vp=$('#viewpdf');if(vp)vp.onclick=()=>openPdf(p);
  const tb=$('#tol');if(tb)tb.onclick=()=>openTol(T);
  if(canEdit){
    $('#addrow').onclick=()=>{collect();f.items.push({});draw();autosave();const last=$$('#items .item').pop();last&&last.scrollIntoView({behavior:'smooth',block:'center'})};
    $('#addrest').onclick=()=>{collect();const u=used();
      const rest=rs.map((r,j)=>[r,j]).filter(([r,j])=>!u.has(String(j)));
      if(!rest.length)return toast('Every packet item is already added');
      if(f.items.length===1&&!Object.values(f.items[0]).some(v=>v))f.items=[];
      rest.forEach(([r,j])=>f.items.push(fromRow(r,{src:String(j)})));
      draw();autosave()};
    $('#cancel').onclick=async()=>{clearTimeout(t);try{await push(false);toast('Draft saved');nav('/p/'+id)}catch(e){toast(e.message,1)}};
    $('#submit').onclick=async()=>{clearTimeout(t);try{collect();
      if(!f.items.some(it=>it.heat||it.cc||it.desc))return toast('Fill in at least one row',1);
      await push(true);toast('Inspection submitted');nav('/p/'+id)}catch(e){toast(e.message,1)}};
  }else{
    $('#cancel').onclick=()=>nav('/p/'+id);
    const rb=$('#reopen');if(rb)rb.onclick=async()=>{try{upsert(await api('POST',`/api/packets/${id}/forms/${encodeURIComponent(po)}/${tk}/reopen`,{}));viewForm(id,po,tk)}catch(e){toast(e.message,1)}};
  }
}

/* ---- drawers ---- */
function closeDrawer(){$('#drawer').classList.remove('open','wide')}
$('#dclose').onclick=closeDrawer;
function openText(title,txt){$('#dtitle').textContent=title;$('#dbody').innerHTML=`<div class="card empty">${esc(txt)}</div>`;$('#drawer').classList.remove('wide');$('#drawer').classList.add('open')}
async function openPdf(p){
  $('#dtitle').textContent='BOL '+p.bol+' packet';$('#drawer').classList.remove('wide');$('#drawer').classList.add('open');
  const body=$('#dbody');body.innerHTML='<div class="card empty">Loading...</div>';
  try{
    const r=await fetch('/api/packets/'+p.id+'/pdf',{credentials:'same-origin'});if(!r.ok)throw new Error('No PDF ('+r.status+')');
    const doc=await pdfjsLib.getDocument({data:await r.arrayBuffer()}).promise;body.innerHTML='';
    for(let i=1;i<=doc.numPages;i++){
      const pg=await doc.getPage(i);let rot=pg.rotate||0;
      const w=document.createElement('div');w.className='pg';const cv=document.createElement('canvas');w.appendChild(cv);
      const b=document.createElement('button');b.className='btn sm rb';b.innerHTML=ic('rot')+' Rotate';w.appendChild(b);body.appendChild(w);
      const draw=async()=>{const vp=pg.getViewport({scale:1.6,rotation:rot});cv.width=vp.width;cv.height=vp.height;await pg.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise};
      b.onclick=()=>{rot=(rot+90)%360;draw()};await draw();
    }
  }catch(e){body.innerHTML='<div class="card empty err">Could not load PDF: '+esc(e.message)+'</div>'}
}

/* ---- coordinator picks or reassigns reviewers ---- */
async function reviewerModal(p){
  let list;try{list=await api('GET','/api/reviewers')}catch(e){return toast(e.message,1)}
  if(!list.length)return toast('No users have the Reviewer role yet. Add them in Settings > Users.',1);
  const cur=(p.stage==='review'?p.requiredReviewers:p.reviewerPick)||[];
  const sel=new Set(cur.length?cur.map(r=>r.id):list.map(r=>r.id));
  const w=document.createElement('div');w.className='modal';
  w.innerHTML=`<div class="card"><h2>${p.stage==='review'?'Reassign reviewers':'Who reviews this packet'}</h2>
   <p class="hint" style="margin:0 0 12px">${p.stage==='review'?'Approvals already given are kept. New reviewers are emailed. If everyone left has approved, the packet moves on.':'Applies when inspection is marked complete.'}</p>
   <div class="approvals">${list.map(r=>{const a=(p.approvals||[]).find(x=>x.id===r.id)&&p.stage==='review';return `<label class="apr" style="cursor:pointer"><input type="checkbox" data-id="${esc(r.id)}" ${sel.has(r.id)?'checked':''} style="width:22px;height:22px"><span class="nm">${esc(r.name)}</span>${a?'<span class="chip on">Approved</span>':''}</label>`}).join('')}</div>
   <p class="err" id="rverr"></p><div class="bar"><button class="btn pri" id="rvsave">Save</button><button class="btn" id="rvcancel">Cancel</button></div></div>`;
  document.body.appendChild(w);$('#rvcancel').onclick=()=>w.remove();
  $('#rvsave').onclick=async()=>{
    const ids=$$('input[data-id]',w).filter(i=>i.checked).map(i=>i.dataset.id);
    try{const r=await api('POST','/api/packets/'+p.id+'/reviewers',{ids});upsert(r);w.remove();toast('Reviewers updated');viewPacket(p.id)}
    catch(e){$('#rverr').textContent=e.message}};
}

function reviewersBlock(p){
  const req=p.requiredReviewers||[],apr=p.approvals||[],pick=p.reviewerPick||[];
  const canChange=has('coordinator')&&['new','inspecting','review'].includes(p.stage);
  let rows;
  if(p.stage==='new'||p.stage==='inspecting')
    rows=pick.length?pick.map(r=>`<div class="rv"><span>${esc(r.name)}</span></div>`).join(''):'<p class="muted" style="margin:0">Everyone with the Reviewer role (default).</p>';
  else
    rows=req.length?req.map(r=>{const a=apr.find(x=>x.id===r.id);return `<div class="rv"><span>${esc(r.name)}</span>${a?`<span class="chip on" title="${fdate(a.t)}">${ic('check')} Approved</span>`:'<span class="chip pend">Waiting</span>'}</div>`}).join(''):'<p class="muted" style="margin:0">No reviewers. Review was skipped.</p>';
  return `<div class="rvbox"><label>Reviewers</label>${rows}${canChange?`<button class="btn sm" id="chrev" style="margin-top:10px">${p.stage==='review'?'Reassign reviewers':'Change reviewers'}</button>`:''}</div>`;
}

/* ---- form locks: opening a form reserves it for you until you close it ---- */
let LK=null;
const lockUrl=(id,po,tk)=>`/api/packets/${id}/forms/${encodeURIComponent(po)}/${tk}`;
function startLock(id,po,tk){stopLock();LK={id,po,tk,t:setInterval(()=>api('POST',lockUrl(id,po,tk)+'/lock',{}).catch(e=>toast(e.message,1)),60000)}}
function stopLock(){
  if(!LK)return;clearInterval(LK.t);const u=lockUrl(LK.id,LK.po,LK.tk)+'/unlock';LK=null;
  fetch(u,{method:'POST',headers:{'X-Requested-With':'fetch','Content-Type':'application/json'},body:'{}',keepalive:true,credentials:'same-origin'}).catch(()=>{});
}
addEventListener('pagehide',stopLock);

/* ---- helpers for the packet page ---- */
function draftBanner(p){
  if(p.ready!==false||!has('coordinator'))return '';
  return `<div class="banner"><b>Draft: the PDF was never attached.</b> Receivers can't see this packet and no email has gone out. Attach the PDF to send it, or delete the draft and start again.
   <div class="bar" style="margin-top:10px"><label class="btn pri" style="cursor:pointer">${ic('file')} Attach PDF<input type="file" id="attachpdf" accept="application/pdf" hidden></label><button class="btn danger" id="delpk">Delete draft</button></div></div>`;
}
function claimBlock(p){
  const open=p.stage==='new'||p.stage==='inspecting',c=p.claimedBy;
  let h=`<div class="rvbox"><label>Inspector</label>`;
  if(c)h+=`<div class="rv"><span>${esc(c.name)}</span><span class="chip on">Claimed</span></div>`;else h+='<p class="muted" style="margin:0">Not claimed. Anyone on the dock can start.</p>';
  if(open&&has('receiver','coordinator')){
    if(!c)h+=`<button class="btn sm" id="claim" style="margin-top:10px">Claim this packet</button>`;
    else if(c.id===S.me.id||has('coordinator'))h+=`<button class="btn sm" id="unclaim" style="margin-top:10px">${c.id===S.me.id?'Release my claim':'Release claim'}</button>`;
  }
  if(has('coordinator')&&p.stage!=='filed'&&p.ready!==false)h+=`<button class="btn sm danger" id="delpk" style="margin-top:10px;margin-left:6px">Delete packet</button>`;
  return h+'</div>';
}
function reasonModal(title,text,btn,go){
  const w=document.createElement('div');w.className='modal';
  w.innerHTML=`<div class="card"><h2>${esc(title)}</h2><p class="hint" style="margin:0 0 12px">${esc(text)}</p><div class="fld"><label>Reason</label><textarea id="rsn" style="min-height:90px" placeholder="Why?"></textarea></div><p class="err" id="rsnerr"></p><div class="bar"><button class="btn pri" id="rsnok">${esc(btn)}</button><button class="btn" id="rsnx">Cancel</button></div></div>`;
  document.body.appendChild(w);$('#rsnx').onclick=()=>w.remove();$('#rsn').focus();
  $('#rsnok').onclick=async()=>{const v=$('#rsn').value.trim();if(!v){$('#rsnerr').textContent='Give a reason.';return}try{await go(v);w.remove()}catch(e){$('#rsnerr').textContent=e.message}};
}
