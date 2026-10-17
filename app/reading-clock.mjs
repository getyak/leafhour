import {mergeReadingIntervals,readingIntervalSeconds,validReadingTimeZone} from './reading-session-record.mjs';
import {ESTIMATE_IDLE_MS} from './reading-time-policy.mjs';
const bad=message=>{throw Object.assign(Error(message),{status:400});};
const validAnchor=a=>a&&typeof a.chapterId==='string'&&typeof a.passageId==='string';
export function createReadingClock({now=Date.now,heartbeatGapMs=Infinity}={}){
  if(heartbeatGapMs!==Infinity&&(!Number.isFinite(heartbeatGapMs)||heartbeatGapMs<1000))bad('前台采样间隔不正确');
  let current=null,visible=true,focused=true,lastTime=-Infinity;
  const time=()=>{const stamp=now();if(!Number.isFinite(stamp))bad('设备时间暂时无法读取');lastTime=Math.max(lastTime,stamp);return lastTime;};
  const close=at=>{if(current.open!==null){current.intervals=mergeReadingIntervals([...current.intervals,[current.open,at]]);current.open=null;}};
  const idleAt=at=>current.source==='reader_estimate'&&at>=current.lastActivity+ESTIMATE_IDLE_MS;
  function observe(){
    const at=time();if(!current||current.finished)return at;
    if(current.open!==null&&at-current.lastObserved>heartbeatGapMs){
      close(Math.min(current.lastObserved,current.source==='reader_estimate'?current.lastActivity+ESTIMATE_IDLE_MS:Infinity));
      if(at<current.started+86400000&&current.wanted&&visible&&focused&&!idleAt(at)){
        if(current.intervals.length>=120){current.finished=true;current.wanted=false;current.ended=at;current.reason='interval_limit';}
        else current.open=at;
      }
    }
    if(current.open!==null&&idleAt(at))close(current.lastActivity+ESTIMATE_IDLE_MS);
    current.lastObserved=at;return at;
  }
  function limit(at){
    if(!current||current.finished)return at;
    const maximum=current.started+86400000;if(at>=maximum){close(maximum);current.finished=true;current.wanted=false;current.ended=maximum;current.reason='time_limit';return maximum;}return at;
  }
  function reconcile(){
    if(!current)return;const at=limit(observe());if(current.finished)return;
    const running=current.wanted&&visible&&focused&&!idleAt(at);
    if(!running)close(at);
    else if(current.open===null){if(current.intervals.length>=120){current.finished=true;current.wanted=false;current.ended=at;current.reason='interval_limit';return;}current.open=at;}
  }
  const intervalsAt=at=>mergeReadingIntervals([...current.intervals,...(current.open===null?[]:[[current.open,at]])]);
  const status=()=>!current?'idle':current.finished?'finished':current.open!==null?'active':'paused';
  return {
    start(input){
      if(current&&!current.finished)bad('请先结束当前这次阅读');
      if(!input||typeof input.bookId!=='string'||!input.bookId||typeof input.contentVersion!=='string'||!input.contentVersion||!validAnchor(input.anchor)||!validReadingTimeZone(input.timeZone)||input.source!==undefined&&!['reader_focus','reader_estimate'].includes(input.source))bad('请先打开一本书并选择实时计时口径');
      const at=time();current={id:input.id||crypto.randomUUID(),bookId:input.bookId,contentVersion:input.contentVersion,timeZone:input.timeZone,source:input.source||'reader_focus',start:{...input.anchor},end:{...input.anchor},started:at,lastObserved:at,lastActivity:at,ended:null,intervals:[],open:null,wanted:true,finished:false,sequence:0,reason:null};reconcile();return this.view();
    },
    setContext(anchor){if(current&&!current.finished&&validAnchor(anchor))current.end={chapterId:anchor.chapterId,passageId:anchor.passageId};},
    pause(){if(current&&!current.finished){current.wanted=false;reconcile();}return this.view();},
    resume(){if(!current||current.finished)bad('请开始新的阅读时段');const at=observe();current.lastActivity=at;current.wanted=true;reconcile();return this.view();},
    activity(){if(current&&!current.finished&&visible&&focused){const at=observe();current.lastActivity=at;reconcile();}return this.view();},
    setVisible(value){visible=!!value;reconcile();},
    setFocused(value){focused=!!value;reconcile();},
    finish(){if(!current)return null;if(!current.finished){const at=limit(observe());if(!current.finished){close(at);current.finished=true;current.wanted=false;current.ended=at;}}return this.snapshot();},
    snapshot(){
      if(!current)return null;const at=limit(observe()),end=current.finished?current.ended:at,intervals=intervalsAt(end);
      return {id:current.id,bookId:current.bookId,contentVersion:current.contentVersion,source:current.source,status:status(),sequence:++current.sequence,timeZone:current.timeZone,startedAt:new Date(current.started).toISOString(),endedAt:new Date(end).toISOString(),start:{...current.start},end:{...current.end},segments:intervals.map(([a,b])=>({startedAt:new Date(a).toISOString(),endedAt:new Date(b).toISOString()})),durationSeconds:readingIntervalSeconds(intervals)};
    },
    view(){if(!current)return {status:'idle',elapsedSeconds:0,id:null,reason:null};const at=limit(observe()),end=current.finished?current.ended:at;return {status:status(),elapsedSeconds:readingIntervalSeconds(intervalsAt(end)),id:current.id,reason:current.reason,source:current.source,idle:!current.finished&&current.wanted&&idleAt(at)};}
  };
}
