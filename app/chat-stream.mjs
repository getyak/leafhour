// Cumulative snapshots make a repeated frame harmless. Only a terminal receipt
// can become a saved answer; an EOF after prefixes is an interrupted request.
export async function readChatResponse(response,{onProgress,isCurrent=()=>true}={}){
 if(!response.ok||!response.headers.get('content-type')?.includes('application/x-ndjson'))return response.json();
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let buffer='',sequence=0,total=0;
 const check=()=>{if(!isCurrent())throw Error('Chat response is no longer current');};
 try{
  for(;;){
   check();const {value,done}=await reader.read();check();
   total+=value?.length||0;if(total>16*1024*1024)throw Error('Chat stream exceeds its limit');
   buffer+=decoder.decode(value,{stream:!done});
   let boundary;
   while((boundary=buffer.indexOf('\n'))>=0){
    if(boundary>196608)throw Error('Chat frame exceeds its limit');
    const line=buffer.slice(0,boundary);buffer=buffer.slice(boundary+1);if(!line.trim())continue;
    check();const frame=JSON.parse(line);
    if(frame.type==='result'&&frame.turn&&typeof frame.turn.id==='string')return frame.turn;
    if(frame.type==='error'){
     const receipt=frame.billingOperation,details=receipt&&typeof receipt.id==='string'&&receipt.id.length<=256&&['not_started','released','cancelled','reversed'].includes(receipt.status)?{billingOperation:{id:receipt.id,status:receipt.status}}:{};
     throw Object.assign(Error('Chat stream interrupted'),{status:Number.isInteger(frame.status)&&frame.status>=400&&frame.status<=599?frame.status:502,...details});
    }
    if(frame.type!=='progress'||typeof frame.id!=='string'||!Number.isSafeInteger(frame.sequence)||typeof frame.text!=='string'||frame.text.length>12000||!frame.text.isWellFormed())throw Error('Invalid chat progress');
    if(frame.sequence>sequence){sequence=frame.sequence;onProgress?.(frame);}
   }
   if(buffer.length>196608)throw Error('Chat frame exceeds its limit');
   if(done)throw Error('Chat stream interrupted before its terminal receipt');
  }
 }finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
