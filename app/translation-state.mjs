import {inferSourceLanguage} from './source-language.mjs';
export const hasDualDrafts=passage=>['literal','interpretive'].every(key=>typeof passage?.translations?.[key]?.text==='string'&&passage.translations[key].text.trim());
export function createTranslationState(){
  const jobs=new Map();let selected=null,lastOutcome=null;
  const background=()=>[...jobs.values()].some(job=>job.status==='running')?'另一段正在翻译，可以继续阅读。':lastOutcome?.status==='saved'?'之前选择的段落双译已保存。':lastOutcome?.status==='failed'?'之前选择的段落翻译未完成，原文保留。回到那一段可重试。':'';
  return {
    selectedId:()=>selected,
    select:id=>{selected=id;},
    begin(id){if(jobs.get(id)?.status==='running')throw Error('这一段正在翻译');jobs.set(id,{status:'running'});},
    complete(id){jobs.set(id,{status:'saved'});lastOutcome={id,status:'saved'};return selected===id;},
    fail(id,message){jobs.set(id,{status:'failed',message});lastOutcome={id,status:'failed'};},
    view(passage,{authenticated,available,loginAvailable=true,defaultNotice=''}={}){
      const job=jobs.get(passage?.id),saved=hasDualDrafts(passage),other=lastOutcome?.id!==passage?.id?background():'';
      if(!passage)return {label:'翻译这段',disabled:true,notice:background()||defaultNotice};
      if(saved)return {label:'查看双译',disabled:false,notice:'这一段已有直译与意译草稿，可在本地打开并核对原文。'+other};
      if(job?.status==='running')return {label:'正在翻译…',disabled:true,notice:'正在翻译这一段。可以继续阅读，结果会保留在书房里。'};
      if(inferSourceLanguage(passage.original)==='zh')return {label:'中文原文 · 无需翻译',disabled:true,notice:'这段原文为中文，无需生成中文译文。'};
      if(!available)return {label:'翻译未配置',disabled:true,notice:'翻译服务尚未配置，原文和已有译文仍可阅读。'};
      if(!authenticated&&!loginAvailable)return {label:'登录准备中',disabled:true,notice:'这段尚未翻译，原文保留。邮箱登录准备中；已备的中文试读仍可直接阅读。'};
      if(!authenticated)return {label:'登录后翻译',disabled:false,notice:'登录后回到这一段。再次点击翻译，才会发送授权上下文。'};
      if(job?.status==='failed')return {label:'重试翻译',disabled:false,notice:(job.message||'翻译暂时无法完成。')+' 原文仍可继续阅读。'};
      return {label:'翻译这段',disabled:false,notice:(other||background())+'当前段落尚未翻译，原文保留。'};
    }
  };
}
