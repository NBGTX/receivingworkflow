/* admin settings panel */
let ST=null,STab='users',SUsers=[];
const ROLES=[['receiver','Receiver / inspector'],['coordinator','Intake coordinator'],['reviewer','Reviewer']];
const TOKENS='{{bol}} {{vendor}} {{pos}} {{items}} {{actor}} {{d365}} {{stage}} {{link}}';

async function viewSettings(){
  $('#app').innerHTML='<div class="card empty">Loading settings...</div>';
  try{[ST,SUsers]=await Promise.all([api('GET','/api/admin/settings'),api('GET','/api/admin/users')])}catch(e){$('#app').innerHTML='<div class="card empty err">'+esc(e.message)+'</div>';return}
  drawSettings();
}
function drawSettings(){
  const tabs=[['users','Users'],['admins','Admins'],['email','Email server'],['notifs','Notifications'],['general','General & security'],['outbox','Sent mail'],['audit','Audit log']];
  $('#app').innerHTML=`<div class="pagehead"><div class="grow"><h1>Settings</h1><p>Admin only. Changes apply right away after you save.</p></div></div>
  <div class="stabs">${tabs.map(([k,l])=>`<button data-t="${k}" class="${STab===k?'on':''}">${l}</button>`).join('')}</div><div id="sbody"></div>`;
  $$('.stabs button').forEach(b=>b.onclick=()=>{STab=b.dataset.t;drawSettings()});
  ({users:tabUsers,admins:tabAdmins,email:tabEmail,notifs:tabNotifs,general:tabGeneral,outbox:tabOutbox,audit:tabAudit})[STab]();
}
const fld=(label,html,cls='')=>`<div class="fld ${cls}"><label>${label}</label>${html}</div>`;
const inp=(id,val,extra='')=>`<input id="${id}" value="${esc(val??'')}" ${extra}>`;
function saveBar(){return `<div class="savebar"><button class="btn pri" id="saveAll">Save settings</button><span id="smsg" class="muted"></span></div>`}
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
function userModal(u){
  const L=S.cfg.pinLength,w=document.createElement('div');w.className='modal';
  w.innerHTML=`<div class="card"><h2>${u?'Edit user':'Add user'}</h2><div class="frm">
   ${fld('Name',inp('un',u?.name))}${fld('Initials (shown on inspections)',inp('ui',u?.initials,'maxlength="4"'))}${fld('Email (for notifications)',inp('ue',u?.email,'type="email"'),'span2')}
   <div class="fld span2"><label>Roles</label><div class="checks">${ROLES.map(([k,l])=>`<label><input type="checkbox" name="role" value="${k}" ${u?.roles.includes(k)?'checked':''}> ${l}</label>`).join('')}</div></div>
   ${fld(u?.pinSet?`Reset PIN (${L} digits, leave blank to keep)`:`PIN (${L} digits)`,inp('up','','inputmode="numeric" maxlength="'+L+'" autocomplete="off"'))}
   ${u?`<div class="fld"><label>Status</label><div class="checks"><label><input type="checkbox" id="ua" ${u.active?'checked':''}> Active</label>${u.locked?'<label><input type="checkbox" id="uk"> Unlock</label>':''}</div></div>`:''}</div>
   <p class="err" id="uerr"></p><div class="bar"><button class="btn pri" id="usave">Save</button><button class="btn" id="ucancel">Cancel</button></div></div>`;
  document.body.appendChild(w);$('#ucancel').onclick=()=>w.remove();
  $('#usave').onclick=async()=>{
    const body={name:$('#un').value,initials:$('#ui').value,email:$('#ue').value,roles:$$('[name=role]:checked').map(x=>x.value),pin:$('#up').value,active:u?$('#ua').checked:true,unlock:$('#uk')?.checked};
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
   <p class="hint" style="margin:10px 0 0"><b>Clear demo data</b> removes only the sample packets and demo users. <b>Delete ALL packets</b> removes every packet, including ones you made, and cannot be undone. Users and settings are kept.</p><p id="seedmsg" class="muted" style="margin:8px 0 0"></p></div>${saveBar()}`;
  const demoCall=async(path,label,confirmText)=>{
    if(confirmText&&!confirm(confirmText))return;
    const m=$('#seedmsg');m.className='muted';m.textContent=label+'...';
    try{const r=await api('POST','/api/admin/'+path,{});SUsers=await api('GET','/api/admin/users');
      m.textContent=path==='seed-demo'?'Loaded. PINs: '+r.users:path==='clear-demo'?'Cleared '+r.packets+' demo packets and '+r.users+' demo users.':'Deleted '+r.packets+' packets.'}
    catch(e){m.className='err';m.textContent=e.message}};
  $('#clrdemo').onclick=()=>demoCall('clear-demo','Clearing','Remove the sample packets and demo users?');
  $('#clrall').onclick=()=>demoCall('clear-packets','Deleting','Delete ALL packets, including ones you created? This cannot be undone.');
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
async function tabAudit(){
  const rows=await api('GET','/api/admin/audit');
  $('#sbody').innerHTML=`<div class="card"><h2>Audit log (latest 200)</h2><table class="list"><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Detail</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${fdate(r.ts)}</td><td>${esc(r.actor)}</td><td>${esc(r.action)}</td><td>${esc(r.detail)}</td></tr>`).join('')}</tbody></table></div>`;
}
