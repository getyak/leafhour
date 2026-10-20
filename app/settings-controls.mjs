// GET-201 settings-scoped control primitives. One module owns the grouped
// label/control row, the native-backed switch, the selectable backup dropzone,
// the heavy-action confirmation and the 24-hour time choices used by the
// library settings dialog. Presentation lives in library-shell.css.
//
// Safety contract shared by every primitive here:
//  - the native backing node (checkbox / file / time input / select) keeps its
//    id, value and single real change event; nothing dispatches a second one;
//  - file selection and drop only stage a file, they never start a restore or
//    any other business action;
//  - heavy actions run only after an explicit confirmation that names the
//    consequence; Escape and Cancel never run them;
//  - labels are passed in by the calling owner module, so this file stays out
//    of the ui-locale owner graph and never reads sessions, books or storage.

const make=(document,tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const setText=(node,text)=>{node.textContent=text;};
let confirmInstances=0;

// One settings group: short title, at most one plain description line and a
// stack of rows separated by hairlines (CSS).
export function settingGroup({document,title='',description='',tag='h3'}={}){
  const root=make(document,'section','settings-group');
  const heading=make(document,tag,'settings-group-title',title);
  const copy=make(document,'p','settings-group-description',description);
  if(!description)copy.hidden=true;
  const body=make(document,'div','settings-group-rows');
  root.append(heading,copy,body);
  return {
    root,body,title:heading,description:copy,
    setTitle(text){setText(heading,text);},
    setDescription(text){setText(copy,text);copy.hidden=!text;}
  };
}

// One grouped row: readable label (optionally associated with the backing
// control) plus a short description on the left, the control on the right.
export function settingRow({document,label='',description='',control=null,labelFor=null}={}){
  const root=make(document,'div','settings-row');
  const copy=make(document,'div','settings-row-copy');
  const labelNode=make(document,'label','settings-row-label',label);
  if(labelFor)labelNode.setAttribute('for',labelFor);
  const descriptionNode=make(document,'p','settings-row-description',description);
  if(!description)descriptionNode.hidden=true;
  const controlNode=make(document,'div','settings-row-control');
  if(control)controlNode.append(control);
  copy.append(labelNode,descriptionNode);
  root.append(copy,controlNode);
  return {
    root,label:labelNode,description:descriptionNode,control:control||controlNode,controlNode,
    setLabel(text){setText(labelNode,text);},
    setDescription(text){setText(descriptionNode,text);descriptionNode.hidden=!text;},
    setControl(next){controlNode.replaceChildren();if(next)controlNode.append(next);}
  };
}

// A boolean setting. The native checkbox stays the value owner inside a label,
// so clicking the row, the track or the text toggles it exactly once and every
// existing change listener keeps working. The custom track/thumb are pure
// presentation (CSS).
export function switchRow({document,input,label='',description=''}={}){
  const root=make(document,'label','settings-switch');
  const copy=make(document,'span','settings-switch-copy');
  const labelNode=make(document,'span','settings-switch-label',label);
  const descriptionNode=make(document,'span','settings-switch-description',description);
  if(!description)descriptionNode.hidden=true;
  const track=make(document,'span','settings-switch-track');
  track.setAttribute('aria-hidden','true');
  copy.append(labelNode,descriptionNode);
  root.append(copy,input,track);
  const sync=()=>{root.dataset.checked=String(!!input.checked);};
  input.addEventListener('change',sync);
  sync();
  return {
    root,input,label:labelNode,description:descriptionNode,
    setLabel(text){setText(labelNode,text);},
    setDescription(text){setText(descriptionNode,text);descriptionNode.hidden=!text;},
    setDisabled(value){input.disabled=!!value;},
    sync
  };
}

const formatBytes=size=>{
  if(!Number.isFinite(size)||size<0)return '';
  if(size<1024)return size+' B';
  if(size<1024*1024)return (size/1024).toFixed(1)+' KiB';
  return (size/1024/1024).toFixed(1)+' MiB';
};

// The backup dropzone. Choosing a file and dropping one are the same single
// change event on the native input; this primitive only stages and describes
// the file. A disabled input refuses drops outright and a change is emitted
// only after the native input actually adopted the new files. States:
// empty | selected | checking | valid | invalid.
export function mountDropzone({document,input,title='',action='',hint=''}={}){
  const root=make(document,'div','settings-dropzone');
  root.dataset.state='empty';root.dataset.dragover='false';
  const titleNode=make(document,'p','settings-dropzone-title',title);
  const actionNode=make(document,'label','settings-dropzone-action',action);
  if(input.id)actionNode.setAttribute('for',input.id);
  const hintNode=make(document,'p','settings-dropzone-hint',hint);
  if(!hint)hintNode.hidden=true;
  const state=make(document,'p','settings-dropzone-state');
  state.dataset.state='empty';
  input.classList.add('settings-dropzone-input');
  root.append(titleNode,actionNode,hintNode,state,input);
  const setState=({state:next='selected',name=null,size=null,message=''}={})=>{
    root.dataset.state=next;state.dataset.state=next;
    const parts=[];
    if(name)parts.push(name);
    const formatted=formatBytes(size);
    if(formatted)parts.push(formatted);
    if(message)parts.push(message);
    state.textContent=parts.join(' · ');
    return state;
  };
  const describeSelection=()=>{
    const file=input.files&&input.files[0];
    if(!file){setState({state:'empty'});return;}
    setState({state:'selected',name:file.name,size:file.size});
  };
  const onDragOver=event=>{if(input.disabled)return;event.preventDefault?.();root.dataset.dragover='true';};
  const onDragLeave=()=>{root.dataset.dragover='false';};
  const onDrop=event=>{
    root.dataset.dragover='false';
    if(input.disabled)return; // a locked file field refuses the drop entirely
    event.preventDefault?.();
    const files=event.dataTransfer&&event.dataTransfer.files;
    if(!files||!files.length)return;
    // The change event announces a NEW selection, so it may only follow a real
    // adoption; a rejecting setter keeps the old file and stays silent.
    let adopted=false;
    try{input.files=files;adopted=!!(input.files&&input.files.length&&input.files[0]===files[0]);}catch{adopted=false;}
    if(!adopted){describeSelection();return;}
    describeSelection();
    input.dispatchEvent(new Event('change',{bubbles:true}));
  };
  input.addEventListener('change',describeSelection);
  root.addEventListener('dragover',onDragOver);
  root.addEventListener('dragleave',onDragLeave);
  root.addEventListener('drop',onDrop);
  return {
    root,input,state,setState,describeSelection,
    labels:{title:titleNode,action:actionNode,hint:hintNode},
    // Label-only locale refresh: no input, File or state is rebuilt.
    updateLabels({title:nextTitle=null,action:nextAction=null,hint:nextHint=null}={}){
      if(nextTitle!==null)titleNode.textContent=nextTitle;
      if(nextAction!==null)actionNode.textContent=nextAction;
      if(nextHint!==null){hintNode.textContent=nextHint;hintNode.hidden=!nextHint;}
    },
    destroy(){
      input.removeEventListener('change',describeSelection);
      root.removeEventListener('dragover',onDragOver);
      root.removeEventListener('dragleave',onDragLeave);
      root.removeEventListener('drop',onDrop);
    }
  };
}

// Accessible confirmation for heavy actions (restore, cancel a running
// operation, sign out). The dialog names the consequence, holds initial focus
// on the safe option, and runs the action only on the explicit confirm.
export function mountConfirm({document,labels={}}={}){
  const dialog=make(document,'dialog','settings-confirm');
  const title=make(document,'h3','settings-confirm-title');
  const consequence=make(document,'p','settings-confirm-consequence');
  // Every instance owns unique, stable identifiers so the dialog keeps a real
  // accessible name and consequence description.
  title.id='settings-confirm-title-'+(++confirmInstances);
  consequence.id='settings-confirm-consequence-'+confirmInstances;
  dialog.setAttribute('aria-labelledby',title.id);
  dialog.setAttribute('aria-describedby',consequence.id);
  const actions=make(document,'div','settings-confirm-actions');
  const cancelButton=make(document,'button','outline');cancelButton.type='button';
  const confirmButton=make(document,'button','primary');confirmButton.type='button';
  actions.append(cancelButton,confirmButton);
  dialog.append(title,consequence,actions);
  let opener=null,onConfirm=null,open=false;
  const settleFocus=()=>{
    if(!opener)return;
    const target=opener;
    opener=null;
    if(typeof target.focus==='function'&&target.isConnected!==false&&!target.hidden&&!target.closest?.('[inert],dialog:not([open])')&&target.getClientRects?.().length!==0)target.focus({preventScroll:true});
  };
  const close=({focus=true}={})=>{
    onConfirm=null;
    if(!open)return;
    open=false;
    if(typeof dialog.close==='function'&&dialog.open)dialog.close();
    else if(typeof dialog.removeAttribute==='function')dialog.removeAttribute('open');
    else dialog.open=false;
    if(focus)settleFocus();else opener=null;
  };
  cancelButton.addEventListener('click',()=>close());
  confirmButton.addEventListener('click',()=>{if(!open)return;const action=onConfirm;close();if(typeof action==='function')action();});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Escape'||!open)return;
    event.preventDefault?.();
    event.stopPropagation?.();
    close();
  });
  dialog.addEventListener('close',()=>{if(dialog.open)return;open=false;onConfirm=null;settleFocus();});
  return {
    dialog,title,consequence,cancelButton,confirmButton,
    // Label-only locale policy: an open confirmation keeps its state, focus and
    // pending action while only the visible strings are rewritten.
    updateLabels({title:heading=null,consequence:text=null,confirmLabel=null,cancelLabel=null}={}){
      if(heading!==null)setText(title,heading);
      if(text!==null)setText(consequence,text);
      if(confirmLabel!==null)setText(confirmButton,confirmLabel);
      if(cancelLabel!==null)setText(cancelButton,cancelLabel);
    },
    open({title:heading='',consequence:text='',confirmLabel=null,cancelLabel=null,opener:source=null,action=null,onConfirm:explicit=null}={}){
      if(open)close();
      setText(title,heading);setText(consequence,text);
      setText(confirmButton,confirmLabel||labels.confirm||'Confirm');
      setText(cancelButton,cancelLabel||labels.cancel||'Cancel');
      opener=source||null;onConfirm=action||explicit||null;open=true;
      if(typeof dialog.showModal==='function')dialog.showModal();
      else dialog.setAttribute('open','true');
      cancelButton.focus({preventScroll:true});
    },
    close,
    destroy(){close();}
  };
}

