// Shared result validation contains no account or persistence access.
const fail=(message,status=400)=>{throw Object.assign(Error(message),{status});};
const object=v=>v&&typeof v==='object'&&!Array.isArray(v);
const text=(v,max=2000)=>typeof v==='string'&&v.trim()&&v.length<=max&&v.isWellFormed();
const fields=(v,allowed)=>{if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('Invalid workspace fields');};
const types=['supports','extends','contrasts','related'];
export function validateNotebookItems(value,kind,noteKeys){
 fields(value,['items']);if(Buffer.byteLength(JSON.stringify(value))>16384)fail('Generated item budget exceeded',502);if(!Array.isArray(value.items)||value.items.length>(kind==='review'?3:24))fail('Invalid generated items',502);
 const allowed=new Set(noteKeys);
 return value.items.map(item=>{fields(item,['text','noteKeys','type','next']);if(!text(item.text,4000)||!Array.isArray(item.noteKeys)||item.noteKeys.length>24||item.noteKeys.some(key=>!allowed.has(key))||new Set(item.noteKeys).size!==item.noteKeys.length||item.noteKeys.length<(kind==='compare'?2:1)||kind==='compare'&&!types.includes(item.type)||kind!=='compare'&&item.type!==undefined||kind==='review'&&!['reread','write','question'].includes(item.next)||kind!=='review'&&item.next!==undefined)fail('Invalid generated citations',502);return structuredClone(item);});
}
