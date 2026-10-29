import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as paintObserver from '../tools/lib/platform-font-observer.mjs';
import {observeInitialPopovers,assertInitialPopoversClosed,exercisePopoverKeyboard,observeReaderTools,observeReaderBookActions} from '../tools/lib/platform-font-observer.mjs';

const observe=nodes=>JSON.parse(JSON.stringify(vm.runInNewContext('('+observeInitialPopovers.toString()+')()',{
  document:{querySelectorAll:selector=>{assert.equal(selector,'[popover]');return nodes;}},
  getComputedStyle:node=>({display:node.display,visibility:'visible'}),
})));
const node=(id,{display='none',rects=0,native=false}={})=>({id,display,
  getClientRects:()=>Array.from({length:rects},()=>({})),
  ...(native?{showPopover(){}}:{}),
  matches(){throw Error('Unsupported pseudo-class must never be queried by the observer');},
});

test('serialized read-only observer accepts truly closed native and unsupported popovers',()=>{
  const observed=observe([node('shelf-filter-panel'),node('library-book-menu',{native:true})]);
  assert.deepEqual(observed,[{id:'shelf-filter-panel',nativePopover:false,rects:0,display:'none',visibility:'visible'},{id:'library-book-menu',nativePopover:true,rects:0,display:'none',visibility:'visible'}]);
  assert.doesNotThrow(()=>assertInitialPopoversClosed(observed,['shelf-filter-panel','library-book-menu']));
});
test('the actual painted default fallback defect fails instead of accepting green font assertions',()=>{
  const observed=observe([node('shelf-filter-panel',{display:'block',rects:1})]);
  assert.throws(()=>assertInitialPopoversClosed(observed,['shelf-filter-panel']),/shelf-filter-panel.*closed/);
});
test('removing the actual control cannot satisfy initial-closed acceptance',()=>{
  assert.throws(()=>assertInitialPopoversClosed([],['book-info']),/book-info.*required/);
});

