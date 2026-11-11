(function(){
'use strict';

const cfg = window.NUS_IMPORT_BACKUP || {ajaxUrl:'/wp-admin/admin-ajax.php',nonce:'',isAdmin:false,maxFileSize:10*1024*1024};

// IMPORTANT: The WordPress page is built in Elementor. Installing the backend plugin
// does not replace Elementor's already-rendered old markup. On this page we therefore
// replace the old #nus-app with the exact same visual template before binding events.
(function mountFixedTemplate(){
  const tpl=document.getElementById('nus-import-backup-fixed-template');
  if(!tpl) return;
  const old=document.getElementById('nus-app');
  const frag=tpl.content.cloneNode(true);
  const fresh=frag.querySelector('#nus-app');
  if(!fresh) return;
  if(old) old.remove();
  document.body.appendChild(frag);
  tpl.remove();
})();

const $ = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const state = {file:null,headers:[],rows:[],mapping:{},recordType:'container',checkedRows:[],history:[],backups:[]};

function alertBox(message,type){
  const el=$('#nus-alert'); el.textContent=message; el.className='nus-alert show '+(type||'success');
  clearTimeout(alertBox.timer); alertBox.timer=setTimeout(()=>el.className='nus-alert',5000);
}
function esc(v){
  return String(v==null?'':v).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
}
function api(action,data={}){
  const fd=new FormData(); fd.append('action',action); fd.append('nonce',cfg.nonce);
  Object.entries(data).forEach(([k,v])=>fd.append(k,typeof v==='string'?v:JSON.stringify(v)));
  return fetch(cfg.ajaxUrl,{method:'POST',body:fd,credentials:'same-origin'}).then(r=>r.json()).then(j=>{
    if(!j.success) throw new Error(j.data?.message||'Request failed.');
    return j.data;
  });
}
function setTab(name){
  $$('.nus-tabs button').forEach(b=>{
    const active=b.dataset.tab===name;b.classList.toggle('active',active);b.setAttribute('aria-selected',active?'true':'false');
  });
  $$('.nus-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===name));
  if(name==='history') loadHistory();
  if(name==='backups') loadBackups();
}
$$('.nus-tabs button').forEach(b=>b.addEventListener('click',()=>setTab(b.dataset.tab)));

function initSidebar(){
  const sidebar=$('#nus-sidebar'),toggle=$('#nus-toggle');
  $$('.nus-group-toggle').forEach(button=>button.addEventListener('click',()=>{
    const open=button.getAttribute('aria-expanded')==='true',menu=$('#'+button.getAttribute('aria-controls'));
    button.setAttribute('aria-expanded',String(!open)); if(menu) menu.hidden=open;
  }));
  const collapsed=window.innerWidth<=767;
  document.body.classList.toggle('nus-collapsed',collapsed);
  toggle.textContent=collapsed?'☰':'‹';toggle.setAttribute('aria-expanded',String(!collapsed));
  toggle.addEventListener('click',()=>{
    const c=document.body.classList.toggle('nus-collapsed');
    toggle.textContent=c?'☰':'‹';toggle.setAttribute('aria-expanded',String(!c));
  });
  const current=location.pathname.replace(/\/+$/,'')||'/';
  $$('.nus-link').forEach(link=>{
    const p=new URL(link.href,location.origin).pathname.replace(/\/+$/,'')||'/';
    if(p===current){link.classList.add('nus-active');const menu=link.closest('.nus-group-menu');if(menu){menu.hidden=false;const b=$(`[aria-controls="${menu.id}"]`);if(b)b.setAttribute('aria-expanded','true');}}
    link.addEventListener('click',()=>{if(innerWidth<=767){document.body.classList.add('nus-collapsed');toggle.textContent='☰';}});
  });
}
initSidebar();

$('#nus-choose').addEventListener('click',()=>$('#nus-file').click());
$('#nus-file').addEventListener('change',e=>{if(e.target.files[0]) handleFile(e.target.files[0]);});
const drop=$('#nus-drop');
['dragenter','dragover'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.style.opacity='.75';}));
['dragleave','drop'].forEach(ev=>drop.addEventListener(ev,e=>{e.preventDefault();drop.style.opacity='1';}));
drop.addEventListener('drop',e=>{const f=e.dataTransfer.files[0];if(f)handleFile(f);});

$('#nus-record-type').addEventListener('change',e=>{state.recordType=e.target.value;buildMapping();validateAndRender();});

function validateFile(file){
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(!['xlsx','xls','csv'].includes(ext)) throw new Error('Only .xlsx, .xls and .csv files are supported.');
  if(file.size>cfg.maxFileSize) throw new Error('File exceeds the 10 MB maximum size.');
}
function parseCsvText(text){
  text=String(text||'').replace(/^\uFEFF/,'');
  const rows=[]; let row=[]; let cell=''; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(quoted){
      if(ch==='"'){
        if(text[i+1]==='"'){cell+='"';i++;}
        else quoted=false;
      }else cell+=ch;
    }else{
      if(ch==='"') quoted=true;
      else if(ch===','){row.push(cell);cell='';}
      else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell='';}
      else if(ch==='\r'){
        if(text[i+1]==='\n') i++;
        row.push(cell);rows.push(row);row=[];cell='';
      }else cell+=ch;
    }
  }
  if(cell!=='' || row.length){row.push(cell);rows.push(row);}
  return rows.filter(r=>r.some(v=>String(v??'').trim()!==''));
}
function applyParsedRows(raw){
  if(!raw.length) throw new Error('The selected file is empty.');
  state.headers=(raw[0]||[]).map((h,i)=>String(h??('Column '+(i+1))).trim()||('Column '+(i+1)));
  if(!state.headers.length) throw new Error('No columns were found in the selected file.');
  state.rows=raw.slice(1).filter(r=>Array.isArray(r) && r.some(v=>String(v??'').trim()!=='')).map((r,i)=>{
    const obj={};state.headers.forEach((h,j)=>obj[h]=String(r[j]??'').trim());obj.__row=i+2;return obj;
  });
  buildMapping();validateAndRender();
  if(state.rows.length===0){
    alertBox('File loaded, but no data rows were found below the header row. Check that your Excel/CSV contains records under the column headings.','error');
  }else{
    alertBox('File loaded successfully. '+state.rows.length+' data rows detected.','success');
  }
}
function handleFile(file){
  try{validateFile(file);}catch(e){alertBox(e.message,'error');return;}
  state.file=file;
  const info=$('#nus-file-info');info.hidden=false;info.innerHTML='<span class="nus-badge ok">Uploaded</span><span class="name">'+esc(file.name)+'</span><span class="nus-muted">'+(file.size/1024).toFixed(1)+' KB</span>';
  const ext=(file.name.split('.').pop()||'').toLowerCase();
  if(ext==='csv'){
    const reader=new FileReader();
    reader.onerror=()=>alertBox('Could not read the CSV file.','error');
    reader.onload=e=>{try{applyParsedRows(parseCsvText(e.target.result));}catch(err){alertBox(err.message||'Could not read the CSV file.','error');}};
    reader.readAsText(file,'utf-8');
    return;
  }
  if(typeof XLSX==='undefined'){
    alertBox('Excel reader could not be loaded. Please refresh the page and try again, or save the Excel file as CSV.','error');
    return;
  }
  const reader=new FileReader();
  reader.onerror=()=>alertBox('Could not read the spreadsheet file.','error');
  reader.onload=e=>{
    try{
      const wb=XLSX.read(e.target.result,{type:'array',cellDates:true});
      if(!wb.SheetNames.length) throw new Error('The spreadsheet contains no worksheets.');
      const ws=wb.Sheets[wb.SheetNames[0]];
      const raw=XLSX.utils.sheet_to_json(ws,{header:1,defval:'',raw:false,blankrows:false});
      applyParsedRows(raw);
    }catch(err){alertBox(err.message||'Could not read the spreadsheet.','error');}
  };
  reader.readAsArrayBuffer(file);
}
const fields={
  container:[
    ['Container Number','container_number'],['Date','date'],['Shipping Line','shipping_line'],['Booking Number','booking_number'],
    ['Shipment ID','shipment_id'],['Mobile','mobile'],['Export Status','export_status'],['Export Date','export_date'],
    ['BL Number','bl_number'],['Vessel / Voyage','vessel_voyage'],['Seal Number','seal_number'],['Arrival Date','arrival_date'],
    ['Free Days Until','free_days_until'],['Remarks','remarks']
  ],
  register_entry:[
    ['Entry Date','entry_date'],['Container Number','container_number'],['Shipping / Booking Ref','shipping_reference'],
    ['Shipment ID','shipment_id'],['Mobile','mobile'],['Export Status','export_status'],['Export Date','export_date'],['Remarks','remarks']
  ],
  shipping_line:[['Shipping Line','shipping_line'],['Contact','contact'],['Phone','phone'],['Email','email'],['Remarks','remarks']],
  generic:[['Name','name'],['Phone','phone'],['Email','email'],['City','city'],['Remarks','remarks']]
};

