export function createReadingSessionCoordinator({clock,outbox}){
  let pending=null;
  const retain=snapshot=>{try{outbox.enqueue(snapshot);pending=null;return snapshot;}catch(error){pending=snapshot;clock.pause();throw error;}};
  return {
    start(context){if(pending)throw Error('这次阅读仍待保存，请先重试或保留备份。');if(outbox.size>=20)throw Error('已有 20 次阅读待同步，请先重试保存。');clock.start(context);return retain(clock.snapshot());},
    checkpoint(anchor){if(anchor)clock.setContext(anchor);const snapshot=clock.snapshot();return snapshot?retain(snapshot):null;},
    finish(anchor){if(anchor)clock.setContext(anchor);const snapshot=clock.finish();return snapshot?retain(snapshot):null;},
    pending:()=>pending?structuredClone(pending):null,
    async retry(){if(pending&&outbox.size>=20){const older=await outbox.flush();if(older.error)return older;}if(pending)retain(pending);return outbox.flush();}
  };
}
