import {mountChoiceControl} from './choice-control.mjs';
import {t,onUiLocaleChange} from './ui-locale.mjs';

// The existing Aa drawer selects, including Interface language, use this on-demand enhancement. Native
// options/value/change stay authoritative; every later write calls sync().
const ids=['reading-purpose','preferred-language','view-mode','page-layout','translation-variant','parallelLayout','parallelStyle','parallelColor','parallelBackground','reader-ui-choice'];
export function mountReaderSettingsChoices({document,choices={}}){
  const deferred=[];let disposed=false;
  const nativeLabels=select=>{
    for(const option of select.options){const id=option.getAttribute?.('data-ui');if(id)option.textContent=t(id);}
    const id=select.getAttribute?.('data-ui-aria-label');
    return id?t(id):undefined;
  };
  for(const id of ids){
    const select=document.getElementById(id);if(!select)continue;
    const enhance=()=>{if(disposed||choices[id])return;const control=mountChoiceControl({document,select,label:nativeLabels(select)});if(control)choices[id]=control;};
    // Async module arrival must not hide an open native language popup.
    // Only a real blur resumes this already-requested enhancement; locale
    // publication never loads or mounts a choice.
    if(id==='reader-ui-choice'&&document.activeElement===select){
      const onBlur=()=>queueMicrotask(()=>{if(!disposed&&document.activeElement!==select){enhance();select.removeEventListener('blur',onBlur);}});
      select.addEventListener('blur',onBlur);deferred.push(()=>select.removeEventListener('blur',onBlur));
    }else enhance();
  }
  const offLocale=onUiLocaleChange(()=>{
    for(const control of Object.values(choices))control.updateLabels({label:nativeLabels(control.select)});
  });
  return {choices,sync(){for(const control of Object.values(choices))control.sync();},unmount(){disposed=true;offLocale();for(const off of deferred)off();for(const control of Object.values(choices))control.destroy?.();}};
}
