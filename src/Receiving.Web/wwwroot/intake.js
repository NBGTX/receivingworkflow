/* ---------------- intake: new packet w/ click-to-index ---------------- */
const COLS=[['po','PO #'],['heat','Heat #'],['coil','Coil / bundle #'],['cc','CC # (NBS#)'],['desc','Description'],['len','Length'],['wt','Weight']];
const Q=2;
async function fitPage(){
  const pg=await pdf.getPage(pageNo),r=((pg.rotate||0)+(rot[pageNo]||0))%360,v=pg.getViewport({scale:1,rotation:r});
  const st=$('#stage'),availH=Math.max(480,innerHeight-215);
  const availW=innerWidth>=1500?$('.ix').clientWidth*.62-60:st.clientWidth-24;
  scale=Math.max(.5,Math.min(4,availW/v.width,(availH-12)/v.height));
}
let pdf=null,pageNo=1,scale=1.5,rot={},boxes={},active=null,ocrWorker=null,curBuf=null,picks={};
// new packet screen: PDF on the left, details and rows on the right
function viewNew(){
  $('#app').classList.add('wide');
  pdf=null;boxes={};rot={};pageNo=1;active=null;curBuf=null;picks={};
  $('#app').innerHTML=`
  <div class="pagehead"><div class="grow"><h1>New packet</h1><p>Open the packet PDF, or pick several files at once to join them. Then click a field and drag a box around the text to fill it.</p></div></div>${howTo('new')}
  <div class="ix">
   <div class="card"><h2>Packet PDF</h2>
    <div class="dropzone" id="drop"><label class="btn pri big" for="file">${ic('file')} Choose PDF files</label><span class="muted">or drop them here. Several files are joined in the order you pick them.</span><input type="file" id="file" accept="application/pdf" multiple hidden></div>
    <div class="muted" id="fname" style="margin:0 0 10px"></div>
    <div class="vtool"><button class="btn sm" id="prev">&lsaquo;</button><span class="num" id="pg">0 / 0</span><button class="btn sm" id="next">&rsaquo;</button>
     <button class="btn sm" id="rotL">${ic('rot')} Rotate</button><button class="btn sm" id="zo">&minus;</button><span class="num" id="zl">100%</span><button class="btn sm" id="zi">+</button><button class="btn sm" id="zfit">Fit page</button></div>
    <div id="stage"><div id="wrap"><canvas id="cv" width="10" height="10"></canvas><div id="ov"></div></div></div></div>
   <div class="card"><h2>Index packet</h2>
    <div class="vtool"><label class="ck"><input type="checkbox" id="auto" checked> Auto-advance to the next field</label></div>
    <div id="ocr">Open a PDF to begin.</div>
    <div class="fh fld sm">
     <div><label>BOL #</label><input data-f="bol"></div><div><label>Vendor</label><input data-f="vendor"></div>
     <div><label>Ship date</label><input data-f="ship"></div><div><label>Carrier</label><input data-f="carrier"></div></div>
    <div class="tw"><table class="cells"><colgroup><col style="width:12%"><col style="width:11%"><col style="width:14%"><col style="width:11%"><col style="width:27%"><col style="width:10%"><col style="width:10%"><col style="width:5%"></colgroup><thead><tr id="thead">${COLS.map(c=>`<th data-c="${c[0]}">${c[1]}</th>`).join('')}<th></th></tr></thead><tbody id="rows"></tbody></table></div>
    <div class="vtool" style="margin-top:12px"><button class="btn" id="addRow">${ic('plus')} Add row</button><span style="flex:1"></span><button class="btn pri" id="save">Save and send to receivers</button></div>
    <p class="muted" id="msg" style="margin:6px 0 0;font-size:13px"></p></div>
  </div>`;
  const ov=$('#ov');
  // open one PDF, or join several in the order given (used by the chooser and by drag and drop)
  const openFiles=async files=>{
    files=files.filter(f=>/pdf$/i.test(f.type)||/\.pdf$/i.test(f.name));
    if(!files.length)return ocrs('Only PDF files can be opened here.',2);
    $('#fname').textContent=files.length===1?files[0].name:files.length+' files: '+files.map(f=>f.name).join(', ');
    if(files.length===1)return files[0].arrayBuffer().then(openData);
    ocrs('Joining '+files.length+' PDFs in the order picked...',1);
    try{
      const fd=new FormData();files.forEach(f=>fd.append('files',f,f.name));
      const r=await fetch('/api/pdf/merge',{method:'POST',headers:{'X-Requested-With':'fetch'},body:fd,credentials:'same-origin'});
      if(!r.ok){let m='Could not join the files';try{m=(await r.json()).error||m}catch(x){}throw new Error(m)}
      await openData(await r.arrayBuffer());
      ocrs('Joined '+files.length+' files ('+files.map(f=>f.name).join(', ')+'). Pages are in that order.');
    }catch(x){ocrs(x.message,2)}
  };
  $('#file').onchange=e=>{openFiles([...e.target.files]);e.target.value=''};
  ['#drop','#stage'].forEach(sel=>{const z=$(sel);
    z.addEventListener('dragover',e=>{e.preventDefault();z.classList.add('over')});
    z.addEventListener('dragleave',()=>z.classList.remove('over'));
    z.addEventListener('drop',e=>{e.preventDefault();z.classList.remove('over');openFiles([...e.dataTransfer.files])})});
  $('#prev').onclick=()=>{if(pdf&&pageNo>1){pageNo--;rend()}};$('#next').onclick=()=>{if(pdf&&pageNo<pdf.numPages){pageNo++;rend()}};
  $('#rotL').onclick=()=>{rot[pageNo]=((rot[pageNo]||0)+90)%360;delete boxes[pageNo];rend()};
  $('#zfit').onclick=()=>{if(pdf){fitPage().then(()=>{boxes={};rend()})}};
  $('#zi').onclick=()=>{scale=Math.min(4,scale+.25);boxes={};rend()};$('#zo').onclick=()=>{scale=Math.max(.5,scale-.25);boxes={};rend()};
  $$('#thead th[data-c]').forEach(th=>th.onclick=()=>{const t=$$(`#rows [data-f=${th.dataset.c}]`).find(i=>!i.value)||$(`#rows [data-f=${th.dataset.c}]`);t&&setActive(t)});
  $('#addRow').onclick=()=>{const t=addRow();setActive(t.querySelector('input'))};
  for(let i=0;i<4;i++)addRow();setActive($('[data-f=bol]'));
  $('#save').onclick=saveNew;
  $$('[data-f]').forEach(i=>i.addEventListener('focus',()=>setActive(i)));
  bindDrag(ov);
}
async function openUrl(u){ocrs('Loading PDF...',1);try{const r=await fetch(u);if(!r.ok)throw new Error(r.status);openData(await r.arrayBuffer())}catch(e){ocrs('Load failed: '+e.message,2)}}
async function openData(buf){curBuf=buf.slice(0);pdf=await pdfjsLib.getDocument({data:buf}).promise;pageNo=1;rot={};boxes={};
  await fitPage();await rend();ocrs('Loaded '+pdf.numPages+' pages. Click a field, then drag a box on the page.')}
