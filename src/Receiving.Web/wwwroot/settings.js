/* admin settings panel */
let ST=null,STab='users',SUsers=[];
const ROLES=[['receiver','Receiver / inspector'],['coordinator','Intake coordinator'],['reviewer','Reviewer']];
const TOKENS='{{bol}} {{vendor}} {{pos}} {{items}} {{actor}} {{d365}} {{stage}} {{link}}';

// admin settings: tab strip and the active tab
async function viewSettings(){
  $('#app').innerHTML='<div class="card empty">Loading settings...</div>';
  try{[ST,SUsers]=await Promise.all([api('GET','/api/admin/settings'),api('GET','/api/admin/users')])}catch(e){$('#app').innerHTML='<div class="card empty err">'+esc(e.message)+'</div>';return}
  drawSettings();
}
function drawSettings(){
  const tabs=[['status','Status'],['users','Users'],['admins','Admins'],['email','Email server'],['notifs','Notifications'],['general','General & security'],['backups','Backups'],['integrations','Integrations'],['outbox','Sent mail'],['audit','Audit log']];
  $('#app').innerHTML=`<div class="pagehead"><div class="grow"><h1>Settings</h1><p>Admin only. Changes apply right away after you save.</p></div></div>
  <div class="stabs">${tabs.map(([k,l])=>`<button data-t="${k}" class="${STab===k?'on':''}">${l}</button>`).join('')}</div>${howTo('settings:'+STab)}<div id="sbody"></div>`;
  $$('.stabs button').forEach(b=>b.onclick=()=>{STab=b.dataset.t;drawSettings()});
  ({status:tabStatus,integrations:tabIntegrations,users:tabUsers,admins:tabAdmins,email:tabEmail,notifs:tabNotifs,general:tabGeneral,backups:tabBackups,outbox:tabOutbox,audit:tabAudit})[STab]();
}
const fld=(label,html,cls='')=>`<div class="fld ${cls}"><label>${label}</label>${html}</div>`;
const inp=(id,val,extra='')=>`<input id="${id}" value="${esc(val??'')}" ${extra}>`;
function saveBar(){return `<div class="savebar"><button class="btn pri" id="saveAll">Save settings</button><span id="smsg" class="muted"></span></div>`}
// save every tab that changed
async function saveAll(){
  const m=$('#smsg');m.className='muted';m.textContent='Saving...';
  try{await api('PUT','/api/admin/settings',{general:ST.general,smtp:{...ST.smtp,password:ST.smtp.newPassword??null},notifs:ST.notifs});delete ST.smtp.newPassword;m.textContent='Saved';
    S.cfg=await api('GET','/api/config');renderShell();toast('Settings saved')}
  catch(e){m.className='err';m.textContent=e.message}
}
function bind(id,obj,key,num){const e=$('#'+id);if(!e)return;e.oninput=e.onchange=()=>{obj[key]=num?(+e.value):e.type==='checkbox'?e.checked:e.value}}

/* users */
function tabUsers(){
  $('#sbody').innerHTML=`<div class="card"><div style="display:flex;align-items:center;margin-bottom:12px"><h2 style="margin:0;flex:1">Receivers, coordinators and reviewers</h2><button class="btn pri" id="addU">${ic('plus')} Add user</button></div>
  <p class="hint" style="margin:0 0 10px">These people sign in by tapping their card and entering a PIN. Admins sign in with Windows (see Admins tab).</p>
  <table class="list"><thead><tr><th>Name</th><th>Initials</th><th>Roles</th><th>Email</th><th>PIN</th><th>Status</th></tr></thead><tbody>
  ${SUsers.length?SUsers.map(u=>`<tr class="r" data-id="${u.id}"><td class="b">${esc(u.name)}</td><td>${esc(u.initials)}</td><td>${u.roles.map(r=>`<span class="chip po">${r}</span>`).join(' ')}</td><td>${esc(u.email)||'<span class="muted">none</span>'}</td><td>${u.pinSet?'Set':'<span class="err">Not set</span>'}</td><td>${!u.active?'<span class="chip off">Inactive</span>':u.locked?'<span class="chip bad">Locked</span>':'<span class="chip on">Active</span>'}</td></tr>`).join(''):'<tr><td colspan="6" class="empty">No users yet. Add the first one.</td></tr>'}</tbody></table></div>`;
  $('#addU').onclick=()=>userModal(null);$$('tr.r').forEach(r=>r.onclick=()=>userModal(SUsers.find(u=>u.id==r.dataset.id)));
}
// add or edit a PIN user
function userModal(u){
  const L=S.cfg.pinLength,w=document.createElement('div');w.className='modal';
  w.innerHTML=`<div class="card"><h2>${u?'Edit user':'Add user'}</h2><div class="frm">
   ${fld('Name',inp('un',u?.name))}${fld('Initials (shown on inspections)',inp('ui',u?.initials,'maxlength="4"'))}${fld('Email (for notifications)',inp('ue',u?.email,'type="email"'),'span2')}
   <div class="fld span2"><label>Roles</label><div class="checks">${ROLES.map(([k,l])=>`<label><input type="checkbox" name="role" value="${k}" ${u?.roles.includes(k)?'checked':''}> ${l}</label>`).join('')}</div></div>
   ${fld(u?.pinSet?`Reset PIN (${L} digits, leave blank to keep)`:`PIN (${L} digits)`,inp('up','','inputmode="numeric" maxlength="'+L+'" autocomplete="off"'))}
   <div class="fld span2"><label class="checks" style="font-weight:normal;text-transform:none;letter-spacing:0"><input type="checkbox" id="umc" ${u?'':'checked'} style="width:auto;min-height:auto"> Make them choose their own PIN the first time they sign in (applies when you set a PIN above)</label></div>
   ${u?`<div class="fld"><label>Status</label><div class="checks"><label><input type="checkbox" id="ua" ${u.active?'checked':''}> Active</label>${u.locked?'<label><input type="checkbox" id="uk"> Unlock</label>':''}</div></div>`:''}</div>
   <p class="err" id="uerr"></p><div class="bar"><button class="btn pri" id="usave">Save</button><button class="btn" id="ucancel">Cancel</button></div></div>`;
  document.body.appendChild(w);$('#ucancel').onclick=()=>w.remove();
  $('#usave').onclick=async()=>{
    const body={name:$('#un').value,initials:$('#ui').value,email:$('#ue').value,roles:$$('[name=role]:checked').map(x=>x.value),pin:$('#up').value,active:u?$('#ua').checked:true,unlock:$('#uk')?.checked,mustChange:$('#umc').checked};
    try{if(u)await api('PUT','/api/admin/users/'+u.id,body);else await api('POST','/api/admin/users',body);w.remove();SUsers=await api('GET','/api/admin/users');tabUsers();toast('User saved')}
    catch(e){$('#uerr').textContent=e.message}
  };
}

