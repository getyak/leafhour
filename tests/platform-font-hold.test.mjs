import test from 'node:test';
import assert from 'node:assert/strict';
import {createEvidenceSession} from '../tools/lib/platform-font-observer.mjs';

function fixture(){
 const handlers=new Map(),continued=[],receipt={errors:[],fonts:[],screenshots:[],checks:[]};
 const cdp={on:(name,fn)=>{handlers.set(name,fn);return ()=>handlers.delete(name);},send:async(method,args)=>{if(method==='Fetch.continueRequest'){continued.push(args.requestId);if(args.requestId==='cancelled-font')throw Error('Invalid InterceptionId');}return {};},close:async()=>{}};
 const session=createEvidenceSession({cdp,receipt,origin:'http://localhost:1234'});session.observeResponses();
 return {session,receipt,continued,event:(name,args)=>handlers.get(name)(args)};
}
test('a root-to-authored-page navigation cannot resume a font request already cancelled by the browser',async()=>{
 const f=fixture();await f.session.installFontHold();
 f.event('Page.frameNavigated',{frame:{id:'main',loaderId:'root',url:'http://localhost:1234/'}});
 f.event('Fetch.requestPaused',{requestId:'cancelled-font',networkId:'old-network-font'});
 f.event('Network.loadingFailed',{requestId:'old-network-font',canceled:true,errorText:'net::ERR_ABORTED'});
 f.event('Page.frameNavigated',{frame:{id:'main',loaderId:'authored',url:'http://localhost:1234/en'}});
 f.event('Fetch.requestPaused',{requestId:'live-font',networkId:'current-network-font'});
 await f.session.releaseFontHold();
 assert.deepEqual(f.continued,['live-font']);assert.equal(f.session.paused.size,0);assert.deepEqual(f.receipt.errors,[]);
 assert.equal(f.receipt.cancelledFontRequests[0].networkId,'old-network-font');
 await f.session.close();assert.deepEqual(f.continued,['live-font'],'cleanup must not resume the cancelled interception again');
});
test('cancellation of another request never hides an invalid live interception or a genuine network failure',async()=>{
 const f=fixture();await f.session.installFontHold();
 f.event('Fetch.requestPaused',{requestId:'cancelled-font',networkId:'actual-font'});
 f.event('Network.loadingFailed',{requestId:'unrelated',canceled:true,errorText:'net::ERR_ABORTED'});
 f.event('Network.loadingFailed',{requestId:'failed-resource',canceled:false,errorText:'net::ERR_FAILED'});
 await assert.rejects(f.session.releaseFontHold(),/Invalid InterceptionId/);
 assert.deepEqual(f.continued,['cancelled-font']);assert.equal(f.receipt.errors[0].error,'net::ERR_FAILED');await f.session.close();
});
