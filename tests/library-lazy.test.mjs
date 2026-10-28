import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parse} from 'acorn';
test('opening the library does not load archive compression or portability before an export/restore action',async()=>{
 const root=fileURLToPath(new URL('../app/',import.meta.url)),seen=new Set();
 async function visit(file){if(seen.has(file))return;seen.add(file);const ast=parse(await readFile(file,'utf8'),{ecmaVersion:'latest',sourceType:'module'});for(const node of ast.body)if(node.type==='ImportDeclaration'&&node.source.value.startsWith('.'))await visit(path.resolve(path.dirname(file),node.source.value));}
 await visit(path.join(root,'portal.js'));assert.equal(seen.has(path.join(root,'fflate.mjs')),false,'archive compression belongs to a user-initiated data action');assert.equal(seen.has(path.join(root,'library-portability.mjs')),false);
});
