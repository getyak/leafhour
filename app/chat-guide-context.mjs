const fail=()=>{throw Object.assign(Error('阅读前导引用的归属或格式不正确'),{status:400});};
const targetKeys=['kind','schemaVersion','origin','guideId','bookId','contentVersion','sourceKind','locale'];
const text=(v,max)=>typeof v==='string'&&v.isWellFormed()&&v.trim().length>0&&[...v].length<=max;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
function validate(value,keys){
 if(!object(value)||Object.keys(value).some(k=>!keys.includes(k))||value.kind!=='leafhour-reading-guide-context'||value.schemaVersion!==1||value.origin!=='ai'||!text(value.guideId,128)||!text(value.bookId,256)||!text(value.contentVersion,256)||!['cloud','local-device'].includes(value.sourceKind)||!['zh-Hans','zh-Hant','en','ja'].includes(value.locale))fail();
 return Object.fromEntries(targetKeys.map(k=>[k,value[k]]));
}
// A live request may identify a saved guide but cannot supply its AI prose.
export const normalizeChatGuideTarget=value=>validate(value,targetKeys);
// Saved history carries an independent AI snapshot, including after migration.
export function normalizeChatGuideContext(value){
 const target=validate(value,[...targetKeys,'opening','method','readingQuestion']);
 if(!text(value.opening,1200)||!text(value.method,1200)||!text(value.readingQuestion,300))fail();
 return {...target,opening:value.opening,method:value.method,readingQuestion:value.readingQuestion};
}
export function chatGuideTarget(value){const context=normalizeChatGuideContext(value);return Object.fromEntries(targetKeys.map(k=>[k,context[k]]));}
