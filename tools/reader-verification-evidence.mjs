// Shared evidence rules for the optional real-browser verification tools.
export function readerWriteKind(path){
 if(/\/(?:chat|translate|translation|translations|audio|dialogues|guides|generate|runs|introduction|gift-quote)(?:\/|$)|\/companion\/messages(?:\/|$)/.test(path))return 'model';
 if(/\/(?:reading-sessions|reading-milestones|comments|questions|highlights|annotations)(?:\/|$)/.test(path))return 'reading-record';
 if(/\/progress(?:\/|$)/.test(path))return 'progress';
 if(/\/daily-reading\/presence/.test(path))return 'presence';
 return 'other';
}
export function compareReaderConsole({baseline,engine,version,errors}){
 if(!baseline)return {verified:false,engine,version,newErrors:null};
 const known=baseline.engines?.find(entry=>entry.engine===engine);
 if(!known||known.version!==version)throw Error('Console baseline must identify the same browser engine/version');
 const normalize=text=>String(text).replace(/http:\/\/127\.0\.0\.1:\d+/g,'http://127.0.0.1:PORT');
 const key=entry=>(entry.path||'')+'\n'+normalize(entry.text);
 const messages=new Set(known.errors.map(key));
 return {verified:true,engine,version,newErrors:errors.filter(entry=>!messages.has(key(entry)))};
}
