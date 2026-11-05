import {readFile,open,mkdir} from 'node:fs/promises';
import {createCipheriv,randomBytes} from 'node:crypto';
import path from 'node:path';
// Production append service acknowledges durable independent storage of an
// encrypted, content-free dispatch envelope. Never write provider/user payloads.
export async function createDispatchLedger({env=process.env,fetcher=fetch}={}){
 if(env.LEAFHOUR_DISPATCH_LEDGER_URL){
  const url=new URL(env.LEAFHOUR_DISPATCH_LEDGER_URL);if(url.protocol!=='https:'||url.username||url.password||url.hash||url.search)throw Error('Dispatch ledger must be a credential-free HTTPS endpoint');
  const token=(await readFile(env.LEAFHOUR_DISPATCH_LEDGER_TOKEN_FILE,'utf8')).trim(),key=Buffer.from((await readFile(env.LEAFHOUR_DISPATCH_LEDGER_KEY_FILE,'utf8')).trim(),'hex');if(key.length!==32||!token)throw Error('Dispatch ledger credentials invalid');
  return async entry=>{const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv),encrypted=Buffer.concat([cipher.update(JSON.stringify(entry),'utf8'),cipher.final()]);const response=await fetcher(url,{method:'POST',redirect:'error',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json','Idempotency-Key':entry.id},body:JSON.stringify({protocol:1,id:entry.id,iv:iv.toString('hex'),tag:cipher.getAuthTag().toString('hex'),ciphertext:encrypted.toString('base64')}),signal:AbortSignal.timeout(15000)});if(!response.ok)throw Error('Dispatch append unavailable');const receipt=await response.json();if(receipt.id!==entry.id||receipt.durable!==true)throw Error('Dispatch durability not acknowledged');};
 }
 if(env.LEAFHOUR_ALLOW_LOCAL_LEDGER==='1'&&env.LEAFHOUR_DISPATCH_LEDGER_FILE){
  const file=path.resolve(env.LEAFHOUR_DISPATCH_LEDGER_FILE);await mkdir(path.dirname(file),{recursive:true,mode:0o700});return async entry=>{const handle=await open(file,'a',0o600);try{await handle.write(JSON.stringify(entry)+'\n');await handle.sync();}finally{await handle.close();}};
 }
 return async()=>{throw Error('Independent dispatch ledger unconfigured');};
}