// Common times as quiet chips plus the native 24-hour editor. The input keeps
// the value; a chip is one user change (one input and one change event) and a
// re-pick of the active time changes nothing.
export function mountTimeChoices({document,input,times=[],customLabel='',onCustom=null}={}){
  const root=make(document,'div','settings-time-choices');
  const sync=()=>{
    for(const button of buttons){
      button.setAttribute('aria-pressed',String(button.dataset.time===input.value));
      button.disabled=!!input.disabled;
    }
    custom.setAttribute('aria-pressed',String(!!input.value&&!times.includes(input.value)));
    custom.disabled=!!input.disabled;
  };
  const pick=time=>{
    if(input.disabled||!time||input.value===time)return;
    input.value=time;
    input.dispatchEvent(new Event('input',{bubbles:true}));
    input.dispatchEvent(new Event('change',{bubbles:true}));
    sync();
  };
  const buttons=times.map(time=>{
    const button=make(document,'button','settings-time-chip',time);
    button.type='button';button.dataset.time=time;
    button.addEventListener('click',()=>pick(time));
    root.append(button);
    return button;
  });
  const custom=make(document,'button','settings-time-chip settings-time-custom',customLabel||'Custom');
  custom.type='button';
  custom.addEventListener('click',()=>{
    if(typeof onCustom==='function')onCustom();
    else if(typeof input.focus==='function')input.focus();
  });
  root.append(custom);
  input.addEventListener('change',sync);
  input.addEventListener('input',sync);
  sync();
  return {
    root,input,buttons,custom,sync,
    // Label-only locale refresh; the backing input and its value stay put.
    updateLabels({customLabel:next=null}={}){if(next!==null)custom.textContent=next;},
    destroy(){
      input.removeEventListener('change',sync);
      input.removeEventListener('input',sync);
    }
  };
}

