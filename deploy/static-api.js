const nativeFetch=window.fetch.bind(window);
const RECORDS_KEY='marginalia-private-site-records-v1';
const EXPERIENCES_KEY='marginalia-private-site-experiences-v1';
let bookPromise=null,packPromise=null;

const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'}});
const readJson=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key)||'null')||fallback();}catch{return fallback();}};
const writeJson=(key,value)=>{localStorage.setItem(key,JSON.stringify(value));return value;};
const book=()=>bookPromise||=(nativeFetch('/book.json').then(r=>r.json()));
const pack=()=>packPromise||=(nativeFetch('/experience-pack.json').then(r=>r.json()));
const emptyRecords=b=>({kind:'marginalia-personal-records',schemaVersion:2,bookId:b.bookId,contentVersion:b.contentVersion,comments:[],questions:[],readingSessions:[],position:null});
const emptyExperiences=b=>({kind:'marginalia-reading-experiences',schemaVersion:1,bookId:b.bookId,contentVersion:b.contentVersion,states:{},echoes:[],events:[]});
const bodyOf=async options=>{try{return JSON.parse(options?.body||'null');}catch{return null;}};
const mergeBy=(left,right,key='id')=>{const map=new Map(left.map(row=>[row[key],row]));for(const row of right)if(!map.has(row[key]))map.set(row[key],row);return [...map.values()];};
const downloadJson=(filename,data)=>{const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};

async function localApi(path,method,options){
  const b=await book(),records=readJson(RECORDS_KEY,()=>emptyRecords(b)),experiences=readJson(EXPERIENCES_KEY,()=>emptyExperiences(b));
  if(method==='GET'&&path==='/api/book')return json(b);
  if(method==='GET'&&(path==='/api/records'||path==='/api/records/export'))return json(records);
  if(method==='GET'&&path==='/api/experiences')return json({...await pack(),states:experiences.states,echoes:experiences.echoes,echoAvailable:false});
  if(method==='GET'&&path==='/api/experiences/export')return json(experiences);
  if(method==='GET'&&path==='/api/experience-metrics')return nativeFetch('/experience-metrics.json');
  if(method==='GET'&&path.startsWith('/api/echo/'))return json({error:'远程私有阅读版尚未连接实时回声服务'},503);
  if(method!=='POST')return json({error:'找不到这个操作'},404);
  const input=await bodyOf(options);
  if(path==='/api/progress'){
    records.position=input;writeJson(RECORDS_KEY,records);return json(input);
  }
  if(path==='/api/comments'||path==='/api/questions'){
    if(!input?.id||!input?.passageId||!input?.text?.trim())return json({error:'记录内容不完整'},400);
    const key=path.endsWith('questions')?'questions':'comments',record={...input,bookId:b.bookId,contentVersion:b.contentVersion,origin:'user',createdAt:input.createdAt||new Date().toISOString(),...(key==='questions'?{status:'open'}:{})};
    const prior=records[key].find(row=>row.id===record.id);if(!prior)records[key].push(record);writeJson(RECORDS_KEY,records);return json(prior||record,prior?200:201);
  }
  if(path==='/api/records/import'){
    if(input?.kind!=='marginalia-personal-records'||input.bookId!==b.bookId)return json({error:'请选择这本书的个人记录包'},400);
    records.comments=mergeBy(records.comments,input.comments||[]);records.questions=mergeBy(records.questions,input.questions||[]);records.readingSessions=mergeBy(records.readingSessions,input.readingSessions||[]);if(input.position)records.position=input.position;writeJson(RECORDS_KEY,records);return json({comments:records.comments.length,questions:records.questions.length});
  }
  if(path==='/api/experience-state'){
    const card=(await pack()).cards.find(row=>row.id===input?.cardId&&row.chapterId===input.chapterId);if(!card)return json({error:'站队卡片不属于这一章'},400);
    const state={...(experiences.states[input.chapterId]||{shown:false,skipped:false,choice:null})};if(input.action==='shown')state.shown=true;if(input.action==='skip'){state.shown=true;state.skipped=true;}if(input.action==='choose'){state.shown=true;state.choice=input.choiceId;}experiences.states[input.chapterId]=state;writeJson(EXPERIENCES_KEY,experiences);return json({chapterId:input.chapterId,state});
  }
  if(path==='/api/experience-events'){
    experiences.events=mergeBy(experiences.events,input?.events||[]);writeJson(EXPERIENCES_KEY,experiences);return json({accepted:(input?.events||[]).length,total:experiences.events.length});
  }
  if(path==='/api/experiences/import'){
    if(input?.kind!=='marginalia-reading-experiences'||input.bookId!==b.bookId)return json({error:'请选择这本书的阅读体验记录包'},400);
    experiences.states={...input.states,...experiences.states};experiences.echoes=mergeBy(experiences.echoes,input.echoes||[],'runId');experiences.events=mergeBy(experiences.events,input.events||[]);writeJson(EXPERIENCES_KEY,experiences);return json({states:Object.keys(experiences.states).length,echoes:experiences.echoes.length,events:experiences.events.length});
  }
  if(path==='/api/echo'||path==='/api/explain'||/\/api\/echo\/[^/]+\/cancel$/.test(path))return json({error:'远程私有阅读版尚未连接实时回声服务'},503);
  return json({error:'找不到这个操作'},404);
}

window.fetch=async(input,options={})=>{
  const request=input instanceof Request?input:null,url=new URL(request?.url||String(input),location.href),method=(options.method||request?.method||'GET').toUpperCase();
  if(url.origin===location.origin&&url.pathname.startsWith('/api/'))return localApi(url.pathname,method,options);
  return nativeFetch(input,options);
};

document.addEventListener('click',async event=>{
  const link=event.target.closest('a[href="/api/experiences/export"]');if(!link)return;event.preventDefault();
  const b=await book();downloadJson('marginalia-experiences.json',readJson(EXPERIENCES_KEY,()=>emptyExperiences(b)));
},{capture:true});
