/* intake helpers: read the page for suggestions, and reuse a vendor's saved layout */

/* ---------- reading a BOL page: pull out the likely values ---------- */
const RX={
  po:/\bT[XKR][-–—_ ]?\s?([0-9OoDQ]{7})\b/i,
  cc:/\bC\s?C\s?#?\s*[:.]?\s*(\d{5,7})\b/i,
  heat:/\bheat\s*(?:numbers?|#|no\.?)?\s*[:#.]?\s*([A-Za-z0-9]{5,9})/i,
  coil:/\b(\d{7}\.\d{4})\b/,
  bundle:/^\s*(\d{8})\b/,
  len:/\b(\d{1,3})\s*['’°]\s*-?\s*(\d{1,2})?\s*["”]?/,
  lenNum:/\b(\d{3,5})\.000\b/,
  wt:/\b(\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d{4,6}\.\d{2})\b/,
};
const fixPo=d=>'TX-'+d.replace(/[OoDQ]/g,'0');

function parseBol(text){
  const lines=text.split('\n').map(s=>s.replace(/\s+/g,' ').trim()).filter(Boolean);
  const full=lines.join('\n'),out={bol:'',vendor:'',ship:'',carrier:'',pos:[],rows:[]};
  let m=full.match(/(?:bill\s+of\s+lading|b\.?\s?o\.?\s?l\.?)\s*(?:no\.?|number|#)\s*[:.#]?\s*(\d{5,10})/i)||full.match(/bill\s+of\s+lading\s*no\.?[\s\S]{0,140}?\b(\d{6,8})\b/i);if(m)out.bol=m[1];
  m=full.match(/(?:ship(?:ped|ping)?\s*date|date)\s*[:.]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i)||full.match(/\b(\d{1,2}\/\d{1,2}\/\d{2,4})\b/);if(m)out.ship=m[1];
  m=full.match(/(?:^|\n|\s)from\s*[:.]?\s*([^\n]{4,70})/i);
  if(m)out.vendor=m[1].replace(/\b(telephone|phone|tel|date|at)\b.*$/i,'').replace(/\s{2,}.*$/,'').trim();
  m=full.match(/^[ \t]*carrier[ \t]*[:.]?[ \t]*([A-Za-z0-9][^\n]{2,140})$/im);if(m)out.carrier=m[1].replace(/\b(bol|vehicle|trailer|load|car or)\b.*$/i,'').trim();
  out.pos=[...new Set([...full.matchAll(new RegExp(RX.po.source,'gi'))].map(x=>fixPo(x[1])))];

  let cur=null,lastPo='';
  const has=r=>r&&(r.cc||r.heat||r.coil);
  const flush=()=>{if(has(cur))out.rows.push(cur);cur=null};
  const fresh=po=>({po:po||lastPo,heat:'',coil:'',cc:'',desc:'',len:'',wt:''});
  for(const ln of lines){
    const po=ln.match(RX.po);
    if(po){flush();lastPo=fixPo(po[1]);cur=fresh(lastPo)}
    const bundle=!po?null:ln.match(RX.bundle); // Berkeley style: bundle number leads the line
    if(!cur)cur=fresh();
    if(bundle&&!cur.coil)cur.coil=bundle[1];
    const coil=ln.match(RX.coil);if(coil&&!cur.coil)cur.coil=coil[1];
    const cc=ln.match(RX.cc);
    if(cc){if(cur.cc){flush();cur=fresh()}cur.cc=cc[1]}
    const heat=ln.match(RX.heat);
    if(heat){if(cur.heat&&cur.cc){flush();cur=fresh()}cur.heat=heat[1];
      // handwritten CC often follows the heat on the same line
      const after=ln.slice(ln.toLowerCase().indexOf(heat[1].toLowerCase())+heat[1].length).match(/\b(\d{6})\b/);
      if(after&&!cur.cc&&after[1]!==heat[1])cur.cc=after[1];}
    const len=ln.match(RX.len);if(len&&!cur.len)cur.len=len[1]+"' "+(parseInt(len[2]||'0',10))+'"';
    else{const ln2=ln.match(RX.lenNum);if(ln2&&!cur.len)cur.len=ln2[1]}
    const wt=ln.match(RX.wt);if(wt&&!cur.wt&&!/\.000$/.test(wt[1]))cur.wt=wt[1].replace(/\.00$/,'');
    if(!cur.desc){
      let d=ln.match(/(\.\d{3,4}\s*(?:MIN\s*)?X\s*\d+\.\d+(?:\s*MIN)?)/i)
        ||ln.match(/\b(W\d{1,2}\s*[xX]\s*\d{1,3}(?:\.\d)?)/)
        ||ln.match(/\b((?:TUBING|CHANNEL|WIDE FLANGE|ANGLE|BEAM|PIPE|PLATE|BAR)\b[^\n]*?)(?=\s+CC|\s+\d+\s*['’]|\s+\d{1,3},\d{3}|$)/i);
      if(d)cur.desc=d[1].trim();
    }
  }
  flush();
  const seen=new Set();out.rows=out.rows.filter(r=>{const k=r.cc||r.coil+'|'+r.heat;if(seen.has(k))return false;seen.add(k);return true});
  return out;
}

/* ---------- suggestions UI ---------- */
let SUG=null,layoutList=[];
function injectExtras(){
  $('#ocr').insertAdjacentHTML('afterend','<div id="sug"></div>');
  $('.ix .fh').insertAdjacentHTML('beforebegin',`<div class="vtool layoutbar"><span class="muted" style="font-size:13px">Saved layout</span><select id="laySel"><option value="">None</option></select><button class="btn sm" id="layApply">Apply</button><button class="btn sm danger" id="layDel">Delete</button></div>`);
  $('#layApply').onclick=applyLayout;
  extraChecks();
  $('#layDel').onclick=async()=>{const n=$('#laySel').value;if(!n)return;if(!confirm('Delete the saved layout for '+n+'?'))return;try{await api('DELETE','/api/layouts/'+encodeURIComponent(n));await loadLayouts();toast('Layout deleted')}catch(e){toast(e.message,1)}};
  loadLayouts();
}
async function loadLayouts(){
  try{layoutList=await api('GET','/api/layouts')}catch(e){layoutList=[]}
  const sel=$('#laySel');if(!sel)return;const cur=sel.value;
  sel.innerHTML='<option value="">None</option>'+layoutList.map(l=>`<option>${esc(l.name)}</option>`).join('');sel.value=cur;
}
const _viewNew=viewNew;
viewNew=function(){SUG=null;_viewNew();injectExtras()};
const _openData=openData;
openData=async function(buf){await _openData(buf);scanPage()};

async function scanPage(){
  if(!pdf)return;
  const myPage=pageNo,box=$('#sug');if(!box)return;
  box.innerHTML='<div class="sug busy">Reading this page for suggestions. You can keep working.</div>';
  try{
    const pg=await pdf.getPage(myPage);
    const vp=pg.getViewport({scale:2.6,rotation:((pg.rotate||0)+(rot[myPage]||0))%360});
    const c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
    await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    const text=await ocrQ(async()=>{const w=await getWorker();await w.setParameters({tessedit_pageseg_mode:'3'});const {data}=await w.recognize(c);return data.text});
    SUG=parseBol(text);SUG.text=text;SUG.page=myPage;await applyFixes();showSuggestions();
  }catch(e){box.innerHTML='<div class="sug err">Could not read the page: '+esc(e.message)+'</div>'}
}

function showSuggestions(){
  const box=$('#sug');if(!box||!SUG)return;
  const chip=(label,val,field)=>val?`<button class="chip sg" data-sgf="${field}" data-sgv="${esc(val)}">${esc(label)} <b>${esc(val)}</b></button>`:'';
  const hit=layoutList.find(l=>SUG.text.toLowerCase().includes(l.name.toLowerCase()));
  box.innerHTML=`<div class="sug"><div class="sgh">Suggestions from the page <span class="muted">(check each one)</span> <button class="btn sm" id="rescan">Read this page</button></div>
   <div class="sgc">${chip('BOL #',SUG.bol,'bol')}${chip('Vendor',SUG.vendor,'vendor')}${chip('Ship date',SUG.ship,'ship')}${chip('Carrier',SUG.carrier,'carrier')}${SUG.pos.map(p=>`<button class="chip sg" data-sgf="po" data-sgv="${esc(p)}">PO <b>${esc(p)}</b></button>`).join('')}</div>
   <div class="bar" style="margin:8px 0 0">${SUG.rows.length?`<button class="btn sm pri" id="sgrows">${$$('#rows tr').some(tr=>$$('input',tr).some(i=>i.value))?'Add':'Fill'} ${SUG.rows.length} row${SUG.rows.length===1?'':'s'} from the page</button>`:'<span class="muted">No item rows recognized on this page.</span>'}
   <button class="btn sm" id="sgheat">Check heats against the MTR pages</button>
   ${hit?`<button class="btn sm" id="sglay">Use saved layout: ${esc(hit.name)}</button>`:''}</div>${SUG.fixed?`<div class="muted" style="margin-top:6px">${SUG.fixed} value${SUG.fixed===1?'':'s'} corrected using fixes you made on earlier packets from this vendor.</div>`:''}<div id="heatres">${HEATRES}</div></div>`;
  $$('.sg',box).forEach(b=>b.onclick=()=>{
    const f=b.dataset.sgf,v=b.dataset.sgv;
    if(f==='po'){const el=($$('#rows [data-f=po]').find(i=>!i.value)||addRow().querySelector('[data-f=po]'));el.value=v;setActive(el.closest('tr').querySelector('[data-f=heat]'))}
    else{const el=$(`input[data-f=${f}]`);el.value=v;setActive(el)}
  });
  $('#rescan').onclick=scanPage;
  $('#sgheat').onclick=checkHeats;
  const r=$('#sgrows');if(r)r.onclick=()=>fillRowsFromPage();
  const l=$('#sglay');if(l)l.onclick=()=>{$('#laySel').value=hit.name;applyLayout()};
}
function fillRowsFromPage(){
  const trs=$$('#rows tr'),had=trs.some(tr=>$$('input',tr).some(i=>i.value));
  if(had&&!confirm('Add these '+SUG.rows.length+' rows after the rows you already have?'))return;
  trs.forEach(tr=>{if(!$$('input',tr).some(i=>i.value))tr.remove()});   // drop empty rows only, never typed ones
  SUG.rows.forEach(r=>addRow(r));
  while($$('#rows tr').length<2)addRow();
  ocrs((had?'Added ':'Filled ')+SUG.rows.length+' rows from page '+pageNo+'. Compare them with the PDF. Handwriting reads poorly, so retype those. For more pages, go to the page and click "Read this page".');
}

/* ---------- saved layouts: read each field from where it was last time ---------- */
async function applyLayout(){
  const name=$('#laySel').value;if(!name)return toast('Pick a layout first',1);
  if(!pdf)return toast('Open the PDF first',1);
  let lay;try{lay=await api('GET','/api/layouts/'+encodeURIComponent(name))}catch(e){return toast(e.message,1)}
  const entries=Object.entries(lay.picks||{});if(!entries.length)return toast('That layout is empty',1);
  const order=k=>['bol','vendor','ship','carrier'].includes(k)?0:1;entries.sort((a,b)=>order(a[0])-order(b[0]));
  ocrs('Applying layout "'+name+'"...',1);
  try{
    for(const [f,pk] of entries){
      if(pageNo!==pk.p||(rot[pk.p]||0)!==pk.rot){pageNo=pk.p;rot[pk.p]=pk.rot;await rend()}
      const cw=$('#cv').clientWidth,ch=$('#cv').clientHeight,b={x:pk.x*cw,y:pk.y*ch,w:pk.w*cw,h:pk.h*ch};
      const lines=await readBox(b,pk.multi);if(!lines.length)continue;
      if(pk.multi)fillColumn(f,lines);else{const el=$(`[data-f=${f}]`);if(el)el.value=clean(f,lines.join(' '))}
      picks[f]=pk;
    }
    pageNo=1;await rend();
    ocrs('Layout applied. Every value came from where it was last time, so check them against the PDF.');
  }catch(e){ocrs('Layout failed: '+e.message,2)}
}


/* ---------- duplicate BOL and PO list checks ---------- */
let HEATRES='',poMissing=[];
function extraChecks(){
  HEATRES='';poMissing=[];
  const bol=$('[data-f=bol]');bol.parentElement.insertAdjacentHTML('beforeend','<div class="hint err" id="bolw" style="margin:4px 0 0"></div>');
  const chk=async()=>{const v=bol.value.trim(),w=$('#bolw');if(!w)return;if(!v){w.textContent='';return}try{const r=await api('GET','/api/packets/exists?bol='+encodeURIComponent(v));w.textContent=r.exists?'BOL '+v+' is already in the system.':''}catch(e){}};
  bol.addEventListener('change',chk);bol.addEventListener('blur',chk);
  $('.tw').insertAdjacentHTML('afterend','<div id="pow"></div>');
  let t=null;const soon=()=>{clearTimeout(t);t=setTimeout(checkPos,700)};
  $('#rows').addEventListener('input',e=>{if(e.target.dataset.f==='po')soon()});
  new MutationObserver(soon).observe($('#rows'),{childList:true});
}
async function checkPos(){
  const box=$('#pow');if(!box)return;
  const pos=[...new Set($$('#rows [data-f=po]').map(i=>i.value.trim()).filter(Boolean))];
  if(!pos.length){box.innerHTML='';poMissing=[];return}
  try{
    const r=await api('GET','/api/pos/check?pos='+encodeURIComponent(pos.join(',')));
    if(!r.loaded){box.innerHTML='';poMissing=[];return}
    poMissing=r.results.filter(x=>!x.found).map(x=>x.po);
    box.innerHTML='<div class="sgc" style="margin-top:8px">'+r.results.map(x=>x.found?`<span class="chip on">${esc(x.po)} on the PO list${x.vendor?' ('+esc(x.vendor)+')':''}</span>`:`<span class="chip bad">${esc(x.po)} is NOT on the PO list</span>`).join('')+'</div>';
  }catch(e){}
}
const _saveNew=saveNew;
saveNew=async function(){
  if(poMissing.length&&!confirm('These POs are not on the PO list from D365:\n\n'+poMissing.join(', ')+'\n\nSave the packet anyway?'))return;
  const rowsBefore=$$('#rows tr').map(tr=>{const o={};$$('input',tr).forEach(i=>o[i.dataset.f]=i.value.trim());return o}).filter(r=>r.po);
  const vend=$('[data-f=vendor]')?.value.trim(),sug=SUG;
  await _saveNew();
  if(location.hash.startsWith('#/p/')&&vend&&sug)learnFixes(vend,sug,rowsBefore);
};

/* ---------- learn from corrections ---------- */
function dist(a,b){const m=a.length,n=b.length,d=Array.from({length:m+1},(_,i)=>[i]);for(let j=1;j<=n;j++)d[0][j]=j;for(let i=1;i<=m;i++)for(let j=1;j<=n;j++)d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));return d[m][n]}
async function learnFixes(vendor,sug,finalRows){
  const fixes={};const note=(f,from,to)=>{if(from&&to&&from!==to&&dist(from,to)<=3)(fixes[f]=fixes[f]||{})[from]=to};
  finalRows.forEach((row,i)=>{const s=sug.rows.find(x=>x.cc&&x.cc===row.cc)||sug.rows.find(x=>x.coil&&x.coil===row.coil)||sug.rows[i];if(!s)return;['heat','cc','coil','po','desc'].forEach(f=>note(f,s[f],row[f]))});
  if(!Object.keys(fixes).length)return;
  try{
    let lay={v:1,picks:{},fixes:{}};
    try{lay=await api('GET','/api/layouts/'+encodeURIComponent(vendor))}catch(e){}
    lay.fixes=lay.fixes||{};for(const f in fixes)lay.fixes[f]={...(lay.fixes[f]||{}),...fixes[f]};
    await api('PUT','/api/layouts/'+encodeURIComponent(vendor),lay);
  }catch(e){}
}
async function applyFixes(){
  SUG.fixed=0;
  const hit=layoutList.find(l=>SUG.text.toLowerCase().includes(l.name.toLowerCase())||(SUG.vendor&&SUG.vendor.toLowerCase().includes(l.name.toLowerCase())));
  if(!hit)return;
  try{
    const lay=await api('GET','/api/layouts/'+encodeURIComponent(hit.name));const fx=lay.fixes||{};
    SUG.rows.forEach(r=>['heat','cc','coil','po','desc'].forEach(f=>{const to=fx[f]&&fx[f][r[f]];if(to){r[f]=to;SUG.fixed++}}));
    ['bol','ship'].forEach(f=>{const to=fx[f]&&fx[f][SUG[f]];if(to){SUG[f]=to;SUG.fixed++}});
  }catch(e){}
}

/* ---------- check each heat against the other pages (the mill test reports) ---------- */
async function readPageText(n){
  const pg=await pdf.getPage(n);let best='',score=-1;
  for(const extra of [0,90,270]){
    const vp=pg.getViewport({scale:2.2,rotation:((pg.rotate||0)+(rot[n]||0)+extra)%360});
    const c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
    await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
    const text=await ocrQ(async()=>{const w=await getWorker();await w.setParameters({tessedit_pageseg_mode:'3'});return (await w.recognize(c)).data.text});
    const sc=(text.match(/\b[A-Za-z]{4,}\b/g)||[]).length;
    if(sc>score){score=sc;best=text}
    if(sc>=40)break;                   // reads as upright text, no need to try the other turns
  }
  return {text:best,score};
}
const normH=t=>String(t).toUpperCase().replace(/[^A-Z0-9]/g,'');
function findHeat(h,pages){
  const H=normH(h);if(H.length<4)return null;
  for(const p of pages){if(normH(p.text).includes(H))return {page:p.n,exact:true}}
  for(const p of pages){const T=normH(p.text);for(let i=0;i+H.length<=T.length;i++){let bad=0;for(let j=0;j<H.length&&bad<2;j++)if(T[i+j]!==H[j])bad++;if(bad<=1)return {page:p.n,exact:false}}}
  return null;
}
async function checkHeats(){
  if(!pdf)return;const box=$('#heatres');
  const heats=[...new Set($$('#rows [data-f=heat]').map(i=>i.value.trim()).filter(Boolean))];
  if(!heats.length)return toast('Fill in some heat numbers first',1);
  const skip=pdf.numPages>1?(SUG&&SUG.page)||1:0,pages=[];
  try{
    for(let n=1;n<=pdf.numPages;n++){
      if(n===skip)continue;
      box.innerHTML=`<div class="sug busy">Reading page ${n} of ${pdf.numPages} for heat numbers. A packet takes a few minutes.</div>`;
      {const r=await readPageText(n);pages.push({n,text:r.text,ok:r.score>=30})}
    }
    const unread=pages.filter(p=>!p.ok).map(p=>p.n);
    HEATRES='<div class="sgc" style="margin-top:8px">'+heats.map(h=>{const r=findHeat(h,pages);return r?`<span class="chip ${r.exact?'on':'pend'}">Heat ${esc(h)} ${r.exact?'found':'close match'} on page ${r.page}</span>`:unread.length?`<span class="chip pend">Heat ${esc(h)} not found. Page${unread.length===1?'':'s'} ${unread.join(', ')} could not be read well, so check it by eye.</span>`:`<span class="chip bad">Heat ${esc(h)} not found on any page. Check for a typo.</span>`}).join('')+'</div>'+(unread.length?`<div class="muted" style="margin-top:6px;font-size:12px">Pages that could not be read clearly: ${unread.join(', ')}. Poor scans and sideways pages are the usual cause.</div>`:'');
    box.innerHTML=HEATRES;
  }catch(e){box.innerHTML='<div class="sug err">Could not check heats: '+esc(e.message)+'</div>'}
}
