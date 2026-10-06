/* tolerance tables as real tables (transcribed from the paper sheets QCF001, QCF005, QCF008, QCF023). Advisory only. */
const BLACK_ROWS=[['.054','.051','.055'],['.060','.057','.064'],['.067','.064','.071'],['.071','.067','.074'],['.075','.071','.078'],['.076','.072','.078'],['.086','.082','.088'],['.089','.085','.092'],['.098','.093','.099'],['.099','.094','.102'],['.105','.100','.107'],['.120','.114','.121'],['.125*','.117','.133'],['.134','.126','.142'],['.150','.142','.158'],['.164','.156','.172'],['.175','.167','.183'],['.188','.178','.198'],['.200','.190','.210'],['.220','.211','.230'],['.225','.216','.234'],['.250','.240','.280'],['.275','.265','.305'],['.313','.303','.343'],['.375','.365','.405'],['.500','.490','.530']];
const BAR_HEAD=['Size','Thickness min.','Thickness max.','Width min.','Width max.'];
const TOLTAB={
 coil:[
  {title:'Coil size constraints',head:['Material','I.D. min.','I.D. max.','O.D. max.','Width max.','Weight max. (lb)'],rows:[['Purlin','19"','21"','70"','60 7/8"','40,000'],['Web','26"','30"','70"','60 7/8"','40,000'],['Panel','19"','21"','65"','48"','20,000']],
   note:'* If .125 coil is less than .119 the coil card and tag must be marked "USE FOR WEB ONLY - NO COLDFORM". Coil width: painted coils 0, +1/8"; black coils not under section number width.'},
  {title:'Black steel thickness',head:['Design','Min.','Max.'],rows:BLACK_ROWS},
  {title:'Panel material minimum thickness',head:['Design','Painted coating','Painted min.','Galv. coating','Galv. min.'],rows:[['28 ga.','G40','.0164','AZ55','.0160'],['26 ga.','G90/G60','.0197','AZ50','.0184'],['26 ga.','G90','.0198','—','—'],['26 ga.','AZ50','.0199','—','—'],['24 ga.','G90','.0241','AZ55','.0229'],['24 ga.','AZ50','.0242','—','—'],['24 ga.','AZ55','.0244','—','—'],['22 ga.','AZ55','.0302','AZ55','.0287']]}],
 sheet:[{title:'Galvanized sheet minimum thickness',head:['Gage','Coating','Min. thickness'],rows:[['10','G60','0.1295'],['12','G60','0.1011'],['14','G60','0.0727'],['16','G60','0.0585'],['18','G60','0.0471'],['22','G60','0.0286'],['24','G60','0.0217'],['26','G60','0.0177']]}],
 bar:[
  {title:'Flat bar, 5" and 6" wide',head:BAR_HEAD,rows:[['3/16 x 5','0.179','0.197','4 15/16','5 3/32'],['1/4 x 5','0.235','0.265','4 15/16','5 3/32'],['3/8 x 5','0.360','0.390','4 15/16','5 3/32'],['1/4 x 6','0.235','0.265','5 15/16','6 3/32'],['5/16 x 6','0.298','0.328','5 15/16','6 3/32'],['3/8 x 6','0.360','0.390','5 15/16','6 3/32'],['1/2 x 6','0.485','0.515','5 15/16','6 3/32'],['5/8 x 6','0.610','0.640','5 15/16','6 3/32'],['3/4 x 6','0.730','0.770','5 15/16','6 3/32'],['5/16 x 5','0.298','0.328','4.938','5.094'],['3/16 x 6','0.179','0.197','5.938','6.094']]},
  {title:'Flat bar, 8" wide',head:BAR_HEAD,rows:[['1/4 x 8','0.234','0.266','7 29/32','8 1/8'],['5/16 x 8','0.297','0.329','7 29/32','8 1/8'],['3/8 x 8','0.359','0.391','7 29/32','8 1/8'],['1/2 x 8','0.484','0.516','7 29/32','8 1/8'],['5/8 x 8','0.600','0.650','7 29/32','8 1/8'],['3/4 x 8','0.725','0.775','7 29/32','8 1/8'],['1 x 8','0.975','1.025','7 29/32','8 1/8'],['1 1/4 x 8','1.219','1.281','7 29/32','8 1/8'],['1 1/2 x 8','1.469','1.531','7 29/32','8 1/8']]},
  {title:'Flat bar, 10" and 12" wide',head:BAR_HEAD,rows:[['3/8 x 10','0.345','0.405','9 7/8','10 1/8'],['1/2 x 10','0.470','0.530','9 7/8','10 1/8'],['5/8 x 10','0.595','0.655','9 7/8','10 3/16'],['3/4 x 10','0.740','0.780','9 7/8','10 3/16'],['1 x 10','0.940','1.060','9 7/8','10 1/4'],['3/8 x 12','0.345','0.405','11 7/8','12 1/8'],['1/2 x 12','0.470','0.530','11 7/8','12 1/8'],['5/8 x 12','0.515','0.655','11 7/8','12 3/16'],['3/4 x 12','0.740','0.780','11 7/8','12 3/16'],['1 x 12','0.990','1.060','11 7/8','12 1/4'],['1 1/4 x 12','1.190','1.310','11 7/8','12 1/4'],['1 1/2 x 12','1.440','1.560','11 7/8','12 1/4']]}],
 tube:[
  {title:'Pipe thickness',head:['Pipe','Min.','Max.'],rows:[['6 5/8 x 0.188','0.169','0.206'],['8 5/8 x 0.188','0.169','0.206'],['10 3/4 x 0.219','0.189','0.206'],['10 3/4 x 0.250','0.225','0.275'],['10 3/4 x 0.365','0.329','0.402']],note:'Pipe O.D.: +/- 0.5%. Thickness: +/- 10%.'},
  {title:'Rod diameter',head:['Rod size','Rod','Order dia.','Min.','Max.','Round'],rows:[['5/8','RD0625','0.5615','0.555','0.569','0.010'],['3/4','RD0750','0.6800','0.672','0.688','0.012'],['7/8','RD0875','0.7970','0.789','0.805','0.012'],['1','RD1000','0.9060','0.897','0.915','0.013'],['1 1/8','RD1125','1.0260','1.016','1.036','0.015'],['1 1/4','RD1250','1.1511','1.140','1.162','0.016']]}]
};
const TOLLAY={coil:[[[0,2],1],[[1],1.7]],bar:[[[0],1],[[1],1],[[2],1]],tube:[[[0],1],[[1],1.3]],sheet:[[[0],1]]};   // [[cards in this column], width weight]
function tolTablesHtml(key){
  const tabs=TOLTAB[key];if(!tabs)return '';
  const tbl=(t,rows)=>`<table><thead><tr>${t.head.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map(c=>`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const card=t=>{
    const half=t.rows.length>14?Math.ceil(t.rows.length/2):0;   // long lists go side by side
    const body=half?`<div class="ttsplit">${tbl(t,t.rows.slice(0,half))}${tbl(t,t.rows.slice(half))}</div>`:tbl(t,t.rows);
    return `<section class="ttab"><h3>${esc(t.title)}</h3>${body}${t.note?`<p class="tnote">${esc(t.note)}</p>`:''}</section>`;
  };
  return (TOLLAY[key]||[[tabs.map((_,i)=>i),1]]).map(([ids,w])=>`<div class="ttcol" style="flex:${w} 1 0">${ids.map(i=>card(tabs[i])).join('')}</div>`).join('');
}
/* make everything fit the screen: shrink the type until nothing scrolls */
function fitTol(){
  const db=document.querySelector('#dbody'),box=db&&db.querySelector('.ttabs');if(!box)return;
  box.classList.toggle('stack',db.clientWidth<600);let px=34;box.style.setProperty('--tf',px+'px');
  while(px>9&&(db.scrollHeight>db.clientHeight+1||db.scrollWidth>db.clientWidth+1)){px--;box.style.setProperty('--tf',px+'px')}
}
addEventListener('resize',()=>{if(document.querySelector('#drawer.open.wide .ttabs'))fitTol()});
