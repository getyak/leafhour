import {DEFAULT_MODELS} from './model-config.mjs';
import {DeepSeekSearchProvider} from '@deepseek-ai/dsh-web-search-deepseek';
import {randomUUID} from 'node:crypto';
import {recordProviderDispatch,recordProviderCall} from './provider-metering.mjs';

export function createWebSearch({env=process.env}={}){
  return async(query,{signal,reserveRequest}={})=>{
    signal?.throwIfAborted();
    if(typeof reserveRequest!=='function')throw new Error('A synchronous request budget is required');
    // The pinned SDK's recordRequest hook is synchronous. Admit its bounded
    // request before invoking it, then await the durable dispatch receipt.
    const model=DEFAULT_MODELS.reading,maxTokens=1024;
    const planned={model,max_tokens:maxTokens,messages:[{role:'user',content:[{type:'text',text:`Perform a web search for the query: ${query}`}]}],tools:[{type:'web_search_20250305',name:'web_search',max_uses:1}]};
    const inputBytes=Buffer.byteLength(JSON.stringify(planned)),reserved=reserveRequest({inputBytes,maxTokens,kind:'web'});
    if(reserved&&typeof reserved.then==='function'){Promise.resolve(reserved).catch(()=>{});throw new Error('Request budget must be synchronous');}
    signal?.throwIfAborted();
    const id=randomUUID(),startedAt=new Date().toISOString();let submitted=false,status='failed';
    await recordProviderDispatch({id,provider:'deepseek',model,startedAt});
    const provider=new DeepSeekSearchProvider(()=>({apiKey:env.DEEPSEEK_API_KEY,model:DEFAULT_MODELS.reading,baseURL:'https://api.deepseek.com/anthropic/v1',apiVersion:'2023-06-01',maxTokens:1024,maxUses:1,recordRequest:request=>{
      const body=request.body,tools=body.tools;
      if(body.model!==model||body.max_tokens!==maxTokens||!Array.isArray(tools)||tools.length!==1||tools[0].type!=='web_search_20250305'||tools[0].name!=='web_search'||tools[0].max_uses!==1||Buffer.byteLength(JSON.stringify(body))>inputBytes)throw new Error('Search request exceeded its admitted budget');
      signal?.throwIfAborted();submitted=true;
    }}));
    try{const result=await provider.search({query},signal);status='completed';return result;}
    finally{
      // This installed SDK returns only search sources, discarding all response
      // usage and server-tool fee identity. Do not infer tokens from the query,
      // or claim that the Harness free-tool promotion applies to this adapter.
      if(submitted)await recordProviderCall({id,provider:'deepseek',model:DEFAULT_MODELS.reading,status:signal?.aborted?'cancelled':status,startedAt,finishedAt:new Date().toISOString(),costStatus:'unknown'});
    }
  };
}

export async function searchOpenLibrary(query,{signal,limit=5}={}){
  const timeout=AbortSignal.timeout(10000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
  combined.throwIfAborted();
  const url=new URL('https://openlibrary.org/search.json');
  url.search=new URLSearchParams({q:query,fields:'key,title,author_name,first_publish_year',limit:String(limit),page:'1'});
  const response=await fetch(url,{signal:combined,redirect:'error',headers:{accept:'application/json'}});
  if(!response.ok)throw new Error('Book search unavailable');
  if(Number(response.headers.get('content-length'))>262144)throw new Error('Book search response too large');
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{while(true){combined.throwIfAborted();const {done,value}=await reader.read();if(done)break;length+=value.byteLength;if(length>262144)throw new Error('Book search response too large');chunks.push(Buffer.from(value));}}finally{await reader.cancel().catch(()=>{});}
  const data=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  return (Array.isArray(data.docs)?data.docs:[]).filter(d=>/^\/works\/OL\d+W$/.test(d.key)&&typeof d.title==='string').slice(0,limit).map(d=>({title:d.title.slice(0,500),author:Array.isArray(d.author_name)?d.author_name.filter(a=>typeof a==='string').slice(0,3).join(', ').slice(0,500):'',year:Number.isInteger(d.first_publish_year)?d.first_publish_year:null,owned:false,source:'openlibrary',url:'https://openlibrary.org'+d.key}));
}
