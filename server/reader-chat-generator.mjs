import path from 'node:path';
import {tmpdir} from 'node:os';
import {createHarnessGenerator} from '../harness/generator.mjs';

// The same bounded official Harness runs locally and in a writable ephemeral
// directory on the hosted service. Opening a window never invokes it.
export function createReaderChatGenerator({env=process.env}={}){
  if(!env.DEEPSEEK_API_KEY)return null;
  return createHarnessGenerator({runRoot:env.VERCEL?path.join(tmpdir(),'marginalia-reading-chat'):undefined,timeoutMs:45000});
}