/* admins */
async function tabAdmins(){
  const list=await api('GET','/api/admin/admins');
  $('#sbody').innerHTML=`<div class="card"><h2>Windows admins</h2><p class="hint" style="margin:0 0 10px">These Windows accounts can open Settings. Use the form DOMAIN\\username, like BG\\sims.anderson. They sign in with the Admin (Windows) button.</p>
  <table class="list"><thead><tr><th>Account</th><th>Name</th><th></th></tr></thead><tbody>${list.map(a=>`<tr><td class="b">${esc(a.account)}</td><td>${esc(a.name)}</td><td style="text-align:right"><button class="btn sm" data-del="${esc(a.account)}">Remove</button></td></tr>`).join('')}</tbody></table>
  <div class="frm" style="margin-top:16px">${fld('Windows account',inp('aa','','placeholder="BG\\\\first.last"'))}${fld('Display name',inp('an',''))}</div><p class="err" id="aerr"></p><div class="bar"><button class="btn pri" id="aadd">Add admin</button></div></div>`;
  $('#aadd').onclick=async()=>{try{await api('POST','/api/admin/admins',{account:$('#aa').value,name:$('#an').value});tabAdmins();toast('Admin added')}catch(e){$('#aerr').textContent=e.message}};
  $$('[data-del]').forEach(b=>b.onclick=async()=>{if(!confirm('Remove '+b.dataset.del+' as admin?'))return;try{await api('DELETE','/api/admin/admins?account='+encodeURIComponent(b.dataset.del));tabAdmins()}catch(e){toast(e.message,1)}});
}

/* email */
function tabEmail(){
  const s=ST.smtp;
  $('#sbody').innerHTML=`<div class="card"><h2>Email server (SMTP)</h2>
   <div class="frm12">
    ${fld('Server host',inp('sh',s.host,'placeholder="smtp.company.com"'),'c5')}
    ${fld('Port',inp('sp',s.port,'type="number"'),'c2')}
    ${fld('Security',`<select id="ss">${[['None','None (internal relay, port 25)'],['StartTls','STARTTLS (port 587)'],['Ssl','SSL/TLS (port 465)']].map(([k,l])=>`<option value="${k}" ${s.security===k?'selected':''}>${l}</option>`).join('')}</select>`,'c5')}
    ${fld('User name',inp('su',s.user,'autocomplete="off" placeholder="Leave blank if the relay needs no login"'),'c6')}
    ${fld('Password',`<input id="spw" type="password" autocomplete="new-password" placeholder="${s.hasPassword?'Saved. Type to replace.':'Leave blank if none'}">`,'c6')}
    ${fld('From address',inp('sf',s.fromAddr,'type="email" placeholder="receiving@company.com"'),'c6')}
    ${fld('From name',inp('sn',s.fromName),'c6')}
   </div>
   <p class="hint" style="margin-top:12px">The password is stored encrypted on the server. Save before sending a test.</p></div>
  <div class="card" style="margin-top:16px"><h2>Send test emails</h2>
   <p class="hint" style="margin:0 0 12px">Sends one email for each notification type (new packet, review needed, ready to receive, ready to authorize, final) using sample packet data. Subjects start with [TEST]. This uses your saved wording, so save first.</p>
   <div class="testrow"><div class="fld" style="flex:1;min-width:240px;max-width:420px"><label>Send to</label><input id="tmail" type="email" placeholder="you@company.com"></div><button class="btn pri" id="ttest">Send all test emails</button><span id="tres" class="tres"></span></div></div>${saveBar()}`;
  [['sh','host'],['ss','security'],['su','user'],['sf','fromAddr'],['sn','fromName']].forEach(([i,k])=>bind(i,s,k));bind('sp',s,'port',true);
  $('#spw').oninput=e=>{s.newPassword=e.target.value};
  $('#saveAll').onclick=saveAll;
  $('#ttest').onclick=async()=>{const r=$('#tres');r.textContent='Sending...';r.className='tres';try{const x=await api('POST','/api/admin/test-email',{to:$('#tmail').value});if(x.failed.length){r.textContent='Sent '+x.sent+', failed: '+x.failed.join('; ');r.className='tres err'}else{r.textContent='Sent '+x.sent+' emails. Check the inbox.';r.className='tres okmsg'}}catch(e){r.textContent=e.message;r.className='tres err'}};
}

