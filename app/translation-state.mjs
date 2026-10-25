import {inferSourceLanguage} from './source-language.mjs';
export const hasDualDrafts=passage=>['literal','interpretive'].every(key=>typeof passage?.translations?.[key]?.text==='string'&&passage.translations[key].text.trim());
const message=id=>({id});
const legacyMessages=/* @__PURE__ */Object.freeze({
  "translation.backgroundRunning": "另一段正在翻译，可以继续阅读。",
  "translation.backgroundSaved": "之前选择的段落双译已保存。",
  "translation.backgroundFailed": "之前选择的段落翻译未完成，原文保留。回到那一段可重试。",
  "translation.translate": "翻译这段",
  "translation.viewDrafts": "查看双译",
  "translation.savedNotice": "这一段已有直译与意译草稿，可在本地打开并核对原文。",
  "translation.translating": "正在翻译…",
  "translation.translatingNotice": "正在翻译这一段。可以继续阅读，结果会保留在书房里。",
  "translation.chineseOriginal": "中文原文 · 无需翻译",
  "translation.chineseNotice": "这段原文为中文，无需生成中文译文。",
  "translation.unconfigured": "翻译未配置",
  "translation.unconfiguredNotice": "翻译服务尚未配置，原文和已有译文仍可阅读。",
  "translation.loginPreparing": "登录准备中",
  "translation.loginPreparingNotice": "这段尚未翻译，原文保留。邮箱登录准备中；已备的中文试读仍可直接阅读。",
  "translation.login": "登录后翻译",
  "translation.loginNotice": "登录后回到这一段。再次点击翻译，才会发送授权上下文。",
  "translation.retry": "重试翻译",
  "translation.failed": "翻译暂时无法完成。",
  "translation.originalRemains": " 原文仍可继续阅读。",
  "translation.untranslated": "当前段落尚未翻译，原文保留。"
});
const legacyMessage=value=>typeof value==='string'?value:value?.literal??legacyMessages[value?.id]??'';
const legacyView=view=>({...view,label:legacyMessage(view.label),notice:view.notice.map(legacyMessage).join('')});
// Presentation is caller-owned: the default keeps the public legacy strings,
// while a UI may cache these stable descriptors and format them in place.
export function createTranslationState({present=legacyView}={}){return createState(present);}
// Browser callers consume descriptors directly; unused legacy prose can be
// removed by the bundler without changing the shared task state machine.
export function createTranslationPresentation(){return createState(view=>view);}
function createState(present){
  const jobs=new Map();let selected=null,lastOutcome=null;
  const background=()=>[...jobs.values()].some(job=>job.status==='running')?message('translation.backgroundRunning'):lastOutcome?.status==='saved'?message('translation.backgroundSaved'):lastOutcome?.status==='failed'?message('translation.backgroundFailed'):null;
  const view=(label,disabled,...notice)=>present({label,disabled,notice:notice.filter(Boolean)});
  return {
    selectedId:()=>selected,
    select:id=>{selected=id;},
    begin(id){if(jobs.get(id)?.status==='running')throw Error('这一段正在翻译');jobs.set(id,{status:'running'});},
    complete(id){jobs.set(id,{status:'saved'});lastOutcome={id,status:'saved'};return selected===id;},
    acknowledgeSaved(id){if(lastOutcome?.id!==id||lastOutcome.status!=='saved')return false;lastOutcome=null;return true;},
    fail(id,text){jobs.set(id,{status:'failed',message:text});if(text?.id!=='billing.cancelled')lastOutcome={id,status:'failed'};},
    view(passage,{authenticated,available,loginAvailable=true,defaultNotice=''}={}){
      const job=jobs.get(passage?.id),saved=hasDualDrafts(passage),other=lastOutcome?.id!==passage?.id?background():null;
      if(!passage)return view(message('translation.translate'),true,background()||defaultNotice);
      if(saved)return view(message('translation.viewDrafts'),false,message('translation.savedNotice'),other);
      if(job?.status==='running')return view(message('translation.translating'),true,message('translation.translatingNotice'));
      if(inferSourceLanguage(passage.original)==='zh')return view(message('translation.chineseOriginal'),true,message('translation.chineseNotice'));
      if(!available)return view(message('translation.unconfigured'),true,message('translation.unconfiguredNotice'));
      if(!authenticated&&!loginAvailable)return view(message('translation.loginPreparing'),true,message('translation.loginPreparingNotice'));
      if(!authenticated)return view(message('translation.login'),false,message('translation.loginNotice'));
      if(job?.status==='failed')return view(message('translation.retry'),false,job.message||message('translation.failed'),message('translation.originalRemains'));
      return view(message('translation.translate'),false,other||background(),message('translation.untranslated'));
    }
  };
}
