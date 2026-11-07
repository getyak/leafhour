// Optional, homepage-only enhancements. The HTML remains the source of truth.
export function selectDemoMode(root,mode){
 if(!['read','translate','ask'].includes(mode))return false;
 const panels=[...root.querySelectorAll('[data-demo-panel]')];
 if(!panels.some(panel=>panel.dataset.demoPanel===mode))return false;
 for(const panel of panels)panel.hidden=panel.dataset.demoPanel!==mode;
 for(const button of root.querySelectorAll('[data-demo-mode]'))button.setAttribute('aria-pressed',String(button.dataset.demoMode===mode));
 root.dataset.mode=mode;return true;
}

export function mountHomeExperience(root,win=root?.ownerDocument?.defaultView){
 const stage=root?.querySelector('#product-stage'),doc=root?.ownerDocument;
 if(!root||root.hidden||!stage||!win)return ()=>{};
 const cleanups=[],demo=root.querySelector('.web-reader-demo'),preference=win.matchMedia('(prefers-reduced-motion: reduce)');
 let engaged=false;
 let disposed=false,visible=true,motion=null,scene=null,loading=false,generation=0,utterance=null;
 const listen=(target,type,fn,options)=>{target.addEventListener(type,fn,options);cleanups.push(()=>target.removeEventListener(type,fn,options));};
 for(const button of demo.querySelectorAll('[data-demo-mode]'))listen(button,'click',()=>selectDemoMode(demo,button.dataset.demoMode));
 listen(demo.querySelector('[data-demo-return]'),'click',()=>{selectDemoMode(demo,'read');demo.querySelector('[data-demo-mode="read"]').focus({preventScroll:true});});
 const voice=root.querySelector('[data-voice-preview]'),label=voice.querySelector('[data-voice-label]'),status=root.querySelector('[data-voice-status]'),idleStatus=status.textContent;
 const finishVoice=()=>{utterance=null;voice.setAttribute('aria-pressed','false');label.textContent=voice.dataset.playLabel;};
 const stopVoice=()=>{if(utterance){utterance.onend=null;utterance.onerror=null;win.speechSynthesis?.cancel();finishVoice();}};
 listen(voice,'click',()=>{
  if(utterance){stopVoice();return;}
  if(!win.speechSynthesis||!win.SpeechSynthesisUtterance){status.textContent=status.dataset.unavailable;return;}
  try{
   utterance=new win.SpeechSynthesisUtterance('Alice was beginning to get very tired of sitting by her sister on the bank, and of having nothing to do.');
   utterance.lang='en-US';utterance.rate=.88;
   const playing=utterance;
   utterance.onend=()=>{if(utterance===playing)finishVoice();};utterance.onerror=event=>{if(utterance!==playing)return;if(!['canceled','interrupted'].includes(event.error))status.textContent=status.dataset.unavailable;finishVoice();};
   voice.setAttribute('aria-pressed','true');label.textContent=voice.dataset.stopLabel;status.textContent=idleStatus;
   win.speechSynthesis.speak(utterance);
  }catch{status.textContent=status.dataset.unavailable;finishVoice();}
 });
 const stopEffects=()=>{generation++;motion?.revert();motion=null;scene?.dispose();scene=null;};
 async function startEffects(){
  if(disposed||root.hidden||doc.hidden||!visible||preference.matches||win.navigator.connection?.saveData||loading||motion||!engaged)return;
  loading=true;const version=++generation;
  try{
   const {gsap,ScrollTrigger}=await import('./vendor/gsap-scroll.mjs');
   if(disposed||version!==generation||preference.matches||doc.hidden||root.hidden||!visible)return;
   gsap.registerPlugin(ScrollTrigger);
   motion=gsap.context(()=>{
    gsap.fromTo(demo,{rotateY:7,rotateX:5,rotateZ:-1.5},{rotateY:-2,rotateX:0,rotateZ:0,y:-22,ease:'none',scrollTrigger:{trigger:stage,start:'top 65%',end:'bottom top',scrub:.7}});
    gsap.to(root.querySelector('.phone-demo'),{y:-52,rotateZ:1,ease:'none',scrollTrigger:{trigger:stage,start:'top 65%',end:'bottom top',scrub:.9}});
    gsap.to(root.querySelector('.floating-voice'),{y:-24,rotateZ:0,ease:'none',scrollTrigger:{trigger:stage,start:'top 65%',end:'bottom top',scrub:.8}});
    gsap.fromTo(root.querySelector('.platform-desktop'),{rotateY:-13,rotateZ:-4},{rotateY:0,rotateZ:0,ease:'none',scrollTrigger:{trigger:'#platforms',start:'top bottom',end:'center center',scrub:.8}});
   },root);
   // The product and controls are already usable before any 3D dependency loads.
   const canvas=stage.querySelector('canvas'),context=canvas.getContext('webgl2',{alpha:true,antialias:true,powerPreference:'low-power'});
   if(!context)return;
   const THREE=await import('./vendor/three-scene.mjs');
   if(disposed||version!==generation||preference.matches||doc.hidden||root.hidden||!visible)return;
   scene=createPaperScene({THREE,canvas,context,win});
   motion.add(()=>gsap.to(scene.progress,{value:1,ease:'none',onUpdate:()=>scene?.render(),scrollTrigger:{trigger:stage,start:'top 85%',end:'bottom top',scrub:.6}}));
  }catch{
   // A browser denying WebGL, or a failed optional chunk, keeps the static paper.
  }finally{loading=false;if(version!==generation&&!disposed)startEffects();}
 }
 let observer=null;
 if(win.IntersectionObserver){observer=new win.IntersectionObserver(entries=>{visible=entries.some(row=>row.isIntersecting);if(visible)startEffects();},{rootMargin:'150px'});observer.observe(stage);cleanups.push(()=>observer.disconnect());}
 const update=()=>{stopEffects();if(!doc.hidden&&!root.hidden)startEffects();else stopVoice();};
 listen(preference,'change',update);listen(doc,'visibilitychange',update);listen(win,'pagehide',()=>{stopEffects();stopVoice();});listen(win,'pageshow',()=>startEffects());
 let mutation=null;
 if(win.MutationObserver){mutation=new win.MutationObserver(()=>{if(root.hidden||!root.contains(stage)){stopEffects();stopVoice();}else startEffects();});mutation.observe(root,{attributes:true,attributeFilter:['hidden'],childList:true});cleanups.push(()=>mutation.disconnect());}
 const engage=()=>{engaged=true;startEffects();};
 listen(win,'scroll',engage,{passive:true});listen(stage,'pointerdown',engage,{passive:true});listen(stage,'focusin',engage);
 return ()=>{if(disposed)return;disposed=true;stopEffects();stopVoice();for(const cleanup of cleanups)cleanup();};
}

