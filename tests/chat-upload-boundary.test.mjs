import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {buildReaderWeb,syntacticImportEdges} from '../tools/build-reader-web.mjs';

test('book upload implementation waits for opening chat and stays outside the fixed reader startup budget',async()=>{
 const root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(os.tmpdir(),'leafhour-upload-boundary-'));
 try{
  const result=await buildReaderWeb({root,outputDir:out,html:await readFile(path.join(root,'app/index.html'),'utf8')});
  for(const file of ['app/atmosphere-audio.mjs','app/chat-book-upload.mjs','app/book-upload-controller.mjs','app/pdf-ingestion.mjs'])assert.ok(!result.inputs.includes(file),file+' must load only with chat upload');
  for(const file of ['app/observability-bridge.mjs','app/observability.mjs','app/observability-contract.mjs'])assert.ok(!result.inputs.includes(file),file+' must load after the first usable reader paint');
  for(const file of ['app/reader-progress-refresh.mjs','app/atmosphere-motion.mjs','app/hearth-motion.mjs','app/nature-motion.mjs'])assert.ok(!result.inputs.includes(file),file+' must wait for its actual foreground or visual use');
  const script=await readFile(path.join(out,result.files.find(f=>f.endsWith('.js'))),'utf8');
  assert.match(script,/import\(["']\/chat-book-upload\.mjs["']\)/);
  assert.match(script,/import\(["']\/observability-bridge\.mjs["']\)/);
  assert.match(script,/import\(["']\/reader-progress-refresh\.mjs["']\)/);
  assert.match(script,/import\(["']\/atmosphere-motion\.mjs["']\)/);
  assert.ok(!script.includes('/api/account/observability'),'the critical reader must not contain the collector transport');
  assert.ok(Buffer.byteLength(script)<=320*1024);
  for(const [owner,module]of [['app/reader.js','reader-progress-refresh.mjs'],['app/reader-atmosphere.js','atmosphere-motion.mjs']]){
   const edges=await syntacticImportEdges(root,owner,await readFile(path.join(root,owner),'utf8'));
   assert.deepEqual(edges.filter(edge=>edge.specifier.includes(module)).map(({specifier,kind})=>({specifier,kind})),[{specifier:'./'+module,kind:'dynamic-import'}]);
  }
 }finally{await rm(out,{recursive:true,force:true});}
});
