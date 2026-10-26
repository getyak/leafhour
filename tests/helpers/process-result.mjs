// SQL race assertions need diagnostics, not just process exit. The close
// boundary is shared by the real database fixtures and the inherited-pipe test.
export function processResult(child){
 return new Promise(resolve=>{
  let output='';child.stderr?.on('data',chunk=>output+=chunk);child.stdout?.resume();
  child.once('error',error=>resolve({status:-1,output:error.message}));
  child.once('close',status=>resolve({status,output}));
 });
}
