import {t,onUiLocaleChange} from './ui-locale.mjs';

// Optional presentation loads with the external enhancement, after the reader.
// A failed stylesheet keeps the original controls in their existing locations.
const styleLoads=new WeakMap();
export function loadReadingHubStyles(document){
 if(styleLoads.has(document))return styleLoads.get(document);
 const head=document.head||document.querySelector('head');
 if(!head)return Promise.resolve(false);
 const link=document.createElement('link');link.rel='stylesheet';link.href='/reading-hub.css';link.setAttribute('data-reading-hub-style','');
 const pending=new Promise(resolve=>{
  const finish=ready=>{link.removeEventListener('load',loaded);link.removeEventListener('error',failed);if(!ready){link.remove();styleLoads.delete(document);}resolve(ready);};
  const loaded=()=>finish(true),failed=()=>finish(false);
  link.addEventListener('load',loaded);link.addEventListener('error',failed);head.append(link);
 });
 styleLoads.set(document,pending);return pending;
}

// A layout adapter over existing live controls. Their reader/audio/account
// owners keep the event handlers, identifiers and data; no mirrored actions.
export function mountReadingHub({document,panel,toolbar,onHandoff=()=>toolbar?.conceal({restoreFocus:false})}={}){
 if(!document?.createElement||!panel?.append)return {updateLabels(){},unmount(){}};
 const $=id=>document.getElementById(id),make=(tag,cls)=>{const node=document.createElement(tag);node.className=cls;return node;},moved=[],labels=[],removers=[];
 let disposed=false;
 const focusedAtMount=document.activeElement;
 const primary=make('div','reading-hub-primary');primary.id='reading-hub-primary';
 const more=make('details','reading-hub-more');more.id='reading-hub-more';
 const summary=make('summary','reading-hub-more-title');labels.push([summary,'reader.hub.more']);
 const secondary=make('div','reading-hub-secondary');more.append(summary,secondary);
 const visible=node=>!!node&&node.isConnected!==false&&!node.disabled&&!node.closest?.('[hidden],[inert],dialog:not([open])')&&(!node.getClientRects||node.getClientRects().length>0);
 function restoreFocus(target,{reveal=false}={}){
  if(!target||target===document.body)return;
  if(more.contains(target))more.open=true;
  if(reveal&&panel.contains(target)&&panel.inert)toolbar?.reveal(false);
  const destination=visible(target)?target:visible($('reading-tools-trigger'))?$('reading-tools-trigger'):null;
  if(destination&&document.activeElement!==destination)destination.focus({preventScroll:true});
 }
 const move=(node,parent)=>{if(!node?.parentElement)return;const previous=node.parentElement,next=node.nextSibling;moved.push(()=>{if(next?.parentElement===previous)previous.insertBefore(node,next);else previous.append(node);});parent.append(node);};
 const addLabel=(node,key)=>{const label=make('span','reading-hub-label');label.dataset.readingHubLabel='';labels.push([label,key]);node.append(label);removers.push(()=>label.remove());};
 const listen=(node,event,fn)=>{node?.addEventListener(event,fn);removers.push(()=>node?.removeEventListener(event,fn));};
 listen($('reading-tools-trigger'),'click',event=>{if(event.detail!==1)queueMicrotask(()=>{if(!disposed&&$('reading-session')?.dataset.expanded==='true')primary.querySelector('button:not([disabled]):not([hidden])')?.focus({preventScroll:true});});});
 const contents=$('open-toc'),settings=$('open-settings'),notes=$('show-all-records');
 move(contents,primary);move(settings,primary);move(notes,primary);move($('listen-chapter')?.parentElement,primary);
 if(settings)addLabel(settings,'reader.hub.appearance');
 if(notes){
  addLabel(notes,'reader.hub.notes');
  listen(notes,'click',()=>queueMicrotask(()=>{if(disposed)return;onHandoff();if(!$('note-panel')?.hidden)$('close-panel')?.focus({preventScroll:true});}));
 }
 const atmosphere=$('open-atmosphere')?.parentElement;
 move(atmosphere,secondary);move($('enter-focus'),secondary);move($('open-reader-account'),secondary);move(document.querySelector('#reading-header .palette-entry'),secondary);
 for(const id of ['reading-timer-settings','manual-reading-open','reading-guide-open'])move($(id),more);
 const heading=panel.querySelector('.reading-tools-heading'),sync=panel.querySelector('.reading-sync-row');
 if(heading?.nextSibling)panel.insertBefore(primary,heading.nextSibling);else panel.prepend(primary);
 move($('reading-tools-chat-slot'),panel);
 // Append in reading order. Moving the session controls retains their clock.
 for(const id of ['reading-controls','page-turner','reading-login','reading-drafts-open'])move($(id),panel);
 panel.append(more);if(sync)panel.append(sync);
 // The source section has no record entry now; hide its otherwise orphan title.
 const recordSection=[...document.querySelectorAll('#settings-dialog .settings-section')].find(section=>section.querySelector('[data-ui="reader.shell.myRecords"]'));
 const sectionHidden=recordSection?.hidden;if(recordSection)recordSection.hidden=true;
 function updateLabels(){if(disposed)return;for(const [node,key]of labels)node.textContent=t(key);primary.setAttribute('aria-label',t('reader.hub.primary'));}
 const adoptAnnotations=()=>{const controls=panel.querySelector('.reader-annotation-controls');if(controls&&controls.parentElement!==more){const focused=document.activeElement;move(controls,more);restoreFocus(focused,{reveal:true});}};
 const Observer=document.defaultView?.MutationObserver,observer=Observer?new Observer(adoptAnnotations):null;observer?.observe(panel,{childList:true});adoptAnnotations();
 const offLocale=onUiLocaleChange(updateLabels);updateLabels();restoreFocus(focusedAtMount,{reveal:true});
 return {updateLabels,unmount(){if(disposed)return;const focused=document.activeElement;disposed=true;offLocale();observer?.disconnect();for(const remove of removers)remove();for(const restore of moved.reverse())restore();if(recordSection)recordSection.hidden=sectionHidden;primary.remove();more.remove();restoreFocus(focused);}};
}
