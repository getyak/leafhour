// GET-173 shared popover capability boundary. Stock Chrome 113 (the Android
// API 34 acceptance machine) predates the Popover API: `popover="auto"` markup
// paints over the shelf instead of hiding, `:popover-open` selectors throw and
// showPopover/hidePopover do not exist. One app-owned controller keeps every
// popover in one truthful open/closed state in both branches. Supporting
// browsers keep the real popover top layer, declarative popovertarget triggers,
// beforetoggle/toggle consumers, light dismissal and focus behaviour;
// unsupported browsers fall back to the native hidden attribute plus one
// explicit open marker and a safe z-index, with Escape and outside
// pointer/focus dismissal that never moves focus away from an intentional
// outside target. The registry makes one instance the sole owner of each
// element; every consumer subscribes to that instance, so open/close callbacks
// run exactly once in either branch and no competing lifecycle mounts exist.

const OPEN='data-popover-open';
const instances=new WeakMap(),wired=new WeakSet(),dismissed=new WeakSet(),stacks=new WeakMap();

// The owned marker is the one safe open query for every production caller. It
// is kept truthful by native beforetoggle/toggle and by the fallback toggles
// below, so no ':popover-open' selector is ever evaluated from script.
export const overlayOpen=(document,dialog='dialog[open]')=>!!document.querySelector(dialog+',[popover]['+OPEN+']');

// A different modal or owned popover is showing; `except` excludes the one
// popover a caller owns itself. Safe owned marker only.
export const otherOverlayOpen=(document,except=null)=>!!document.querySelector('dialog[open]')||[...document.querySelectorAll('[popover]['+OPEN+']')].some(node=>node!==except);

// A trigger that may take return focus or gate a mount: connected, visible and
// non-inert, never focused blindly. Real computed visibility is read through
// the owning document's view (hidden/collapse reject), while fixtures without a
// computed-style API stay truthful unknowns.
const styleVisible=node=>{
  const view=node?.ownerDocument?.defaultView;
  if(!view||typeof view.getComputedStyle!=='function')return true;
  try{const visibility=view.getComputedStyle(node)?.visibility;return visibility!=='hidden'&&visibility!=='collapse';}catch{return true;}
};
export const focusableTrigger=trigger=>!!trigger&&typeof trigger.focus==='function'&&trigger.isConnected!==false&&!trigger.hidden&&!trigger.closest?.('[inert]')&&trigger.getClientRects?.().length!==0&&styleVisible(trigger);

export function mountPopover({document,element,trigger=null,beforeOpen=null,onChange=null}={}){
  const owned=instances.get(element);
  if(owned){
    if(trigger)owned.setTrigger(trigger);
    owned.subscribe({beforeOpen,onChange});
    return owned;
  }
  const native=typeof element.showPopover==='function',stack=stacks.get(document)||stacks.set(document,[]).get(document);
  const before=[],change=[];
  const sync=open=>{
    if(element.hasAttribute(OPEN)===open)return;
    element.toggleAttribute(OPEN,open);
    const at=stack.indexOf(instance);
    if(open){if(at<0)stack.push(instance);}else if(at>=0)stack.splice(at,1);
    if(instance.trigger)instance.trigger.setAttribute('aria-expanded',''+open);
    for(const fn of [...change])fn(open);
  };
  // Focus returns to a connected, visible, non-inert trigger only while focus
  // is still inside the closing popover (or nowhere); an intentional outside
  // target and any other modal keep their focus.
  const restore=()=>{
    const active=document.activeElement,target=instance.trigger;
    if(active&&active!==document.body&&!element.contains(active)||!focusableTrigger(target))return;
    target.focus({preventScroll:true});
  };
  const instance={
    element,trigger,
    isOpen:()=>element.hasAttribute(OPEN),
    setTrigger(next){const previous=instance.trigger;instance.trigger=next||null;if(previous&&previous!==instance.trigger)previous.setAttribute('aria-expanded','false');},
    // One real subscription API: both callback kinds survive later owners, run
    // at most once per transition, and detach for good. A subscriber added
    // while the popover already shows receives that state as one transition.
    subscribe({beforeOpen=null,onChange=null}={}){
      const detach=[];
      if(typeof beforeOpen==='function'&&!before.includes(beforeOpen)){before.push(beforeOpen);detach.push([before,beforeOpen]);}
      if(typeof onChange==='function'&&!change.includes(onChange)){
        change.push(onChange);detach.push([change,onChange]);
        if(element.hasAttribute(OPEN))onChange(true);
      }
      return ()=>{for(const [list,fn]of detach){const at=list.indexOf(fn);if(at>=0)list.splice(at,1);}};
    },
    open(){
      if(instance.isOpen())return;
      if(native){element.showPopover();sync(true);return;}
      for(const other of [...stack])if(other!==instance)other.close({focus:false});
      for(const fn of [...before])fn();
      element.removeAttribute('hidden');
      sync(true);
      // Keyboard and pointer opens alike reach a usable first control, the
      // same first control the native popover focusing steps would take.
      (element.querySelector('button:not(:disabled),a[href],input,select,textarea,[tabindex]')||element).focus({preventScroll:true});
    },
    close({focus=true}={}){
      if(!instance.isOpen())return;
      if(native)element.hidePopover();else element.setAttribute('hidden','');
      sync(false);
      if(focus)restore();
    }
  };
  instances.set(element,instance);
  // The registry owns the element's real state: mounting while it is already
  // open must keep Escape, dismissal and callbacks truthful.
  if(element.hasAttribute(OPEN))stack.push(instance);
  if(native){
    element.addEventListener('beforetoggle',event=>{const open=event.newState==='open';if(open)for(const fn of [...before])fn();sync(open);});
    element.addEventListener('toggle',event=>sync(event.newState==='open'));
  }
  if(trigger){
    instance.setTrigger(trigger);
    // Fallback browsers ignore popovertarget; the owner wires the same toggle.
    if(!native)trigger.addEventListener('click',()=>{if(instance.isOpen())instance.close();else instance.open();});
  }
  if(!wired.has(document)){
    wired.add(document);
    document.addEventListener('keydown',event=>{
      if(event.key!=='Escape'||!stack.length)return;
      event.preventDefault();
      stack[stack.length-1].close();
    });
  }
  if(!native&&!dismissed.has(document)){
    dismissed.add(document);
    const away=event=>{
      for(const instance of [...stack]){
        const {element,trigger}=instance;
        if(element.contains(event.target)||trigger&&trigger.contains(event.target))continue;
        instance.close({focus:false});
      }
    };
    document.addEventListener('pointerdown',away,true);
    document.addEventListener('focusin',away);
  }
  instance.subscribe({beforeOpen,onChange});
  return instance;
}
