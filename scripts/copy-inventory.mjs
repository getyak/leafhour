// GET-202 copy inventory: one source of truth for visible product copy.
//
// The inventory is evidence, not review. Regex/AST discovery is only candidate
// discovery: it never proves that text is unused, actually visible, human
// reviewed or completely covered. Every row keeps its source location and an
// explicit unknown/unreviewed state until a human decides on it individually.
//
// Nothing here executes repository HTML or JavaScript. Catalogue modules are
// parsed with Acorn as data (`export default Object.freeze({...})`); other
// JavaScript and HTML files are parsed or pattern-scanned read-only.
import {readFile,readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {parse} from 'acorn';

export const COPY_SCHEMA_VERSION=1;
export const UI_LOCALES=Object.freeze(['en','zh-Hans','zh-Hant','ja']);
export const FROZEN_SOURCE_COMMIT='43187d0ecaa63aa6575700677744c7cf4b3d099e';

const CJK=/[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF]/;
const DOM_TEXT_PROPERTIES=new Set(['textContent','innerText','innerHTML','placeholder','title','alt','ariaLabel','label']);
const HTML_COPY_ATTRIBUTES=new Set(['aria-label','title','placeholder','alt']);
const FILENAME=/[\w\u3400-\u9FFF.\-]+\.(?:md|mjs|js|json|html|css|txt|pdf|epub|zip|png|jpe?g|webp|mp3|woff2?|csv|tsv|ya?ml)\b/i;
const PATHISH=/(?:^|[\s"'`（(])\/?(?:[\w\u3400-\u9FFF.\-]+\/)+[\w\u3400-\u9FFF.\-]*/;

export function sha256(value){
  return createHash('sha256').update(value,'utf8').digest('hex');
}

// Protected source material: book titles, author text, quotations, pathnames,
// URLs, sample English and identifiers are preserved exactly and must never be
// rewritten by copy work. Detection is evidence-bound heuristics, not proof;
// a protected row still keeps its exact value for review.
export function classifyProtectedValue(value){
  const reasons=[];
  const text=String(value);
  const lines=[text,...text.split('\n')];
  if(lines.some(line=>/https?:\/\/[^\s"')>]+/.test(line)))reasons.push('url');
  if(lines.some(line=>PATHISH.test(line)||FILENAME.test(line)))reasons.push('path');
  if(lines.some(line=>/[「『“"][^「』”"\n]{8,}[」』”"]/.test(line)||/(?:^|\s)"[^"\n]{8,}"/.test(line)))reasons.push('quotation');
  const trimmed=text.trim();
  // Only code-like identifiers (keys, tokens, paths fragments) stay protected;
  // a plain one-word UI label such as "Close" is copy and must stay reviewable.
  if(/^[A-Za-z][A-Za-z0-9._-]*$/.test(trimmed)&&/[._\-/0-9]/.test(trimmed))reasons.push('identifier');
  return {protected:reasons.length>0,reasons};
}

function walk(node,visit,parent=null){
  if(!node||typeof node.type!=='string')return;
  visit(node,parent);
  for(const key of Object.keys(node)){
    if(key==='loc'||key==='type'||key==='parent')continue;
    const child=node[key];
    if(Array.isArray(child)){for(const entry of child)if(entry&&typeof entry.type==='string')walk(entry,visit,node);}
    else if(child&&typeof child.type==='string')walk(child,visit,node);
  }
}

function staticString(node){
  if(!node)return null;
  if(node.type==='Literal'&&typeof node.value==='string')return node.value;
  if(node.type==='TemplateLiteral'&&node.expressions.length===0&&node.quasis.length===1)return node.quasis[0].value.cooked;
  return null;
}

function templateFragments(node){
  if(node.type!=='TemplateLiteral')return [];
  return node.quasis.map(quasi=>quasi.value.cooked).filter(fragment=>fragment.length>0);
}

function concatFragments(node,found=[]){
  if(!node)return found;
  if(node.type==='BinaryExpression'&&node.operator==='+'){
    concatFragments(node.left,found);concatFragments(node.right,found);return found;
  }
  const literal=staticString(node);
  if(literal!==null){found.push(literal);return found;}
  if(node.type==='TemplateLiteral')found.push(...templateFragments(node));
  return found;
}

function expressionText(source,node){
  return source.slice(node.start,node.end).replace(/\s+/g,' ').slice(0,160);
}

export function parseCatalogue(source,file){
  let ast;
  try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});}
  catch(error){throw Error('Catalogue parser rejected '+file+': '+error.message);}
  const declaration=ast.body.find(node=>node.type==='ExportDefaultDeclaration');
  if(!declaration)throw Error('Catalogue must export its data: '+file);
  let object=declaration.declaration;
  if(object.type==='CallExpression'&&object.callee.type==='MemberExpression'&&!object.callee.computed&&object.callee.type&&object.callee.property.type==='Identifier'&&object.callee.property.name==='freeze')object=object.arguments[0];
  if(!object||object.type!=='ObjectExpression')throw Error('Catalogue must be Object.freeze({...}) string data: '+file);
  const entries=[];
  for(const property of object.properties){
    const line=property.loc?property.loc.start.line:0;
    if(property.type!=='Property'||property.computed||property.kind!=='init'||property.key.type!=='Literal'||property.value.type!=='Literal'||typeof property.key.value!=='string'||typeof property.value.value!=='string'){
      throw Error('Catalogue entries must be plain string literals: '+file+':'+line);
    }
    entries.push({key:property.key.value,value:property.value.value,line,column:property.loc.start.column+1});
  }
  return entries;
}

async function listSourceFiles(root,dir,extensions){
  const result=[];
  async function walkDir(current,prefix){
    let entries;
    try{entries=await readdir(current,{withFileTypes:true});}
    catch(error){if(error.code==='ENOENT')return;throw error;}
    for(const entry of entries.sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0)){
      const file=prefix?prefix+'/'+entry.name:entry.name;
      if(entry.isDirectory())await walkDir(path.join(current,entry.name),file);
      else if(extensions.test(entry.name))result.push(file);
    }
  }
  await walkDir(path.join(root,dir),dir);
  return result;
}

function candidateRow({id,file,line,column,kind,property,value,hints}){
  const protection=classifyProtectedValue(value);
  return {
    id,file,line,column,kind,property:property||null,value,sha256:sha256(value),
    protected:protection.protected,protectionReason:protection.protected?protection.reasons.join('+'):null,
    hints:hints||[],
    review:{state:'unknown',classification:'unknown',surface:'unknown',trigger:'unknown',decision:'unknown'}
  };
}

function lineStartsOf(source){
  const starts=[0];
  for(let i=0;i<source.length;i++)if(source.charCodeAt(i)===10)starts.push(i+1);
  return starts;
}
function positionAt(starts,offset){
  let low=0,high=starts.length-1;
  while(low<high){const mid=Math.ceil((low+high)/2);if(starts[mid]<=offset)low=mid;else high=mid-1;}
  return {line:low+1,column:offset-starts[low]+1};
}

function scanJavaScript({source,file,keySet,candidates,consumers,dynamicReferences}){
  let ast;
  try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module',locations:true});}
  catch(error){throw Error('JavaScript parser rejected '+file+': '+error.message);}
  walk(ast,(node,parent)=>{
    if(node.type==='MemberExpression'&&node.computed&&staticString(node.property)===null){
      const fragments=concatFragments(node.property);
      dynamicReferences.push({kind:'computed-member',file,line:node.loc.start.line,expression:expressionText(source,node.property),fragments,unresolved:true});
      return;
    }
    if(node.type==='BinaryExpression'&&node.operator==='+'&&!(parent&&parent.type==='MemberExpression'&&parent.computed&&parent.property===node)){
      const operands=[node.left,node.right];
      if(operands.some(operand=>staticString(operand)!==null||operand.type==='TemplateLiteral')){
        dynamicReferences.push({kind:'concatenation',file,line:node.loc.start.line,expression:expressionText(source,node),fragments:concatFragments(node),unresolved:true});
      }
      return;
    }
    if(node.type==='TemplateLiteral'&&node.expressions.length>0&&!(parent&&parent.type==='MemberExpression'&&parent.computed&&parent.property===node)){
      dynamicReferences.push({kind:'template',file,line:node.loc.start.line,expression:expressionText(source,node),fragments:templateFragments(node),unresolved:true});
      return;
    }
    if(node.type!=='Literal'&&!(node.type==='TemplateLiteral'&&node.expressions.length===0))return;
    const value=staticString(node);
    if(value===null||value.length===0)return;
    const line=node.loc.start.line,column=node.loc.start.column+1;
    if(keySet.has(value)){
      consumers.push({file,line,column,key:value});
      return;
    }
    const assignment=domAssignmentOf(node,parent);
    if(assignment){
      candidates.push(candidateRow({id:'candidate:'+file+':'+line+':'+column,file,line,column,kind:'js-dom-literal',property:assignment.property,value}));
      return;
    }
    const attribute=setAttributeOf(node,parent);
    if(attribute){
      candidates.push(candidateRow({id:'candidate:'+file+':'+line+':'+column,file,line,column,kind:'js-attribute',property:attribute.property,value}));
      return;
    }
    if(CJK.test(value)){
      candidates.push(candidateRow({id:'candidate:'+file+':'+line+':'+column,file,line,column,kind:'js-cjk-literal',value}));
    }
  });
}

function domAssignmentOf(node,parent){
  if(!parent||parent.type!=='AssignmentExpression'||parent.right!==node)return null;
  const left=parent.left;
  if(left&&left.type==='MemberExpression'&&!left.computed&&left.property.type==='Identifier'&&DOM_TEXT_PROPERTIES.has(left.property.name)){
    return {property:left.property.name};
  }
  return null;
}

function setAttributeOf(node,parent){
  if(!parent)return null;
  if(parent.type==='CallExpression'&&parent.callee.type==='MemberExpression'&&!parent.callee.computed&&parent.callee.property.type==='Identifier'&&parent.callee.property.name==='setAttribute'){
    const [name,value]=parent.arguments;
    const attributeName=staticString(name);
    if(attributeName&&value===node)return {property:attributeName};
    return null;
  }
  return null;
}

function scanHtml({source,file,keySet,candidates,consumers,dynamicReferences}){
  const cleaned=source
    .replace(/<!--[\s\S]*?-->/g,match=>match.replace(/[^\n]/g,' '))
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi,match=>match.replace(/[^\n]/g,' '))
    .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi,match=>match.replace(/[^\n]/g,' '));
  const starts=lineStartsOf(cleaned);
  const claimed=new Set();
  const attributePattern=new RegExp('\\s('+[...HTML_COPY_ATTRIBUTES].join('|')+')\\s*=\\s*"([^"]*)"|\\s('+[...HTML_COPY_ATTRIBUTES].join('|')+")\\s*=\\s*'([^']*)'",'gi');
  for(const match of cleaned.matchAll(attributePattern)){
    const property=(match[1]||match[3]).toLowerCase();
    const value=match[2]!==undefined?match[2]:match[4];
    if(!value)continue;
    const quote=match[2]!==undefined?'"':"'";
    const offset=match.index+match[0].indexOf(quote)+1;
    if(claimed.has(offset))continue;
    claimed.add(offset);
    const {line,column}=positionAt(starts,offset);
    if(keySet.has(value)){consumers.push({file,line,column,key:value});continue;}
    candidates.push(candidateRow({id:'candidate:'+file+':'+line+':'+column,file,line,column,kind:'html-attribute',property,value,hints:[{kind:'dom-property',evidence:'html-attribute:'+property,confidence:'low'}]}));
  }
  for(const match of cleaned.matchAll(/>([^<>]+)</g)){
    const raw=match[1];
    const value=raw.trim();
    if(!value||/^[{}[\],;:\s]*$/.test(value))continue;
    const offset=match.index+1+raw.indexOf(value[0]);
    if(claimed.has(offset))continue;
    claimed.add(offset);
    const {line,column}=positionAt(starts,offset);
    if(keySet.has(value)){consumers.push({file,line,column,key:value});continue;}
    candidates.push(candidateRow({id:'candidate:'+file+':'+line+':'+column,file,line,column,kind:'html-text',value,hints:[{kind:'dom-text',evidence:'html-text-node',confidence:'low'}]}));
  }
}

// The generated inventory binds the bytes of every scanned input, never the
// current git commit: committing or squashing history must not change a
// reproducible artifact. Execution commit metadata lives in an untracked
// receipt written by scripts/export-copy.mjs.
async function sourceInputs(base,files){
  const inputs=[];
  for(const file of [...new Set(files)].sort()){
    inputs.push({file,sha256:sha256(await readFile(path.join(base,file),'utf8'))});
  }
  return {
    frozenBase:FROZEN_SOURCE_COMMIT,
    binding:'input-sha256',
    inputs,
    inputDigest:sha256(inputs.map(entry=>entry.file+':'+entry.sha256).join('\n'))
  };
}

export async function collectCopy({root}={}){
  if(!root)throw Error('collectCopy requires an explicit root');
  const base=path.resolve(root);
  const catalogues=[];
  const definitions=new Map();
  for(const locale of UI_LOCALES){
    const file=path.posix.join('app/ui-catalogs',locale+'.mjs');
    let source;
    try{source=await readFile(path.join(base,file),'utf8');}
    catch(error){
      if(error.code!=='ENOENT')throw error;
      catalogues.push({locale,file,missing:true,entries:0});
      continue;
    }
    const entries=parseCatalogue(source,file);
    catalogues.push({locale,file,missing:false,entries:entries.length});
    for(const entry of entries){
      if(!definitions.has(entry.key))definitions.set(entry.key,[]);
      definitions.get(entry.key).push({locale,file,line:entry.line,column:entry.column,value:entry.value,sha256:sha256(entry.value)});
    }
  }
  const keySet=new Set(definitions.keys());
  const candidates=[],consumers=[],dynamicReferences=[];
  const sourceFiles=[
    ...(await listSourceFiles(base,'app',/\.mjs$/)).filter(file=>!file.startsWith('app/ui-catalogs/')&&!['app/vendor/pdf-lib.mjs','app/vendor/pdf-fontkit.mjs'].includes(file)),
    ...(await listSourceFiles(base,'app',/\.js$/)),
    ...(await listSourceFiles(base,'app',/\.html$/)),
    ...(await listSourceFiles(base,'server',/\.(?:mjs|js)$/)),
    ...(await listSourceFiles(base,'api',/\.(?:mjs|js)$/))
  ];
  const scannedFiles=[];
  for(const file of [...new Set(sourceFiles)].sort()){
    const source=await readFile(path.join(base,file),'utf8');
    scannedFiles.push(file);
    if(file.endsWith('.html'))scanHtml({source,file,keySet,candidates,consumers,dynamicReferences});
    else scanJavaScript({source,file,keySet,candidates,consumers,dynamicReferences});
  }
  const candidateIds=new Set();
  for(const candidate of candidates){
    if(candidateIds.has(candidate.id))throw Error('Duplicate candidate identity from one scan: '+candidate.id+'; discovery must not merge different source nodes');
    candidateIds.add(candidate.id);
  }
  const items=[];
  for(const [id,found] of definitions){
    const values={},missingLocales=[],duplicates=[];
    for(const locale of UI_LOCALES){
      const rows=found.filter(entry=>entry.locale===locale);
      if(rows.length===0){missingLocales.push(locale);continue;}
      const first=rows[0];
      values[locale]={file:first.file,line:first.line,column:first.column,value:first.value,sha256:first.sha256};
      if(rows.length>1)duplicates.push(...rows.map(row=>({locale,file:row.file,line:row.line,column:row.column,value:row.value})));
    }
    const namespace=id.split('.')[0];
    items.push({
      id,kind:'catalogue',values,missingLocales,duplicates,
      consumers:consumers.filter(entry=>entry.key===id).map(({file,line,column})=>({file,line,column})),
      hints:[{kind:'key-namespace',evidence:'key-namespace:'+namespace,confidence:'low'}],
      review:{state:'unreviewed',classification:'unknown',surface:'unknown',trigger:'unknown',decision:'unknown'}
    });
  }
  const missing={};
  for(const item of items)if(item.missingLocales.length>0)missing[item.id]=[...item.missingLocales].sort();
  const localeValues=items.reduce((total,item)=>total+Object.keys(item.values).length,0);
  const candidatesProtected=candidates.filter(entry=>entry.protected).length;
  const itemsProtected=items.filter(entry=>Object.values(entry.values).some(value=>classifyProtectedValue(value.value).protected)).length;
  const counts={
    catalogueFiles:catalogues.filter(entry=>!entry.missing).length,
    catalogueKeys:items.length,
    localeValues,
    itemsComplete:items.filter(entry=>entry.missingLocales.length===0).length,
    itemsWithMissingLocales:items.filter(entry=>entry.missingLocales.length>0).length,
    duplicateKeys:items.filter(entry=>entry.duplicates.length>0).length,
    reviewedItems:0,
    unreviewedItems:items.length,
    candidates:candidates.length,
    candidatesUnreviewed:candidates.length,
    candidatesProtected,
    itemsProtected,
    dynamicConsumers:dynamicReferences.length,
    consumerReferences:consumers.length,
    keysWithoutStaticConsumers:items.filter(entry=>entry.consumers.length===0).length
  };
  return {
    schemaVersion:COPY_SCHEMA_VERSION,
    source:await sourceInputs(base,[...catalogues.filter(entry=>!entry.missing).map(entry=>entry.file),...scannedFiles]),
    locales:[...UI_LOCALES],
    corpus:counts.catalogueKeys===0?'empty':'populated',
    catalogues,
    items,
    candidates,
    dynamicReferences,
    parity:{ok:Object.keys(missing).length===0&&counts.catalogueFiles===UI_LOCALES.length,missing},
    counts
  };
}

export function csvCell(value){
  const text=value===null||value===undefined?'':String(value);
  return /[",\n\r]|^\s|\s$/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;
}

export function inventoryCsv(inventory){
  const header=['id','kind','file','line','surface','trigger','classification','decision','review','en','zh-Hans','zh-Hant','ja'];
  const rows=[header.join(',')];
  for(const item of inventory.items){
    const first=item.values[UI_LOCALES.find(locale=>item.values[locale])]||{};
    rows.push([
      item.id,item.kind,first.file||'',first.line||'',item.review.surface,item.review.trigger,
      item.review.classification,item.review.decision,item.review.state,
      ...UI_LOCALES.map(locale=>item.values[locale]?item.values[locale].value:'')
    ].map(csvCell).join(','));
  }
  return rows.join('\n')+'\n';
}

export function candidatesCsv(inventory){
  const header=['id','kind','file','line','property','review','protected','protectionReason','value'];
  const rows=[header.join(',')];
  for(const entry of inventory.candidates){
    rows.push([
      entry.id,entry.kind,entry.file,entry.line,entry.property||'',entry.review.state,
      entry.protected?'protected':'reviewable',entry.protectionReason||'',entry.value
    ].map(csvCell).join(','));
  }
  return rows.join('\n')+'\n';
}
