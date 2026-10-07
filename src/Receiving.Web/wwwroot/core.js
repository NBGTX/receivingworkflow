/* core: utils, api, auth, shell, router */
const $=(s,r=document)=>r.querySelector(s),$$=(s,r=document)=>[...r.querySelectorAll(s)];
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const IC={
 inbox:'<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5h13L22 12v6a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-6z"/>',
 list:'<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
 plus:'<path d="M12 5v14M5 12h14"/>',
 file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
 check:'<path d="M20 6 9 17l-5-5"/>',
 back:'<path d="M15 18l-6-6 6-6"/>',
 search:'<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
 rot:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
 dl:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
 info:'<circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/>',
 gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
 chart:'<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
 stamp:'<path d="M9 11V6a3 3 0 1 1 6 0v5"/><path d="M5 21h14v-4a3 3 0 0 0-3-3H8a3 3 0 0 0-3 3z"/>',
 out:'<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9"/>'};
const ic=n=>`<svg class="ic" viewBox="0 0 24 24">${IC[n]||''}</svg>`;

const STAGES=[['new','Awaiting inspection'],['inspecting','In inspection'],['review','In review'],['receive','Ready to receive'],['authorize','Ready to authorize'],['filed','Filed']];
const SL=Object.fromEntries(STAGES);
/* Columns match the paper sheets in the Inspections folder, in sheet order.
   Heat #, Description, NBS # (CC #), and Coil # are pre-filled from the packet. 'ok' = OK/Reject toggle. */
const TYPES=[
 {k:'coil',n:'Coil',form:'QCF001',tol:'coil',tolRegion:[.63,.98],show:['coil','heat','desc','cc'],meas:[['id','I.D.'],['od','O.D.'],['gauge','Gauge'],['width','Width'],['color','Color','text']],post:[]},
 {k:'sheet',n:'Flat sheet',form:'QCF023',tol:'sheet',tolRegion:[.70,.90],show:['heat','desc','cc'],meas:[['qty','Qty. Rec./BOL'],['len','Length'],['width','Width'],['gauge','Gauge']],post:[]},
 {k:'bar',n:'Flat bar',form:'QCF005',tol:'bar',tolRegion:[.61,.91],show:['heat','desc','cc'],meas:[['qty','Qnty Rec./BOL'],['width','Width'],['thick','Thick'],['sweep','Sweep / Camber'],['surface','Surface','ok']],post:[['cert','Cert.','ok']]},
 {k:'shape',n:'Beam, channel, angle',form:'QCF011',tol:null,show:['heat','desc','cc'],meas:[['qty','Qty. Rec./BOL'],['depth','Depth'],['width','Width'],['visual','Visual Insp.','ok'],['thick','Thickness'],['sweep','Sweep / Camber']],post:[['cert','Cert.','ok']]},
 {k:'tube',n:'Rod, pipe, tube',form:'QCF008',tol:'tube',tolRegion:[.69,.91],show:['heat','desc','cc'],meas:[['qty','Qnty Rec./BOL'],['wall','Wall Thickness'],['od','O.D.'],['surface','Surface','ok'],['sweep','Sweep / Camber']],post:[['cert','Cert.','ok']]}];
const FL={coil:'Coil #',heat:'Heat #',desc:'Description',cc:'NBS # (CC #)',po:'PO #',wt:'Weight'};
const ago=ts=>{const m=(Date.now()-ts)/6e4;return m<1?'now':m<60?Math.round(m)+' min':m<1440?Math.round(m/60)+' h':Math.round(m/1440)+' d'};
const fdate=ts=>new Date(ts).toLocaleString([], {month:'short',day:'numeric',hour:'numeric',minute:'2-digit'});
// short message at the bottom of the screen
// short message at the bottom; act = {label, fn, ms} adds a button such as Undo
function toast(t,bad,act){
  const e=$('#toast');e.textContent=t;e.style.background=bad?'var(--red)':'';
  if(act){const b=document.createElement('button');b.type='button';b.className='toast-act';b.textContent=act.label;b.onclick=()=>{e.classList.remove('show');clearTimeout(toast.t);act.fn()};e.appendChild(b)}
  e.style.pointerEvents=act?'auto':'';
  e.classList.add('show');clearTimeout(toast.t);toast.t=setTimeout(()=>e.classList.remove('show'),act?(act.ms||10000):2600);
}

