import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {assertAudioBoundaryEdges,AUDIO_PUBLIC_FILES,syntacticImportEdgesMany,auditUiLocaleGraph,targetFileOf} from '../tools/build-reader-web.mjs';
import {releaseFiles} from '../tools/release-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const release=new Set(await releaseFiles(root));
const files=['app/reader-audio-bootstrap.mjs',...AUDIO_PUBLIC_FILES];
const edges=await syntacticImportEdgesMany(root,files);
test('actual complete audio public closure is release-backed, pure and avoids duplicate API/navigation',async()=>{
 const closure=assertAudioBoundaryEdges({edges,release,sources:files});assert.deepEqual(closure,[...AUDIO_PUBLIC_FILES].sort());assert.equal(closure.includes('app/reader-api.mjs'),false);assert.equal(closure.includes('app/reader-navigation.mjs'),false);await auditUiLocaleGraph({root});
 const html=await readFile(path.join(root,'app/index.html'),'utf8');assert.match(html,/src="\/reader-audio-bootstrap.mjs"/);assert.doesNotMatch(html,/src="\/reader-audio.js"/);
});
for(const specifier of ['./reader-audio.js?retry=2','./reader-audio.js?random=1','./reader-audio.js#x','/reader-audio.js','./sub/../reader-audio.js','./reader-audio','./reader-audio.mjs','https://example.test/reader-audio.js','./%2e/reader-audio.js'])test('audio boundary rejects alias/query '+specifier,()=>{
 assert.ok(targetFileOf('app/reader-audio-bootstrap.mjs',specifier)?.startsWith('app/reader-audio'));
 assert.throws(()=>assertAudioBoundaryEdges({edges:[...edges,{importer:'app/reader-audio-bootstrap.mjs',specifier,kind:'dynamic-import'}],release,sources:files}),/Unauthorized audio/);
});
for(const importer of ['app/reader.js','app/audio-state.mjs','server/audio-service.mjs','deploy/main.mjs'])for(const kind of ['import-statement','require-call','dynamic-import'])test('audio rejects '+importer+' '+kind,()=>{
 assert.throws(()=>assertAudioBoundaryEdges({edges:[...edges,{importer,specifier:importer.startsWith('app/')?'./reader-audio.js':'../app/reader-audio.js',kind}],release,sources:files}),/Unauthorized audio/);
});
for(const kind of ['require-call','import-statement'])test('audio rejects bootstrap '+kind,()=>assert.throws(()=>assertAudioBoundaryEdges({edges:[...edges,{importer:'app/reader-audio-bootstrap.mjs',specifier:'./reader-audio.js',kind}],release,sources:files}),/Unauthorized audio/));
test('missing raw transitive release backing and forbidden extra stateful imports fail closed',()=>{
 for(const file of AUDIO_PUBLIC_FILES){const missing=new Set(release);missing.delete(file);assert.throws(()=>assertAudioBoundaryEdges({edges,release:missing,sources:files}),/Non-public audio/);}
 for(const name of ['reader-api.mjs','reader-navigation.mjs','anything-new.mjs'])assert.throws(()=>assertAudioBoundaryEdges({edges:[...edges,{importer:'app/reader-audio.js',specifier:'./'+name,kind:'import-statement'}],release,sources:files}),/Non-public audio/);
});
