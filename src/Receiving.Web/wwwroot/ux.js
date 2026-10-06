/* ux helpers: drafts that survive a dropped connection, "next step" banner, coverage and type hints,
   reviewer summary, reject reasons, setup checklist */

/* ---------- unsent drafts: kept on this tablet until the server has them ---------- */
const DK='rcvd:';
const dkey=(id,po,tk)=>DK+(S.me?S.me.id:'x')+'|'+id+'|'+po+'|'+tk;
function saveLocal(id,po,tk,f){try{localStorage.setItem(dkey(id,po,tk),JSON.stringify({id,po,tk,date:f.date,items:f.items,t:Date.now(),unsent:true}))}catch(e){}renderSync()}
function loadLocal(id,po,tk){try{const v=JSON.parse(localStorage.getItem(dkey(id,po,tk))||'null');return v&&v.unsent?v:null}catch(e){return null}}
function markSynced(id,po,tk){try{localStorage.removeItem(dkey(id,po,tk))}catch(e){}renderSync()}
function unsentList(){
  const out=[],pre=DK+(S.me?S.me.id:'x')+'|';
  try{for(let i=0;i<localStorage.length;i++){const k=localStorage.key(i);if(k&&k.startsWith(pre)){const v=JSON.parse(localStorage.getItem(k));if(v&&v.unsent)out.push(v)}}}catch(e){}
  return out;
}
// a failed fetch (no network) is a TypeError; anything else is an answer from the server
const isNetErr=e=>e instanceof TypeError;

let syncing=false;
// send every unsent draft; stops quietly while offline
async function syncAll(){
  if(syncing||!S.me||!navigator.onLine)return;
  syncing=true;
  try{
    for(const d of unsentList()){
      try{
        await api('PUT',`/api/packets/${d.id}/forms/${encodeURIComponent(d.po)}/${d.tk}`,{date:d.date,items:d.items,submit:false});
        markSynced(d.id,d.po,d.tk);
      }catch(e){
        if(isNetErr(e))break;
        // packet moved on or form already submitted: the old draft can never be sent, so drop it
        if(/past inspection|Already submitted/i.test(e.message)){markSynced(d.id,d.po,d.tk)}
      }
    }
  }finally{syncing=false;renderSync()}
}
function renderSync(){
  let el=document.getElementById('syncpill');
  if(!el){const top=document.querySelector('.top');if(!top)return;el=document.createElement('button');el.id='syncpill';el.className='syncpill';el.hidden=true;el.onclick=()=>{syncAll();toast(navigator.onLine?'Sending...':'Still offline')};top.insertBefore(el,document.getElementById('who'))}
  const n=S.me?unsentList().length:0,off=!navigator.onLine;
  el.hidden=!S.me||(!n&&!off);
  el.className='syncpill'+(off?' off':'');
  el.textContent=(off?'Offline':'Online')+(n?' · '+n+' unsent':'');
  el.title=n?'Entries saved on this tablet that have not reached the server yet. Tap to send now.':'No connection to the server.';
}
addEventListener('online',()=>{renderSync();syncAll()});
addEventListener('offline',renderSync);
setInterval(()=>{renderSync();syncAll()},30000);

/* ---------- which inspection type does a BOL line look like? ---------- */
const TYPE_HINTS=[
  ['tube',/\b(tube|tubing|pipe|rod|hss|rhs|shs|round bar)\b/i],
  ['shape',/\b(beam|channel|angle|wide flange|wf|hp\s?\d+|mc\s?\d+)\b|\b[wcl]\s?\d+\s?x/i],
  ['bar',/\b(flat bar|fb|bar)\b/i],
  ['sheet',/\b(sheet|plate|\d+\s?ga|gauge|gage|g60|g90)\b/i],
  ['coil',/\b(coil|hro|cro|hr|cr|galv|galvanized|painted|slit)\b/i]];
function guessType(r){const d=String(r.desc||'');for(const [k,re] of TYPE_HINTS)if(re.test(d))return k;return ''}
// {type: count} for the lines of one PO
function suggestTypes(rs){const m={};rs.forEach(r=>{const k=guessType(r);if(k)m[k]=(m[k]||0)+1});return m}
// when none of the PO's lines look like this type but others do, say so
function typeMismatch(rs,tk){
  const m=suggestTypes(rs);if(!rs.length||m[tk])return '';
  const others=Object.keys(m);if(!others.length)return '';
  return 'The items on this PO look like '+others.map(k=>TYPES.find(t=>t.k===k).n.toLowerCase()).join(' / ')+', not '+TYPES.find(t=>t.k===tk).n.toLowerCase()+'. Check you opened the right form.';
}

