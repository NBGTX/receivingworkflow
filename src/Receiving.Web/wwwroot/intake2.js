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
    SUG=parseBol(text);SUG.text=text;showSuggestions();
  }catch(e){box.innerHTML='<div class="sug err">Could not read the page: '+esc(e.message)+'</div>'}
}

function showSuggestions(){
  const box=$('#sug');if(!box||!SUG)return;
  const chip=(label,val,field)=>val?`<button class="chip sg" data-f="${field}" data-v="${esc(val)}">${esc(label)} <b>${esc(val)}</b></button>`:'';
  const hit=layoutList.find(l=>SUG.text.toLowerCase().includes(l.name.toLowerCase()));
  box.innerHTML=`<div class="sug"><div class="sgh">Suggestions from the page <span class="muted">(check each one)</span> <button class="btn sm" id="rescan">Read this page</button></div>
   <div class="sgc">${chip('BOL #',SUG.bol,'bol')}${chip('Vendor',SUG.vendor,'vendor')}${chip('Ship date',SUG.ship,'ship')}${chip('Carrier',SUG.carrier,'carrier')}${SUG.pos.map(p=>`<button class="chip sg" data-f="po" data-v="${esc(p)}">PO <b>${esc(p)}</b></button>`).join('')}</div>
   <div class="bar" style="margin:8px 0 0">${SUG.rows.length?`<button class="btn sm pri" id="sgrows">${$$('#rows tr').some(tr=>$$('input',tr).some(i=>i.value))?'Add':'Fill'} ${SUG.rows.length} row${SUG.rows.length===1?'':'s'} from the page</button>`:'<span class="muted">No item rows recognized on this page.</span>'}
   ${hit?`<button class="btn sm" id="sglay">Use saved layout: ${esc(hit.name)}</button>`:''}</div></div>`;
  $$('.sg',box).forEach(b=>b.onclick=()=>{
    const f=b.dataset.f,v=b.dataset.v;
    if(f==='po'){const el=($$('#rows [data-f=po]').find(i=>!i.value)||addRow().querySelector('[data-f=po]'));el.value=v;setActive(el.closest('tr').querySelector('[data-f=heat]'))}
    else{const el=$(`[data-f=${f}]`);el.value=v;setActive(el)}
  });
  $('#rescan').onclick=scanPage;
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