function buildMapping(){
  const wrap=$('#nus-mapping');
  if(!state.headers.length){wrap.innerHTML='<div class="nus-muted">Upload a file to load its columns.</div>';return;}
  const list=fields[state.recordType]||fields.generic;
  wrap.innerHTML=list.map(([label,key])=>{
    const guess=state.headers.find(h=>h.toLowerCase().replace(/[^a-z0-9]/g,'')===label.toLowerCase().replace(/[^a-z0-9]/g,''))||
      state.headers.find(h=>h.toLowerCase().includes(label.toLowerCase().split(' ')[0]));
    const options=['<option value="">Do not import</option>'].concat(state.headers.map(h=>'<option value="'+esc(h)+'">'+esc(h)+'</option>'));
    return '<label class="nus-map">'+esc(label)+'<span>Field: '+esc(key)+'</span><select data-field="'+esc(key)+'">'+options.join('')+'</select></label>';
  }).join('');
  $$('#nus-mapping select').forEach(s=>{
    const label=s.closest('.nus-map').firstChild.textContent.trim();
    const guess=state.headers.find(h=>h.toLowerCase().replace(/[^a-z0-9]/g,'')===label.toLowerCase().replace(/[^a-z0-9]/g,''));
    if(guess)s.value=guess;
    s.addEventListener('change',validateAndRender);
  });
}
function readMapping(){
  state.mapping={};$$('#nus-mapping select').forEach(s=>{if(s.value)state.mapping[s.dataset.field]=s.value;});return state.mapping;
}
function normalize(v){return String(v??'').trim().toLowerCase().replace(/[\s\-_/().]+/g,'');}
function getMapped(row,key){const col=state.mapping[key];return col?String(row[col]??'').trim():'';}
function isRealDate(value){
  const v=String(value??'').trim();
  if(!v) return true;
  let y,m,d,match=v.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})$/);
  if(match){y=+match[1];m=+match[2];d=+match[3];}
  else {match=v.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(match){m=+match[1];d=+match[2];y=+match[3];}else return false;}
  if(y<1900||y>2100||m<1||m>12||d<1||d>31) return false;
  const dt=new Date(Date.UTC(y,m-1,d));
  return dt.getUTCFullYear()===y&&dt.getUTCMonth()===m-1&&dt.getUTCDate()===d;
}
function validateMappedDates(data,errors){
  const dateFields={date:'Date',entry_date:'Entry date',export_date:'Export date',arrival_date:'Arrival date',free_days_until:'Free days until'};
  Object.entries(dateFields).forEach(([key,label])=>{if(data[key]&&!isRealDate(data[key]))errors.push(label+' is not a valid date. Use YYYY-MM-DD or DD/MM/YYYY.');});
}
function normalizeContainer(v){return String(v??'').trim().toUpperCase().replace(/\s+/g,'');}
function checkRows(){
  readMapping();
  const results=[],seen=new Set();
  state.rows.forEach(row=>{
    const data={};Object.entries(state.mapping).forEach(([key,col])=>data[key]=String(row[col]??'').trim());
    const errors=[],type=state.recordType;
    if(type==='container'||type==='register_entry'){
      if(!data.container_number) errors.push('Container number is required.');
      else if(!/^[A-Z]{4}\d{7}$/.test(normalizeContainer(data.container_number))) errors.push('Container number format is invalid. Expected 4 letters followed by 7 digits.');
    }
    if(data.mobile&&!/^[0-9+()\-\s]{7,20}$/.test(data.mobile)) errors.push('Mobile number is not valid.');
    if(data.phone&&!/^[0-9+()\-\s]{7,20}$/.test(data.phone)) errors.push('Phone number is not valid.');
    if(type==='shipping_line'&&!data.shipping_line) errors.push('Shipping line is required.');
    if(type==='generic'&&!data.name) errors.push('Name is required.');
    validateMappedDates(data,errors);
    const key=(type==='container'||type==='register_entry')?normalizeContainer(data.container_number):(data.shipping_line||data.name||JSON.stringify(data)).trim().toLowerCase();
    let status='valid',reason='';
    if(errors.length){status='error';reason=errors.join(' ');}
    else if(key&&seen.has(key)){status='duplicate';reason='Duplicate of an earlier row.';}
    else if(key) seen.add(key);
    results.push({sourceRow:row.__row,status,reason,data});
  });
  return results;
}

