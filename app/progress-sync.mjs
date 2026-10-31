export function createProgressSync({revision=0,send,beforeSend=()=>{},onSaved=()=>{},onConflict=()=>{},onFailure=()=>{}}){
  let currentRevision=revision,paused=false,queue=Promise.resolve(),generation=0,pending=0;
  return {
    get revision(){return currentRevision;},get paused(){return paused;},
    get pending(){return pending;},pause(){paused=true;},settle(){return queue.catch(()=>null);},
    adopt(value){generation++;currentRevision=Number.isInteger(value)&&value>=0?value:0;paused=false;},
    save(position){
      pending++;
      const submittedGeneration=generation;
      const work=queue.catch(()=>{}).then(async()=>{
        if(paused||submittedGeneration!==generation)return null;
        const request={...position,baseRevision:currentRevision};beforeSend(request);
        try{const result=await send(request);if(submittedGeneration!==generation)return null;if(Number.isInteger(result.revision))currentRevision=result.revision;onSaved(result,request);return result;}
        catch(error){if(submittedGeneration!==generation)return null;if(error.status===409){paused=true;onConflict(error);}else onFailure(error);throw error;}
      }).finally(()=>{pending--;});queue=work;return work;
    }
  };
}
