/* intake 3: read digital PDFs from their own text, and teach the app each vendor's BOL format.
   A saved layout now remembers three things per vendor: where fields sit (boxes you drew),
   which label sits next to each header value (BOL no., carrier, ship date), and a fingerprint of the page
   header so the same format is recognised next time even when the vendor name is misread. */

/* ---------- the PDF's own text (digital PDFs); scans fall back to OCR ---------- */
const LAYERS={};   // "page|rotation" -> {lines:[{y,str,items:[{s,x,y,w,h,off}]}], text}
async function pageLayer(n){
  if(!pdf)return null;
  const key=n+'|'+(rot[n]||0);
  if(key in LAYERS)return LAYERS[key];
  LAYERS[key]=null;
  try{
    const pg=await pdf.getPage(n);
    if(((pg.rotate||0)+(rot[n]||0))%360)return null;            // turned pages: use OCR
    const tc=await pg.getTextContent();
    const vp=pg.getViewport({scale:1});
    const items=tc.items.filter(i=>i.str&&i.str.trim()).map(i=>{
      const [x,y]=vp.convertToViewportPoint(i.transform[4],i.transform[5]);
      return {s:i.str,x,y,w:i.width,h:Math.abs(i.transform[3])||i.height||9};
    });
    if(items.reduce((a,i)=>a+i.s.length,0)<60)return null;       // a scan has no text to read
    items.sort((a,b)=>a.y-b.y||a.x-b.x);
    const lines=[];
    for(const it of items){const L=lines.find(l=>Math.abs(l.y-it.y)<=Math.max(2,it.h*.45));if(L)L.items.push(it);else lines.push({y:it.y,items:[it]})}
    lines.sort((a,b)=>a.y-b.y);
    for(const l of lines){
      l.items.sort((a,b)=>a.x-b.x);let s='';
      l.items.forEach((it,i)=>{if(i){const p=l.items[i-1],gap=it.x-(p.x+p.w);s+=gap>it.h*3?'   ':gap>1?' ':''}it.off=s.length;s+=it.s});
      l.str=s;
    }
    return LAYERS[key]={lines,text:lines.map(l=>l.str).join('\n')};
  }catch(e){return null}
}
// text inside a dragged box (css pixels), straight from the PDF text when there is some
async function boxFromLayer(b){
  const L=await pageLayer(pageNo);if(!L)return null;
  const x0=b.x/scale,y0=b.y/scale,x1=(b.x+b.w)/scale,y1=(b.y+b.h)/scale,out=[];
  for(const l of L.lines){
    const its=l.items.filter(it=>{const cx=it.x+it.w/2,cy=it.y-it.h*.35;return cx>=x0&&cx<=x1&&cy>=y0&&cy<=y1});
    if(its.length)out.push(its.map(i=>i.s).join(' ').replace(/\s+/g,' ').trim());
  }
  return out;
}
const _readBox=readBox;
readBox=async function(b,multi){const t=await boxFromLayer(b);return t&&t.length?t:_readBox(b,multi)};
const _readPageText=readPageText;
readPageText=async function(n){const L=await pageLayer(n);return L?{text:L.text,score:99}:_readPageText(n)};
const _openData3=openData;
openData=async function(buf){for(const k in LAYERS)delete LAYERS[k];return _openData3(buf)};

// the text of a page for suggestions: the PDF's own text, or OCR of the picture
async function scanText(n){
  const L=await pageLayer(n);if(L)return L.text;
  const pg=await pdf.getPage(n);
  const vp=pg.getViewport({scale:2.6,rotation:((pg.rotate||0)+(rot[n]||0))%360});
  const c=document.createElement('canvas');c.width=Math.floor(vp.width);c.height=Math.floor(vp.height);
  await pg.render({canvasContext:c.getContext('2d'),viewport:vp}).promise;
  return ocrQ(async()=>{const w=await getWorker();await w.setParameters({tessedit_pageseg_mode:'3'});const {data}=await w.recognize(c);return data.text});
}

/* ---------- format fingerprint and label rules ---------- */
// the words in the top of the page identify the vendor's form
const fingerprint=text=>[...new Set((text.split('\n').slice(0,14).join(' ').toUpperCase().match(/[A-Z]{4,}/g)||[]))].slice(0,40);
const jacc=(a,b)=>{const A=new Set(a),B=new Set(b);let i=0;A.forEach(x=>{if(B.has(x))i++});return i/Math.max(1,A.size+B.size-i)};

