import {mkdtemp,readFile,rm,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const project=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const disabled=['persistent-bash','persistent-pwsh','tool-working-directory','llm-retry','session-title'];

// Perform only SDK initialization and shutdown. No session prompt is sent and
// the child receives a fixed fake key rather than any deployment credentials.
export async function checkReaderRuntime(outputDir=path.join(project,'.reader-runtime')){
  outputDir=path.resolve(outputDir);
  const run=await mkdtemp(path.join(tmpdir(),'reader-runtime-check-'));
  let harness,lifecycle;
  try{
    await writeFile(path.join(run,'input.json'),JSON.stringify({kind:'explain',runId:'offline-runtime-check',bookId:'fixture',contentVersion:'v1',passageId:'p1',text:'Fixture question',passages:[{id:'p1',original:'Fixture source.'}],expiresAt:Date.now()+60000}),{mode:0o600});
    // A fixture plugin reports the actual runtime PID without depending on
    // private SDK fields. After close, verify that the same PID was reaped.
    const lifecycleFile=path.join(run,'lifecycle.json'),plugin=path.join(run,'lifecycle.mjs');
    await writeFile(plugin,`import {writeFileSync} from 'node:fs';\nexport function apply(){writeFileSync(${JSON.stringify(lifecycleFile)},JSON.stringify({pid:process.pid,nodeVersion:process.versions.node}),{mode:0o600});}\n`,{mode:0o600});
    const patch=[...disabled.map(id=>({id,disabled:true})),{id:'sandbox-policy',name:'@deepseek-ai/dsh-sandbox-policy',config:{mode:'read-only',workspaceRoot:run}},{id:'tools',name:'@deepseek-ai/dsh-tools',config:{mode:'native'}},{insert:[{id:'reader-runtime',name:path.join(outputDir,'harness/reader-plugin.mjs'),inject:['tools','llm'],config:{runDir:run,maxRequests:4,maxToolCalls:8,maxTokens:1024,maxCostCny:.1,pricing:{validUntil:'2099-01-01',inputMissPerMillion:2,outputPerMillion:8}}},{id:'runtime-check-lifecycle',name:plugin}]}];
    const patchPath=path.join(run,'reader.patch.json');await writeFile(patchPath,JSON.stringify(patch),{mode:0o600});
    const {DeepSeekHarness}=await import(pathToFileURL(path.join(outputDir,'node_modules/@deepseek-ai/dsh-sdk-client/lib/index.js')));
    const hosted=process.platform==='linux'&&process.arch==='x64';
    harness=new DeepSeekHarness({...(hosted?{dshBin:path.join(outputDir,'bin/dsh-launch.mjs')}:{}),profile:'sdk-minimal',patches:[patchPath],dshHome:path.join(run,'home'),processCwd:run,cwd:run,env:{PATH:process.env.PATH,DEEPSEEK_API_KEY:'offline-runtime-check',DSH_SYSTEM_PROMPT:'Use only the reader fixture.'},provider:'deepseek-official',model:'deepseek-flash',reasoningEffort:'off',initializeTimeoutMs:15000,requestTimeoutMs:15000});
    await harness.start();lifecycle=JSON.parse(await readFile(lifecycleFile,'utf8'));
    if(!Number.isSafeInteger(lifecycle.pid)||lifecycle.pid<=0)throw Error('The reading runtime did not report a valid PID.');
  }finally{
    try{await harness?.close();}finally{await rm(run,{recursive:true,force:true});}
  }
  try{process.kill(lifecycle.pid,0);}catch(error){
    if(error.code==='ESRCH')return {initialized:true,closed:true,reaped:true,modelRequests:0,nodeVersion:lifecycle.nodeVersion};
    throw error;
  }
  throw Error('The reading runtime is still alive after SDK shutdown.');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const result=await checkReaderRuntime(process.argv[2]);
  console.log(JSON.stringify(result));
}
