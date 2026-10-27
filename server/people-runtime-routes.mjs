import {searchPeople} from './people-sources.mjs';
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const fields=(body,allowed)=>{if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!allowed.includes(k)))throw fail('人物任务参数不正确。');};
export function createPeopleRuntimeRoutes({people,generation,auth,funding}){
 return {async handle({req,url,user,body,token,send}){
  const p=url.pathname;
  if(p==='/api/people/directory'){
   if(req.method!=='GET')throw fail('请使用搜索入口。',405);if(!user?.id)throw fail('请先进入自己的书房。',401);
   if([...url.searchParams.keys()].some(k=>!['query','locale'].includes(k)))throw fail('搜索参数不正确。');
   const candidates=await searchPeople(url.searchParams.get('query')||'',{locale:url.searchParams.get('locale')||'en'});send(200,{candidates});return true;
  }
  const cancelPrepared=p.match(/^\/api\/people\/([A-Za-z0-9_-]{1,128})\/generation\/cancel-preparation$/);
  if(cancelPrepared){if(req.method!=='POST')throw fail('请使用取消入口。',405);if(!user?.id)throw fail('请先进入自己的书房。',401);if(!body||Object.keys(body).some(k=>k!=='preparationId'))throw fail('取消参数不正确。');const prepared=await generation.preparation(user,body.preparationId);if(prepared.personId!==cancelPrepared[1])throw fail('找不到这次整理。',404);send(200,await generation.cancelPreparation(user,body.preparationId));return true;}
  const m=p.match(/^\/api\/people\/([A-Za-z0-9_-]{1,128})\/(prepare-generation|generate|generation\/([A-Za-z0-9_-]{1,128})(\/cancel)?)$/);if(!m)return false;
  if(!user?.id)throw fail('请先进入自己的书房。',401);const id=m[1];await people.get(user,id);
  const authorize=async()=>{const current=await auth.userFor(token);if(current?.id!==user.id)throw fail('登录已失效，这次整理尚未保存。',401);return true;};
  if(m[2]==='prepare-generation'){
   if(req.method!=='POST')throw fail('请使用整理入口。',405);fields(body,['requestId','expectedRevision','locale','workId','sourceIds']);if(body?.personId!==undefined)throw fail('请使用当前人物。');
   const result=await generation.prepare(user,{...body,personId:id});send(200,{...result,funding:{kind:'sponsored',maxCostUsd:funding.maxCostUsd,requiresConfirmation:true}});return true;
  }
  if(m[2]==='generate'){
   if(req.method!=='POST')throw fail('请使用整理入口。',405);fields(body,['requestId','expectedRevision','preparationId','fundingConsent']);
   const prepared=await generation.preparation(user,body.preparationId);if(prepared&&prepared.personId!==id)throw fail('整理任务不属于当前人物。',403);
   const result=await generation.generate(user,body,{authorize});if(result.personId!==id)throw fail('整理任务不属于当前人物。',403);send(202,result);return true;
  }
  const task=await generation.status(user,m[3]);if(task.personId!==id)throw fail('找不到这次整理。',404);
  if(m[4]){if(req.method!=='POST')throw fail('请使用取消入口。',405);send(200,await generation.cancel(user,m[3]));}
  else{if(req.method!=='GET')throw fail('请使用查看入口。',405);send(200,task);}return true;
 }};
}