// find the value that belongs to a learned label (same line after it, or in the cell below it)
async function valueByLabel(page,text,rule){
  const label=rule.label.toLowerCase(),L=await pageLayer(page);
  if(L){
    for(let i=0;i<L.lines.length;i++){
      const l=L.lines[i],k=l.str.toLowerCase().indexOf(label);if(k<0)continue;
      if(rule.mode==='same'){
        const v=l.str.slice(k+label.length).replace(/^[\s:.#-]+/,'').split(/\s{3,}/)[0].trim();if(v)return v;
      }else{
        const it=l.items.find(t=>t.off<=k+1&&t.off+t.s.length>=k+1)||l.items[0],next=L.lines[i+1];if(!next)continue;
        const v=[];let end=null;
        for(const n of next.items){if(n.x<it.x-4)continue;if(n.x>it.x+Math.max(it.w,110)+90)break;if(end!==null&&n.x-end>12)break;v.push(n.s);end=n.x+n.w}
        const s=v.join(' ').replace(/\s+/g,' ').trim();if(s)return s;
      }
    }
    return '';
  }
  const lines=text.split('\n').map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const k=lines[i].toLowerCase().indexOf(label);if(k<0)continue;
    if(rule.mode==='same'){const v=lines[i].slice(k+label.length).replace(/^[\s:.#-]+/,'').trim();if(v)return v}
    else if(lines[i+1])return lines[i+1];
  }
  return '';
}
// work out which label sits beside a value the user typed
async function learnLabelRule(page,text,v){
  v=String(v||'').trim();if(v.length<3)return null;
  const nv=v.toLowerCase(),L=await pageLayer(page);
  const good=s=>s.length>=2&&s.length<=32&&/[A-Za-z]/.test(s);
  if(L){
    for(let i=0;i<L.lines.length;i++){
      const l=L.lines[i],k=l.str.toLowerCase().indexOf(nv);if(k<0)continue;
      const seg=l.str.slice(0,k).replace(/[\s:.#-]+$/,'').trim().split(/\s{3,}/).pop().trim();
      if(good(seg))return {label:seg,mode:'same'};
      const it=l.items.find(t=>t.off<=k&&t.off+t.s.length>k)||l.items[0],prev=L.lines[i-1];
      if(prev){
        const above=prev.items.filter(p=>Math.abs(p.x-it.x)<=Math.max(30,p.w*.6)||(p.x<=it.x&&p.x+p.w>=it.x));
        const lab=above.map(p=>p.s).join(' ').replace(/[\s:.#-]+$/,'').trim();if(good(lab))return {label:lab,mode:'below'};
      }
    }
    return null;
  }
  const lines=text.split('\n').map(s=>s.trim()).filter(Boolean);
  for(let i=0;i<lines.length;i++){
    const k=lines[i].toLowerCase().indexOf(nv);if(k<0)continue;
    const seg=lines[i].slice(0,k).replace(/[\s:.#-]+$/,'').trim();if(good(seg))return {label:seg,mode:'same'};
    if(i>0&&good(lines[i-1].replace(/[\s:.#-]+$/,'').trim()))return {label:lines[i-1].replace(/[\s:.#-]+$/,'').trim(),mode:'below'};
  }
  return null;
}

/* ---------- recognise a taught format when a page is read ---------- */
let LAYOUTS_FULL={};
async function loadLayoutsFull(){
  const list=layoutList.length?layoutList:await api('GET','/api/layouts');
  for(const l of list){if(!LAYOUTS_FULL[l.name]){try{LAYOUTS_FULL[l.name]=await api('GET','/api/layouts/'+encodeURIComponent(l.name))}catch(e){}}}
}
async function matchFormat(sug){
  sug.layout='';sug.ruled=[];
  try{await loadLayoutsFull()}catch(e){return}
  const fp=fingerprint(sug.text);let best='',bs=0;
  for(const [name,lay] of Object.entries(LAYOUTS_FULL)){
    let sc=sug.text.toLowerCase().includes(name.toLowerCase())?.9:0;
    if(lay.fp&&lay.fp.length)sc=Math.max(sc,jacc(fp,lay.fp));
    if(sc>bs){bs=sc;best=name}
  }
  if(!best||bs<.5)return;
  sug.layout=best;sug.vendor=best;                               // layouts are named after the vendor
  const rules=LAYOUTS_FULL[best].labels||{};
  for(const f of Object.keys(rules)){
    const v=await valueByLabel(sug.page,sug.text,rules[f]);
    if(v){sug[f]=v;sug.ruled.push(f)}
  }
}

/* ---------- teach: remember the format when a packet is saved ---------- */
// work out what to remember while the PDF is still open
async function planLearn(sug){
  if(!sug||!sug.text)return {picks:{...picks},labels:{},fp:null};
  const labels={};
  for(const f of ['bol','ship','carrier']){
    const el=$(`input[data-f=${f}]`),r=el&&await learnLabelRule(sug.page||1,sug.text,el.value);
    if(r)labels[f]=r;
  }
  return {picks:{...picks},labels,fp:fingerprint(sug.text)};
}
async function commitLearn(vendor,plan){
  let lay={v:1,picks:{},fixes:{},labels:{}};
  try{lay=await api('GET','/api/layouts/'+encodeURIComponent(vendor))}catch(e){}
  lay.v=1;lay.picks={...(lay.picks||{}),...plan.picks};lay.labels={...(lay.labels||{}),...plan.labels};
  if(plan.fp&&plan.fp.length)lay.fp=plan.fp;
  try{await api('PUT','/api/layouts/'+encodeURIComponent(vendor),lay);LAYOUTS_FULL={}}catch(e){return}
  const n=Object.keys(plan.labels).length+Object.keys(plan.picks).length;
  if(n)toast('Remembered how '+vendor+' lays out its BOL');
}