/* ---- api ---- */
const S={me:null,cfg:{siteName:'Steel Receiving',idleMinutes:15,pinLength:4},packets:[]};
// fetch wrapper: JSON in and out; 440 means the session ended, so go back to the sign-in screen
async function api(method,url,body,ctype){
  const h={'X-Requested-With':'fetch'};let b;
  if(body instanceof ArrayBuffer){b=body;h['Content-Type']=ctype||'application/octet-stream'}
  else if(body!==undefined){b=JSON.stringify(body);h['Content-Type']='application/json'}
  const r=await fetch(url,{method,headers:h,body:b,credentials:'same-origin'});
  if(r.status===440&&!url.includes('/auth/')){S.me=null;showLogin();throw new Error('Signed out')}
  let j=null;const t=await r.text();try{j=t?JSON.parse(t):null}catch(e){}
  if(!r.ok)throw new Error((j&&(j.error||j.title))||('Request failed ('+r.status+')'));
  return j;
}
const has=(...r)=>S.me&&(S.me.roles.includes('admin')||r.some(x=>S.me.roles.includes(x)));
const P=id=>S.packets.find(p=>p.id===id);
const pos=p=>[...new Set(p.rows.map(r=>r.po))];
const subForms=(p,po)=>TYPES.filter(t=>p.forms[po+'|'+t.k]?.submitted);
const covered=p=>pos(p).filter(po=>subForms(p,po).length).length;
const lastT=p=>(p.log[p.log.length-1]||{}).t||p.created;
// reload the packet list into the cache (S.packets)
async function loadPackets(){S.packets=await api('GET','/api/packets')}
// replace one packet in the cache after the server returns it
function upsert(p){const i=S.packets.findIndex(x=>x.id===p.id);if(i>=0)S.packets[i]=p;else S.packets.unshift(p)}

/* ---- login ---- */
let idleT=null,warnT=null,warnEl=null,warnI=null;
// sign out after the idle time set in Settings
function closeIdleWarn(){clearInterval(warnI);if(warnEl){warnEl.remove();warnEl=null}}
function resetIdle(){
  clearTimeout(idleT);clearTimeout(warnT);closeIdleWarn();if(!S.me)return;
  const ms=(S.me.idleMinutes||15)*60000;
  idleT=setTimeout(()=>logout('Signed out after inactivity'),ms);
  if(ms>90000)warnT=setTimeout(idleWarn,ms-60000);   // one minute of notice
}
// "Still there?" dialog before the automatic sign-out; any tap keeps the session
function idleWarn(){
  if(!S.me)return;
  warnEl=document.createElement('div');warnEl.className='pinwrap';let left=60;
  warnEl.innerHTML=`<div class="pinbox" style="width:min(420px,94vw)"><b style="font-size:20px;color:var(--dg)">Still there?</b><p id="iw_t" style="margin:12px 0 18px">You will be signed out in 60 seconds. Inspection entries are saved as drafts.</p><button class="btn pri big" id="iw_b">Stay signed in</button></div>`;
  document.body.appendChild(warnEl);
  warnEl.querySelector('#iw_b').onclick=()=>{api('GET','/api/auth/me').catch(()=>{});resetIdle()};
  warnI=setInterval(()=>{left--;const t=warnEl&&warnEl.querySelector('#iw_t');if(t)t.textContent='You will be signed out in '+left+' seconds. Inspection entries are saved as drafts.'},1000);
}
['pointerdown','keydown','touchstart'].forEach(e=>addEventListener(e,resetIdle,{passive:true}));
async function logout(msg){try{await api('POST','/api/auth/logout')}catch(e){}S.me=null;S.packets=[];clearTimeout(idleT);showLogin(msg)}
// card picker plus the Windows admin link
async function showLogin(msg){
  if(typeof renderFoot==='function')renderFoot();
  $('#tabs').innerHTML='';$('#tabs2').innerHTML='';$('#who').innerHTML='';closeDrawer&&closeDrawer();
  $('#app').innerHTML=`<div class="login"><h1>Who is working?</h1><p>${esc(msg||'Tap your card, then enter your PIN.')}</p>${howTo('login')}<div class="ucards" id="ucards"></div>
   <div class="adminlink"><button class="btn" id="winbtn">${ic('stamp')} Admin sign-in (Windows)</button><p class="hint" id="winerr" style="margin-top:10px"></p></div></div>`;
  $('#winbtn').onclick=winLogin;
  try{
    const cards=await api('GET','/api/auth/cards');
    $('#ucards').innerHTML=cards.length?cards.map(c=>`<div class="ucard" data-id="${c.id}" data-n="${esc(c.name)}" data-i="${esc(c.initials||c.name.slice(0,2))}"><div class="av">${esc((c.initials||c.name.slice(0,2)).toUpperCase())}</div><b>${esc(c.name)}</b><span>${esc(c.roles.join(', '))}</span></div>`).join(''):'<div class="card empty" style="grid-column:1/-1">No users yet. An admin signs in with Windows, then adds people in Settings.</div>';
    $$('.ucard').forEach(c=>c.onclick=()=>pinPad(+c.dataset.id,c.dataset.n,c.dataset.i));
  }catch(e){$('#ucards').innerHTML='<div class="card empty err" style="grid-column:1/-1">'+esc(e.message)+'</div>'}
}
// top-level navigation, because the browser only does the Windows handshake that way
function winLogin(){
  // Full page navigation: the browser can run the Windows handshake (or ask for a password) properly here,
  // then the server signs the admin in and sends them back to the app.
  const e=$('#winerr');e.textContent='Opening Windows sign-in...';e.className='hint';
  location.href='/api/auth/windows?next=1';
}
// PIN entry dialog
function pinPad(id,name,ini){
  let v='';const L=S.cfg.pinLength;
  const w=document.createElement('div');w.className='pinwrap';
  w.innerHTML=`<div class="pinbox"><div class="av">${esc(ini.toUpperCase())}</div><b style="font-size:19px;color:var(--dg)">${esc(name)}</b><div class="dots" id="dots"></div><div class="pinerr" id="perr"></div>
   <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}<button class="sm" data-k="x">Cancel</button><button data-k="0">0</button><button class="sm" data-k="b">&#9003;</button></div></div>`;
  document.body.appendChild(w);
  const dots=()=>$('#dots').innerHTML=Array.from({length:L},(_,i)=>`<i class="${i<v.length?'f':''}"></i>`).join('');dots();
  w.querySelectorAll('[data-k]').forEach(b=>b.onclick=async()=>{
    const k=b.dataset.k;
    if(k==='x'){w.remove();return}
    if(k==='b')v=v.slice(0,-1);else if(v.length<L)v+=k;
    dots();$('#perr').textContent='';
    if(v.length===L){
      try{S.me=await api('POST','/api/auth/pin',{userId:id,pin:v});w.remove();await enter()}
      catch(e){$('#perr').textContent=e.message;v='';dots();const pb=w.querySelector('.pinbox');pb.classList.remove('shake');void pb.offsetWidth;pb.classList.add('shake')}
    }
  });
}

