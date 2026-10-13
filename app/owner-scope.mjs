export function createOwnerScope(initial='guest'){
  let owner=initial,revision=0;
  const current=ticket=>ticket?.owner===owner&&ticket.revision===revision;
  const assert=ticket=>{if(!current(ticket))throw Object.assign(Error('账户已切换，请重新操作。'),{status:409});};
  return {capture:()=>({owner,revision}),isCurrent:current,assertCurrent:assert,adopt(next){if(owner===next)return false;owner=next;revision++;return true;},async run(ticket,operation){assert(ticket);let value;try{value=await operation();}catch(error){assert(ticket);throw error;}assert(ticket);return value;}};
}

export function readOwnerResponse(scope,ticket,request,onSessionChanged){
  return scope.run(ticket,async()=>{
    const response=await request();
    scope.assertCurrent(ticket);
    if(response.headers.get('X-Reader-Session-Changed')==='1'){
      onSessionChanged();throw Error('账户已切换，请重新进入书房。');
    }
    let body;try{body=await response.json();}catch{throw Error('服务暂时无法连接，请稍后重试');}
    if(!response.ok)throw Error(body.error||'暂时无法完成');
    return body;
  });
}
