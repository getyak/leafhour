import test from 'node:test';
import assert from 'node:assert/strict';

const api=await import('../app/home-scroll-story.mjs').catch(()=>({}));

test('viewport progress has readable entry/exit bounds and reverses without history',()=>{
 assert.equal(typeof api.viewportProgress,'function');
 assert.equal(api.viewportProgress({top:900,height:500},1000),0);
 assert.equal(api.viewportProgress({top:325,height:500},1000),.5);
 assert.equal(api.viewportProgress({top:-250,height:500},1000),1);
 assert.equal(api.viewportProgress({top:325,height:500},1000),.5);
 assert.equal(api.viewportProgress({top:NaN,height:500},1000),0);
 assert.equal(api.viewportProgress({top:0,height:500},0),0);
});

function fixture({reduced=false,hidden=false,supported=true}={}){
 const win=new EventTarget(),doc=new EventTarget(),preference=new EventTarget(),frames=new Map(),effects=[];let next=0;
 Object.assign(win,{innerWidth:1440,innerHeight:900,scrollY:0,Element:{prototype:{animate(){}}},requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>preference});
 preference.matches=reduced;doc.hidden=false;doc.activeElement=null;
 const node=(id,y,height,width=500)=>{const value=new EventTarget();return Object.assign(value,{id,isConnected:true,dataset:{},style:{willChange:''},contains:target=>target===value,querySelector:()=>null,getBoundingClientRect:()=>({top:y-win.scrollY,bottom:y-win.scrollY+value.height,height:value.height,width}),height,animate(keyframes,options){const effect={node:value,keyframes,options,currentTime:null,paused:false,cancelled:false,pause(){this.paused=true;},cancel(){this.cancelled=true;},finished:Promise.resolve()};effects.push(effect);return effect;}});};
 const hero=node('hero',80,900),windowPhoto=node('window',220,300),pagePhoto=node('page',180,230),reading=node('reading',980,1500),card=node('card',1100,530),readingPhoto=node('reading-photo',980,1500),continuity=node('continuity',2480,700),figure=node('figure',2540,490),image=node('image',2540,490),header=node('header',0,80);
 hero.dataset.scrollStory='true';
 const nodes=new Map([['.home-hero',hero],['.story-window',windowPhoto],['.story-page',pagePhoto],['.story-reading',reading],['.story-demo .sample-sheet',card],['.story-reading-art img',readingPhoto],['.story-continuity',continuity],['.story-continuity figure',figure],['.story-continuity figure img',image]]);
 const root=new EventTarget(),classes=new Set();Object.assign(root,{hidden,ownerDocument:doc,classList:{add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v)},querySelector:s=>nodes.get(s)||null,querySelectorAll:()=>[],contains:n=>n?.isConnected!==false});doc.querySelector=s=>s==='.site-header'?header:null;
 if(!supported)delete win.Element.prototype.animate;
 const step=()=>{const pending=[...frames.values()];frames.clear();for(const callback of pending)callback();};
 return {win,doc,root,preference,frames,effects,hero,card,reading,step,windowPhoto};
}

test('scroll seeks real paused effects, coalesces frames and restores the same pose in reverse',()=>{
 assert.equal(typeof api.mountHomeScrollStory,'function');const f=fixture(),dispose=api.mountHomeScrollStory(f.root,f.win);
 assert.ok(f.effects.length>=4);assert.ok(f.effects.every(a=>a.paused));assert.ok(f.root.classList.contains('is-scroll-story'));
 const heroEffect=f.effects.find(a=>a.node===f.windowPhoto),start=heroEffect.currentTime;
 f.win.scrollY=400;for(let i=0;i<8;i++)f.win.dispatchEvent(new Event('scroll'));assert.equal(f.frames.size,1);f.step();assert.ok(heroEffect.currentTime>start);assert.equal(f.frames.size,0,'idle motion never schedules a perpetual frame loop');
 f.win.scrollY=0;f.win.dispatchEvent(new Event('scroll'));f.step();assert.equal(heroEffect.currentTime,start);dispose();
});

test('a tall sample never sticks or traps its controls in a short viewport',()=>{
 const f=fixture(),dispose=api.mountHomeScrollStory(f.root,f.win);assert.equal(f.reading.dataset.scrollPinned,'true');
 f.card.height=1000;f.win.dispatchEvent(new Event('resize'));f.step();assert.equal(f.reading.dataset.scrollPinned,'false');
 f.card.height=530;f.win.innerHeight=620;f.win.dispatchEvent(new Event('resize'));f.step();assert.equal(f.reading.dataset.scrollPinned,'false');dispose();
});

test('reduced motion and tab hiding restore the static document and cancel pending work',()=>{
 const f=fixture(),dispose=api.mountHomeScrollStory(f.root,f.win);f.win.dispatchEvent(new Event('scroll'));
 f.preference.matches=true;f.preference.dispatchEvent(new Event('change'));assert.equal(f.frames.size,0);assert.ok(f.effects.every(a=>a.cancelled));assert.equal(f.root.classList.contains('is-scroll-story'),false);
 f.preference.matches=false;f.preference.dispatchEvent(new Event('change'));assert.equal(f.root.classList.contains('is-scroll-story'),true);
 f.doc.hidden=true;f.doc.dispatchEvent(new Event('visibilitychange'));assert.equal(f.root.classList.contains('is-scroll-story'),false);assert.equal(f.frames.size,0);dispose();
});

test('private, unsupported and initially reduced surfaces create no effects',()=>{
 for(const options of [{hidden:true},{supported:false},{reduced:true}]){const f=fixture(options),dispose=api.mountHomeScrollStory(f.root,f.win);assert.equal(f.effects.length,0);assert.equal(f.root.classList.contains('is-scroll-story'),false);dispose();}
});

test('replaced home content and disposal cannot retain animation owners',()=>{
 const f=fixture(),dispose=api.mountHomeScrollStory(f.root,f.win);f.hero.isConnected=false;f.win.dispatchEvent(new Event('scroll'));f.step();assert.ok(f.effects.every(a=>a.cancelled));assert.equal(f.root.classList.contains('is-scroll-story'),false);
 const count=f.effects.length;dispose();f.win.dispatchEvent(new Event('pageshow'));f.win.dispatchEvent(new Event('scroll'));assert.equal(f.effects.length,count);assert.equal(f.frames.size,0);
});
test('viewport-height changes coalesce without rebuilding effects and page restore seeks the saved pose',()=>{
 const f=fixture(),dispose=api.mountHomeScrollStory(f.root,f.win);f.win.scrollY=450;f.win.dispatchEvent(new Event('scroll'));f.step();const count=f.effects.length,pose=f.effects.find(a=>a.node===f.windowPhoto).currentTime;
 f.win.innerHeight=850;for(let i=0;i<8;i++)f.win.dispatchEvent(new Event('resize'));assert.equal(f.frames.size,1);f.step();assert.equal(f.effects.length,count);
 f.win.dispatchEvent(new Event('pagehide'));assert.ok(f.effects.every(a=>a.cancelled));f.win.dispatchEvent(new Event('pageshow'));assert.equal(f.effects.findLast(a=>a.node===f.windowPhoto).currentTime,pose);dispose();
});
test('a mounted homepage that becomes hidden releases its motion work',()=>{
 const f=fixture(),dispose=api.mountHomeScrollStory(f.root,f.win);f.root.hidden=true;f.win.dispatchEvent(new Event('scroll'));f.step();assert.equal(f.root.classList.contains('is-scroll-story'),false);assert.ok(f.effects.every(a=>a.cancelled));assert.equal(f.frames.size,0);dispose();
});