/* ---- shell ---- */
function firstRoute(){return has('receiver')&&!has('coordinator')?'/inbox':has('reviewer')&&!has('coordinator')&&!has('receiver')?'/reviews':has('coordinator')?'/board':'/inbox'}
async function enter(){
  resetIdle();
  if(S.me&&S.me.mustChange)await changePin(true);
  try{S.cfg=await api('GET','/api/config')}catch(e){}
  renderShell();
  if(!location.hash||location.hash==='#/'||location.hash==='#')location.hash=firstRoute();
  route();
}
function renderShell(){
  const m=S.me;if(!m)return;
  $('#who').innerHTML=`<div class="userchip"><div style="text-align:right"><b>${esc(m.name)}</b><small>${m.roles.includes('admin')?'admin':esc(m.roles.join(', '))}</small></div><div class="avatar">${esc((m.initials||'?').toUpperCase())}</div></div>${m.kind==='pin'?'<button class="btn sm" id="chpin" style="margin-left:6px">Change PIN</button>':''}<button class="btn sm" id="logout" style="margin-left:6px">${ic('out')} Sign out</button>`;
  $('#logout').onclick=()=>logout();
  const cp=$('#chpin');if(cp)cp.onclick=()=>changePin(false);
  $('.brand b').textContent=S.cfg.siteName||'Steel Receiving';
}
// which tabs each role sees, in order
function tabsFor(){
  const t=[];
  // intake first (overview, list, create), then the people who act on a packet, settings last
  if(has('coordinator','reviewer')){t.push(['dashboard','chart','Dashboard']);t.push(['board','list','Packets'])}
  if(has('coordinator'))t.push(['new','plus','New packet']);
  if(has('reviewer','coordinator'))t.push(['reviews','stamp','Reviews']);
  if(has('receiver'))t.push(['inbox','inbox','My inbox']);
  if(has('admin'))t.push(['settings','gear','Settings']);
  return t;
}
/* ---- tabs: main ones on the left, My inbox on the right as a highlighted pill with a count ---- */
let curTab='';
// number shown on a tab, for example packets waiting in My inbox
function badgeCount(k){
  if(k==='inbox')return S.packets.filter(p=>p.stage==='new'||p.stage==='inspecting').length;
  if(k==='reviews')return S.packets.filter(p=>p.stage==='review'&&(p.requiredReviewers||[]).some(r=>r.id===S.me.id)&&!(p.approvals||[]).some(a=>a.id===S.me.id)).length;
  return 0;
}
function renderTabs(){
  if(!S.me)return;
  const html=([k,i,l])=>{const n=badgeCount(k);return `<a href="#/${k}" title="${l}" class="${k==='inbox'?'inbox ':''}${curTab===k?'on':''}">${ic(i)}<span class="tl">${l}</span>${n?`<span class="pill-n" title="${n} waiting">${n}</span>`:''}</a>`};
  const all=tabsFor();
  $('#tabs').innerHTML=all.filter(t=>t[0]!=='inbox').map(html).join('');
  $('#tabs2').innerHTML=all.filter(t=>t[0]==='inbox').map(html).join('');
}
function nav(h){location.hash=h}
addEventListener('hashchange',()=>{if(S.me)route()});
let routeSeq=0;
// hash router: picks the view for the current address
async function route(){
  if(typeof renderFoot==='function')renderFoot();
  if(!S.me)return;
  if(typeof syncAll==='function')syncAll();
  const seq=++routeSeq;
  if(typeof stopLock==='function')stopLock();
  const parts=(location.hash||'').replace(/^#\/?/,'').split('/').map(decodeURIComponent);
  $('#app').classList.remove('wide');
  const v=parts[0],tabs=tabsFor();
  if(['board','reviews','inbox','dashboard'].includes(v))S.lastList='/'+v;
  const cur=v==='p'?((S.lastList||'').slice(1)||(has('coordinator','reviewer')?'board':'inbox')):v;
  curTab=cur;renderTabs();
  closeDrawer();
  try{
    if(v==='settings'&&has('admin'))return viewSettings();
    if(v==='new'&&has('coordinator'))return viewNew();
    if(v==='dashboard'&&has('coordinator','reviewer'))return viewDashboard();
    await loadPackets();if(seq!==routeSeq)return;
    renderTabs();
    if(v==='p'&&parts[2]==='f')return viewForm(parts[1],parts[3],parts[4]);
    if(v==='p')return viewPacket(parts[1]);
    if(v==='board'&&has('coordinator','reviewer'))return viewBoard();
    if(v==='reviews'&&has('reviewer','coordinator'))return viewReviews();
    if(v==='inbox'&&has('receiver'))return viewInbox();
    nav(firstRoute());
  }catch(e){if(e.message!=='Signed out')$('#app').innerHTML=`<div class="card empty err">${esc(e.message)}</div>`}
}
/* keep the counts on the tabs fresh even when another page is open */
setInterval(async()=>{
  if(!S.me||document.hidden||!(has('receiver')||has('reviewer')))return;
  try{S.packets=await api('GET','/api/packets');renderTabs()}catch(e){}
},30000);
/* refresh list views so new packets show up on tablets */
setInterval(()=>{
  if(!S.me||document.hidden||$('#drawer').classList.contains('open')||document.querySelector('.pinwrap,.modal'))return;
  if(/^#\/(inbox|board|reviews)$/.test(location.hash)&&!document.activeElement?.matches('input,textarea'))route();
},20000);

/* ---- change PIN: three taps on the keypad (current, new, new again) ---- */
function askPin(title,sub,cancelable){
  return new Promise(resolve=>{
    let v='';const L=S.cfg.pinLength,w=document.createElement('div');w.className='pinwrap';
    w.innerHTML=`<div class="pinbox"><b style="font-size:19px;color:var(--dg)">${esc(title)}</b><div class="muted" style="font-size:13px;margin-top:4px">${esc(sub||'')}</div><div class="dots" id="dots"></div><div class="pinerr" id="perr"></div>
     <div class="pad">${[1,2,3,4,5,6,7,8,9].map(n=>`<button data-k="${n}">${n}</button>`).join('')}<button class="sm" data-k="x">${cancelable?'Cancel':''}</button><button data-k="0">0</button><button class="sm" data-k="b">&#9003;</button></div></div>`;
    document.body.appendChild(w);
    const dots=()=>$('#dots').innerHTML=Array.from({length:L},(_,i)=>`<i class="${i<v.length?'f':''}"></i>`).join('');dots();
    w.querySelectorAll('[data-k]').forEach(b=>b.onclick=()=>{const k=b.dataset.k;
      if(k==='x'){if(cancelable){w.remove();resolve(null)}return}
      if(k==='b')v=v.slice(0,-1);else if(v.length<L)v+=k;dots();
      if(v.length===L){w.remove();resolve(v)}});
  });
}
// forced or voluntary PIN change dialog
async function changePin(force){
  for(;;){
    const cur=await askPin('Enter your current PIN',force?'An admin set this PIN for you. Choose your own now.':'',!force);if(cur===null)return;
    const n1=await askPin('Choose a new PIN',S.cfg.pinLength+' digits',!force);if(n1===null)return;
    const n2=await askPin('Type the new PIN again','',!force);if(n2===null)return;
    if(n1!==n2){toast('The two PINs did not match. Try again.',1);continue}
    try{S.me=await api('POST','/api/auth/change-pin',{current:cur,new:n1});toast('PIN changed');return}
    catch(e){toast(e.message,1)}
  }
}