/* ---------- which BOL lines already have an inspection row? ---------- */
// returns 'done' (submitted), 'draft' or '' for line j of this PO
function covStatus(p,po,rs,j){
  const r=rs[j];let st='';
  TYPES.forEach(t=>{
    const f=p.forms[po+'|'+t.k];if(!f)return;
    (f.items||[]).forEach(it=>{
      if(it.skip)return;
      const hit=(it.src!==undefined&&it.src!==''&&String(it.src)===String(j))||(r.cc&&String(it.cc||'').trim()===String(r.cc).trim());
      if(!hit)return;
      if(f.submitted)st='done';else if(st!=='done')st='draft';
    });
  });
  return st;
}

/* ---------- "Next step" banner at the top of the packet page ---------- */
function nextStepHtml(p){
  const canInspect=has('receiver','coordinator'),editable=p.stage==='new'||p.stage==='inspecting';
  const req=p.requiredReviewers||[],apr=p.approvals||[];
  let text='',btn='',go='';
  if(editable&&canInspect){
    const open=pos(p).filter(po=>!subForms(p,po).length);
    if(open.length){text='Inspect '+(open.length===1?'PO '+open[0]:open.length+' POs')+' that still '+(open.length===1?'has':'have')+' no submitted inspection.';btn='Go to '+open[0];go='.pobox[data-po="'+open[0]+'"]'}
    else{text='Every PO has an inspection. Send the packet to review.';btn='Inspection complete';go='#complete'}
  }else if(p.stage==='review'){
    const mine=req.some(r=>r.id===S.me.id),done=apr.some(a=>a.id===S.me.id);
    if(mine&&!done){text='Your approval is needed.';btn='Review and approve';go='#approve'}
    else{const wait=req.filter(r=>!apr.some(a=>a.id===r.id)).map(r=>r.name);text='In review. Waiting for '+(wait.join(', ')||'approval')+'.'}
  }else if(p.stage==='receive'){
    if(has('coordinator')){text='Receive the PO lines in D365, then enter the receipt number.';btn='Enter receipt number';go='#d365'}else text='Reviews are done. Waiting for the coordinator to receive it in D365.';
  }else if(p.stage==='authorize'){
    if(has('coordinator')){text='Check the details, then authorize and file.';btn='Authorize and file';go='#auth'}else text='Waiting for the coordinator to authorize.';
  }else if(p.stage==='filed'){
    text='Filed. Upload the final packet PDF to DocuWare.';if(has('coordinator')){btn='Go to downloads';go='.abtns'}
  }
  if(!text)return '';
  return `<div class="nextstep"><div class="ns-t"><b>Next step</b><span>${esc(text)}</span></div>${btn?`<button class="btn pri" type="button" data-go='${go}'>${esc(btn)}</button>`:''}</div>`;
}
function bindNextStep(){
  const b=document.querySelector('.nextstep [data-go]');if(!b)return;
  b.onclick=()=>{const el=document.querySelector(b.dataset.go);if(!el)return;el.scrollIntoView({behavior:'smooth',block:'center'});if(el.matches('input,button'))setTimeout(()=>el.focus({preventScroll:true}),400)};
}

/* ---------- reject reasons ---------- */
const REASONS=['Rust or corrosion','Dent or damage','Wrong size','Out of tolerance','Coating damage','Cert missing or unreadable','Wrong material','Other'];
const OKLABEL={surface:'Surface',cert:'Cert.',visual:'Visual Insp.'};