function createPaperScene({THREE:T,canvas,context,win}){
 const renderer=new T.WebGLRenderer({canvas,context,alpha:true,antialias:true,powerPreference:'low-power'});
 renderer.setPixelRatio(Math.min(win.devicePixelRatio||1,1.4));renderer.outputColorSpace=T.SRGBColorSpace;
 const scene=new T.Scene(),camera=new T.PerspectiveCamera(39,1,.1,60);camera.position.set(0,0,12);
 scene.add(new T.AmbientLight(0xffffff,1.4));const light=new T.DirectionalLight(0xfff9df,1.6);light.position.set(-3,6,8);scene.add(light);
 const fans=[],resources=[],progress={value:0};
 function fan(x,y,scale,rotation){
  const group=new T.Group();group.position.set(x,y,0);group.scale.setScalar(scale);group.rotation.set(-.3,-.4,rotation);scene.add(group);fans.push(group);
  for(let n=0;n<7;n++){
   const geometry=new T.PlaneGeometry(1.95,2.9,24,6),positions=geometry.attributes.position;
   for(let i=0;i<positions.count;i++){
    const px=positions.getX(i),py=positions.getY(i);
    positions.setZ(i,Math.pow((px+.975)/1.95,2)*(.65+n*.03)+Math.sin(py*1.1)*.07);
   }
   geometry.computeVertexNormals();
   const material=new T.MeshStandardMaterial({color:new T.Color(n%2?'#c5d5b1':'#a4ba8b'),roughness:.87,metalness:0,side:T.DoubleSide});
   const page=new T.Mesh(geometry,material);page.position.set(.3+n*.05,0,n*.055);page.rotation.z=(n-3)*.18;page.rotation.y=(n-3)*.08;
   group.add(page);resources.push(geometry,material);
  }
 }
 fan(4,1.1,1.05,-.45);fan(-4.8,-1.1,.69,2.8);
 function render(){
  if(win.document.hidden)return;
  fans[0].rotation.y=-.4+progress.value*.55;fans[0].rotation.z=-.45-progress.value*.3;fans[1].rotation.z=2.8+progress.value*.5;
  renderer.render(scene,camera);
 }
 function resize(){const box=canvas.getBoundingClientRect();if(!box.width||!box.height)return;renderer.setSize(box.width,box.height,false);camera.aspect=box.width/box.height;camera.updateProjectionMatrix();render();}
 const observer=new win.ResizeObserver(resize);observer.observe(canvas);resize();canvas.parentElement.classList.add('is-ready');
 const lost=()=>canvas.parentElement.classList.remove('is-ready');canvas.addEventListener('webglcontextlost',lost);
 return {progress,render,dispose(){observer.disconnect();canvas.removeEventListener('webglcontextlost',lost);canvas.parentElement.classList.remove('is-ready');for(const resource of resources)resource.dispose();renderer.dispose();}};
}
if(typeof document!=='undefined')mountHomeExperience(document.getElementById('home-view'));