async function rend(){
  if(!pdf)return;const page=await pdf.getPage(pageNo);
  const vp=page.getViewport({scale:scale*Q,rotation:((page.rotate||0)+(rot[pageNo]||0))%360});
  const cv=$('#cv');cv.width=Math.floor(vp.width);cv.height=Math.floor(vp.height);cv.style.width=(vp.width/Q)+'px';cv.style.height=(vp.height/Q)+'px';
  await page.render({canvasContext:cv.getContext('2d'),viewport:vp}).promise;
  $('#pg').textContent=pageNo+' / '+pdf.numPages;$('#zl').textContent=Math.round(scale*100)+'%';drawBoxes();
}
function drawBoxes(){$$('.box').forEach(b=>b.remove());(boxes[pageNo]||[]).forEach(b=>{const d=document.createElement('div');d.className='box';Object.assign(d.style,{left:b.x*scale+'px',top:b.y*scale+'px',width:b.w*scale+'px',height:b.h*scale+'px'});$('#ov').appendChild(d)})}
function bindDrag(ov){
  let drag=null,sel=null;
  ov.addEventListener('pointerdown',e=>{if(!pdf)return;ov.setPointerCapture(e.pointerId);const r=ov.getBoundingClientRect();drag={x:e.clientX-r.left,y:e.clientY-r.top};sel=document.createElement('div');sel.className='sel';ov.appendChild(sel)});
  ov.addEventListener('pointermove',e=>{if(!drag)return;const r=ov.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;Object.assign(sel.style,{left:Math.min(x,drag.x)+'px',top:Math.min(y,drag.y)+'px',width:Math.abs(x-drag.x)+'px',height:Math.abs(y-drag.y)+'px'})});
  ov.addEventListener('pointerup',async e=>{
    if(!drag)return;const r=ov.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;
    const b={x:Math.min(x,drag.x),y:Math.min(y,drag.y),w:Math.abs(x-drag.x),h:Math.abs(y-drag.y)};drag=null;sel.remove();
    if(b.w<6||b.h<6)return;if(!active){ocrs('Click a field on the right first.',2);return}
    (boxes[pageNo]=boxes[pageNo]||[]).push({x:b.x/scale,y:b.y/scale,w:b.w/scale,h:b.h/scale});drawBoxes();
    const isCol=!!active.closest('tbody'),multi=isCol,cw=$('#cv').clientWidth,ch=$('#cv').clientHeight;
    picks[active.dataset.f]={p:pageNo,rot:rot[pageNo]||0,x:b.x/cw,y:b.y/ch,w:b.w/cw,h:b.h/ch,multi};
    await ocr(b,multi)});
}
let ocrChain=Promise.resolve();
const ocrQ=fn=>{const p=ocrChain.then(fn,fn);ocrChain=p.then(()=>{},()=>{});return p};
async function getWorker(){
  if(!ocrWorker){ocrs('Starting OCR engine...',1);ocrWorker=await Tesseract.createWorker('eng',1,{workerPath:'/vendor/tesseract/worker.min.js',corePath:'/vendor/tesseract/',langPath:'/vendor/tesseract/lang',gzip:true,workerBlobURL:false})}
  return ocrWorker;
}
/* read the text inside a box (css pixels on the shown page); returns a list of lines */
function readBox(b,multi){
  return ocrQ(async()=>{
    const w=await getWorker();
    const src=$('#cv'),k=Math.max(1,Math.min(3,Math.ceil(90/Math.max(b.h*Q,1))));
    const c=document.createElement('canvas');c.width=b.w*Q*k;c.height=b.h*Q*k;const g=c.getContext('2d');g.fillStyle='#fff';g.fillRect(0,0,c.width,c.height);g.drawImage(src,b.x*Q,b.y*Q,b.w*Q,b.h*Q,0,0,c.width,c.height);
    await w.setParameters({tessedit_pageseg_mode:multi||b.h>70?'6':'7'});
    const {data}=await w.recognize(c);
    return data.text.split('\n').map(s=>s.trim()).filter(Boolean);
  });
}
// read the page text in the browser (Tesseract); nothing is sent to a server
async function ocr(b,multi){
  try{
    ocrs('Reading...',1);
    const lines=await readBox(b,multi);
    if(!lines.length)return ocrs('No text found. Try a tighter box or type it.',2);
    // a box around a whole column (several lines) fills the rows downward from the selected cell; one line fills just that cell
    const down=multi&&lines.length>1;
    if(down)fillDown(lines);else put(active,lines.join(' '));
    ocrs(down?'Filled '+lines.length+' rows down the '+(COLS.find(c=>c[0]===active.dataset.f)||[0,'column'])[1]+' column. Check each value and fix any that are wrong.':'Read "'+lines.join(' ')+'". Check the value and fix it if wrong.');
  }catch(err){ocrs('OCR failed: '+err.message,2)}
}
function clean(f,t){if(f==='po')return t.replace(/\s+/g,'').replace(/^T[XK]?[-_ ]?/i,'TX-').replace(/[Oo](?=\d)/g,'0');if(['heat','coil','cc','bol'].includes(f))return t.replace(/\s+/g,'').replace(/^[^A-Za-z0-9.]+|[^A-Za-z0-9]+$/g,'');if(f==='wt')return t.replace(/[^\d.,]/g,'');return t}
function put(el,t){el.value=clean(el.dataset.f,t);if($('#auto').checked){const o=$$('[data-f]'),i=o.indexOf(el);if(i<o.length-1)setActive(o[i+1])}}
// fill one column of rows from a box dragged on the PDF
function fillColumn(f,lines){let tr=$('#rows tr');lines.forEach(t=>{if(!tr)tr=addRow();tr.querySelector(`[data-f=${f}]`).value=clean(f,t);tr=tr.nextElementSibling})}
function fillDown(lines){const f=active.dataset.f;let tr=active.closest('tr');lines.forEach(t=>{if(!tr)tr=addRow();tr.querySelector(`[data-f=${f}]`).value=clean(f,t);tr=tr.nextElementSibling})}
function ocrs(t,k){const o=$('#ocr');if(!o)return;o.textContent=t;o.className=k===1?'busy':k===2?'err':''}
function addRow(v={}){const tr=document.createElement('tr');tr.innerHTML=COLS.map(c=>`<td><input data-f="${c[0]}" placeholder="${c[1]}" aria-label="${c[1]}" value="${esc(v[c[0]]||'')}"></td>`).join('')+'<td><button class="btn sm ghost" tabindex="-1" title="Remove row">&times;</button></td>';
  tr.querySelector('button').onclick=()=>tr.remove();tr.querySelectorAll('input').forEach(i=>i.addEventListener('focus',()=>setActive(i)));$('#rows').appendChild(tr);return tr}
