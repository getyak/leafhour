import {estimateMessage} from '@deepseek-ai/dsh-token-meter/estimate';
// Provider-published capacities, verified 2026-11-02. Unknown models fail closed
// instead of silently inheriting another model's window.
// https://api-docs.deepseek.com/api/list-models/
export function chatModelCapacity(model){
 if(model!=='deepseek-flash')throw Error('Model capacity unavailable');
 return {contextWindow:1048576,maxOutputTokens:393216};
}
// Use the pinned official SDK's text/framing estimate, with a CJK correction:
// the SDK's uniform four-characters/token heuristic undercounts ideographs.
export function estimateChatTokens(text){
 const cjk=text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length||0;
 return estimateMessage({role:'user',content:[{type:'text',text}]})+Math.ceil(cjk*.75);
}
const tokens=value=>estimateChatTokens(JSON.stringify(value));
// Originals live in the owner-scoped chat store. Only this request projection
// is summarized; no turn is deleted and a failed summary never drops history.
const CHECKPOINT='Conversation checkpoint (summary of earlier role-labelled messages):\n';
const validSummary=summary=>{if(typeof summary!=='string'||!summary.trim())throw Error('Context compaction returned no summary');return summary;};
export async function compactChatHistory(history,{inputBudgetTokens,summaryInputTokens=inputBudgetTokens,summarize,signal}={}){
 if(!Number.isSafeInteger(inputBudgetTokens)||inputBudgetTokens<1||!Number.isSafeInteger(summaryInputTokens)||summaryInputTokens<1)throw Error('Invalid context capacity');
 let projected=structuredClone(history);
 if(!projected.length)return projected;
 async function summarizePrefix(rows){
  signal?.throwIfAborted();
  if(tokens(rows)<=summaryInputTokens)return validSummary(await summarize(rows));
  // Oversized role pairs are summarized in bounded, explicitly role-labelled
  // fragments. The running checkpoint accompanies every following batch.
  const fragments=[];
  for(const row of rows){
   if(tokens(row)<=summaryInputTokens/3){fragments.push(row);continue;}
   const encoded=JSON.stringify(row),width=Math.max(1,Math.floor(summaryInputTokens/8));
   for(let offset=0;offset<encoded.length;offset+=width)fragments.push({role:row.role,content:'Serialized message fragment: '+encoded.slice(offset,offset+width)});
  }
  let checkpoint='',batch=[];
  const prefix=()=>checkpoint?[{role:'user',content:CHECKPOINT+checkpoint}]:[];
  const flush=async()=>{signal?.throwIfAborted();checkpoint=validSummary(await summarize([...prefix(),...batch]));batch=[];};
  for(const fragment of fragments){
   if(tokens([...prefix(),...batch,fragment])>summaryInputTokens){
    if(!batch.length)throw Error('Context compaction did not reduce history');
    await flush();
   }
   if(tokens([...prefix(),...batch,fragment])>summaryInputTokens)throw Error('Context compaction did not reduce history');
   batch.push(fragment);
  }
  if(batch.length)await flush();
  return checkpoint;
 }
 while(tokens(projected)>inputBudgetTokens){
  signal?.throwIfAborted();const before=tokens(projected);
  // Select complete oldest role pairs. A final oversized assistant message is
  // eligible too; it cannot be permanently protected from compaction.
  const ends=[];
  for(let i=0;i<projected.length;i++){
   if(projected[i].role==='user'&&projected[i+1]?.role==='assistant')i++;
   ends.push(i+1);
  }
  let groups=1;
  while(groups<ends.length&&tokens(projected.slice(ends[groups-1]))>inputBudgetTokens)groups++;
  // Re-summarizing a lone checkpoint cannot make progress; combine it with
  // the next complete role group when more compression is needed.
  if(ends.length>1&&projected[0].content.startsWith(CHECKPOINT))groups=Math.max(groups,2);
  const count=ends[groups-1],summary=await summarizePrefix(projected.slice(0,count));
  const next=[{role:'user',content:CHECKPOINT+summary},...projected.slice(count)];
  // Compare the entire projection, including identical wrapper/array framing.
  // This rejects repeated checkpoints instead of looping until the deadline.
  if(tokens(next)>=before)throw Error('Context compaction did not reduce history');
  projected=next;
 }
 return projected;
}

export function chatRuntimeTimeout(env=process.env){
 const configured=Number(env.LEAFHOUR_CHAT_TIMEOUT_MS??270000);
 if(!Number.isSafeInteger(configured)||configured<1||configured>2147453647)throw Error('Invalid chat runtime timeout');
 // Hosted invocations end at 300s; reserve teardown and receipt persistence time.
 return env.VERCEL?Math.min(configured,270000):configured;
}
