import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';

if(process.argv[2]==='descendant'){
 const parent=Number(process.argv[3]),deadline=Date.now()+5000;
 function ready(){
  if(Date.now()>=deadline){process.stderr.write('parent_exit_not_observed\n');process.exitCode=2;return;}
  try{process.kill(parent,0);setTimeout(ready,2);}
  catch(error){if(error.code!=='ESRCH')throw error;process.stderr.write('reader_billing:subscription_exists\n');}
 }
 if(Number.isSafeInteger(parent)&&parent>0)ready();else process.exitCode=2;
}else{
 spawn(process.execPath,[fileURLToPath(import.meta.url),'descendant',String(process.pid)],{stdio:['ignore','ignore',2]}).unref();
 process.exitCode=1;
}
