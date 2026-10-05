/* inspection helpers: tolerance warnings, photos, barcode scan, short-ship check */

/* ---------- numbers: "5 15/16", "3/8", ".094" ---------- */
function toNum(s){
  s=String(s??'').trim().replace(/["”]/g,'');if(!s)return NaN;
  const m=s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/);if(m)return +m[1]+ +m[2]/ +m[3];
  const f=s.match(/^(\d+)\s*\/\s*(\d+)$/);if(f)return +f[1]/ +f[2];
  return parseFloat(s);
}
const fr=(a,b,c)=>a+(b?b/c:0);   // 5 15/16 -> fr(5,15,16)

/* ---------- tolerance data copied from the paper sheets (advisory only) ---------- */
// QCF001 black steel: design, min, max
const COIL_BLACK=[[.054,.051,.055],[.060,.057,.064],[.067,.064,.071],[.071,.067,.074],[.075,.071,.078],[.076,.072,.078],[.086,.082,.088],[.089,.085,.092],[.098,.093,.099],[.099,.094,.102],[.105,.100,.107],[.120,.114,.121],[.125,.117,.133],[.134,.126,.142],[.150,.142,.158],[.164,.156,.172],[.175,.167,.183],[.188,.178,.198],[.200,.190,.210],[.220,.211,.230],[.225,.216,.234],[.250,.240,.280],[.275,.265,.305],[.313,.303,.343],[.375,.365,.405],[.500,.490,.530]];
// QCF005 flat bar: "thickness x width" -> thickness min,max, width min,max
const BAR={
 '3/16x5':[.179,.197,fr(4,15,16),fr(5,3,32)],'1/4x5':[.235,.265,fr(4,15,16),fr(5,3,32)],'3/8x5':[.360,.390,fr(4,15,16),fr(5,3,32)],'5/16x5':[.298,.328,4.938,5.094],
 '1/4x6':[.235,.265,fr(5,15,16),fr(6,3,32)],'5/16x6':[.298,.328,fr(5,15,16),fr(6,3,32)],'3/8x6':[.360,.390,fr(5,15,16),fr(6,3,32)],'1/2x6':[.485,.515,fr(5,15,16),fr(6,3,32)],'5/8x6':[.610,.640,fr(5,15,16),fr(6,3,32)],'3/4x6':[.730,.770,fr(5,15,16),fr(6,3,32)],'3/16x6':[.179,.197,5.938,6.094],
 '1/4x8':[.234,.266,fr(7,29,32),fr(8,1,8)],'5/16x8':[.297,.329,fr(7,29,32),fr(8,1,8)],'3/8x8':[.359,.391,fr(7,29,32),fr(8,1,8)],'1/2x8':[.484,.516,fr(7,29,32),fr(8,1,8)],'5/8x8':[.600,.650,fr(7,29,32),fr(8,1,8)],'3/4x8':[.725,.775,fr(7,29,32),fr(8,1,8)],'1x8':[.975,1.025,fr(7,29,32),fr(8,1,8)],'1 1/4x8':[1.219,1.281,fr(7,29,32),fr(8,1,8)],'1 1/2x8':[1.469,1.531,fr(7,29,32),fr(8,1,8)],
 '3/8x10':[.345,.405,fr(9,7,8),fr(10,1,8)],'1/2x10':[.470,.530,fr(9,7,8),fr(10,1,8)],'5/8x10':[.595,.655,fr(9,7,8),fr(10,3,16)],'3/4x10':[.740,.780,fr(9,7,8),fr(10,3,16)],'1x10':[.940,1.060,fr(9,7,8),fr(10,1,4)],
 '3/8x12':[.345,.405,fr(11,7,8),fr(12,1,8)],'1/2x12':[.470,.530,fr(11,7,8),fr(12,1,8)],'5/8x12':[.515,.655,fr(11,7,8),fr(12,3,16)],'3/4x12':[.740,.780,fr(11,7,8),fr(12,3,16)],'1x12':[.990,1.060,fr(11,7,8),fr(12,1,4)],'1 1/4x12':[1.190,1.310,fr(11,7,8),fr(12,1,4)],'1 1/2x12':[1.440,1.560,fr(11,7,8),fr(12,1,4)],
};
// QCF008 pipe wall thickness and rod diameter
const PIPE={'6 5/8 x 0.188':[.169,.206],'8 5/8 x 0.188':[.169,.206],'10 3/4 x 0.219':[.189,.206],'10 3/4 x 0.250':[.225,.275],'10 3/4 x 0.365':[.329,.402]};
const ROD={RD0625:[.555,.569],RD0750:[.672,.688],RD0875:[.789,.805],RD1000:[.897,.915],RD1125:[1.016,1.036],RD1250:[1.140,1.162]};
const ROD_BY_SIZE={'5/8':'RD0625','3/4':'RD0750','7/8':'RD0875','1':'RD1000','1 1/8':'RD1125','1 1/4':'RD1250'};

const fmt=n=>(Math.round(n*10000)/10000).toString().replace(/^0\./,'.');
function tolCheck(type,it){
  const out=[];const add=(field,msg)=>out.push({field,msg});
  const v=k=>toNum(it[k]);
  if(type==='coil'){
    const g=v('gauge');
    if(!isNaN(g)&&g>=.05&&!COIL_BLACK.some(([d,lo,hi])=>g>=lo&&g<=hi))add('gauge','Gauge '+fmt(g)+' is not inside any black steel range on the sheet ('+fmt(COIL_BLACK[0][1])+' to '+fmt(COIL_BLACK[COIL_BLACK.length-1][2])+'). Painted or galvanized coil uses the min thickness table instead.');
    const od=v('od');if(!isNaN(od)&&od>70)add('od','O.D. '+od+'" is over the 70" maximum.');
    const idv=v('id');if(!isNaN(idv)&&!((idv>=19&&idv<=21)||(idv>=26&&idv<=30)))add('id','I.D. '+idv+'" is outside 19 to 21" (purlin, panel) and 26 to 30" (web).');
    const w=v('width');if(!isNaN(w)&&w>60.875)add('width','Width '+w+'" is over the 60 7/8" maximum.');
  }
  if(type==='bar'){
    const m=String(it.desc||'').match(/(\d+(?:\s+\d+\/\d+|\/\d+)?)\s*[xX]\s*(\d+)\b/);
    if(m){const row=BAR[m[1].replace(/\s+/g,m[1].includes(' ')?' ':'')+'x'+m[2]];
      if(row){const t=v('thick'),w=v('width');
        if(!isNaN(t)&&(t<row[0]||t>row[1]))add('thick','Thickness '+fmt(t)+' is outside '+fmt(row[0])+' to '+fmt(row[1])+' for '+m[1]+' x '+m[2]+'.');
        if(!isNaN(w)&&(w<row[2]-.0001||w>row[3]+.0001))add('width','Width '+fmt(w)+' is outside '+fmt(row[2])+' to '+fmt(row[3])+' for '+m[1]+' x '+m[2]+'.');}}
  }
  if(type==='tube'){
    const d=String(it.desc||'');const w=v('wall'),od=v('od');
    for(const k of Object.keys(PIPE)){if(d.replace(/\s+/g,' ').includes(k)&&!isNaN(w)&&(w<PIPE[k][0]||w>PIPE[k][1]))add('wall','Wall '+fmt(w)+' is outside '+fmt(PIPE[k][0])+' to '+fmt(PIPE[k][1])+' for pipe '+k+'.')}
    const rm=d.match(/RD\d{4}/i)||(/rod/i.test(d)?[ROD_BY_SIZE[(d.match(/(\d+(?:\s+\d+\/\d+|\/\d+)?)\s*(?:in|")?\s*rod/i)||[])[1]]]:null);
    const key=rm&&rm[0]&&String(rm[0]).toUpperCase();
    if(key&&ROD[key]&&!isNaN(od)&&(od<ROD[key][0]||od>ROD[key][1]))add('od','Diameter '+fmt(od)+' is outside '+fmt(ROD[key][0])+' to '+fmt(ROD[key][1])+' for '+key+'.');
  }
  return out;
}

/* ---------- photo helper: shrink a phone photo before upload ---------- */
function shrinkImage(file,max=1600,q=.82){
  return new Promise((res,rej)=>{
    const img=new Image(),url=URL.createObjectURL(file);
    img.onload=()=>{const k=Math.min(1,max/Math.max(img.width,img.height));const c=document.createElement('canvas');c.width=Math.round(img.width*k);c.height=Math.round(img.height*k);c.getContext('2d').drawImage(img,0,0,c.width,c.height);URL.revokeObjectURL(url);c.toBlob(b=>b?b.arrayBuffer().then(res):rej(new Error('Could not read the photo')),'image/jpeg',q)};
    img.onerror=()=>rej(new Error('That file is not a picture'));img.src=url;
  });
}

/* ---------- barcode scan for the CC # (needs HTTPS and a browser with BarcodeDetector) ---------- */
async function scanBarcode(){
  if(!('BarcodeDetector' in window)||!navigator.mediaDevices?.getUserMedia||!isSecureContext)return Promise.reject(new Error('Barcode scanning needs HTTPS and Chrome on Android. Type the number for now.'));
  const det=new BarcodeDetector();
  const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'environment'}});
  const w=document.createElement('div');w.className='pinwrap';
  w.innerHTML='<div class="pinbox" style="width:min(520px,96vw)"><b style="color:var(--dg)">Point the camera at the barcode</b><video playsinline autoplay muted style="width:100%;border-radius:10px;margin:12px 0;background:#000"></video><button class="btn" id="scx">Cancel</button></div>';
  document.body.appendChild(w);const vid=w.querySelector('video');vid.srcObject=stream;
  return new Promise(resolve=>{
    let done=false;const stop=v=>{if(done)return;done=true;stream.getTracks().forEach(t=>t.stop());w.remove();resolve(v)};
    w.querySelector('#scx').onclick=()=>stop(null);
    const tick=async()=>{if(done)return;try{const r=await det.detect(vid);if(r.length)return stop(r[0].rawValue)}catch(e){}setTimeout(tick,250)};
    vid.onplaying=tick;
  });
}

/* ---------- called after every redraw of the inspection rows ---------- */
function enhanceItems(ctx){
  const {id,f,T,canEdit}=ctx;
  $$('#items .item').forEach(card=>{
    const i=+card.dataset.i,it=f.items[i],ib=$('.ib',card);
    // photos
    const ph=it.photos||[];
    ib.insertAdjacentHTML('beforeend',`<div class="fld" style="grid-column:1/-1"><label>Photos</label><div class="thumbs">${ph.map(n=>`<span class="th"><a href="/api/packets/${id}/photo/${n}" target="_blank"><img src="/api/packets/${id}/photo/${n}" alt=""></a>${canEdit?`<button type="button" data-prm="${n}" title="Remove">&times;</button>`:''}</span>`).join('')}${canEdit?`<label class="btn addph">${ic('plus')} Add photo<input type="file" accept="image/*" capture="environment" hidden></label>`:''}${!ph.length&&!canEdit?'<span class="muted">None</span>':''}</div></div>`);
    $$('[data-prm]',card).forEach(b=>b.onclick=()=>{it.photos=(it.photos||[]).filter(x=>x!==b.dataset.prm);ctx.collect();ctx.draw();ctx.autosave()});
    const inp=$('.addph input',card);
    if(inp)inp.onchange=async e=>{const file=e.target.files[0];if(!file)return;try{toast('Uploading photo...');const buf=await shrinkImage(file);const r=await api('POST','/api/packets/'+id+'/photo',buf,'image/jpeg');ctx.collect();(it.photos=it.photos||[]).push(r.name);ctx.draw();ctx.autosave();toast('Photo added')}catch(x){toast(x.message,1)}};
    // scan button on the CC field
    const cc=$('input[data-k=cc]',card);
    if(cc&&canEdit){const lab=cc.parentElement.querySelector('label');lab.insertAdjacentHTML('beforeend',' <button type="button" class="scanbtn" title="Scan barcode">Scan</button>');
      $('.scanbtn',card).onclick=async()=>{try{const v=await scanBarcode();if(v){cc.value=v.replace(/\D/g,'')||v;cc.dispatchEvent(new Event('input',{bubbles:true}))}}catch(e){toast(e.message,1)}}}
    // tolerance warnings
    ib.insertAdjacentHTML('beforeend','<div class="tolbox" style="grid-column:1/-1"></div>');
    const box=$('.tolbox',card);
    const warn=()=>{const w=tolCheck(T.k,f.items[i]);box.innerHTML=w.length?w.map(x=>`<div class="tw1">${ic('info')} ${esc(x.msg)}</div>`).join('')+'<div class="tw2">Advisory only. Check the paper sheet if you are unsure. You can still submit.</div>':'';
      $$('input[data-k]',card).forEach(el=>el.classList.toggle('warnfld',w.some(x=>x.field===el.dataset.k)))};
    warn();
    if(canEdit)$$('input[data-k]',card).forEach(el=>el.addEventListener('input',()=>{ctx.collect();warn()}));
  });
}

/* ---------- warn before sending a packet to review with items missing ---------- */
function shortShipCheck(p){
  const lines=[];
  pos(p).forEach(po=>{
    const need=p.rows.filter(r=>r.po===po).length;let got=0;
    TYPES.forEach(t=>{const f=p.forms[po+'|'+t.k];if(f&&f.submitted)got+=(f.items||[]).filter(it=>!it.skip&&(it.heat||it.cc||it.desc)).length});
    if(got<need)lines.push(po+': '+got+' of '+need+' items inspected');
  });
  return lines.length?'Not every item has an inspection row:\n\n'+lines.join('\n')+'\n\nSend to review anyway?':'';
}
