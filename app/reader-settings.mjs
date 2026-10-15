// Each panel answers a different reading decision; hidden preferences retain their values.
export function mountReaderSettings({document}){
  const tabs=[...document.querySelectorAll('[data-settings-tab]')],content=document.getElementById('settings-content');
  function activate(index,{focus=false}={}){
    tabs.forEach((tab,i)=>{const selected=i===index;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;document.getElementById('settings-'+tab.dataset.settingsTab).hidden=!selected;});
    content.scrollTop=0;if(focus)tabs[index].focus({preventScroll:true});
  }
  tabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>activate(index));
    tab.addEventListener('keydown',event=>{
      const next=event.key==='ArrowRight'?(index+1)%tabs.length:event.key==='ArrowLeft'?(index+tabs.length-1)%tabs.length:event.key==='Home'?0:event.key==='End'?tabs.length-1:null;
      if(next===null)return;event.preventDefault();activate(next,{focus:true});
    });
  });
  activate(0);
  return {update({mode}){
    const translated=mode==='zh'||mode==='parallel';
    document.getElementById('translation-settings').hidden=!translated;
    document.getElementById('translation-details').hidden=!translated;
    document.getElementById('parallel-settings').hidden=mode!=='parallel';
  }};
}
