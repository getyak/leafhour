import {settingGroup,switchRow} from './settings-controls.mjs';

export function mountObservabilitySettings({document=globalThis.document,root,client,getOwner,t,timers=globalThis}={}){
  let owner=Symbol('unmounted'),generation=0,disposed=false,busy=false,clearStatus=null,statusId=null;
  const group=settingGroup({document}),controls={},rows={};
  group.root.dataset.observabilitySettings='true';
  for(const key of ['analytics','diagnostics']){
    const input=document.createElement('input');input.type='checkbox';input.id='observability-'+key;controls[key]=input;
    const row=switchRow({document,input});rows[key]=row;group.body.append(row.root);
    input.addEventListener('change',()=>{void save();});
  }
  const status=document.createElement('p');status.className='settings-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');group.body.append(status);root.append(group.root);
  function message(id){statusId=id;status.textContent=id?t(id):'';}
  function paint(config=client.config(),{keepDraft=false}={}){
    const signedIn=!!getOwner();for(const key of ['analytics','diagnostics']){if(!keepDraft)controls[key].checked=signedIn&&config[key]===true;rows[key].setDisabled(!signedIn||!client.loaded||!config.enabled||busy);rows[key].sync();}
  }
  async function save(){
    if(disposed||busy||!getOwner()||!client.config().enabled)return;
    const token=generation,captured=getOwner();busy=true;message(null);paint(undefined,{keepDraft:true});
    try{await client.setConsent({analytics:controls.analytics.checked,diagnostics:controls.diagnostics.checked});if(disposed||token!==generation||captured!==getOwner())return;message('observability.saved');clearStatus=timers.setTimeout(()=>message(null),2000);clearStatus?.unref?.();}
    catch{if(!disposed&&token===generation&&captured===getOwner())message('observability.saveFailed');}
    finally{if(!disposed&&token===generation&&captured===getOwner()){busy=false;paint();}}
  }
  const unsubscribe=client.subscribe(config=>{if(disposed)return;paint(config,{keepDraft:busy});});
  async function update(){
    if(disposed)return;const next=getOwner()||null;
    if(next===owner){paint(undefined,{keepDraft:busy});return;}
    owner=next;generation++;busy=false;if(clearStatus!==null)timers.clearTimeout(clearStatus);clearStatus=null;message(null);client.syncOwner();paint();
    const token=generation;await client.refresh();if(disposed||token!==generation||owner!==(getOwner()||null))return;paint();
  }
  function updateLabels(){group.setTitle(t('observability.title'));group.setDescription(t('observability.description'));for(const key of ['analytics','diagnostics']){rows[key].setLabel(t('observability.'+key));rows[key].setDescription(t('observability.'+key+'.description'));}if(statusId)message(statusId);}
  updateLabels();
  return {controls,update,updateLabels,dispose(){disposed=true;generation++;unsubscribe();if(clearStatus!==null)timers.clearTimeout(clearStatus);}};
}
