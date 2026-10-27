import {Server} from '@modelcontextprotocol/sdk/server/index.js';
import {ListToolsRequestSchema,CallToolRequestSchema} from '@modelcontextprotocol/sdk/types.js';
import {createHash} from 'node:crypto';
import {createPeopleTools} from './people-tools.mjs';
import {searchPeople} from './people-sources.mjs';
import {PERSON_LOCALES,validPersonId} from '../app/person-model.mjs';
const bytes=value=>Buffer.byteLength(JSON.stringify(value)),hash=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_k,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const fail=(message,status=400,code='INVALID_ARGUMENTS')=>Object.assign(Error(message),{status,code});
const scopeFor=name=>name==='people_create'?'people:create':['people_update','people_update_items','people_delete','people_restore'].includes(name)?'people:write':['people_prepare_generation','people_generate','people_get_generation','people_cancel_generation'].includes(name)?'people:generate':'people:read';
const str=(max=128)=>({type:'string',minLength:1,maxLength:max}),revision={type:'integer',minimum:1},schema=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const personId=str(),requestId=str(),generationSpecs=[
 ['people_prepare_generation','Prepare one selected person and at most one work, read sources and return the availability and cost ceiling. Does not dispatch generation or grant funding consent.',schema({personId,requestId,expectedRevision:revision,locale:{type:'string',enum:PERSON_LOCALES},workId:str(),sourceIds:{type:'array',maxItems:8,items:str()}},['personId','requestId','expectedRevision'])],
 ['people_generate','Start the exact prepared task only after the current user explicitly accepts its bounded funding request. people:generate does not imply fundingConsent. Recheck permission before asynchronous results can save.',schema({personId,requestId,expectedRevision:revision,preparationId:str(),fundingConsent:{type:'boolean',const:true}},['personId','requestId','expectedRevision','preparationId','fundingConsent'])],
 ['people_get_generation','Read the status of an authorized task for this selected person.',schema({personId,taskId:str()},['personId','taskId'])],
 ['people_cancel_generation','Cancel the selected person task and fence late saves. Does not delete saved person data.',schema({personId,taskId:str()},['personId','taskId'])]
];
function valid(value,s){if(Object.hasOwn(s,'const')&&value!==s.const)return false;if(s.enum&&!s.enum.includes(value))return false;if(s.type==='object')return value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(k=>Object.hasOwn(s.properties,k)&&valid(value[k],s.properties[k]))&&s.required.every(k=>Object.hasOwn(value,k));if(s.type==='string')return typeof value==='string'&&value.isWellFormed()&&value.length>=(s.minLength||0)&&value.length<=(s.maxLength??Infinity);if(s.type==='integer')return Number.isSafeInteger(value)&&value>=s.minimum&&value<=(s.maximum??Number.MAX_SAFE_INTEGER);if(s.type==='boolean')return typeof value==='boolean';if(s.type==='array')return Array.isArray(value)&&value.length<=s.maxItems&&value.every(v=>valid(v,s.items));return false;}
export function createMcpPeopleServer({oauth,identity,token,people,peopleGrants,generation,searchDirectory=searchPeople}){
 const server=new Server({name:'leafhour-people',version:'1.0.0'},{capabilities:{tools:{}}}),prototype=createPeopleTools({people,user:{id:identity.ownerId},allowedIds:identity.personIds,allowWrites:identity.scope.split(' ').includes('people:write'),allowCreate:identity.scope.split(' ').includes('people:create')});
 const generationEnabled=Boolean(generation&&identity.scope.split(' ').includes('people:generate'));
 const directoryScope=identity.scope.split(' ').includes('people:create')?'people:create':identity.scope.split(' ').includes('people:generate')?'people:generate':null,toolScope=name=>name==='people_search_directory'?directoryScope:scopeFor(name);
 const connection={name:'people_get_connection',description:'Read selected person IDs, granted scopes and expiry. This grants no access to books, notes or progress.',parameters:schema({})};
 const directory={name:'people_search_directory',description:'Search public Wikidata and Open Library identity directories for an unfamiliar person. This is public network discovery, not a search of private records. Same-name candidates need an explicit choice; descriptions and snippets are leads, not verified facts or read evidence. Does not save, generate, or expand selected person access.',parameters:schema({query:str(256),locale:{type:'string',enum:PERSON_LOCALES},limit:{type:'integer',minimum:1,maximum:8}},['query'])};
 const definitions=[connection,...(directoryScope?[directory]:[]),...prototype.definitions,...(generationEnabled?generationSpecs.map(([name,description,parameters])=>({name,description,parameters})):[])].map(d=>({name:d.name,description:d.description,inputSchema:d.parameters,annotations:{readOnlyHint:toolScope(d.name)==='people:read'||d.name==='people_get_generation'||d.name==='people_search_directory',destructiveHint:d.name==='people_delete'||d.name==='people_update_items',idempotentHint:d.name!=='people_prepare_generation',openWorldHint:d.name==='people_search_directory'},_meta:{securitySchemes:[{type:'oauth2',scopes:[toolScope(d.name)]}]}}));
 const authorize=async(scope,id)=>{const current=await oauth.authenticate(token),owner=await peopleGrants.authenticate(token,scope,id);if(current.ownerId!==identity.ownerId||owner.id!==identity.ownerId)throw fail('This connection belongs to another account.',403,'SCOPE_DENIED');return true;};
 const make=current=>createPeopleTools({people,user:{id:current.ownerId},allowedIds:current.personIds,allowWrites:current.scope.split(' ').includes('people:write'),allowCreate:current.scope.split(' ').includes('people:create'),authorize,maxResultBytes:7500});
 async function generate(name,args){const spec=generationSpecs.find(s=>s[0]===name);if(!spec||!valid(args,spec[2])||!validPersonId(args.personId))throw fail('Invalid generation tool arguments.');const user={id:identity.ownerId};await authorize('people:generate',args.personId);const live=()=>authorize('people:generate',args.personId);
  if(name==='people_prepare_generation'){const result=await generation.prepare(user,args);await live();if(result.personId!==args.personId)throw fail('Preparation belongs to another person.',403,'SCOPE_DENIED');return result;}
  if(name==='people_generate'){if(typeof generation.preparation!=='function')throw fail('Generation preparation is unavailable.',503,'NOT_CONFIGURED');const prepared=await generation.preparation(user,args.preparationId);if(prepared.personId!==args.personId||prepared.expectedRevision!==args.expectedRevision)throw fail('Prepared person or revision does not match.',409,'REVISION_CONFLICT');await live();const {personId,...input}=args,result=await generation.generate(user,input,{authorize:live});if(result.personId!==personId)throw fail('Generation belongs to another person.',403,'SCOPE_DENIED');await live();return result;}
  const task=await generation.status(user,args.taskId);if(!task||task.personId!==args.personId)throw fail('Task not found for this selected person.',404,'NOT_FOUND');await live();if(name==='people_get_generation')return task;const result=await generation.cancel(user,args.taskId);await live();return result;
 }
 server.setRequestHandler(ListToolsRequestSchema,async()=>{await authorize('people:read');return {tools:definitions};});
 server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{
  const name=request.params.name,args=request.params.arguments||{};
  try{
   if(bytes(args)>8192)throw fail('Tool arguments exceed eight KiB.',413,'REQUEST_TOO_LARGE');if(!definitions.some(d=>d.name===name))throw fail('This person capability was not granted.',403,'SCOPE_DENIED');
   const current=await oauth.authenticate(token);await authorize(toolScope(name),args.personId);let result;
   if(name==='people_get_connection'){if(Object.keys(args).length)throw fail('Unexpected connection arguments.');result={personIds:current.personIds,scopes:current.scope.split(' '),expiresAt:new Date(current.expiresAt).toISOString()};}
   else if(name==='people_search_directory'){
    if(!valid(args,directory.parameters)||!args.query.trim())throw fail('Invalid public directory search arguments.');extra.signal.throwIfAborted();const limit=args.limit||8,candidates=await searchDirectory(args.query.trim(),{locale:args.locale||'en',limit,signal:extra.signal});extra.signal.throwIfAborted();await authorize(directoryScope);
    if(!Array.isArray(candidates))throw fail('Public identity directories are unavailable.',502,'DIRECTORY_UNAVAILABLE');result={candidates:candidates.slice(0,limit),selectionRequired:true,saved:false,generated:false,evidenceStatus:'identity-leads-not-verified-facts',truncated:candidates.length>limit};while(result.candidates.length&&bytes({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result})>24576){result.candidates.pop();result.truncated=true;}
   }
   else if(generationSpecs.some(s=>s[0]===name))result=await generate(name,args);
   else{
    const tools=make(current),scope=scopeFor(name);
    if(name==='people_create')result=await peopleGrants.create(token,{personId:args.person?.id,requestId:args.requestId,fingerprint:hash(canonical(args))},()=>tools.execute(name,{...args,requestId:'mcp-person-'+hash(JSON.stringify([token,args.requestId]))},{signal:extra.signal}));
    else if(scope==='people:write'){result=await tools.execute(name,args,{signal:extra.signal});if(!result.error)await peopleGrants.invalidateReadState(token);}
    else{
     const saved=await peopleGrants.readState(token);
     if(saved.state){try{await tools.importReadState(saved.state);}catch(error){if(![403,409].includes(error.status))throw error;await authorize('people:read');}}
     result=await tools.execute(name,args,{signal:extra.signal});if(!result.error)await tools.verify();await peopleGrants.saveReadState(token,saved.revision,tools.exportReadState());
    }
   }
   await oauth.authenticate(token);const response={content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,...(result?.error?{isError:true}:{})};if(bytes(response)>24576)throw fail('Person response exceeds twenty-four KiB; narrow the requested data.',413,'RESULT_TOO_LARGE');return response;
  }catch(error){const result={error:{code:error.code||'UNAVAILABLE',message:error.status&&error.status<500?error.message:'Person tools are temporarily unavailable.'}};return {content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,isError:true};}
 });
 return server;
}
