import {composeBetaFeedback} from './beta-channel.mjs';

const form=document.getElementById('beta-feedback-form');
if(form){
 form.hidden=false;
 const status=document.getElementById('beta-feedback-status'),draft=document.getElementById('beta-feedback-draft'),preview=document.getElementById('beta-email-preview'),open=document.getElementById('beta-email-open');
 form.addEventListener('submit',event=>{
  event.preventDefault();if(!form.reportValidity())return;
  const values=new FormData(form);
  if(!String(values.get('description')||'').trim()){form.elements.description.setCustomValidity(document.getElementById('beta-description').placeholder);form.elements.description.reportValidity();return;}
  const feedback=composeBetaFeedback({locale:document.documentElement.lang,platform:values.get('platform'),version:values.get('version'),description:values.get('description')});
  preview.value=feedback.text;open.href=feedback.mailto;draft.hidden=false;status.textContent=form.dataset.draft;open.focus();
 });
 form.addEventListener('input',()=>{form.elements.description.setCustomValidity('');draft.hidden=true;status.textContent='';});
 document.getElementById('beta-feedback-copy').addEventListener('click',async()=>{
  try{await navigator.clipboard.writeText(preview.value);status.textContent=form.dataset.copied;}
  catch{preview.focus();preview.select();status.textContent=form.dataset.manual;}
 });
}
