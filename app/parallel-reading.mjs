export const parallelStyles=Object.freeze([
  {id:'plain',name:'素面对照',description:'原文与译文同等清晰，适合细读核对。'},
  {id:'muted',name:'译文淡化',description:'原文先入眼，译文安静地留作参考。'},
  {id:'quote',name:'引用侧线',description:'用一条细线区分译文，来回对照更容易。'},
  {id:'tint',name:'柔和底色',description:'给译文铺一层浅色，快速找到对应段落。'},
  {id:'reveal',name:'点按揭晓',description:'先试着读原文，再逐段查看已有译文。'}
]);

// Every pair keeps its original paragraph anchor; revealing only changes local display.
export function createParallelPair({document,layers,variant,prose,passageId,revealed=new Set(),onReveal=change=>change()}){
  const pair=document.createElement('div');pair.className='parallel-pair';
  for(const layer of layers){
    const column=document.createElement('div');column.className='parallel-column parallel-'+layer.kind;
    const label=document.createElement('span');label.className='pair-label';label.textContent=layer.label;column.append(label);
    const text=prose(layer,variant);
    if(layer.kind==='translation'){
      const key=passageId+':'+variant,toggle=document.createElement('button');toggle.type='button';toggle.className='parallel-reveal';
      const content=document.createElement('div');content.className='parallel-translation-text';content.id='parallel-translation-'+passageId+'-'+variant;content.append(text);
      toggle.setAttribute('aria-controls',content.id);
      const sync=()=>{const open=revealed.has(key);column.dataset.revealed=String(open);toggle.setAttribute('aria-expanded',String(open));toggle.textContent=open?'收起译文':'查看译文';};
      toggle.addEventListener('click',event=>{event.stopPropagation();onReveal(()=>{if(revealed.has(key))revealed.delete(key);else revealed.add(key);sync();});});sync();
      column.append(toggle,content);
    }else column.append(text);
    pair.append(column);
  }
  return pair;
}

export function mountParallelSettings({document,onChange,onActivate}){
  const root=document.getElementById('parallel-style-options');
  for(const style of parallelStyles){
    const button=document.createElement('button');button.type='button';button.dataset.parallelStyleChoice=style.id;button.setAttribute('aria-pressed','false');
    const sample=document.createElement('span');sample.className='parallel-style-sample sample-'+style.id;sample.setAttribute('aria-hidden','true');sample.append(document.createElement('i'),document.createElement('i'));
    const copy=document.createElement('span'),title=document.createElement('strong'),description=document.createElement('span');title.textContent=style.name;description.textContent=style.description;copy.append(title,description);button.append(sample,copy);
    button.addEventListener('click',()=>onChange({parallelStyle:style.id}));root.append(button);
  }
  for(const key of ['parallelLayout','parallelColor','parallelBackground'])document.getElementById(key).addEventListener('change',event=>onChange({[key]:event.target.value}));
  document.getElementById('activate-parallel').addEventListener('click',onActivate);
  const preview=document.getElementById('parallel-preview');
  preview.append(createParallelPair({document,passageId:'settings-preview',variant:'interpretive',layers:[{kind:'original',label:'原文',lang:'en',text:'Who in the world am I?'},{kind:'translation',label:'意译 · 示例',lang:'zh-Hans',text:'我究竟是谁？'}],prose:layer=>{const p=document.createElement('p');p.lang=layer.lang;p.textContent=layer.text;return p;}}));
}

export function applyParallelAppearance(document,state){
  for(const key of ['parallelLayout','parallelStyle','parallelColor','parallelBackground'])document.body.dataset[key]=state[key];
  for(const key of ['parallelLayout','parallelColor','parallelBackground'])document.getElementById(key).value=state[key];
  for(const button of document.querySelectorAll('[data-parallel-style-choice]'))button.setAttribute('aria-pressed',String(button.dataset.parallelStyleChoice===state.parallelStyle));
  document.getElementById('activate-parallel').hidden=state.mode==='parallel';
}