/* ---------- what the reviewer needs to see before approving ---------- */
function reviewSummaryHtml(p){
  if(!has('coordinator','reviewer')||!['review','receive','authorize','filed'].includes(p.stage))return '';
  const rows=[];let total=0,rej=0;
  Object.entries(p.forms||{}).forEach(([key,f])=>{
    if(!f||!f.submitted)return;
    const [po,tk]=key.split('|'),T=TYPES.find(t=>t.k===tk);
    const items=(f.items||[]).filter(it=>!it.skip&&(it.heat||it.cc||it.desc));
    total+=items.length;
    const bad=[];
    items.forEach(it=>Object.keys(OKLABEL).forEach(k=>{if(it[k]==='bad')bad.push({cc:it.cc||it.heat||'?',what:OKLABEL[k],why:it[k+'_why']||'',note:it.comments||''})}));
    rej+=bad.length;
    rows.push(`<div class="rs-row"><div><b>${esc(po)}</b> &middot; ${esc(T?T.n:tk)} &middot; ${items.length} row${items.length===1?'':'s'} <span class="muted">by ${esc(f.by||f.inspector||'')} ${f.date?'&middot; '+esc(f.date):''}</span></div>
      ${bad.length?`<ul class="rs-bad">${bad.map(b=>`<li><b>CC ${esc(b.cc)}</b>: ${esc(b.what)} rejected${b.why?' ('+esc(b.why)+')':''}${b.note?' &mdash; '+esc(b.note):''}</li>`).join('')}</ul>`:'<div class="muted" style="font-size:13px">No rejects.</div>'}</div>`);
  });
  if(!rows.length)return '';
  return `<div class="card" style="margin-bottom:18px"><h2>Review summary</h2>
    <p class="muted" style="margin:-4px 0 10px">${total} row${total===1?'':'s'} inspected${rej?`, <b style="color:var(--red)">${rej} rejected field${rej===1?'':'s'}</b>`:', no rejects'}. Open the packet PDF beside this to compare.</p>${rows.join('')}</div>`;
}

/* ---------- admin setup checklist (top of Settings > Status) ---------- */
async function setupChecklist(d){
  let admins=[];try{admins=await api('GET','/api/admin/admins')}catch(e){}
  const g=ST&&ST.general?ST.general:{};
  const users=(typeof SUsers!=='undefined'?SUsers:[]).filter(u=>u.active!==false);
  const role=r=>users.some(u=>(u.roles||[]).includes(r));
  const items=[
    ['Site address set to what people type to reach the app',g.baseUrl&&!/localhost|127\.0\.0\.1/i.test(g.baseUrl),'general',false],
    ['Email server set up',!!(d.mail&&d.mail.smtpSet),'email',false],
    ['At least one admin has an email address',admins.some(a=>a.email),'admins',false],
    ['A receiver, a coordinator and a reviewer added',role('receiver')&&role('coordinator')&&role('reviewer'),'users',false],
    ['Nightly backup is on and has run',!!(d.backup&&d.backup.enabled&&d.backup.last),'backups',false],
    ['Copy to the DocuWare folder (optional)',!!(d.drop&&d.drop.enabled),'integrations',true],
    ['PO list imported (optional)',!!d.poLines,'integrations',true]];
  const left=items.filter(i=>!i[1]&&!i[3]).length;
  return `<div class="card" style="margin-bottom:16px"><h2>Setup checklist</h2>
    <p class="hint" style="margin:-4px 0 10px">${left?left+' step'+(left===1?'':'s')+' left before this is ready for everyone.':'Everything needed is set up.'}</p>
    <ul class="checklist">${items.map(([t,ok,tab,opt])=>`<li class="${ok?'ok':''}"><span class="cx">${ok?'✓':''}</span><span class="cl">${esc(t)}</span>${ok?'':`<button class="btn sm" type="button" data-gotab="${tab}">${opt?'Open':'Do this'}</button>`}</li>`).join('')}</ul></div>`;
}
function bindChecklist(){
  document.querySelectorAll('[data-gotab]').forEach(b=>b.onclick=()=>{const t=document.querySelector('.stabs button[data-t="'+b.dataset.gotab+'"]');if(t)t.click()});
}

/* ---------- page footer: which build is this tablet looking at? ---------- */
function renderFoot(){
  const el=document.getElementById('appfoot');if(!el||!S.cfg)return;
  const c=S.cfg,app=/SteelReceivingApp\/([\w.]+)/.exec(navigator.userAgent);
  const built=c.built?new Date(c.built).toLocaleString([],{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'}):'';
  el.textContent=[(c.siteName||'Steel Receiving')+(c.version?' v'+c.version:''),c.build?'build '+c.build.replace(/^([0-9a-f]{7})[0-9a-f]+/,'$1'):'',built?'deployed '+built:'',app?'Android app '+app[1]:'browser'].filter(Boolean).join(' \u00b7 ');
}

/* first paint of the header pill once the page is ready */
renderSync();