function keyboardTransport(options={}){
  let open=false,focusOnTrigger=false,focusInPanel=false,stopped=false,closing=false,closedReads=0;
  const commands=[],captures=[];
  const cdp={
    async evaluate(expression){
      if(expression.startsWith('(function observeNativeScroll'))return options.scroll||{status:'unchanged'};
      if(expression.startsWith('(function observePopoverPaint')){captures.push('paint observation');if(options.cancelAtPaint)stopped=true;return options.paint||{status:'settled'};}
      assert.ok(expression.startsWith('(function observePopoverState'),'only the actual read-only observation is evaluated');
      if(closing&&options.delayedCloseFocus&&++closedReads>=2)focusOnTrigger=true;
      return {url:options.changedUrl&&!open&&captures.length?'/library?broken=1':'/library',trigger:{visible:options.visible!==false,disabled:false,inert:false},panel:{visible:open},expanded:String(open),focusOnTrigger,focusInPanel};
    },
    async send(method,args){
      commands.push([method,args]);
      if(method==='DOM.getDocument')return {root:{nodeId:1}};
      if(method==='DOM.querySelector')return {nodeId:2};
      if(method==='DOM.focus'){focusOnTrigger=!options.failedFocus;if(options.cancelAfterFocus)stopped=true;return {};}
      assert.equal(method,'Input.dispatchKeyEvent');
      if(args.type==='keyDown'&&args.key==='Enter'&&args.text==='\r'&&args.unmodifiedText==='\r'){open=true;focusOnTrigger=false;}
      if(args.type==='rawKeyDown'){
        if(args.key==='Tab')focusInPanel=!options.outsideFocus;
        else if(args.key==='Escape'){open=false;closing=true;focusInPanel=false;focusOnTrigger=!options.delayedCloseFocus&&!options.noCloseFocus;}
      }
      return {};
    },
  };
  return {stop:()=>{stopped=true;},cdp,commands,captures,trigger:'#shelf-filter-button',panel:'#shelf-filter-panel',capture:async()=>captures.push('real open screenshot'),guard:()=>{if(stopped)throw Error('cancelled');}};
}
test('remote keyboard sequence activates the real button once and observes focus, screenshot, Escape and URL roundtrip',async()=>{
  const f=keyboardTransport();const value=await exercisePopoverKeyboard(f);
  assert.equal(value.before.panel.visible,false);assert.equal(value.opened.focusInPanel,true);assert.equal(value.closed.focusOnTrigger,true);
  const down=f.commands.filter(([method,args])=>method==='Input.dispatchKeyEvent'&&args.type!=='keyUp').map(([,args])=>args);
  assert.deepEqual(down.map(args=>args.key),['Enter','Tab','Escape']);
  assert.equal(down[0].type,'keyDown');assert.equal(down[0].text,'\r');assert.equal(down[0].unmodifiedText,'\r');
  assert.deepEqual(f.captures,['paint observation','real open screenshot']);assert.equal(value.paint.status,'settled');
});
test('closing visibility can precede the native close event that returns focus',async()=>{
  const f=keyboardTransport({delayedCloseFocus:true});const value=await exercisePopoverKeyboard(f);
  assert.equal(value.closed.focusOnTrigger,true);assert.equal(f.commands.filter(([,args])=>args?.key==='Escape'&&args.type==='rawKeyDown').length,1,'Only closing state is observed; Escape must not be replayed');
});
test('a closed panel that never restores focus remains an acceptance failure',async()=>{
  const f=keyboardTransport({noCloseFocus:true});await assert.rejects(()=>exercisePopoverKeyboard(f),/Escape.*focus|close.*focus/);
  assert.equal(f.commands.filter(([,args])=>args?.key==='Escape'&&args.type==='rawKeyDown').length,1);
});
test('hidden trigger or failed actual focus refuses keyboard activation',async()=>{
  for(const options of [{visible:false},{failedFocus:true}]){
    const f=keyboardTransport(options);await assert.rejects(()=>exercisePopoverKeyboard(f),/usable popover trigger|actually receive focus/);
    assert.equal(f.commands.some(([method])=>method==='Input.dispatchKeyEvent'),false);assert.equal(f.captures.length,0);
  }
});
test('failed real scrolling retains the exact selector and observed geometry before any input',async()=>{
  const scroll={status:'timeout',before:{rect:{x:450,y:14,width:120,height:44},scrollY:497},after:{rect:{x:450,y:14,width:120,height:44},scrollY:497},needsMovement:true};
  const f=keyboardTransport({scroll});
  await assert.rejects(()=>exercisePopoverKeyboard({...f,trigger:'#open-book-info',panel:'#book-info'}),error=>{
    assert.match(error.message,/#open-book-info/);assert.match(error.message,/timeout/);
    assert.ok(error.message.includes(JSON.stringify(scroll.before)),'failure evidence retains actual pre-scroll facts');
    assert.ok(error.message.includes(JSON.stringify(scroll.after)),'failure evidence retains actual post-scroll facts');
    return true;
  });
  assert.equal(f.commands.length,0);assert.equal(f.captures.length,0);
});
test('outside focus and changed URL are real failures, not accepted screenshots or repeated activations',async()=>{
  const outside=keyboardTransport({outsideFocus:true});await assert.rejects(()=>exercisePopoverKeyboard(outside),/inside the open popover/);assert.equal(outside.captures.length,0);
  const changed=keyboardTransport({changedUrl:true});await assert.rejects(()=>exercisePopoverKeyboard(changed),/preserve the entry URL/);
  assert.equal(changed.commands.filter(([method,args])=>method==='Input.dispatchKeyEvent'&&args.type==='keyDown'&&args.key==='Enter').length,1);
});
test('lifecycle cancellation after protocol focus permits no late input or screenshot',async()=>{
  const f=keyboardTransport({cancelAfterFocus:true});await assert.rejects(()=>exercisePopoverKeyboard(f),/cancelled/);
  assert.equal(f.commands.some(([method])=>method==='Input.dispatchKeyEvent'),false);assert.equal(f.captures.length,0);
});

test('remote enhancement readiness is awaited before accepting an open screenshot',async()=>{
  const f=keyboardTransport();let ready=false;
  await exercisePopoverKeyboard({...f,afterOpened:async()=>{ready=true;},capture:async()=>{assert.equal(ready,true,'actual optional controls must finish before capture');f.captures.push('ready screenshot');}});
  assert.equal(ready,true);assert.deepEqual(f.captures,['paint observation','ready screenshot']);
});
test('cancellation during remote enhancement readiness permits no late screenshot or Escape input',async()=>{
  const f=keyboardTransport();await assert.rejects(()=>exercisePopoverKeyboard({...f,afterOpened:async()=>f.stop()}),/cancelled/);
  assert.equal(f.captures.length,0);assert.equal(f.commands.some(([method,args])=>method==='Input.dispatchKeyEvent'&&args.key==='Escape'),false);
});

function readerProbe(options={}){
  const rect={x:0,y:0,width:100,height:44,bottom:44,right:100,top:0,left:0};
  const share={tagName:options.wrongTag?'DIV':'BUTTON',disabled:!!options.disabled,style:{display:options.hidden?'none':'block',visibility:'visible'},getClientRects:()=>options.missingRect?[]:[rect],getBoundingClientRect:()=>({...rect,width:options.zeroWidth?0:100})};
  const gift={tagName:'DIALOG',open:!!options.giftOpen},header={inert:!!options.inert,style:{display:'block',visibility:options.hiddenHeader?'hidden':'visible'},getClientRects:()=>[rect],getBoundingClientRect:()=>rect,contains:value=>value==='real header focus'};
  const document={activeElement:options.outsideFocus?'outside':'real header focus',getElementById:id=>({'book-info-share':options.noShare?null:share,'reader-book-gift':options.noGift?null:gift,'reading-tools-trigger':{getAttribute:()=>options.collapsed?'false':'true'},'reading-header':header})[id]};
  return {document,getComputedStyle:node=>node.style,innerWidth:393,innerHeight:722};
}
const runProbe=(observer,options)=>JSON.parse(JSON.stringify(vm.runInNewContext('('+observer.toString()+')()',readerProbe(options))));
test('serialized optional-action observer requires actual enabled rendered button and closed native gift dialog',()=>{
  const ready=runProbe(observeReaderBookActions,{});assert.equal(ready.ready,true);assert.equal(ready.shareRendered,true);assert.equal(ready.giftDialogPresent,true);
  for(const options of [{disabled:true},{noShare:true},{noGift:true},{hidden:true},{missingRect:true},{zeroWidth:true},{wrongTag:true},{giftOpen:true}])assert.equal(runProbe(observeReaderBookActions,options).ready,false,JSON.stringify(options));
});
test('serialized tools observer reports real expanded header, inert state and actual focus without changing them',()=>{
  const ready=runProbe(observeReaderTools,{});assert.deepEqual(ready,{expanded:'true',headerInert:false,headerVisible:true,focusInHeader:true});
  assert.equal(runProbe(observeReaderTools,{collapsed:true}).expanded,'false');assert.equal(runProbe(observeReaderTools,{inert:true}).headerInert,true);assert.equal(runProbe(observeReaderTools,{hiddenHeader:true}).headerVisible,false);assert.equal(runProbe(observeReaderTools,{outsideFocus:true}).focusInHeader,false);
});


async function paintScenario({animationUntil=0,parentUntil=0,permanentAnimation=false,permanentOpacity=false,unsupported=false,removed=false}={}){
  let now=0,next=0,resolved=false,result;const frames=new Map(),timers=new Map();
  const parent={id:'parent',parentElement:null,getAnimations:()=>[]};
  const panel={id:'panel',parentElement:parent,isConnected:!removed,getClientRects:()=>[{}],getBoundingClientRect:()=>({x:12,y:now<animationUntil?100-now/100:98.6,width:320,height:438}),getAnimations:()=>permanentAnimation||now<animationUntil?[{playState:'running',pending:now<60,finish(){throw Error('must never finish animation');},cancel(){throw Error('must never cancel animation');}}]:[]};
  if(unsupported)panel.getAnimations=undefined;
  const promise=vm.runInNewContext('('+paintObserver.observePopoverPaint.toString()+')("#panel")',{
    document:{querySelector:selector=>{assert.equal(selector,'#panel');return panel;}},innerWidth:393,innerHeight:722,
    getComputedStyle:node=>({opacity:node===panel?(permanentOpacity?'.4':now<animationUntil?String(.2+.8*now/animationUntil):'1'):now<parentUntil?'.5':'1',display:'block',visibility:'visible',transform:'none',translate:node===panel&&now<animationUntil?'0 -3px':'none',scale:'none',rotate:'none'}),
    performance:{now:()=>now},requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),setTimeout:(fn,ms)=>{const id=++next;timers.set(id,{at:now+ms,fn});return id;},clearTimeout:id=>timers.delete(id),
  });
  promise.then(value=>{resolved=true;result=JSON.parse(JSON.stringify(value));});
  for(let i=0;i<250&&!resolved;i++){
    now+=20;const pending=[...frames];frames.clear();for(const [,fn]of pending)fn();for(const [id,timer]of [...timers])if(timer.at<=now){timers.delete(id);timer.fn();}await Promise.resolve();
  }
  await promise;assert.equal(frames.size,0);assert.equal(timers.size,0);return result;
}
test('serialized paint observer waits for real opacity/translate animation then stable painted frames',async()=>{
  const r=await paintScenario({animationUntil:140});assert.equal(r.status,'settled');assert.ok(r.elapsedMs>=240);assert.equal(r.before.ready,false);assert.equal(r.after.ready,true);assert.equal(r.after.nodes[0].opacity,1);assert.equal(r.after.nodes[0].activeAnimations,0);assert.equal(r.after.rect.y,98.6);
});
test('paint observation includes ancestor opacity and rejects ongoing, transparent, detached or unsupported surfaces',async()=>{
  const parent=await paintScenario({parentUntil:240});assert.equal(parent.status,'settled');assert.ok(parent.elapsedMs>=340);
  for(const options of [{permanentAnimation:true},{permanentOpacity:true},{removed:true}]){const r=await paintScenario(options);assert.equal(r.status,'timeout',JSON.stringify(options));assert.equal(r.after.ready,false);assert.ok(r.history.length<=16);}
  assert.equal((await paintScenario({unsupported:true})).status,'unsupported');
});
test('paint failure or cancellation refuses a screenshot and does not issue Escape after rejection',async()=>{
  const f=keyboardTransport({paint:{status:'timeout',after:{ready:false}}});await assert.rejects(()=>exercisePopoverKeyboard(f),/paint.*settle|settled.*paint/i);assert.deepEqual(f.captures,['paint observation']);assert.equal(f.commands.some(([,args])=>args?.key==='Escape'),false);
  const cancelled=keyboardTransport({cancelAtPaint:true});await assert.rejects(()=>exercisePopoverKeyboard(cancelled),/cancelled/);assert.deepEqual(cancelled.captures,['paint observation']);assert.equal(cancelled.commands.some(([,args])=>args?.key==='Escape'),false);
});
