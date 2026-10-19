// GET-177/187 shared progressive accessible choice primitive. It enhances an
// existing native select instead of replacing it: options, value and disabled
// state stay owned by the select, and a confirmed changed value dispatches
// exactly one normal bubbling change event so every existing native side effect
// keeps working. Programmatic option/value writes are mirrored only through the
// explicit sync() call — no setter monkey patches and no blanket observers.
//
// Presentation: up to six options become immediate segmented chips; larger
// groups become one editable APG combobox input controlling one sibling
// listbox, with search, Arrow/Home/End navigation, Enter to commit, Escape to
// cancel and restore the committed label, normal Tab traversal and an IME
// composition guard. The closed popup is hidden from layout and accessibility
// at every close point. Chip and option nodes are keyed by value so sync()
// never detaches a focused control. The native select stays visible only if
// mounting failed, and any partial chrome from a failed mount is removed.

let instances=0;
const COMPOSITION_END='compositionend';

function readOptions(select){
  return [...select.options].map((option,index)=>({
    index,
    value:String(option.value),
    label:String(option.textContent||option.value),
    disabled:!!option.disabled
  }));
}

export function mountChoiceControl({document,select,label='',onChange=()=>{}}={}){
  if(!document||!select)return null;
  const instance='choice-control-'+(++instances),hadNativeFocus=document.activeElement===select;
  const control={mode:null,select,root:null,input:null,listbox:null,chips:[],options:[],activeValue:null,onChange};
  let composing=false,query='',open=false,compositionBase=null;
  try{
    const labelElement=select.id?document.querySelector('label[for="'+select.id+'"]'):null;
    let labelText=(typeof label==='string'&&label)||labelElement?.textContent?.trim()||select.getAttribute('aria-label')||'选择';
    const describedBy=select.getAttribute('aria-describedby');
    const commit=value=>{
      const option=[...select.options].find(row=>String(row.value)===value);
      if(select.disabled||!option||option.disabled||value===select.value)return false;
      select.value=value;
      select.dispatchEvent(new Event('change',{bubbles:true}));
      onChange(value);
      sync(); // Internal commits update selected/pressed semantics immediately.
      return true;
    };
    const attach=root=>{
      select.after(root);
      control.root=root;
      select.hidden=true;
      select.classList?.add('choice-native');
    };
    const decorateRoot=root=>{
      root.className='choice-control';
      root.setAttribute('aria-label',labelText);
      if(describedBy)root.setAttribute('aria-describedby',describedBy);
    };

    function buildChips(){
      const root=document.createElement('div');
      decorateRoot(root);
      root.classList.add('choice-chips');
      root.setAttribute('role','group');
      const chipNodes=new Map();
      control.mode='chips';control.input=null;control.listbox=null;
      control.rebuild=()=>{
        const fresh=[];
        for(const option of control.options){
          let chip=chipNodes.get(option.value);
          if(!chip){
            chip=document.createElement('button');
            chip.type='button';
            chip.className='choice-chip';
            chip.dataset.value=option.value;
            chip.addEventListener('click',()=>{commit(option.value);sync();});
            chipNodes.set(option.value,chip);
          }
          chip.textContent=option.label;
          chip.disabled=option.disabled||select.disabled;
          chip.setAttribute('aria-pressed',String(option.value===select.value));
          option.node=chip;
          fresh.push(chip);
        }
        for(const [value,chip] of [...chipNodes])if(!control.options.some(option=>option.value===value)){chipNodes.delete(value);chip.remove();}
        root.replaceChildren(...fresh);
        control.chips=fresh;
      };
      attach(root);
      control.rebuild();
    }

    function buildCombobox(){
      const root=document.createElement('div');
      decorateRoot(root);
      root.classList.add('choice-combobox');
      const input=document.createElement('input');
      input.type='text';
      input.className='choice-input';
      input.id=instance+'-input';
      input.setAttribute('role','combobox');
      input.setAttribute('aria-expanded','false');
      input.setAttribute('aria-autocomplete','list');
      input.setAttribute('aria-label',labelText);
      if(describedBy)input.setAttribute('aria-describedby',describedBy);
      input.autocomplete='off';
      const listbox=document.createElement('div');
      listbox.className='choice-listbox';
      listbox.id=instance+'-listbox';
      listbox.setAttribute('role','listbox');
      listbox.setAttribute('aria-label',labelText);
      listbox.hidden=true;
      input.setAttribute('aria-controls',listbox.id);
      root.append(input,listbox);
      control.mode='combobox';control.input=input;control.listbox=listbox;

      // Keyboard navigation follows the rows actually shown. A label-only
      // locale commit preserves the current result set until the user edits
      // the query; matching new labels must not invalidate its active option.
      const visible=()=>control.options.filter(option=>!open||!option.node?.hidden);
      const enabled=()=>visible().filter(option=>!option.disabled&&!select.disabled);
      const byValue=value=>control.options.find(option=>option.value===value)||null;
      const setActive=(option,{focusText=true}={})=>{
        control.activeValue=option?option.value:null;
        if(option&&focusText&&document.activeElement!==input)input.focus();
        syncActiveDescendant();
      };
      const syncActiveDescendant=()=>{
        input.removeAttribute('aria-activedescendant');
        if(!open||control.activeValue===null)return;
        for(const option of control.options){
          if(option.value!==control.activeValue)continue;
          const node=optionNodes.get(option.value);
          if(node&&!node.hidden)input.setAttribute('aria-activedescendant',node.id);
        }
      };
      control.syncDisplay=()=>syncDisplay();
      control.updateClosedLabel=()=>{
        if(open||composing)return;
        const committed=byValue(select.value),text=committed?committed.label:select.value;
        if(input.value!==text)input.value=text;
      };
      const setOpen=next=>{
        open=next;
        input.setAttribute('aria-expanded',String(open));
        listbox.hidden=!open;
        if(!open)query='';
        syncDisplay();
        syncActiveDescendant();
      };
      const syncDisplay=()=>{
        for(const option of control.options){
          const node=optionNodes.get(option.value);
          if(node)node.hidden=open&&!(!query||option.label.toLowerCase().includes(query));
        }
        if(!open){const committed=byValue(select.value);input.value=committed?committed.label:select.value;}
      };
      const applyQuery=text=>{
        query=String(text||'').trim().toLowerCase();
        if(!query){setOpen(false);return;}
        if(!open)setOpen(true);else{syncDisplay();syncActiveDescendant();}
        setActive(enabled()[0]||null,{focusText:false});
      };
      const optionNodes=new Map();
      const optionIds=new Map();
      let idSequence=0;
      control.rebuild=()=>{
        const fresh=[];
        for(const option of control.options){
          let node=optionNodes.get(option.value);
          if(!node){
            node=document.createElement('div');
            node.className='choice-option';
            if(!optionIds.has(option.value))optionIds.set(option.value,instance+'-option-'+(++idSequence));
            node.id=optionIds.get(option.value);
            node.setAttribute('role','option');
            // Pointer press keeps the input focused so blur cannot reset the
            // searched rows before the click lands on the row under the pointer.
            node.addEventListener('mousedown',event=>{event.preventDefault();});
            node.addEventListener('click',()=>{const current=control.options.find(row=>row.value===option.value);if(!current||current.disabled||select.disabled)return;commit(current.value);setOpen(false);input.focus();});
            optionNodes.set(option.value,node);
          }
          node.textContent=option.label;
          node.setAttribute('aria-selected',String(option.value===select.value));
          if(option.disabled)node.setAttribute('aria-disabled','true');else node.removeAttribute('aria-disabled');
          node.classList.toggle('is-selected',option.value===select.value);
          option.node=node;
          fresh.push(node);
        }
        for(const [value,node] of [...optionNodes])if(!control.options.some(option=>option.value===value)){optionNodes.delete(value);node.remove();}
        listbox.replaceChildren(...fresh);
        if(!open)control.activeValue=select.value;
        syncDisplay();
        syncActiveDescendant();
      };
      control.syncActiveDescendant=syncActiveDescendant;
      control.setOpen=setOpen;
      control.reconcileActive=()=>{
        if(!open){control.activeValue=select.value;syncActiveDescendant();return;}
        const candidates=enabled();
        if(!candidates.some(option=>option.value===control.activeValue))control.activeValue=candidates[0]?.value??null;
        syncActiveDescendant();
      };

      input.addEventListener('input',()=>{if(composing)return;applyQuery(input.value);});
      // Only the final composed text is a search: a cancelled composition that
      // leaves the committed display label untouched must not become a query.
      input.addEventListener('compositionstart',()=>{composing=true;compositionBase=input.value;});
      input.addEventListener(COMPOSITION_END,()=>{composing=false;const final=input.value,base=compositionBase;compositionBase=null;if(final!==base)applyQuery(final);else control.updateClosedLabel?.();});
      input.addEventListener('blur',()=>{if(open){setOpen(false);query='';}});
      input.addEventListener('keydown',event=>{
        if(composing||event.isComposing||event.keyCode===229)return;
        const candidates=enabled();
        const step=direction=>{
          event.preventDefault();
          const from=byValue(select.value);
          if(!open){
            setOpen(true);
            const index=candidates.findIndex(option=>from&&option.value===from.value);
            const next=direction<0?(index<0?candidates[candidates.length-1]:candidates[index-1]||candidates[0]):(index<0?candidates[0]:candidates[index+1]||candidates[candidates.length-1]);
            setActive(next||null,{focusText:false});return;
          }
          const index=candidates.findIndex(option=>option.value===control.activeValue);
          const next=direction<0?(index<=0?candidates[0]:candidates[index-1]):(index<0?candidates[0]:candidates[index+1]||candidates[index]);
          setActive(next||null,{focusText:false});
        };
        if(event.key==='ArrowDown')return step(1);
        if(event.key==='ArrowUp')return step(-1);
        // Home/End stay native text-edit behavior while the popup is closed.
        if(event.key==='Home'){if(open){event.preventDefault();setActive(candidates[0]||null,{focusText:false});}return;}
        if(event.key==='End'){if(open){event.preventDefault();setActive(candidates[candidates.length-1]||null,{focusText:false});}return;}
        if(event.key==='Enter'){
          if(open&&control.activeValue!==null){
            event.preventDefault();
            const target=byValue(control.activeValue);
            if(target&&!target.disabled){commit(target.value);setOpen(false);}
          }
          return;
        }
        if(event.key==='Escape'){
          event.preventDefault();event.stopPropagation();
          query='';setOpen(false);
          input.focus();
        }
      });
      attach(root);
      control.rebuild();
    }

    const focusSnapshot=()=>{const active=document.activeElement;const chip=control.chips.find(node=>node===active);return chip?chip.dataset.value:control.input&&active===control.input?'__input__':null;};
    const restoreFocus=value=>{
      if(value===null)return;
      if(value==='__input__')value=select.value;
      if(control.mode==='chips'){const chip=control.chips.find(node=>node.dataset.value===value&&!node.disabled)||control.chips.find(node=>!node.disabled);chip?.focus();}
      else control.input?.focus();
    };

    control.options=readOptions(select);
    if(control.options.length<=6)buildChips();else buildCombobox();
    const sync=()=>{
      const focused=focusSnapshot();
      const next=readOptions(select);
      const threshold=next.length<=6;
      const remount=threshold!==(control.mode==='chips');
      control.options=next;
      if(remount){
        open=false;query='';composing=false;compositionBase=null;control.activeValue=null;
        control.setOpen=null;control.reconcileActive=null;
        control.root?.remove();
        select.hidden=false;
        if(threshold)buildChips();else buildCombobox();
        restoreFocus(focused);
      }else{
        control.rebuild();
        if(focused!==null&&focusSnapshot()===null)restoreFocus(focused);
        control.reconcileActive?.();
      }
      if(control.mode==='combobox')control.input.disabled=select.disabled;
    };
    control.updateLabels=({label}={})=>{
      // GET-192 label-only refresh: the owner updates its native options first,
      // then this refreshes owned root/input/listbox names and keyed option
      // labels. No change event, callback, remount or preference write; input
      // display writes that would disrupt IME composition are deferred.
      if(typeof label==='string'&&label){
        labelText=label;
        control.root?.setAttribute('aria-label',label);
        control.input?.setAttribute('aria-label',label);
        control.listbox?.setAttribute('aria-label',label);
      }
      const next=readOptions(select);
      if(next.length!==control.options.length||next.some((row,index)=>row.value!==control.options[index].value))return false;
      // Label updates cannot detach a focused chip or reset combobox search,
      // visible rows, selection, scroll or active descendant. Structure/value
      // changes still require the separate explicit business sync() path.
      for(let index=0;index<next.length;index++){
        const option=control.options[index];option.label=next[index].label;
        if(option.node)option.node.textContent=option.label;
      }
      control.updateClosedLabel?.();
      return true;
    };
    control.sync=sync;
    control.destroy=()=>{
      control.root?.remove();
      select.hidden=false;
    };
    sync();
    if(hadNativeFocus)restoreFocus(select.value);
    return control;
  }catch(error){
    control.root?.remove();
    select.hidden=false;
    select.classList?.remove('choice-native');
    if(hadNativeFocus)select.focus?.();
    return null;
  }
}
