// GET-201 settings appearance panel: real small reading-page previews rendered
// from the live theme palette, a quiet selected card with its own check badge
// and focus ring, and one labelled interface-language group. The theme radios
// stay the native value owners and fire exactly one real change event; the
// language group is the shared GET-198 locale control, unchanged. Labels and
// runtime callbacks are injected by the library shell, so this module stays out
// of the ui-locale owner graph and never reads sessions, storage or business
// data.
import {settingGroup} from './settings-controls.mjs';
import {mountUiLocaleControls} from './ui-locale-controls.mjs';

const make=(document,className,text)=>{const node=document.createElement('div');node.className=className;if(text!==undefined)node.textContent=text;return node;};

// One small page: heading, two text lines and an annotation mark. The heading
// carries the truthful theme name; the lines and the mark are decorative
// layout (aria-hidden), never invented book text.
function previewPage(document,{tone,name,heading=true,collect=null}){
  const page=make(document,'preview-page');
  page.dataset.tone=tone;
  if(heading){const head=make(document,'preview-heading',name);if(collect)collect.push(head);page.append(head);}
  const first=make(document,'preview-line'),second=make(document,'preview-line preview-line-short'),mark=make(document,'preview-mark');
  page.append(first,second,mark);
  return page;
}

function themePreview(document,{tone,name,split=false,collect=null}){
  const root=make(document,'theme-preview');
  root.dataset.tone=tone;
  root.setAttribute('aria-hidden','true');
  if(split){
    // One preview, two tones: the halves stay decorative so the split never
    // repeats a truncated heading.
    const left=previewPage(document,{tone:'paper',name,heading:false}),right=previewPage(document,{tone:'night',name,heading:false});
    left.classList.add('preview-half');right.classList.add('preview-half');
    root.append(left,right);
  }else root.append(previewPage(document,{tone,name,collect}));
  return root;
}

export function mountSettingsAppearance({document,root,t,getAppearance,setAppearance,locale}){
  const group=settingGroup({document,title:t('shell.appearance.title'),description:t('shell.appearance.description')});
  const cards=make(document,'appearance-cards');
  const entries=[];
  for(const value of ['system','paper','night']){
    const name=t('shell.appearance.'+value),detail=t('shell.appearance.'+value+'Detail');
    const card=document.createElement('label');card.className='appearance-card';card.dataset.theme=value;
    const input=document.createElement('input');input.type='radio';input.name='site-appearance';input.value=value;input.id='settings-appearance-'+value;
    const headings=[];
    const preview=themePreview(document,{tone:value,name,split:value==='system',collect:headings});
    const check=make(document,'appearance-check');check.setAttribute('aria-hidden','true');
    const title=document.createElement('span');title.className='appearance-name';title.textContent=name;
    const copy=document.createElement('small');copy.className='appearance-detail';copy.textContent=detail;
    input.addEventListener('change',()=>{if(input.checked)setAppearance(input.value);});
    card.append(input,preview,check,title,copy);
    cards.append(card);entries.push({input,name:title,detail:copy,headings});
  }
  group.body.append(cards);
  // Interface language: one labelled group, each choice written in its own
  // language. The shared control keeps its own notices and retry affordances.
  const language=settingGroup({document,title:t('shell.settings.language.title'),description:t('ui.language.systemDescription')});
  const localeRoot=make(document,'settings-locale');
  language.body.append(localeRoot);
  const localeControls=locale&&typeof locale.getState==='function'?mountUiLocaleControls({
    root:localeRoot,options:locale.options,getState:locale.getState,setLocale:locale.setLocale,retry:locale.retry,subscribeState:locale.subscribeState,labels:locale.labels
  }):null;
  root.append(group.root,language.root);
  const inputs=entries.map(entry=>entry.input);
  const sync=()=>{for(const entry of entries){entry.input.checked=entry.input.value===getAppearance();const card=entry.input.parentElement;if(card)card.dataset.checked=String(entry.input.checked);}};
  const updateLabels=()=>{
    group.setTitle(t('shell.appearance.title'));group.setDescription(t('shell.appearance.description'));
    language.setTitle(t('shell.settings.language.title'));
    language.setDescription(t('ui.language.systemDescription'));
    for(const entry of entries){
      const label=t('shell.appearance.'+entry.input.value);
      entry.name.textContent=label;
      entry.detail.textContent=t('shell.appearance.'+entry.input.value+'Detail');
      for(const heading of entry.headings)heading.textContent=label;
    }
    localeControls?.render();
    sync();
  };
  sync();
  return {root,inputs,localeControls,sync,updateLabels,dispose(){localeControls?.unmount?.();}};
}
