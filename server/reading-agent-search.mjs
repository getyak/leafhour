import {DeepSeekSearchProvider} from '@deepseek-ai/dsh-web-search-deepseek';

export function createWebSearch({env=process.env}={}){
  return async(query,{signal,reserveRequest}={})=>{
    signal?.throwIfAborted();
    if(typeof reserveRequest!=='function')throw new Error('A synchronous request budget is required');
    const provider=new DeepSeekSearchProvider(()=>({apiKey:env.DEEPSEEK_API_KEY,model:'deepseek-flash',baseURL:'https://api.deepseek.com/anthropic/v1',apiVersion:'2023-06-01',maxTokens:1024,maxUses:1,recordRequest:request=>{
      const reserved=reserveRequest({inputBytes:Buffer.byteLength(JSON.stringify(request.body)),maxTokens:request.body.max_tokens,kind:'web'});
      if(reserved&&typeof reserved.then==='function'){Promise.resolve(reserved).catch(()=>{});throw new Error('Request budget must be synchronous');}
    }}));
    return provider.search({query},signal);
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
