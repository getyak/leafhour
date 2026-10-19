import {t,getUiLocale,onUiLocaleChange,uiReady,bindUi,uiHref} from './ui-locale.mjs';
import {uiAuthoredPath} from './ui-locale-codec.mjs';

export function mountExperienceMetrics({document:doc=globalThis.document,request=globalThis.fetch}={}){
 const $=id=>doc.getElementById(id),labels=new Map();let disposed=false;
 const paintOwned=(n,paint)=>{n.textContent=paint();n.setAttribute('lang',getUiLocale());};
 const own=(n,paint)=>{labels.set(n,paint);paintOwned(n,paint);return n;};
 const el=(tag,cls='')=>{const n=doc.createElement(tag);if(cls)n.className=cls;return n;};
 const fixed=(tag,id,params)=>own(el(tag),()=>t(id,params));
 const percent=value=>value===null||value===undefined?t('evals.noRecords'):(value*100).toFixed(1)+'%';
 const row=(target,titleId,value,detail)=>{const n=el('div','metric-row'),copy=el('div');copy.append(fixed('span',titleId),own(el('p'),detail));n.append(copy,own(el('div','metric-value'),value));$(target).append(n);};
 const unbind=bindUi(doc.documentElement);$('status').removeAttribute('data-ui');
 function updateLabels(){if(disposed)return;for(const [n,paint]of labels)paintOwned(n,paint);$('evals-home').href=uiAuthoredPath('/',getUiLocale());$('evals-chat').href=uiHref('/read?study=chat');doc.title=t('evals.pageTitle');}
 const off=onUiLocaleChange(updateLabels);void uiReady.then(updateLabels);
 const status=(id,params)=>own($('status'),()=>t(id,params));status('evals.loading');
 const ready=(async()=>{try{
  const response=await request('/api/experience-metrics');if(disposed)return;if(!response.ok)throw Error();const m=await response.json();if(disposed)return;
  const sessions=m.uniqueSessions,insufficient=m.sampleState==='insufficient';own($('status'),()=>t('evals.sessions',{count:sessions,state:t(insufficient?'evals.sample.insufficient':'evals.sample.observation')}));
  const coverage={...m.fragmentCoverage},latency={...m.latency.xray},quiet=m.constraints.quiet.rate;
  row('technical','evals.coverage.title',()=>percent(coverage.rate),()=>t('evals.coverage.detail',{numerator:coverage.numerator,denominator:coverage.denominator}));
  row('technical','evals.latency.title',()=>latency.p95Ms===null?t('evals.waitClicks'):latency.p95Ms.toFixed(0)+' ms',()=>t('evals.latency.detail',{count:latency.samples}));
  row('technical','evals.quiet.title',()=>percent(quiet),()=>t('evals.quiet.detail'));
  for(const key of ['xrayContinue','stanceChoice','stanceSource','share','observationCopy','echoReread','immediateExit']){
   const r={...m.behavior[key]},state=r.sampleState==='insufficient'?'insufficient':r.targetReached===null?'proxy':r.targetReached?'reached':'notReached';
   row('behavior','evals.'+key+'.title',()=>percent(r.rate),()=>t('evals.ratio',{numerator:r.numerator,denominator:r.denominator})+t('evals.result.'+state)+' '+t('evals.'+key+'.detail'));
  }
  for(const id of ['echo','rates','privacy'])$('definitions').append(fixed('p','evals.definition.'+id));
  const control={...m.chatControl};$('definitions').append(own(el('p'),()=>t('evals.definition.chat',{result:control.available===false?t('evals.noControl'):percent(control.rate)+t('evals.controlWindow')})));
  updateLabels();
 }catch{if(!disposed)status('evals.failed');}})();
 return {ready,updateLabels,dispose(){if(disposed)return;disposed=true;off();unbind();labels.clear();}};
}
if(globalThis.document?.getElementById('technical')){
 await uiReady;const metrics=mountExperienceMetrics();window.addEventListener('pagehide',event=>{if(!event.persisted)metrics.dispose();});
}
