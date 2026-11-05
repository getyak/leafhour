import {readFile,readdir} from 'node:fs/promises';
import path from 'node:path';
import {parse} from 'acorn';
const roots=['apps/api','apps/agent','apps/web','packages/contracts','packages/domain','packages/adapters'];let count=0;
for(const root of roots)for(const name of await readdir(root)){if(!name.endsWith('.mjs'))continue;const source=await readFile(path.join(root,name),'utf8');count++;
 if(/from\s+['"](?:\.\.\/)+(?:apps\/)?(?:api|agent|web)\//.test(source)&&!root.startsWith('apps/'))throw Error('Shared package imports an application: '+name);
 if(root==='apps/api'&&/env\.(?:DEEPSEEK_API_KEY|GEMINI_API_KEY|ARK_API_KEY|PADDLEOCR_ACCESS_TOKEN)\s*=/.test(source))throw Error('API provider credential assignment: '+name);
}
const visited=new Set(),forbidden=/(?:^|\/)(?:apps\/(?:api|web)\/|(?:hosted-store|hosted-auth|supabase-rest|billing-store|ingestion-storage|library-service|locked-json-store)\.mjs$)/;
async function agentGraph(file){const normalized=file.replaceAll('\\','/');if(forbidden.test(normalized))throw Error('Agent transitive storage/application dependency: '+normalized);if(visited.has(file))return;visited.add(file);const ast=parse(await readFile(file,'utf8'),{sourceType:'module',ecmaVersion:'latest'}),imports=[];
 function visit(node){if(!node||typeof node!=='object')return;if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(node.type)&&node.source?.value)imports.push(node.source.value);if(node.type==='ImportExpression'&&node.source.type==='Literal')imports.push(node.source.value);for(const value of Object.values(node)){if(Array.isArray(value))value.forEach(visit);else if(value&&typeof value==='object')visit(value);}}
 visit(ast);for(const specifier of imports)if(specifier.startsWith('.'))await agentGraph(path.resolve(path.dirname(file),specifier));
}
await agentGraph(path.resolve('apps/agent/server.mjs'));
console.log('Checked '+count+' module files and '+visited.size+' Agent dependency files; no API/database storage import.');
