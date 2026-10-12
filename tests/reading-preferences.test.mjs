import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createReaderServer} from '../server/server.mjs';

test('reading appearance travels with exported records, rejects invalid imports atomically, and accepts old positions',async t=>{
  const dir=await mkdtemp(path.join(tmpdir(),'reader-appearance-'));
  t.after(()=>rm(dir,{recursive:true,force:true}));
  const bookPath=path.join(dir,'book.json');
  await writeFile(bookPath,JSON.stringify({bookId:'appearance-book',contentVersion:'v1',chapters:[{id:'ch01'}],sections:[{number:1,chapterId:'ch01',paragraphs:[{id:'p1'}]}]}));
  const servers=[];
  t.after(async()=>{for(const server of servers)await new Promise(r=>server.close(r));});
  async function open(name){const server=await createReaderServer({bookPath,recordsPath:path.join(dir,name,'records.json')});servers.push(server);await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
  const base=await open('first'),other=await open('second');
  const post=(base,url,data)=>fetch(base+url,{method:'POST',headers:{'Content-Type':'application/json',Origin:base},body:JSON.stringify(data)});
  const legacy={chapterId:'ch01',passageId:'p1',offset:100,mode:'parallel',variant:'literal',font:23,theme:'night'};
  const custom={...legacy,theme:'leaf',fontFamily:'kai',lineHeight:2.2,paragraphGap:32,letterSpacing:0.04,wordSpacing:0.12,fontWeight:600,indent:true};
  assert.equal((await post(base,'/api/progress',custom)).status,200);
  const exported=await (await fetch(base+'/api/records/export')).json();
  for(const [key,value] of Object.entries(custom))assert.equal(exported.position[key],value,key);
  assert.equal((await post(other,'/api/records/import',exported)).status,200);
  const restored=await (await fetch(other+'/api/records')).json();
  for(const [key,value] of Object.entries(custom))assert.equal(restored.position[key],value,key);
  for(const invalid of [{fontFamily:'injected'},{theme:'unknown'},{lineHeight:9},{paragraphGap:-4},{letterSpacing:1},{wordSpacing:-1},{fontWeight:900},{indent:'yes'}]){
    const bad={...exported,position:{...custom,...invalid},comments:[{id:'bad-note',passageId:'p1',text:'should never be imported'}]};
    assert.equal((await post(other,'/api/records/import',bad)).status,400,JSON.stringify(invalid));
    const unchanged=await (await fetch(other+'/api/records')).json();
    assert.deepEqual(unchanged.position,restored.position);assert.equal(unchanged.comments.length,0);
  }
  assert.equal((await post(other,'/api/progress',legacy)).status,200);
  const migrated=await (await fetch(other+'/api/records')).json();
  assert.equal(migrated.position.fontFamily,'song');assert.equal(migrated.position.lineHeight,1.98);assert.equal(migrated.position.indent,false);
});