/* notifications */
function tabNotifs(){
  $('#sbody').innerHTML=`<p class="muted" style="margin:0 0 12px">Choose who gets an email at each step. A message goes to everyone who matches a role below, plus any specific people and extra addresses. People with no email on their user record are skipped. The message becomes the opening text of a styled email. The details box, item list and button are added automatically. Placeholders: <code>${TOKENS}</code></p>
  ${ST.notifs.map((n,i)=>`<div class="nrow"><h3>${esc(n.label)} <button class="btn sm" type="button" data-reset="${i}" style="margin-left:auto">Reset text</button><button class="btn sm" type="button" data-prev="${i}">Preview email</button><label class="checks"><input type="checkbox" data-n="${i}" data-k="enabled" ${n.enabled?'checked':''}> Send</label></h3>
   <div class="frm"><div class="fld span2"><label>Send to roles</label><div class="checks">${ROLES.map(([k,l])=>`<label><input type="checkbox" data-n="${i}" data-role="${k}" ${n.roles.includes(k)?'checked':''}> ${l}</label>`).join('')}</div></div>
   <div class="fld span2"><label>Also send to these people</label><div class="checks">${SUsers.filter(u=>u.active).map(u=>`<label><input type="checkbox" data-n="${i}" data-uid="${u.id}" ${n.userIds.includes(u.id)?'checked':''}> ${esc(u.name)}</label>`).join('')||'<span class="muted">No users yet</span>'}</div></div>
   ${fld('Extra email addresses (comma separated)',`<input data-n="${i}" data-k="extra" value="${esc(n.extra)}" placeholder="manager@company.com, finance@company.com">`,'span2')}
   ${fld('Subject',`<input data-n="${i}" data-k="subject" value="${esc(n.subject)}">`,'span2')}
   ${fld('Message',`<textarea data-n="${i}" data-k="body">${esc(n.body)}</textarea>`,'span2')}</div></div>`).join('')}${saveBar()}`;
  $$('[data-n]').forEach(e=>{const n=ST.notifs[+e.dataset.n];
    e.onchange=e.oninput=()=>{
      if(e.dataset.role){n.roles=e.checked?[...new Set([...n.roles,e.dataset.role])]:n.roles.filter(r=>r!==e.dataset.role)}
      else if(e.dataset.uid){const id=+e.dataset.uid;n.userIds=e.checked?[...new Set([...n.userIds,id])]:n.userIds.filter(x=>x!==id)}
      else n[e.dataset.k]=e.type==='checkbox'?e.checked:e.value}});
  $$('[data-reset]').forEach(b=>b.onclick=async()=>{const d=(await api('GET','/api/admin/notif-defaults'))[+b.dataset.reset];const n=ST.notifs[+b.dataset.reset];n.subject=d.subject;n.body=d.body;tabNotifs();toast('Text reset. Save to keep it.')});
  $$('[data-prev]').forEach(b=>b.onclick=async()=>{
    const n=ST.notifs[+b.dataset.prev];b.textContent='Loading...';
    try{const r=await api('POST','/api/admin/preview-email',{event:n.event,subject:n.subject,body:n.body});b.textContent='Preview email';
      const w=document.createElement('div');w.className='modal';
      w.innerHTML=`<div class="card" style="width:min(680px,100%);padding:0;overflow:hidden"><div style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)"><b style="flex:1;color:var(--dg)">${esc(r.subject)}</b><button class="btn sm" id="pvx">Close</button></div><iframe id="pvf" style="width:100%;height:min(78vh,760px);border:0;background:#F5F4F0"></iframe></div>`;
      document.body.appendChild(w);$('#pvf').srcdoc=r.html;$('#pvx').onclick=()=>w.remove();w.onclick=e=>{if(e.target===w)w.remove()}}
    catch(e){b.textContent='Preview email';toast(e.message,1)}});
  $('#saveAll').onclick=saveAll;
}

