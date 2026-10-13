import {positionStorageKey} from './reading-progress.mjs';
import {validateLibraryBackup} from './library-backup.mjs';
import {createUploadState} from './upload-state.mjs';
import {createOwnerScope,readOwnerResponse} from './owner-scope.mjs';
import {safeReaderReturn} from './reader-return.mjs';
import {createGrantResult,grantScopeSummary} from './grant-result.mjs';
import {makeMcpConfiguration} from './mcp-config.mjs';
import {chineseTrialUrl} from './catalog-sample.mjs';
const $=id=>document.getElementById(id);
const make=(tag,cls,text)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n;};
const ownerScope=createOwnerScope();
const grantResult=createGrantResult();let grantBusy=false;
let mcpSetup=null,mcpSetupBusy=false,mcpReceipt=null,mcpSetupSequence=0;
const api=(url,data,ticket=ownerScope.capture())=>readOwnerResponse(ownerScope,ticket,()=>fetch(url,{...(data===undefined?{}:{method:'POST',body:JSON.stringify(data)}),headers:{'Content-Type':'application/json',...(url.startsWith('/api/library')?{'X-Reader-Owner':ticket.owner}:{})}}),()=>{ownerScope.adopt('guest');session={...session,user:null};clearPrivateUI();location.reload();});
const status=(id,text,error=false)=>{$(id).textContent=text;$(id).classList.toggle('error',error);};
let session=null,books=[],shelf='all',pendingUpload=false,restoringLibrary=false,upload=createUploadState();
const isLibrary=location.pathname==='/library';$('home-view').hidden=isLibrary;$('library-view').hidden=!isLibrary;
const entryQuery=new URLSearchParams(location.search),returnToReader=safeReaderReturn(entryQuery.get('next'));
const returnAfterAuth=()=>{if(returnToReader&&!pendingUpload){location.replace(returnToReader);return true;}if(!isLibrary){location.href='/library';return true;}return false;};
if(isLibrary)document.title='我的书房 · 旁读 Marginalia';
const openAuth=()=>{$('auth-status').textContent=session?.emailAvailable?'':session?.localAvailable?'邮箱服务尚未配置。你可以先试读，或进入本机书房。':'邮箱登录准备中。现在可以直接试读三本公版书。';$('auth-dialog').showModal();};
const ensureUser=()=>{if(session?.user)return true;openAuth();return false;};
function clearPrivateUI(){
  $('data-controls').hidden=true;$('toggle-data').setAttribute('aria-expanded','false');grantResult.clear();renderGrantResult();grantBusy=false;$('create-grant').disabled=false;$('create-grant').textContent='创建 7 天授权 →';$('grant-list').replaceChildren();$('grant-form').reset();
  for(const id of ['data-status','upload-status','auth-status','library-status','upload-filename'])status(id,'');
  for(const id of ['email','email-code','book-file','backup-file','book-search'])$(id).value='';$('verify-form').hidden=true;
  if($('auth-dialog').open)$('auth-dialog').close();if($('upload-dialog').open)$('upload-dialog').close();$('upload-dialog').removeAttribute('aria-busy');$('confirm-upload').disabled=true;$('book-file').disabled=false;$('restore-library').disabled=false;
  pendingUpload=false;restoringLibrary=false;upload=createUploadState();shelf='all';document.querySelectorAll('[data-shelf]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.shelf==='all')));
  books=books.filter(b=>b.visibility==='public').map(b=>({...b,resume:null}));renderBooks();$('featured-books').replaceChildren(...books.slice(0,3).map(bookCard));
}
function bookCard(book){
  const card=make('article','book-card'),art=make('a','book-art '+(book.cover||'private'));art.href='/read?book='+encodeURIComponent(book.bookId);art.setAttribute('aria-label','阅读'+book.title.zh);
  const cover=make('div','book-cover'),inner=make('div','cover-inner');inner.append(make('small','',book.visibility==='public'?'THE MARGINALIA LIBRARY':'MY READING ROOM'),make('strong','',book.title.zh.slice(0,28)),make('span','cover-ornament',book.cover==='alice'?'❦':book.cover==='walden'?'⌁':'☼'),make('small','',book.visibility==='public'?'ORIGINAL TEXT':'A BOOK OF MY OWN'));cover.append(inner);art.append(cover);
  const meta=make('div','book-meta'),label=make('div','book-label');label.append(make('span','',book.visibility==='public'?'公版 · 英文原文':'自己的书 · '+book.source.format.toUpperCase()),make('span','',book.chineseSample?'双译开篇 · '+book.chineseSample.paragraphs+' 段':book.visibility==='public'?'按需翻译':'已提取'));
  meta.append(label,make('h3','',book.title.zh),make('p','book-author',book.author||book.source.filename),make('p','book-description',book.description||'原文已保留。译文和思考，从这一页开始。'));
  let resume=book.resume;if(!session?.user){try{const local=JSON.parse(localStorage.getItem(positionStorageKey(book.bookId))||'null');if(local?.passageId&&local.chapterLabel&&local.contentVersion===book.source.sha256)resume={label:local.chapterLabel,passageId:local.passageId};}catch{}}
  if(resume){meta.append(make('p','book-resume','上次读到 · '+resume.label));art.setAttribute('aria-label','继续阅读'+book.title.zh);}
  if(book.chineseSample&&!resume)art.href=chineseTrialUrl(book);
  const bottom=make('div','book-bottom'),read=make('a','book-read',resume?'继续阅读 →':book.chineseSample?'中文试读 →':'开始阅读 →');read.href=art.href;bottom.append(read);
  if(book.chineseSample&&resume){const trial=make('a','source-link','中文试读 ↗');trial.href=chineseTrialUrl(book);meta.append(trial);}
  if(book.source.url){const source=make('a','source-link','来源 ↗');source.href=book.source.url;source.target='_blank';source.rel='noopener noreferrer';bottom.append(source);}else bottom.append(make('span','',book.paragraphs+' 段'));
  meta.append(bottom);card.append(art,meta);return card;
}
function renderBooks(){const query=$('book-search').value.trim().toLowerCase();const filtered=books.filter(b=>(shelf!=='private'||b.visibility==='private')&&(!query||(b.title.zh+' '+b.title.en+' '+b.author).toLowerCase().includes(query)));$('library-books').replaceChildren(...filtered.map(bookCard));$('empty-shelf').hidden=!!filtered.length;$('empty-shelf').querySelector('h2').textContent=query?'没有找到这本书。':'给自己的书留一个位置。';const select=$('grant-book');select.replaceChildren(...books.map(b=>{const option=make('option','',b.title.zh);option.value=b.bookId;return option;}));}
async function refresh(knownSession){
  const next=knownSession||await api('/api/auth/session'),continueUpload=!session?.user&&next.user&&pendingUpload,changed=ownerScope.adopt(next.user?.id||'guest');session=next;
  if(changed){clearPrivateUI();pendingUpload=!!continueUpload;}
  $('local-entry').hidden=!session.localAvailable;$('send-code').disabled=!session.emailAvailable;$('auth-intro').textContent=session.emailAvailable?'用邮箱进入，无需记住密码。第一次验证后，会为你建立书房。':session.localAvailable?'本机书房已准备好。邮箱登录需先配置邮件服务。':'邮箱登录准备中。你可以先试读，无需注册。';const user=session.user;
  $('account-button').textContent=user?(user.kind==='local'?'本机书房 · 退出':'已登录 · 退出'):'登录 / 注册 ↗';
  $('library-description').textContent=user?(user.kind==='local'?'自己的书，留在这台电脑。回来时，从上次停下的地方继续。':'自己的书与思考，安静地留在这里。'):'先选一本书，读几页。自己的书和笔记，登录后留在这里。';
  books=(await api('/api/library')).books;renderBooks();$('featured-books').replaceChildren(...books.filter(b=>b.visibility==='public').slice(0,3).map(bookCard));
}
$('account-button').addEventListener('click',async()=>{
  if(!session?.user){openAuth();return;}const b=$('account-button'),ticket=ownerScope.capture();b.disabled=true;let signedOut=false;
  try{await api('/api/auth/logout',{},ticket);session={...session,user:null};ownerScope.adopt('guest');clearPrivateUI();signedOut=true;b.textContent='登录 / 注册 ↗';$('library-description').textContent='先选一本书，读几页。自己的书和笔记，登录后留在这里。';await refresh();status('library-status','已退出。私人书籍和授权信息已从页面清除。');}
  catch(error){if(signedOut)status('library-status','已退出。页面私人内容已清除，书架暂时无法刷新。',true);else if(ownerScope.isCurrent(ticket))status('library-status',error.message,true);}
  finally{b.disabled=false;}
});
document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>$(b.dataset.close).close()));
for(const dialog of document.querySelectorAll('dialog'))dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)dialog.close();}});
$('email-form').addEventListener('submit',async e=>{e.preventDefault();const b=$('send-code');b.disabled=true;status('auth-status','正在发送验证码…');try{await api('/api/auth/code',{email:$('email').value});$('verify-form').hidden=false;$('email-code').focus();status('auth-status','验证码已发送，请查看邮箱。10 分钟内有效。');}catch(error){status('auth-status',error.message,true);}finally{b.disabled=!session?.emailAvailable;}});
$('verify-form').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button');b.disabled=true;try{await api('/api/auth/verify',{email:$('email').value,code:$('email-code').value});$('auth-dialog').close();if(returnAfterAuth())return;await refresh();status('library-status','欢迎回来。');if(pendingUpload)openUpload();}catch(error){status('auth-status',error.message,true);}finally{b.disabled=false;}});
$('local-login').addEventListener('click',async()=>{try{await api('/api/auth/local',{});$('auth-dialog').close();if(returnAfterAuth())return;await refresh();if(pendingUpload)openUpload();}catch(error){status('auth-status',error.message,true);}});
function openUpload(){pendingUpload=true;if(!ensureUser())return;pendingUpload=false;if(!upload.file){$('book-file').value='';$('upload-filename').textContent='';status('upload-status','');$('confirm-upload').textContent='放进我的书房 →';}$('confirm-upload').disabled=upload.busy||!upload.file;$('upload-dialog').showModal();}
for(const id of ['upload-button','empty-upload'])$(id).addEventListener('click',openUpload);
function selectFile(file){if(!file||upload.busy)return;$('upload-filename').textContent='';$('confirm-upload').disabled=true;$('book-file').value='';try{upload.select(file);$('upload-filename').textContent=file.name+' · '+(file.size>=1024*1024?(file.size/1024/1024).toFixed(2)+' MB':Math.max(1,Math.ceil(file.size/1024))+' KB');$('confirm-upload').textContent='放进我的书房 →';$('confirm-upload').disabled=false;status('upload-status','');}catch(error){status('upload-status',error.message,true);}}
$('book-file').addEventListener('change',e=>selectFile(e.target.files[0]));
const drop=$('drop-zone');for(const event of ['dragenter','dragover'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.add('dragging');});for(const event of ['dragleave','drop'])drop.addEventListener(event,e=>{e.preventDefault();drop.classList.remove('dragging');if(event==='drop')selectFile(e.dataTransfer.files[0]);});
$('confirm-upload').addEventListener('click',async()=>{
  if(!upload.file||upload.busy)return;const ticket=ownerScope.capture(),operation=upload,file=operation.begin(),b=$('confirm-upload');let succeeded=false;b.disabled=true;$('book-file').disabled=true;b.textContent='正在放进书房…';$('upload-dialog').setAttribute('aria-busy','true');status('upload-status',file.name.toLowerCase().endsWith('.pdf')?'正在提取 PDF 文字，请稍等…':'正在整理段落…');
  try{
    let book;
    if(session.directUpload){
      status('upload-status','正在将原文件存入你的私人书房…');
      const target=await api('/api/library/upload/start',{filename:file.name,bytes:file.size},ticket);
      const sent=await fetch(target.url,{method:'PUT',headers:{'Content-Type':'application/octet-stream'},body:file});
      if(!sent.ok)throw Error('原文件上传未完成。');
      status('upload-status','原文件已收到，正在提取并整理段落…');
      book=await api('/api/library/upload/complete',{id:target.id},ticket);
    }else{
      const base64=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result.split(',')[1]);reader.onerror=()=>reject(Error('文件无法读取，请重新选择。'));reader.readAsDataURL(file);});
      book=await api('/api/library/upload',{filename:file.name,base64},ticket);
    }
    succeeded=true;
    if($('upload-dialog').open){status('upload-status','已放进书房，正在打开第一段。');location.href='/read?book='+encodeURIComponent(book.bookId);}else{await refresh();if(ownerScope.isCurrent(ticket))status('library-status',file.name+' 已放进书房。');}
  }catch(error){if(!ownerScope.isCurrent(ticket))return;status('upload-status',error.message+' 你可以重试，或选择另一份文件。',true);b.textContent='重试上传 →';if(!$('upload-dialog').open)status('library-status',file.name+' 上传未完成。打开上传窗口可重试。',true);}
  finally{operation.finish();if(succeeded)operation.reset();if(ownerScope.isCurrent(ticket)){b.disabled=!operation.file;$('book-file').disabled=false;$('upload-dialog').removeAttribute('aria-busy');}}
});
document.querySelectorAll('[data-shelf]').forEach(b=>b.addEventListener('click',()=>{shelf=b.dataset.shelf;document.querySelectorAll('[data-shelf]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderBooks();}));$('book-search').addEventListener('input',renderBooks);
$('toggle-data').addEventListener('click',async()=>{if(!ensureUser())return;const expanded=$('data-controls').hidden;$('data-controls').hidden=!expanded;$('toggle-data').setAttribute('aria-expanded',String(expanded));if(expanded)await renderGrants();});
$('export-library').addEventListener('click',async()=>{try{const data=await api('/api/library/export'),url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=make('a');a.href=url;a.download='marginalia-library.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);status('data-status','书房已导出，包含原文与译文，也保存记录和位置。');}catch(error){status('data-status',error.message,true);}});
$('restore-library').addEventListener('click',()=>{if(!restoringLibrary)$('backup-file').click();});
$('backup-file').addEventListener('change',async e=>{
  const ticket=ownerScope.capture(),file=e.target.files[0];if(!file||restoringLibrary)return;restoringLibrary=true;$('restore-library').disabled=true;let restored=0,started=false;
  try{
    status('data-status','正在检查备份，检查通过后才开始恢复…');let backup;try{backup=JSON.parse(await file.text());}catch{throw Error('备份无法读取，请选择完整的旁读 JSON 备份。');}validateLibraryBackup(backup);
    for(const [index,entry] of backup.books.entries()){if(!ownerScope.isCurrent(ticket))return;status('data-status','正在检查第 '+(index+1)+' / '+backup.books.length+' 本书的原文版本…');await api('/api/library/validate',{kind:'marginalia-library',schemaVersion:1,books:[entry]},ticket);}
    started=true;for(const entry of backup.books){if(!ownerScope.isCurrent(ticket))return;status('data-status','正在恢复 '+(restored+1)+' / '+backup.books.length+' 本书…');await restoreBook(entry,ticket);restored++;}
    await refresh();if(ownerScope.isCurrent(ticket))status('data-status','已恢复 '+restored+' 本书及其记录。');
  }catch(error){if(!ownerScope.isCurrent(ticket))return;await refresh().catch(()=>{});if(!ownerScope.isCurrent(ticket))return;status('data-status',(started?'已完整恢复 '+restored+' 本；当前书可能已恢复部分数据，可重复恢复。':'尚未写入任何书籍。')+error.message,true);}
  finally{if(ownerScope.isCurrent(ticket)){restoringLibrary=false;$('restore-library').disabled=false;e.target.value='';}}
});
async function restoreBook(entry,ticket){
  if(!entry?.book||!entry.records||!Array.isArray(entry.book.sections)||!['comments','questions','readingSessions'].every(k=>Array.isArray(entry.records[k])))throw Error('备份格式不完整');
  const baseBook={...entry.book,sections:entry.book.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({...p,translations:{}}))}))},empty={...entry.records,comments:[],questions:[],readingSessions:[],position:null};
  const send=async(book,records)=>api('/api/library/import',{kind:'marginalia-library',schemaVersion:1,books:[{book,records}]},ticket);
  await send(baseBook,empty);
  for(const key of ['comments','questions','readingSessions'])for(let start=0;start<entry.records[key].length;start+=50)await send(baseBook,{...empty,[key]:entry.records[key].slice(start,start+50)});
  const translated=entry.book.sections.flatMap(s=>s.paragraphs).filter(p=>Object.keys(p.translations||{}).length);
  for(let i=0;i<translated.length;i+=20){const updates=new Map(translated.slice(i,i+20).map(p=>[p.id,p.translations])),book={...baseBook,sections:baseBook.sections.map(s=>({...s,paragraphs:s.paragraphs.map(p=>({...p,translations:updates.get(p.id)||{}}))}))};await send(book,empty);}
  if(entry.records.position)await send(baseBook,{...empty,position:entry.records.position});
}
async function renderGrants(ticket=ownerScope.capture()){
  const listTicket=grantResult.beginList();try{const {grants}=await api('/api/library/grants',undefined,ticket);if(!grantResult.reconcile(grants,Date.now(),listTicket))return null;renderGrantResult();const visible=grants.filter(g=>!g.revoked);$('grant-list').replaceChildren(...visible.map(g=>{
    const row=make('div','grant-row');row.append(make('span','',(books.find(b=>b.bookId===g.bookId)?.title.zh||'书籍')+' · '+grantScopeSummary(g.scopes)+' · '+(Date.parse(g.expiresAt)<=Date.now()?'已到期':new Date(g.expiresAt).toLocaleDateString('zh-CN')+' 到期')));
    const b=make('button','','撤回');b.addEventListener('click',async()=>{b.disabled=true;try{await api('/api/library/grants/'+g.id+'/revoke',{},ticket);grantResult.revoke(g.id);renderGrantResult();const refreshed=await renderGrants(ticket);if(ownerScope.isCurrent(ticket)&&refreshed!==null)status('data-status',refreshed?'授权已撤回，Agent 的后续访问已停止。':'授权已撤回；列表暂时无法刷新，可重新打开管理面板。');}catch(error){if(ownerScope.isCurrent(ticket)){b.disabled=false;status('data-status',error.message,true);}}});row.append(b);return row;
  }));if(!visible.length)$('grant-list').append(make('p','muted','还没有有效授权。Agent 无法访问你的私人书房。'));return true;}catch(error){if(!grantResult.isListCurrent(listTicket))return null;if(ownerScope.isCurrent(ticket))status('data-status',error.message,true);return false;}
}
function renderGrantResult(){const result=grantResult.current();$('grant-result').hidden=!result;$('grant-token').value=result?.token||'';$('grant-token').type='password';$('copy-token').disabled=!result;$('show-token').textContent='显示令牌';$('show-token').setAttribute('aria-pressed','false');$('grant-summary').textContent=result?(books.find(b=>b.bookId===result.bookId)?.title.zh||'书籍')+' · '+grantScopeSummary(result.scopes)+' · '+new Date(result.expiresAt).toLocaleDateString('zh-CN')+' 到期':'';if(!result||!mcpReceipt||mcpReceipt.id!==result.id||mcpReceipt.revision!==result.revision){mcpSetupSequence++;mcpSetup=null;mcpSetupBusy=false;mcpReceipt=result?{id:result.id,revision:result.revision}:null;$('mcp-guide').open=false;$('mcp-config-preview').textContent='';$('mcp-book-id').textContent=result?.bookId||'';$('mcp-config-status').textContent='';$('copy-mcp-config').disabled=true;$('save-mcp-config').disabled=true;}}
async function loadMcpSetup(){
  if(mcpSetupBusy||mcpSetup||!grantResult.current())return;const receipt=grantResult.current(),ticket=ownerScope.capture(),sequence=++mcpSetupSequence;mcpSetupBusy=true;$('mcp-config-preview').textContent='';$('copy-mcp-config').disabled=true;$('save-mcp-config').disabled=true;status('mcp-config-status','正在准备这台电脑的配置…');
  try{const setup=await api('/api/library/mcp-setup',undefined,ticket);if(sequence!==mcpSetupSequence||!grantResult.isCurrent(receipt))return;const preview=makeMcpConfiguration(setup,'本次令牌会在复制或保存时填入');mcpSetup=setup;$('mcp-config-preview').textContent=JSON.stringify(preview,null,2);$('copy-mcp-config').disabled=false;$('save-mcp-config').disabled=false;status('mcp-config-status','配置已准备好。保存到你的 Agent 后即可访问这本授权的书。');}
  catch(error){if(ownerScope.isCurrent(ticket)&&sequence===mcpSetupSequence&&grantResult.isCurrent(receipt))status('mcp-config-status',error.message,true);}
  finally{if(sequence===mcpSetupSequence)mcpSetupBusy=false;}
}
$('mcp-guide').addEventListener('toggle',()=>{if($('mcp-guide').open)loadMcpSetup();});
$('retry-mcp-config').addEventListener('click',()=>{if(!mcpSetupBusy){mcpSetup=null;loadMcpSetup();}});
async function deliverMcpConfiguration(download){
  const receipt=grantResult.current(),ticket=ownerScope.capture();if(!receipt||!mcpSetup){renderGrantResult();return;}
  try{ownerScope.assertCurrent(ticket);if(!grantResult.isCurrent(receipt))return;const text=JSON.stringify(makeMcpConfiguration(mcpSetup,receipt.token),null,2);
    if(download){const url=URL.createObjectURL(new Blob([text],{type:'application/json'})),a=make('a');a.href=url;a.download='marginalia-agent-config.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}else await navigator.clipboard.writeText(text);
    if(ownerScope.isCurrent(ticket)&&grantResult.isCurrent(receipt))status('mcp-config-status',download?'配置文件已交给浏览器保存，其中包含本次令牌。':'接入配置已复制，其中包含本次令牌。请只粘贴到自己的 Agent 设置中。');
  }catch(error){if(ownerScope.isCurrent(ticket)&&grantResult.isCurrent(receipt))status('mcp-config-status',download?error.message:'暂时无法复制，可保存配置文件后使用。',true);}
}
$('copy-mcp-config').addEventListener('click',()=>deliverMcpConfiguration(false));$('save-mcp-config').addEventListener('click',()=>deliverMcpConfiguration(true));
$('grant-form').addEventListener('submit',async e=>{
  e.preventDefault();if(grantBusy)return;const ticket=ownerScope.capture();grantBusy=true;$('create-grant').disabled=true;$('create-grant').textContent='正在创建…';try{const scopes=[...e.target.querySelectorAll('[name=scope]:checked')].map(n=>n.value);if(!scopes.length)throw Error('请选择至少一种数据');const grant=await api('/api/library/grants',{bookId:$('grant-book').value,scopes},ticket);grantResult.show(grant);renderGrantResult();const refreshed=await renderGrants(ticket);if(ownerScope.isCurrent(ticket)&&refreshed!==null)status('data-status',refreshed?'授权已创建，有效期 7 天。请按上方范围核对。':'授权已创建，令牌已保留在本页；列表暂时无法刷新。');}catch(error){if(ownerScope.isCurrent(ticket))status('data-status',error.message,true);}finally{if(ownerScope.isCurrent(ticket)){grantBusy=false;$('create-grant').disabled=false;$('create-grant').textContent='创建 7 天授权 →';}}
});
$('copy-token').addEventListener('click',async()=>{const ticket=ownerScope.capture(),receipt=grantResult.current();if(!receipt){renderGrantResult();return;}try{await navigator.clipboard.writeText(receipt.token);if(ownerScope.isCurrent(ticket)&&grantResult.isCurrent(receipt))status('data-status','已复制访问令牌。');}catch{if(ownerScope.isCurrent(ticket)&&grantResult.isCurrent(receipt))status('data-status','请先显示令牌，再选中手动复制。');}});
$('show-token').addEventListener('click',()=>{if(!grantResult.current()){renderGrantResult();return;}const visible=$('grant-token').type==='password';$('grant-token').type=visible?'text':'password';$('show-token').textContent=visible?'隐藏令牌':'显示令牌';$('show-token').setAttribute('aria-pressed',String(visible));});
$('dismiss-token').addEventListener('click',()=>{grantResult.clear();renderGrantResult();status('data-status','令牌已从本页收起。授权仍有效，可在下面撤回。');});
refresh().then(()=>{if(isLibrary&&entryQuery.get('login')==='1'){if(session?.user&&returnToReader)location.replace(returnToReader);else if(!session?.user)openAuth();}}).catch(error=>{status('library-status',error.message,true);$('featured-books').replaceChildren(make('p','muted','书架暂时无法连接，请稍后重试。'));});

const checkOwner=async()=>{if(document.hidden)return;try{const current=await api('/api/auth/session');if((current.user?.id||'guest')!==(session?.user?.id||'guest'))await refresh(current);}catch{}};
window.addEventListener('focus',checkOwner);document.addEventListener('visibilitychange',checkOwner);
