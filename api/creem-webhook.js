import {Readable} from 'node:stream';
import {createBillingRuntime} from '../server/billing-runtime.mjs';
import {readWebhookBytes} from '../server/billing-routes.mjs';

// Web Standard entry preserves bytes before any Node.js request.body helper.
// https://vercel.com/docs/functions/runtimes/node-js
export function createCreemWebhookHandler({serviceFactory=createBillingRuntime,env=process.env}={}){
 let service;
 return {async fetch(request){
  const headers={'Cache-Control':'private, no-store','X-Robots-Tag':'noindex, nofollow, noarchive'};
  if(request.method!=='POST')return Response.json({error:'Method not allowed'},{status:405,headers:{...headers,Allow:'POST'}});
  try{
   const rawBody=await readWebhookBytes({headers:Object.fromEntries(request.headers),[Symbol.asyncIterator]:()=>Readable.fromWeb(request.body||new ReadableStream({start(c){c.close();}}))[Symbol.asyncIterator]()});
   if(!service)service=Promise.resolve(serviceFactory({env})).catch(e=>{service=null;throw e;});
   const billing=await service,result=await billing.webhook({rawBody,signature:request.headers.get('creem-signature')});
   return Response.json(result,{status:200,headers});
  }catch(error){return Response.json({error:error.status&&error.status<500?'Payment notification rejected':'Payment verification temporarily unavailable'},{status:error.status||503,headers});}
 }};
}
export default createCreemWebhookHandler();