/* general */
function tabGeneral(){
  const g=ST.general;
  $('#sbody').innerHTML=`<div class="card"><h2>General and security</h2><div class="frm">
   ${fld('Site name',inp('gn',g.siteName))}
   ${fld('Site address (used in email links)',inp('gb',g.baseUrl,'placeholder="http://server-ip:5080"')+'<p class="hint" id="gbh" style="margin:6px 0 0"></p>')}
   ${fld('Sign out after idle minutes',inp('gi',g.idleMinutes,'type="number" min="1"'))}
   ${fld('PIN length (4 to 8 digits)',inp('gp',g.pinLength,'type="number" min="4" max="8"'))}
   ${fld('Failed PIN tries before lock',inp('gm',g.maxFailed,'type="number" min="1"'))}
   ${fld('Lock minutes',inp('gl',g.lockMinutes,'type="number" min="1"'))}
   ${fld('Reviews needed',`<select id="gr"><option value="all" ${g.reviewRule==='all'?'selected':''}>Every reviewer must approve</option><option value="any" ${g.reviewRule==='any'?'selected':''}>Any one reviewer is enough</option></select>`)}</div>
   <p class="hint">Changing PIN length only affects PINs set after the change. Existing PINs keep working until reset.</p></div>
   <div class="card" style="margin-top:16px"><h2>Demo data</h2><p class="hint" style="margin:0 0 12px">Load five sample packets: three from your real scanned PDFs (Arkansas coils, Berkeley beams, Delta tube and beams) and two built-in ones that use every inspection sheet type (coil, flat sheet, flat bar, beam, tube). Also adds four demo users (Receiver One, Receiver Two, Demo Coordinator, Demo Reviewer). Loading only works while there are no packets.</p>
   <div class="bar" style="margin:0"><button class="btn" id="seed">Load demo data</button><button class="btn" id="clrdemo">Clear demo data</button><button class="btn danger" id="clrall">Delete ALL packets</button></div>
   <p class="hint" style="margin:10px 0 0"><b>Clear demo data</b> removes only the sample packets and demo users. <b>Delete ALL packets</b> removes every packet, including ones you made, and cannot be undone. Users and settings are kept.</p><p id="seedmsg" class="muted" style="margin:8px 0 0"></p></div>
   <div class="card" style="margin-top:16px;border:2px solid #a32428"><h2 style="color:#a32428">Scorched earth</h2>
   <p class="hint" style="margin:0 0 12px">Wipes the whole system back to empty: every packet, every PIN user, all history, every stored PDF, final packet and photo. Admins and the settings on these tabs are kept. There is no undo.</p>
   <div class="bar" style="margin:0"><button class="btn danger" id="scorch">Scorched earth...</button></div></div>${saveBar()}`;
  const demoCall=async(path,label,confirmText)=>{
    if(confirmText&&!confirm(confirmText))return;
    const m=$('#seedmsg');m.className='muted';m.textContent=label+'...';
    try{const r=await api('POST','/api/admin/'+path,{});SUsers=await api('GET','/api/admin/users');
      m.textContent=path==='seed-demo'?'Loaded. PINs: '+r.users:path==='clear-demo'?'Cleared '+r.packets+' demo packets and '+r.users+' demo users.':'Deleted '+r.packets+' packets.'}
    catch(e){m.className='err';m.textContent=e.message}};
  $('#clrdemo').onclick=()=>demoCall('clear-demo','Clearing','Remove the sample packets and demo users?');
  $('#clrall').onclick=()=>demoCall('clear-packets','Deleting','Delete ALL packets, including ones you created? This cannot be undone.');
  $('#scorch').onclick=()=>scorchFlow();
  $('#seed').onclick=async()=>{const m=$('#seedmsg');m.className='muted';m.textContent='Loading...';try{const r=await api('POST','/api/admin/seed-demo',{});m.textContent='Loaded. PINs: '+r.users;SUsers=await api('GET','/api/admin/users')}catch(e){m.className='err';m.textContent=e.message}};
  [['gn','siteName'],['gb','baseUrl'],['gr','reviewRule']].forEach(([i,k])=>bind(i,g,k));[['gi','idleMinutes'],['gp','pinLength'],['gm','maxFailed'],['gl','lockMinutes']].forEach(([i,k])=>bind(i,g,k,true));
  const here=location.origin,gh=$('#gbh');
  const upd=()=>{const v=g.baseUrl||'';
    gh.innerHTML=(!v||/localhost|127\.0\.0\.1/i.test(v))
      ?`<span class="err">Emails link to this address, so it must be what people type to reach the app, like http://server-ip:5080.</span> <a href="#" id="gbuse" style="color:var(--mg);font-weight:bold">Use ${esc(here)}</a>`
      :'Links in emails open the app at this address.';
    const u=$('#gbuse');if(u)u.onclick=e=>{e.preventDefault();$('#gb').value=here;g.baseUrl=here;upd()}};
  $('#gb').addEventListener('input',upd);upd();
  $('#saveAll').onclick=saveAll;
}

