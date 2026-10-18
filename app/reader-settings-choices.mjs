import {mountChoiceControl} from './choice-control.mjs';

// Only the nine Aa drawer selects use this on-demand enhancement. Native
// options/value/change stay authoritative; every later write calls sync().
const ids=['reading-purpose','preferred-language','view-mode','page-layout','translation-variant','parallelLayout','parallelStyle','parallelColor','parallelBackground'];
export function mountReaderSettingsChoices({document}){
  const choices={};
  for(const id of ids){
    const select=document.getElementById(id),control=select?mountChoiceControl({document,select}):null;
    if(control)choices[id]=control;
  }
  return {choices,sync(){for(const control of Object.values(choices))control.sync();}};
}
