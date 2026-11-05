import http from 'node:http';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createInternalClient} from '../../packages/adapters/internal-client.mjs';
import {assertModuleEnvironment,executorToken,runtimeVersion,configuredCapabilities} from '../../packages/contracts/runtime-config.mjs';
import {createAgentProviders} from './providers.mjs';
import {createAgentWorker} from './worker.mjs';
export async function startAgent({env=process.env,handlers}={}){
 assertModuleEnvironment('agent',env);const version=await runtimeVersion('agent',env),token=await executorToken(env),providers=handlers||createAgentProviders({env}),configured=configuredCapabilities(env);
 if(configured.some(type=>!providers[type]))throw Error('Configured Agent capability lacks its provider credential');
 const allowed=configured.length?Object.fromEntries(configured.map(type=>[type,providers[type]])):providers;
 const connection=createInternalClient({socketPath:env.LEAFHOUR_INTERNAL_SOCKET,token});let initialisePause=env.LEAFHOUR_AGENT_PAUSED==='1';
 const client={async call(method,value){if(method==='claim'&&initialisePause){await connection.call('control',{paused:true});initialisePause=false;}return connection.call(method,value);}};
 const worker=createAgentWorker({client,handlers:allowed});
 const server=http.createServer((req,res)=>{if(!['GET','HEAD'].includes(req.method)||!['/healthz','/version'].includes(req.url)){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:JSON.stringify(req.url==='/version'?version:{...version,...worker.status(),capabilities:Object.keys(allowed)}));});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(Number(env.LEAFHOUR_AGENT_PORT||18332),'127.0.0.1',resolve);});worker.start();
 return {server,worker,async close(){await worker.close();await new Promise(resolve=>server.close(resolve));}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){const service=await startAgent();let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await service.close();};process.once('SIGTERM',stop);process.once('SIGINT',stop);}