/* outbox + audit */
async function tabOutbox(){
  const rows=await api('GET','/api/admin/outbox');
  $('#sbody').innerHTML=`<div class="card"><h2>Sent mail (latest 100)</h2><table class="list"><thead><tr><th>When</th><th>To</th><th>Subject</th><th>Status</th><th></th></tr></thead><tbody>
  ${rows.length?rows.map(r=>`<tr><td>${fdate(r.created)}</td><td>${esc(r.to)}</td><td>${esc(r.subject)}</td><td><span class="chip ${r.status==='sent'?'on':r.status==='failed'?'bad':'pend'}">${r.status}</span>${r.error?`<div class="hint err">${esc(r.error)}</div>`:''}</td><td>${r.status!=='sent'?`<button class="btn sm" data-r="${r.id}">Retry</button>`:''}</td></tr>`).join(''):'<tr><td colspan="5" class="empty">No mail yet.</td></tr>'}</tbody></table></div>`;
  $$('[data-r]').forEach(b=>b.onclick=async()=>{await api('POST','/api/admin/outbox/'+b.dataset.r+'/retry',{});toast('Queued again');tabOutbox()});
}
/* backups */
async function tabBackups(){
  const g=ST.general;let info={folder:'',files:[]};
  try{info=await api('GET','/api/admin/backups')}catch(e){}
  $('#sbody').innerHTML=`<div class="card"><h2>Backups</h2>
   <p class="hint" style="margin:0 0 12px">Each backup is one zip with a safe copy of the database, every packet PDF, the saved final packets and the encryption keys. Restoring means unzipping it into the data folder while the app is stopped.</p>
   <div class="frm12">
    <div class="fld c4"><label>Nightly backup</label><div class="checks" style="min-height:44px"><label><input type="checkbox" id="be" ${g.backupEnabled?'checked':''}> On</label></div></div>
    ${fld('Time (24 hour)',inp('bt',g.backupTime,'type="time"'),'c2')}
    ${fld('Keep this many backups',inp('bk',g.backupKeep,'type="number" min="1"'),'c2')}
    ${fld('Folder (blank = data\\backups)',inp('bf',g.backupFolder,'placeholder="E:\\Backups\\Receiving"'),'c4')}
   </div>
   <p class="hint" style="margin-top:10px">Best to point this at a different drive or a network share, so one disk failure cannot take the data and its backups together. The app pool identity needs write access to that folder.</p></div>
   <div class="card" style="margin-top:16px"><div style="display:flex;align-items:center;gap:12px;margin-bottom:10px"><h2 style="margin:0;flex:1">Backup files</h2><button class="btn pri" id="bnow">Back up now</button><span id="bmsg" class="tres"></span></div>
   <p class="hint" style="margin:0 0 8px">Folder: ${esc(info.folder)}</p>
   <table class="list"><thead><tr><th>File</th><th>Size</th><th>When</th><th></th></tr></thead><tbody>
   ${info.files.length?info.files.map(f=>`<tr><td class="b">${esc(f.name)}</td><td>${(f.size/1048576).toFixed(1)} MB</td><td>${fdate(f.time)}</td><td style="text-align:right"><a class="btn sm" href="/api/admin/backups/${encodeURIComponent(f.name)}">${ic('dl')} Download</a></td></tr>`).join(''):'<tr><td colspan="4" class="empty">No backups yet.</td></tr>'}</tbody></table></div>${saveBar()}`;
  [['bt','backupTime'],['bf','backupFolder']].forEach(([i,k])=>bind(i,g,k));bind('bk',g,'backupKeep',true);bind('be',g,'backupEnabled');
  $('#saveAll').onclick=saveAll;
  $('#bnow').onclick=async()=>{const m=$('#bmsg');m.className='tres';m.textContent='Backing up...';try{const r=await api('POST','/api/admin/backups/run',{});m.className='tres okmsg';m.textContent='Saved '+r.file;tabBackups()}catch(e){m.className='tres err';m.textContent=e.message}};
}

