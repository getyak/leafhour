import {personError,validPersonId,PERSON_SECTIONS} from '../app/person-model.mjs';
const fail=(message,status=400,code='INVALID_ARGUMENTS')=>{throw personError(message,status,code);};
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))fail('Invalid request fields');}
function queryOptions(search,allowed){const result={};for(const [key,value]of search){if(!allowed.includes(key)||Object.hasOwn(result,key))fail('Invalid or repeated query field');if(key==='limit'){if(!/^[1-9]\d{0,2}$/.test(value)||Number(value)>100)fail('Invalid page limit');result.limit=Number(value);}else if(['includeDeleted','publicOnly'].includes(key)){if(!['true','false','1','0'].includes(value))fail('Invalid boolean query');result[key]=['true','1'].includes(value);}else{if(value.length>(key==='cursor'?4096:2000))fail('Query field is too long');if(key==='section'&&!PERSON_SECTIONS.includes(value))fail('Invalid person section');result[key]=value;}}return result;}
function identifier(raw){let id;try{id=decodeURIComponent(raw);}catch{fail('Invalid person identifier',404,'NOT_FOUND');}if(!validPersonId(id))fail('Person not found',404,'NOT_FOUND');return id;}
function parsedBody(body){if(body===undefined||body===null)body={};fields(body,Object.keys(body));let size;try{size=Buffer.byteLength(JSON.stringify(body));}catch{fail('Invalid JSON body');}if(size>1024*1024)fail('Person request exceeds one MiB',413,'REQUEST_TOO_LARGE');return body;}

// The existing portal owns authentication, Origin/CSRF validation, body reading
// and error responses. Call handle only after those checks, with captured user
// and parsed body; this adapter never trusts identity supplied in a request.
export function createPeopleRoutes({people}={}){
 if(!people)throw TypeError('people service is required');
 return {async handle({req,res,url,user,body,send}){
  const target=url instanceof URL?url:new URL(req.url,'http://reader.local'),pathname=target.pathname;
  if(pathname!=='/api/people'&&!pathname.startsWith('/api/people/'))return false;
  const get=req.method==='GET',post=req.method==='POST';
  if(pathname==='/api/people'||pathname==='/api/people/'){
   if(get){const options=queryOptions(target.searchParams,['query','limit','cursor','includeDeleted','publicOnly']);res?.setHeader?.('Cache-Control','private, no-store');send(200,await people.list(user,options));return true;}
   if(!post)return false;
   if(!user?.id)fail('Enter your own library first',401,'AUTH_REQUIRED');
   const input=parsedBody(body);fields(input,['requestId','person']);queryOptions(target.searchParams,[]);send(201,await people.create(user,input));return true;
  }
  const share=pathname.match(/^\/api\/people\/shares\/([^/]+)$/);
  if(share){if(!get)return false;queryOptions(target.searchParams,[]);res?.setHeader?.('Cache-Control','no-store');send(200,await people.getShare(identifier(share[1])));return true;}
  const match=pathname.match(/^\/api\/people\/([^/]+)(?:\/([^/]+))?$/);
  if(!match)return false;
  const id=identifier(match[1]),action=match[2];
  if(!action&&get){const options=queryOptions(target.searchParams,['section','limit','cursor','includeDeleted','publicOnly']);res?.setHeader?.('Cache-Control','private, no-store');send(200,await people.get(user,id,options));return true;}
  if(action==='shares'&&get){if(!user?.id)fail('Enter your own library first',401,'AUTH_REQUIRED');queryOptions(target.searchParams,[]);res?.setHeader?.('Cache-Control','private, no-store');send(200,await people.listShares(user,id));return true;}
  if(!post||!['update','delete','restore','preview','publish','revoke','export'].includes(action))return false;
  if(!user?.id)fail('Enter your own library first',401,'AUTH_REQUIRED');
  queryOptions(target.searchParams,[]);const input=parsedBody(body);
  const allowed={update:['requestId','expectedRevision','patch'],delete:['requestId','expectedRevision'],restore:['requestId','expectedRevision'],preview:['requestId','expectedRevision'],publish:['requestId','expectedRevision','previewToken'],revoke:['shareId'],export:['requestId','expectedRevision']};fields(input,allowed[action]);
  res?.setHeader?.('Cache-Control','private, no-store');
  let result;
  if(action==='preview')result=await people.preview(user,id);
  else if(action==='export')result=await people.exportRecord(user,id);
  else if(action==='revoke')result=await people.revoke(user,id,input.shareId);
  else result=await people[{update:'update',delete:'remove',restore:'restore',publish:'publish'}[action]](user,id,input);
  send(200,result);return true;
 }};
}