const TIME_TEXT=/^([01]\d|2[0-3]):([0-5]\d)$/;
// The daily time editor: one 24-hour trigger opens a compact panel with the
// common times and a labelled HH:mm editor. The native time input keeps the
// value and the single real change event; the text editor only mirrors
// validated commits into it, so nothing reads or writes the plan until the
// explicit authorization action.
export function mountTimeEditor({document,input,editor,panel,times=[],customLabel='',label=''}={}){
  const root=make(document,'div','settings-time-editor');
  root.setAttribute('aria-label',label);
  const mirror=()=>{if(editor.value!==input.value)editor.value=input.value;editor.disabled=!!input.disabled;};
  const choices=mountTimeChoices({document,input,times,customLabel,onCustom:()=>{if(panel.hidden)panel.hidden=false;editor.focus?.();}});
  panel.hidden=true;
  panel.append(choices.root);
  root.append(editor,panel);
  const commit=()=>{
    const value=String(editor.value||'').trim();
    if(input.disabled)return false;
    if(!TIME_TEXT.test(value)){editor.setAttribute('aria-invalid','true');return false;}
    editor.removeAttribute?.('aria-invalid');
    if(value!==input.value){
      input.value=value;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.dispatchEvent(new Event('change',{bubbles:true}));
    }
    mirror();
    return true;
  };
  const onEditorChange=()=>{if(!commit())editor.setAttribute('aria-invalid','true');else editor.removeAttribute?.('aria-invalid');};
  const onEditorKey=event=>{if(event.key!=='Enter')return;event.preventDefault?.();event.stopPropagation?.();if(!event.isComposing&&event.keyCode!==229)onEditorChange();};
  editor.addEventListener('change',onEditorChange);
  editor.addEventListener('keydown',onEditorKey);
  editor.setAttribute('aria-label',label);
  input.addEventListener('change',mirror);
  input.addEventListener('input',mirror);
  mirror();choices.sync();
  return {
    root,panel,input,editor,choices,commit,
    open(){panel.hidden=false;mirror();choices.sync();},
    close(){panel.hidden=true;},
    sync(){mirror();choices.sync();},
    updateLabels({customLabel:nextCustom=null,label:nextLabel=null}={}){
      if(nextLabel!==null){root.setAttribute('aria-label',nextLabel);editor.setAttribute('aria-label',nextLabel);}
      choices.updateLabels({customLabel:nextCustom});
    },
    destroy(){
      editor.removeEventListener('change',onEditorChange);
      editor.removeEventListener('keydown',onEditorKey);
      input.removeEventListener('change',mirror);
      input.removeEventListener('input',mirror);
      choices.destroy();
    }
  };
}
