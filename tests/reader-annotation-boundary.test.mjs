import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {assertAnnotationBoundaryEdges,ANNOTATION_PUBLIC_FILES,assertRetainedBackupBoundaryEdges,RETAINED_BACKUP_PUBLIC_FILES,buildReaderWeb} from '../tools/build-reader-web.mjs';

test('annotation controller has one exact deferred owner and closed public dependency graph',()=>{
 const edge={importer:'app/reader-highlights.mjs',specifier:'./reader-annotations.mjs',kind:'dynamic-import'},release=new Set(ANNOTATION_PUBLIC_FILES);
 assert.deepEqual(assertAnnotationBoundaryEdges({edges:[edge],release}),['app/reader-annotations.mjs']);
 for(const patch of [{importer:'app/reader.js'},{kind:'import-statement'},{kind:'require-call'},{specifier:'./reader-annotations.mjs?retry=1'},{specifier:'/reader-annotations.mjs'},{specifier:'./x/../reader-annotations.mjs'},{specifier:'./x/%2e%2e/reader-annotations.mjs'},{specifier:'./reader-annotations'}])assert.throws(()=>assertAnnotationBoundaryEdges({edges:[{...edge,...patch}],release}),/Unauthorized annotation/);
 assert.throws(()=>assertAnnotationBoundaryEdges({edges:[edge,edge],release}),/exactly one/);
 assert.throws(()=>assertAnnotationBoundaryEdges({edges:[edge],release:new Set()}),/Non-public annotation/);
 assert.throws(()=>assertAnnotationBoundaryEdges({edges:[edge,{importer:'app/reader-annotations.mjs',specifier:'./reader-api.mjs',kind:'import-statement'}],release}),/Non-public annotation/);
});

test('the actual reader keeps annotation UI and its pending store outside the initial asset',async()=>{
 const root=path.resolve(import.meta.dirname,'..'),out=await mkdtemp(path.join(tmpdir(),'annotation-build-'));
 try{const result=await buildReaderWeb({root,outputDir:out,html:await readFile(path.join(root,'app/index.html'),'utf8')});
  assert.ok(result.inputs.includes('app/reader-highlights.mjs'));assert.ok(!result.inputs.includes('app/reader-annotations.mjs'));assert.ok(!result.inputs.includes('app/reader-annotation-pending.mjs'));
  const js=await readFile(path.join(out,result.files.find(file=>file.endsWith('.js'))),'utf8');assert.match(js,/import\(["']\/reader-annotations\.mjs["']\)/);assert.doesNotMatch(js,/marginalia-annotation-pending-v1/);
  assert.ok(Buffer.byteLength(js)<=320*1024);const css=await readFile(path.join(out,result.files.find(file=>file.endsWith('.css'))),'utf8');assert.match(css,/reader-annotation-card/);assert.ok(Buffer.byteLength(css)<=200*1024);
 }finally{await rm(out,{recursive:true,force:true});}
});

test('retained backup has one explicit gesture owner, rejecting aliases and mutable reader dependencies',()=>{
 const edge={importer:'app/reading-session.js',specifier:'./reading-retained-backup.mjs',kind:'dynamic-import'},release=new Set(RETAINED_BACKUP_PUBLIC_FILES);
 assert.deepEqual(assertRetainedBackupBoundaryEdges({edges:[edge],release}),['app/reading-retained-backup.mjs']);
 for(const patch of [{importer:'app/reader.js'},{kind:'import-statement'},{specifier:'./reading-retained-backup.mjs?retry=1'},{specifier:'/reading-retained-backup.mjs'},{specifier:'./x/%2e%2e/reading-retained-backup.mjs'},{specifier:'./reading-retained-backup'}])assert.throws(()=>assertRetainedBackupBoundaryEdges({edges:[{...edge,...patch}],release}),/Unauthorized retained backup/);
 assert.throws(()=>assertRetainedBackupBoundaryEdges({edges:[edge,edge],release}),/exactly one/);
 assert.throws(()=>assertRetainedBackupBoundaryEdges({edges:[edge],release:new Set()}),/Non-public retained/);
 assert.throws(()=>assertRetainedBackupBoundaryEdges({edges:[edge,{importer:'app/reading-retained-backup.mjs',specifier:'./reader-api.mjs',kind:'import-statement'}],release}),/Non-public retained/);
});