function setActive(el){
  if(active)active.classList.remove('active');active=el;
  if(el){el.classList.add('active');el.focus({preventScroll:true});
    // tell the user what a drag will do for a table cell
    const o=$('#ocr');if(pdf&&el.closest('tbody')&&o&&o.className!=='busy')ocrs('Selected: '+((COLS.find(c=>c[0]===el.dataset.f)||[0,'cell'])[1])+'. Drag a box around the whole column on the PDF to fill rows down, or around one value to fill just this cell.')}
}
// create the packet, then upload the PDF so receivers are notified
async function saveNew(){
  const bol=$('[data-f=bol]').value.trim();
  const rows=$$('#rows tr').map(tr=>{const o={};$$('input',tr).forEach(i=>o[i.dataset.f]=i.value.trim());return o}).filter(r=>r.po);
  const m=$('#msg');m.style.color='var(--red)';
  if(!bol||!rows.length){m.textContent='Needs a BOL # and at least one row with a PO #.';return}
  if(!curBuf){m.textContent='Open the packet PDF first.';return}
  try{
    $('#save').disabled=true;
    const p=await api('POST','/api/packets',{bol,vendor:$('[data-f=vendor]').value.trim(),ship:$('[data-f=ship]').value.trim(),carrier:$('[data-f=carrier]').value.trim(),rows});
    await api('POST','/api/packets/'+p.id+'/pdf',curBuf,'application/pdf');
    const vend=$('[data-f=vendor]').value.trim();if(vend&&Object.keys(picks).length){try{await api('PUT','/api/layouts/'+encodeURIComponent(vend),{v:1,picks})}catch(e){}}
    toast('Packet sent to receivers');nav('/p/'+p.id);
  }catch(e){m.textContent=e.message;$('#save').disabled=false}
}
