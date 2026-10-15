import test from 'node:test';import assert from 'node:assert/strict';
const settings=()=>import('../app/reader-settings.mjs').catch(()=>({}));
class Element extends EventTarget{
  constructor(tab){super();this.dataset=tab?{settingsTab:tab}:{};this.attributes=new Map();this.hidden=false;this.scrollTop=80;}
  setAttribute(key,value){this.attributes.set(key,String(value));}getAttribute(key){return this.attributes.get(key);}focus(){this.focused=true;}
}
function fixture(){const tabs=['reading','sound','habits','data'].map(name=>new Element(name)),elements=new Map(['settings-content','translation-settings','parallel-settings','translation-details',...tabs.map(t=>'settings-'+t.dataset.settingsTab)].map(id=>[id,new Element()]));return {tabs,elements,document:{querySelectorAll:()=>tabs,getElementById:id=>elements.get(id)}};}
test('settings only expose the translation controls relevant to the active reading mode',async()=>{
  const {mountReaderSettings}=await settings();assert.equal(typeof mountReaderSettings,'function');
  const f=fixture(),ui=mountReaderSettings({document:f.document});
  for(const [mode,translation,parallel]of [['en',false,false],['zh',true,false],['parallel',true,true]]){
    ui.update({mode});assert.equal(f.elements.get('translation-settings').hidden,!translation);assert.equal(f.elements.get('translation-details').hidden,!translation);assert.equal(f.elements.get('parallel-settings').hidden,!parallel);
  }
});
test('four settings tabs expose one panel at a time and keep keyboard focus in the selected tab',async()=>{
  const {mountReaderSettings}=await settings();assert.equal(typeof mountReaderSettings,'function');
  const f=fixture();mountReaderSettings({document:f.document});assert.equal(f.tabs[0].getAttribute('aria-selected'),'true');
  f.tabs[1].dispatchEvent(new Event('click'));assert.equal(f.elements.get('settings-reading').hidden,true);assert.equal(f.elements.get('settings-sound').hidden,false);
  const arrow=new Event('keydown',{cancelable:true});Object.defineProperty(arrow,'key',{value:'ArrowRight'});f.tabs[1].dispatchEvent(arrow);
  assert.equal(f.tabs[2].getAttribute('aria-selected'),'true');assert.equal(f.tabs[2].focused,true);assert.equal(f.elements.get('settings-habits').hidden,false);
  assert.equal(f.tabs.filter(t=>t.getAttribute('aria-selected')==='true').length,1);
});