function renderCellValue(key,value,reason,status){
  const text=esc(value);
  if(status==='error' && reason && reason.toLowerCase().includes(key.replace('_',' '))) return text+'<small>'+esc(reason)+'</small>';
  return text;
}
function validateAndRender(){
  if(!state.rows.length){$('#nus-total').textContent='0';$('#nus-valid').textContent='0';$('#nus-duplicates').textContent='0';$('#nus-errors').textContent='0';return;}
  state.checkedRows=checkRows();
  const valid=state.checkedRows.filter(r=>r.status==='valid').length,dup=state.checkedRows.filter(r=>r.status==='duplicate').length,err=state.checkedRows.filter(r=>r.status==='error').length;
  $('#nus-total').textContent=state.checkedRows.length;$('#nus-valid').textContent=valid;$('#nus-duplicates').textContent=dup;$('#nus-errors').textContent=err;
  const keys=Object.keys(state.mapping);
  $('#nus-preview-head').innerHTML='<tr><th>Row</th>'+keys.map(k=>'<th>'+esc(k.replace(/_/g,' '))+'</th>').join('')+'<th>Status</th></tr>';
  $('#nus-preview-body').innerHTML=state.checkedRows.map(r=>{
    const cls=r.status==='error'?'error':r.status==='duplicate'?'dup':'';
    const cells=keys.map(k=>{
      const v=r.data[k]??'';const bad=r.status==='error'&&r.reason.toLowerCase().includes(k.replace(/_/g,' '));
      return '<td class="'+(bad?'bad':'')+'">'+esc(v)+(bad?'<small>'+esc(r.reason)+'</small>':'')+'</td>';
    }).join('');
    const badge=r.status==='valid'?'<span class="nus-badge ok">Valid</span>':r.status==='duplicate'?'<span class="nus-badge warn">Duplicate</span>':'<span class="nus-badge err">Error</span>';
    return '<tr class="'+cls+'"><td>'+r.sourceRow+'</td>'+cells+'<td>'+badge+(r.status!=='valid'&&!r.reason.toLowerCase().includes('required')?'<small>'+esc(r.reason)+'</small>':'')+'</td></tr>';
  }).join('');
  $('#nus-confirm').disabled=valid===0;
  $('#nus-confirm').textContent='Confirm import ('+valid+' rows)';
  $('#nus-error-report').disabled=err===0;
}
$('#nus-confirm').addEventListener('click',async()=>{
  if(!state.file||!state.checkedRows.length)return;
  const valid=state.checkedRows.filter(r=>r.status==='valid');
  if(!valid.length)return;
  if(!confirm('Import '+valid.length+' valid rows now?'))return;
  const btn=$('#nus-confirm');btn.disabled=true;btn.textContent='Importing…';
  try{
    const result=await api('nus_ib_import',{payload:{
      fileName:state.file.name,fileSize:state.file.size,recordType:state.recordType,mapping:state.mapping,
      rows:state.checkedRows
    }});
    alertBox('Import completed: '+result.imported+' imported, '+result.skipped+' skipped, '+result.errors+' errors.','success');
    setTab('history');
  }catch(e){alertBox(e.message,'error');btn.disabled=false;validateAndRender();}
});
$('#nus-cancel').addEventListener('click',()=>{
  state.file=null;state.headers=[];state.rows=[];state.mapping={};state.checkedRows=[];
  $('#nus-file').value='';$('#nus-file-info').hidden=true;$('#nus-mapping').innerHTML='<div class="nus-muted">Upload a file to load its columns.</div>';
  $('#nus-preview-head').innerHTML='<tr><th>Row</th><th>Status</th></tr>';$('#nus-preview-body').innerHTML='<tr><td colspan="2" class="nus-muted">Upload a file to preview it.</td></tr>';
  validateAndRender();
});
$('#nus-error-report').addEventListener('click',()=>{
  const errors=state.checkedRows.filter(r=>r.status!=='valid');
  const lines=['Row,Status,Reason'];
  errors.forEach(r=>lines.push([r.sourceRow,r.status,r.reason].map(v=>'"'+String(v).replace(/"/g,'""')+'"').join(',')));
  downloadBlob(lines.join('\n'),'nus-import-errors.csv','text/csv;charset=utf-8');
});
$('#nus-sample').addEventListener('click',()=>{
  // Generate the sample entirely in the browser. This avoids caching, AJAX,
  // content-type and WordPress output issues and guarantees real data rows.
  const rows = [
    ['Container Number','Date','Shipping Line','Booking Number','Shipment ID','Mobile','Export Status','Export Date','Remarks'],
    ['MSCU1234567','2026-10-23','MSC','BOOK123','SHIP123','03001234567','Pending','','Sample record 1'],
    ['TCLU7654321','2026-10-24','Maersk','BOOK456','SHIP456','03111234567','Exported','2026-10-25','Sample record 2'],
    ['OOLU2468135','2026-10-25','CMA CGM','BOOK789','SHIP789','03211234567','Pending','','Sample record 3']
  ];
  const csv = rows.map(row => row.map(v => '"'+String(v).replace(/"/g,'""')+'"').join(',')).join('\r\n')+'\r\n';
  downloadBlob(csv,'nus-import-template.csv','text/csv;charset=utf-8');
  alertBox('Sample template downloaded with 3 example records.','success');
});
function downloadBlob(content,name,type){const blob=new Blob([content],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

async function loadHistory(){
  const body=$('#nus-history-body');body.innerHTML='<tr><td colspan="7" class="nus-muted">Loading…</td></tr>';
  try{
    const data=await api('nus_ib_history');
    body.innerHTML=data.length?data.map(r=>'<tr><td>'+esc(r.date)+'</td><td>'+esc(r.file)+'</td><td>'+esc(r.importedBy)+'</td><td>'+r.imported+'</td><td>'+r.skipped+'</td><td>'+r.errors+'</td><td><span class="nus-badge '+(r.status==='Completed'?'ok':r.status==='Failed'?'err':'warn')+'">'+esc(r.status)+'</span></td></tr>').join(''):'<tr><td colspan="7" class="nus-muted">No imports yet.</td></tr>';
  }catch(e){body.innerHTML='<tr><td colspan="7" class="nus-muted">Could not load history.</td></tr>';alertBox(e.message,'error');}
}
async function loadBackups(){
  const body=$('#nus-backup-body');body.innerHTML='<tr><td colspan="5" class="nus-muted">Loading…</td></tr>';
  try{
    const data=await api('nus_ib_list_backups');
    body.innerHTML=data.length?data.map(r=>'<tr><td>'+esc(r.name)+'</td><td>'+esc(r.created)+'</td><td>'+esc(r.size)+'</td><td><span class="nus-badge '+(r.type==='Manual'?'ok':'')+'">'+esc(r.type)+'</span></td><td><div class="nus-row-actions"><button class="nus-btn ghost sm" data-download="'+r.id+'">Download</button><button class="nus-btn danger sm" data-restore="'+r.id+'">Restore</button><button class="nus-btn ghost sm" data-delete="'+r.id+'">Delete</button></div></td></tr>').join(''):'<tr><td colspan="5" class="nus-muted">No backups yet.</td></tr>';
    $$('[data-download]').forEach(b=>b.onclick=downloadBackup);$$('[data-restore]').forEach(b=>b.onclick=restoreBackup);$$('[data-delete]').forEach(b=>b.onclick=deleteBackup);
  }catch(e){body.innerHTML='<tr><td colspan="5" class="nus-muted">Could not load backups.</td></tr>';alertBox(e.message,'error');}
}
async function downloadBackup(e){
  try{const d=await api('nus_ib_download_backup',{id:e.currentTarget.dataset.download});window.location.href=d.url;}
  catch(err){alertBox(err.message,'error');}
}
async function restoreBackup(e){
  const id=e.currentTarget.dataset.restore;
  if(!confirm('Restore this backup? Current Import & Backup module data will be replaced.'))return;
  try{await api('nus_ib_restore_backup',{id});alertBox('Backup restored successfully.','success');loadHistory();loadBackups();}
  catch(err){alertBox(err.message,'error');}
}
async function deleteBackup(e){
  const id=e.currentTarget.dataset.delete;
  if(!confirm('Delete this backup permanently?'))return;
  try{await api('nus_ib_delete_backup',{id});alertBox('Backup deleted.','success');loadBackups();}
  catch(err){alertBox(err.message,'error');}
}
$('#nus-create-backup').addEventListener('click',async()=>{
  const b=$('#nus-create-backup');b.disabled=true;b.textContent='Creating…';
  try{await api('nus_ib_create_backup');alertBox('Backup created successfully.','success');loadBackups();}
  catch(e){alertBox(e.message,'error');}
  finally{b.disabled=false;b.textContent='Create backup now';}
});

if(!cfg.isAdmin){
  $('#nus-confirm').disabled=true;$('#nus-create-backup').disabled=true;
  alertBox('Administrator permission is required for importing and backup operations.','error');
}
})();
