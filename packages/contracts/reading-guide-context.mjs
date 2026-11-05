// Shared bounded input contract; no library or persistence implementation.
const fail=(message,status=400)=>Object.assign(Error(message),{status});
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const only=(x,keys)=>object(x)&&Object.keys(x).every(k=>keys.includes(k));
const text=(x,max)=>typeof x==='string'&&x.isWellFormed()&&x.trim().length>0&&[...x].length<=max;
const id=x=>text(x,256)&&!/[\u0000-\u001f]/u.test(x);
const bytes=x=>Buffer.byteLength(JSON.stringify(x));
export function normalizeReadingGuideContext(value){
 if(!only(value,['title','author','chapters','passages'])||!text(value.title,500)||typeof value.author!=='string'||!value.author.isWellFormed()||[...value.author].length>500||!Array.isArray(value.chapters)||value.chapters.length>24||!Array.isArray(value.passages)||value.passages.length>6||!value.passages.length||bytes(value)>18000)throw fail('阅读前导的开篇取样不完整或超过范围');
 if(value.chapters.some(c=>!only(c,['id','title'])||!id(c.id)||typeof c.title!=='string'||!c.title.isWellFormed()||[...c.title].length>200)||value.passages.some(p=>!only(p,['id','chapterId','original'])||!id(p.id)||!id(p.chapterId)||!text(p.original,6000))||value.passages.reduce((n,p)=>n+[...p.original].length,0)>6000||new Set(value.passages.map(p=>p.id)).size!==value.passages.length)throw fail('阅读前导只使用当前书的目录与有限原文');
 return structuredClone(value);
}