/* audit log with search */
async function tabAudit(q='',actor='',action=''){
  const qs=new URLSearchParams({q,actor,action});[...qs.keys()].forEach(k=>{if(!qs.get(k))qs.delete(k)});
  const d=await api('GET','/api/admin/audit?'+qs);
  $('#sbody').innerHTML=`<div class="card"><h2>Audit log</h2>
   <div class="frm12" style="margin-bottom:12px">
    <div class="fld c4"><label>Search</label><input id="aq" value="${esc(q)}" placeholder="BOL, user, anything"></div>
    <div class="fld c3"><label>Who</label><input id="aw" value="${esc(actor)}"></div>
    <div class="fld c3"><label>Action</label><select id="aa"><option value="">All</option>${d.actions.map(a=>`<option ${a===action?'selected':''}>${esc(a)}</option>`).join('')}</select></div>
    <div class="fld c2"><label>&nbsp;</label><button class="btn pri" id="ago" style="width:100%">Search</button></div></div>
   <p class="hint" style="margin:0 0 8px">Newest 300 matches.</p>
   <table class="list"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${d.rows.length?d.rows.map(r=>`<tr><td>${fdate(r.ts)}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join(''):'<tr><td colspan="4" class="empty">Nothing matches.</td></tr>'}</tbody></table></div>`;
  const go=()=>tabAudit($('#aq').value,$('#aw').value,$('#aa').value);
  $('#ago').onclick=go;['aq','aw'].forEach(i=>$('#'+i).addEventListener('keydown',e=>{if(e.key==='Enter')go()}));$('#aa').onchange=go;
}

/* status */
async function tabStatus(){
  $('#sbody').innerHTML='<div class="card empty">Loading...</div>';
  let d;try{d=await api('GET','/api/admin/status')}catch(e){$('#sbody').innerHTML='<div class="card empty err">'+esc(e.message)+'</div>';return}
  const tile=(label,val,sub,state)=>`<div class="stat" style="cursor:default;${state==='bad'?'outline:3px solid var(--red);outline-offset:-1px':state==='warn'?'outline:3px solid #e3b25a;outline-offset:-1px':''}"><div class="n" style="font-size:24px">${val}</div><div class="l">${label}${sub?'<br><span class="muted">'+sub+'</span>':''}</div></div>`;
  const total=d.packets.reduce((a,b)=>a+b.n,0),diskLow=d.diskFreeGB!=null&&d.diskFreeGB<5;
  const lastB=d.backup.last||'never',stale=d.backup.enabled&&d.backup.last&&(Date.now()-new Date(d.backup.last+'T00:00:00').getTime())>2*864e5;
  $('#sbody').innerHTML=`<div class="stats" style="grid-template-columns:repeat(auto-fit,minmax(190px,1fr))">
   ${tile('Packets',total,d.users+' active users')}
   ${tile('Disk free',d.diskFreeGB==null?'?':d.diskFreeGB+' GB',d.diskTotalGB?'of '+d.diskTotalGB+' GB':'',diskLow?'bad':'')}
   ${tile('Database',d.dbMB+' MB','up '+d.uptimeHours+' h')}
   ${tile('Last backup',lastB,d.backup.enabled?'nightly at '+esc(d.backup.time):'switched off',!d.backup.enabled||stale?'warn':'')}
   ${tile('Mail failed',d.mail.failed,d.mail.pending+' waiting, '+d.mail.sentToday+' sent today',d.mail.failed?'bad':(!d.mail.smtpSet?'warn':''))}
   ${tile('DocuWare folder',d.drop.enabled?(d.drop.failures24h?d.drop.failures24h+' failed':'on'):'off',d.drop.enabled?esc(d.drop.folder):'',d.drop.failures24h?'bad':'')}
   ${tile('PO list',d.poLines||'none',d.poLines?'lines loaded':'not imported')}</div>
  <div class="card" style="margin-top:16px"><h2>About this server</h2>
   <div class="kv"><div><label>Version</label><div>${esc(d.version)}</div></div><div><label>Data folder</label><div style="font-size:13px;word-break:break-all">${esc(d.dataDir)}</div></div></div>
   <p class="hint" style="margin-top:10px">Alerts go to every admin with an email and to the addresses in Settings > Integrations, once a day per problem: failed mail, no backup for 2 days, failed backup, failed folder copy, and under 5 GB of disk.</p></div>`;
}

/* integrations: alerts, DocuWare folder drop, DocuWare columns, PO list */
async function tabIntegrations(){
  const g=ST.general;let dw={columns:[],sources:[]},po={lines:0,pos:0,sample:[]};
  try{[dw,po]=await Promise.all([api('GET','/api/admin/docuware'),api('GET','/api/admin/po-list')])}catch(e){}
  const SRC={bol:'BOL #',vendor:'Vendor',ship:'Ship date',carrier:'Carrier',po:'PO #',heat:'Heat #',coil:'Coil / bundle #',cc:'CC # (NBS#)',desc:'Description',len:'Length',wt:'Weight',d365:'D365 receipt #',authBy:'Authorized by',authAt:'Authorized on',const:'Fixed text'};
  let cols=dw.columns.map(c=>({...c}));
  const drawCols=()=>{
    $('#dwrows').innerHTML=cols.map((c,i)=>`<tr><td><input data-dc="${i}" data-f="header" value="${esc(c.header)}"></td><td><select data-dc="${i}" data-f="source">${dw.sources.map(k=>`<option value="${k}" ${c.source===k?'selected':''}>${SRC[k]||k}</option>`).join('')}</select></td><td><input data-dc="${i}" data-f="const" value="${esc(c.const||'')}" ${c.source==='const'?'':'disabled'} placeholder="${c.source==='const'?'Text to put in every row':''}"></td>
      <td style="white-space:nowrap"><button class="btn sm" data-up="${i}">&uarr;</button> <button class="btn sm" data-dn="${i}">&darr;</button> <button class="btn sm" data-del="${i}">&times;</button></td></tr>`).join('');
    $$('#dwrows [data-dc]').forEach(el=>el.onchange=el.oninput=()=>{const c=cols[+el.dataset.dc];c[el.dataset.f]=el.value;if(el.dataset.f==='source')drawCols()});
    $$('#dwrows [data-up]').forEach(b=>b.onclick=()=>{const i=+b.dataset.up;if(i>0){[cols[i-1],cols[i]]=[cols[i],cols[i-1]];drawCols()}});
    $$('#dwrows [data-dn]').forEach(b=>b.onclick=()=>{const i=+b.dataset.dn;if(i<cols.length-1){[cols[i+1],cols[i]]=[cols[i],cols[i+1]];drawCols()}});
    $$('#dwrows [data-del]').forEach(b=>b.onclick=()=>{cols.splice(+b.dataset.del,1);drawCols()});
  };
  $('#sbody').innerHTML=`
  <div class="card"><h2>Alerts</h2><p class="hint" style="margin:0 0 10px">Admins with an email on the Admins tab are always told. Add anyone else here.</p>
   <div class="frm12">${fld('Extra alert addresses (comma separated)',inp('ga',g.alertEmails,'placeholder="it@company.com"'),'c12')}</div></div>
  <div class="card" style="margin-top:16px"><h2>Copy final packets to a folder</h2><p class="hint" style="margin:0 0 10px">When a packet is authorized, its final PDF (and the index CSV) is also copied here, for example the folder DocuWare already watches. The app pool identity needs write access to it.</p>
   <div class="frm12"><div class="fld c3"><label>Copy on filing</label><div class="checks" style="min-height:44px"><label><input type="checkbox" id="gde" ${g.dropEnabled?'checked':''}> On</label></div></div>
    ${fld('Folder',inp('gdf',g.dropFolder,'placeholder="\\\\fileserver\\docuware\\inbox"'),'c5')}
    ${fld('File name ({bol} {vendor} {date})',inp('gdn',g.dropName),'c4')}
    <div class="fld c12"><div class="checks"><label><input type="checkbox" id="gdc" ${g.dropCsv?'checked':''}> Also copy the index CSV next to it</label></div></div></div>
   <div class="bar"><button class="btn" id="gdt">Test the folder</button><span id="gdr" class="tres"></span></div></div>
  <div class="card" style="margin-top:16px"><h2>DocuWare index columns</h2><p class="hint" style="margin:0 0 10px">The CSV for each packet has one row per item with these columns, in this order. Rename the headers to match the fields in your DocuWare cabinet.</p>
   <table class="cells" style="min-width:0;width:100%"><thead><tr><th>Header in the CSV</th><th>Value</th><th>Fixed text</th><th></th></tr></thead><tbody id="dwrows"></tbody></table>
   <div class="bar"><button class="btn" id="dwadd">${ic('plus')} Add column</button><button class="btn pri" id="dwsave">Save columns</button><button class="btn" id="dwreset">Back to default</button><span id="dwr" class="tres"></span></div></div>
  <div class="card" style="margin-top:16px"><h2>PO list (from D365)</h2><p class="hint" style="margin:0 0 10px">Upload a CSV export of open purchase orders. New packets are then checked: a PO that is not in the list is flagged at intake. Needs a PO column (PO, PurchId or PO Number); Vendor, Item, Description, Qty and Unit are optional. Uploading replaces the old list.</p>
   <div class="bar" style="margin:0"><label class="btn pri" style="cursor:pointer">${ic('dl')} Upload CSV<input type="file" id="pof" accept=".csv,text/csv" hidden></label><button class="btn danger" id="pocl" ${po.lines?'':'disabled'}>Clear list</button><span id="por" class="tres">${po.lines?po.lines+' lines, '+po.pos+' POs, loaded '+esc(po.imported||''):'No list loaded'}</span></div>
   ${po.sample&&po.sample.length?`<table class="lines" style="margin-top:10px"><thead><tr><th>PO</th><th>Vendor</th><th>Item</th><th>Description</th><th>Qty</th></tr></thead><tbody>${po.sample.map(r=>`<tr><td>${esc(r.po)}</td><td>${esc(r.vendor)}</td><td>${esc(r.item)}</td><td>${esc(r.descr)}</td><td>${r.qty} ${esc(r.uom)}</td></tr>`).join('')}</tbody></table>`:''}</div>${saveBar()}`;
  [['ga','alertEmails'],['gdf','dropFolder'],['gdn','dropName']].forEach(([i,k])=>bind(i,g,k));bind('gde',g,'dropEnabled');bind('gdc',g,'dropCsv');
  $('#saveAll').onclick=saveAll;
  drawCols();
  $('#dwadd').onclick=()=>{cols.push({header:'',source:'bol',const:''});drawCols()};
  $('#dwreset').onclick=async()=>{if(!confirm('Go back to the default columns?'))return;cols=[['BOL #','bol'],['Vendor','vendor'],['Ship date','ship'],['PO #','po'],['Heat #','heat'],['Mill coil / bundle #','coil'],['CC # (NBS#)','cc'],['Description','desc'],['Length','len'],['Weight','wt'],['D365 receipt #','d365'],['Authorized by','authBy']].map(([header,source])=>({header,source,const:''}));drawCols()};
  $('#dwsave').onclick=async()=>{const r=$('#dwr');try{await api('PUT','/api/admin/docuware',{columns:cols});r.className='tres okmsg';r.textContent='Saved'}catch(e){r.className='tres err';r.textContent=e.message}};
  $('#gdt').onclick=async()=>{const r=$('#gdr');r.className='tres';r.textContent='Saving and testing...';try{await saveAll();const x=await api('POST','/api/admin/drop-test',{});r.className='tres okmsg';r.textContent='Wrote '+x.file}catch(e){r.className='tres err';r.textContent=e.message}};
  $('#pof').onchange=async e=>{const f=e.target.files[0];if(!f)return;const r=$('#por');r.className='tres';r.textContent='Importing...';try{const x=await api('POST','/api/admin/po-import',{csv:await f.text()});toast('Imported '+x.lines+' lines for '+x.pos+' POs');tabIntegrations()}catch(x){r.className='tres err';r.textContent=x.message}};
  $('#pocl').onclick=async()=>{if(!confirm('Clear the PO list?'))return;await api('DELETE','/api/admin/po-list');tabIntegrations()};
}


/* scorched earth: three screens, a typed phrase and a countdown; the server checks all of it again */
function scorchFlow(){
  const w=document.createElement('div');w.className='pinwrap';document.body.appendChild(w);
  const close=()=>w.remove();
  const box=h=>{w.innerHTML=`<div class="pinbox" style="width:min(560px,96vw);text-align:left;max-height:92vh;overflow:auto">${h}</div>`};
  const step1=()=>{
    box(`<h2 style="color:#a32428;margin:0 0 8px">Scorched earth</h2>
    <p style="margin:0 0 10px"><b>This permanently deletes:</b></p>
    <ul style="margin:0 0 12px;padding-left:20px;line-height:1.6"><li>every packet, inspection, review and approval</li><li>every PIN user (receivers, coordinators, reviewers)</li><li>all activity history and the sent mail list</li><li>every stored PDF, final packet and photo</li><li>saved layouts and the imported PO list</li></ul>
    <p style="margin:0 0 12px"><b>Kept:</b> the admin list and the settings (email server, folders, notifications). Files already copied to the DocuWare folder are not touched. One line recording that this happened is kept in the history.</p>
    <label class="ck" style="display:flex;gap:10px;align-items:center;margin:0 0 10px"><input type="checkbox" id="sc_bk"> Also delete the backup files (zips). This removes your safety net.</label>
    <label class="ck" style="display:flex;gap:10px;align-items:flex-start;margin:0 0 16px"><input type="checkbox" id="sc_ok" style="margin-top:4px"> <span>I understand that everything listed above will be gone for good and that there is no undo.</span></label>
    <div class="bar" style="margin:0;justify-content:flex-end"><button class="btn" id="sc_x">Cancel</button><button class="btn danger" id="sc_n" disabled>Continue</button></div>`);
    $('#sc_x',w).onclick=close;
    $('#sc_ok',w).onchange=e=>{$('#sc_n',w).disabled=!e.target.checked};
    $('#sc_n',w).onclick=()=>step2($('#sc_bk',w).checked);
  };
  const step2=async bk=>{
    let tk;
    try{tk=await api('POST','/api/admin/scorch/token',{})}catch(e){toast(e.message,1);return close()}
    box(`<h2 style="color:#a32428;margin:0 0 8px">Last check</h2>
    <p style="margin:0 0 12px">Type <b>${esc(tk.phrase)}</b> exactly, then wait for the countdown. ${bk?'<b>Backups will be deleted too.</b>':'Backups are kept.'}</p>
    <input id="sc_t" autocomplete="off" spellcheck="false" placeholder="${esc(tk.phrase)}" style="width:100%;min-height:52px;font-size:18px;padding:0 14px;border:2px solid #a32428;border-radius:8px">
    <p id="sc_m" class="err" style="min-height:22px;margin:10px 0"></p>
    <div class="bar" style="margin:0;justify-content:flex-end"><button class="btn" id="sc_x">Cancel</button><button class="btn danger" id="sc_go" disabled>Wait ${tk.waitSeconds}...</button></div>`);
    $('#sc_x',w).onclick=close;
    let left=tk.waitSeconds;const go=$('#sc_go',w),inp=$('#sc_t',w);
    const ready=()=>{const ok=left<=0&&inp.value===tk.phrase;go.disabled=!ok;go.textContent=left>0?'Wait '+left+'...':'Delete everything now'};
    const timer=setInterval(()=>{left--;if(!document.body.contains(w))return clearInterval(timer);if(left<=0)clearInterval(timer);ready()},1000);
    inp.oninput=ready;inp.focus();
    go.onclick=async()=>{go.disabled=true;go.textContent='Deleting...';
      try{const r=await api('POST','/api/admin/scorch',{token:tk.token,phrase:inp.value,backups:bk});
        box(`<h2 style="margin:0 0 8px">Done</h2><p style="margin:0 0 12px">Deleted ${r.packets} packets, ${r.users} users, ${r.history} history entries, ${r.files} files${r.backups?' and '+r.backups+' backup files':''}.</p><div class="bar" style="margin:0;justify-content:flex-end"><button class="btn pri" id="sc_d">OK</button></div>`);
        $('#sc_d',w).onclick=()=>{close();location.reload()};
      }catch(e){$('#sc_m',w).textContent=e.message;go.textContent='Failed'}};
  };
  step1();
}
