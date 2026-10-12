import {readFileSync,writeFileSync,existsSync,renameSync} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const name='reader-runtime';
export const inject=['tools','llm'];
export function apply(ctx,config){
 const file=n=>path.join(config.runDir,n),input=JSON.parse(readFileSync(file('input.json'),'utf8'));let contextRead=false,requests=0,toolCalls=0,reservedCostCny=0;
 const refs={type:'array',minItems:1,maxItems:10,items:{type:'object',properties:{passageId:{type:'string'},quote:{type:'string'}},required:['passageId','quote'],additionalProperties:false}};
 const assetSchema={type:'object',properties:{verdict:{type:'string',enum:['consistent','needs_revision','uncertain']},summary:{type:'string',maxLength:240},segments:{type:'array',maxItems:8,items:{type:'object',properties:{readerQuote:{type:'string'},reason:{type:'string',maxLength:240},sourceRef:refs.items},required:['readerQuote','reason','sourceRef'],additionalProperties:false}},sourceRefs:refs},required:['verdict','summary','segments','sourceRefs'],additionalProperties:false};
 const checkLive=()=>{if(existsSync(file('revoked'))||Date.now()>input.expiresAt)throw Error('Run cancelled or expired');};
 const write=(name,value)=>{const pending=file(name+'.pending');writeFileSync(pending,JSON.stringify(value),{mode:0o600});renameSync(pending,file(name));};
 const ledger=()=>write('budget.json',{requests,toolCalls,reservedCostCny,maxCostCny:config.maxCostCny,pricing:{...config.pricing,settlement:'reservation-not-invoice'}});
 ctx.tools.guard(exec=>{if(!['reader_get_context','reader_publish_asset'].includes(exec.name))return 'Tool unavailable in this reading Run';if(existsSync(file('revoked'))||Date.now()>input.expiresAt)return 'Run cancelled or expired';toolCalls++;ledger();if(toolCalls>config.maxToolCalls)return 'Tool budget exhausted';});
 ctx.on('llm/stream',async function*(options,next){
  checkLive();if(!config.pricing||!Number.isFinite(Date.parse(config.pricing.validUntil))||Date.now()>Date.parse(config.pricing.validUntil))throw Error('Pricing reference expired or unavailable');if(++requests>config.maxRequests)throw Error('Model request budget exhausted');
  const bytes=Buffer.byteLength(JSON.stringify({messages:options.messages,tools:options.tools}));if(bytes>24576)throw Error('Context budget exhausted');
  const reserved=bytes*config.pricing.inputMissPerMillion/1000000+(options.maxTokens||config.maxTokens)*config.pricing.outputPerMillion/1000000;if(!Number.isFinite(reserved)||reserved<0||reservedCostCny+reserved>config.maxCostCny)throw Error('Cost reservation budget exhausted');reservedCostCny+=reserved;ledger();
  for await(const chunk of next()){checkLive();yield chunk;}
 });
 ctx.tools.register({name:'reader_get_context',description:'Read the authorized context once. Repeated calls only remind you to use the original tool result already in history; they do not add another copy.',parameters:{type:'object',properties:{},additionalProperties:false},output:{schema:{type:'object'},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(){checkLive();if(contextRead)return {contextAlreadyProvided:true,note:'Use the original context already in this session; proceed to verified publication.'};contextRead=true;return input;}});
 ctx.tools.register({name:'reader_publish_asset',description:'Submit a candidate then a separately rechecked verified echo. Every correction needs exact original evidence. Verified publication concludes this turn.',parameters:{type:'object',properties:{stage:{type:'string',enum:['candidate','verified']},asset:assetSchema},required:['stage','asset'],additionalProperties:false},output:{schema:{type:'object',properties:{published:{type:'boolean'},stage:{type:'string'}},required:['published','stage'],additionalProperties:false},render:(_,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args,exec){
  checkLive();if(!contextRead)throw Error('Read context first');
  if(input.kind==='explain'&&(args.asset.verdict==='needs_revision'||args.asset.segments.length))throw Error('Explanation mode must not grade or correct a reader question');
  for(const ref of [...args.asset.sourceRefs,...args.asset.segments.map(s=>s.sourceRef)]){const p=input.passages.find(p=>p.id===ref.passageId);if(!p||!ref.quote||!p.original.includes(ref.quote)||createHash('sha256').update(p.original).digest('hex')!==p.sourceHash)throw Error('Source quote mismatch');}
  for(const s of args.asset.segments){if(!s.readerQuote||input.text.indexOf(s.readerQuote)<0||input.text.indexOf(s.readerQuote,input.text.indexOf(s.readerQuote)+1)>=0)throw Error('Reader quote location is ambiguous');}
  const ranges=args.asset.segments.map(s=>({start:input.text.indexOf(s.readerQuote),end:input.text.indexOf(s.readerQuote)+s.readerQuote.length})).sort((a,b)=>a.start-b.start);for(let i=1;i<ranges.length;i++)if(ranges[i].start<ranges[i-1].end)throw Error('Overlapping corrections: use one precise non-overlapping reader quote for each correction.');
  if(args.asset.verdict==='consistent'&&args.asset.segments.length)throw Error('Consistent feedback cannot flag errors');
  if(args.stage==='candidate'){write('candidate.json',args.asset);return {published:false,stage:'candidate'};}
  if(!existsSync(file('candidate.json')))throw Error('Submit a candidate before verification');
  write('output.json',{runId:input.runId,kind:input.kind||'echo',contentVersion:input.contentVersion,asset:args.asset});exec.concludeTurn();return {published:true,stage:'verified'};
 }});
}
