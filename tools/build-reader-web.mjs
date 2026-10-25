import {build} from 'esbuild';
import {parse} from 'acorn';
import {mkdir,writeFile,readFile,readdir,realpath} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {releaseFiles} from './release-policy.mjs';

// GET-192 mutable runtime graph: the exact reviewed browser owners that may
// hold a static './ui-locale.mjs' import-statement edge. Unused permissions are
// removed at checkpoint A; every other caller/path/kind combination for this
// resolved mutable file FAILS and is never silently bundled.
export const UI_LOCALE_OWNERS=Object.freeze([
 'app/preference-memory-ui.mjs',
 'app/auth-dialog.mjs',
 'app/book-gift.mjs',
 'app/billing.mjs',
 'app/command-palette.mjs',
 'app/evals.js',
 'app/experiences.js',
 'app/gift-compose.mjs',
 'app/home-atmosphere.mjs',
 'app/home-navigation.mjs',
 'app/library-book-actions.mjs',
 'app/library-chat.mjs',
 'app/chat-book-upload.mjs',
 'app/library-daily-reading.mjs',
 'app/library-data.mjs',
 'app/library-filter-controls.mjs',
 'app/library-incremental.mjs',
 'app/library-profile.mjs',
 'app/library-reading-preferences.mjs',
 'app/library-shell.mjs',
 'app/palette-bootstrap.mjs',
 'app/palette-library.mjs',
 'app/parallel-reading.mjs',
 'app/pdf-onboarding.mjs',
 'app/personal-record-editor.mjs',
 'app/portal.js',
 'app/pricing-checkout.mjs',
 'app/reader-atmosphere.js',
 'app/reader-account.mjs',
 'app/reader-audio.js',
 'app/reader-audio-bootstrap.mjs',
 'app/reader-book-actions-bootstrap.mjs',
 'app/reader-book-actions.mjs',
 'app/reader-companion.mjs',
 'app/reader-conversation.mjs',
 'app/reader-highlights.mjs',
 'app/reader-annotations.mjs',
 'app/reader-immersion.mjs',
 'app/reader-navigation.mjs',
 'app/reader-pagination.mjs',
 'app/reader-settings-choices.mjs',
 'app/reader-settings.mjs',
 'app/reader-tools.mjs',
 'app/reader-translation.js',
 'app/reader-api.mjs',
 'app/reader.js',
 'app/reading-arrival.mjs',
 'app/reading-dashboard.mjs',
 'app/reading-manual-ui.mjs',
 'app/reading-session.js',
 'app/reading-toolbar.mjs',
 'app/share.js',
 'app/site-appearance.mjs',
 'app/source-review.mjs',
]);
export const UI_CATALOGUES=Object.freeze(['en','zh-Hans','zh-Hant','ja']);
export const UI_LOCALE_RELEASE_ENTRIES=Object.freeze([
 'app/ui-locale.mjs','app/ui-locale-codec.mjs',
 // GET-198 explicit account factories: closed raw dependencies of the one
 // runtime, no additional mutable locale and no new catalogue import forms.
 'app/account-ui-preferences-browser.mjs','app/account-ui-preferences.mjs',
 'app/account-ui-preferences-transport.mjs','app/authored-ui-choice.mjs',
 ...UI_CATALOGUES.map(code=>'app/ui-catalogs/'+code+'.mjs')
]);

// Syntactic import edges through esbuild's real parser: comments and ordinary
// string content produce no edges at all, template-literal specifiers with
// expressions are recorded as opaque and can never be silently accepted.
const stripQuery=specifier=>String(specifier).split(/[?#]/,1)[0];

// Maps any resolvable public specifier to its release backing file: relative
// spellings resolve against the importer, browser root-absolute URLs resolve to
// the public app backing. Protected public paths are checked conservatively.
export function targetFileOf(importerRelative,specifier){
  const raw=String(specifier),clean=stripQuery(raw),targets=[];
  if(clean.startsWith('./')||clean.startsWith('../'))targets.push(path.posix.normalize(path.posix.join(path.posix.dirname(importerRelative),clean)));
  else if(clean.startsWith('/')&&!clean.startsWith('//'))targets.push(path.posix.normalize('app'+clean));
  // Public app modules are served without app/. WHATWG URL resolution handles
  // encoded dot segments, backslashes and ASCII URL whitespace as the browser
  // does. Keep the filesystem candidate too for server/api/deploy source roots.
  // HTTP(S) origins are deployment-dependent: conservatively protect these exact
  // runtime/catalogue paths at every origin instead of trusting a private env.
  // Let URL itself perform C0/ASCII-tab/newline preprocessing, including inside
  // the scheme; a raw-prefix test would miss executable HTTP(S) aliases.
  for(const pathname of [importerRelative,importerRelative.startsWith('app/')?importerRelative.slice(4):importerRelative]){
      try{
        const url=new URL(raw,'https://ui-audit.invalid/'+pathname);
        if(url.protocol!=='http:'&&url.protocol!=='https:')continue;
        targets.push('app'+url.pathname,url.pathname.slice(1));
      }catch{}
  }
  const protectedFile=file=>/^app\/(reader-annotations|reading-retained-backup)(?:\.mjs|\.js)?$/.test(file)||file==='app/reader-audio'||file==='app/reader-audio.js'||file==='app/reader-audio.mjs'||file==='app/ui-locale'||file==='app/ui-locale.mjs'||file==='app/ui-locale.js'||file.startsWith('app/ui-catalogs/');
  const protectedTarget=targets.find(protectedFile);if(protectedTarget)return protectedTarget;
  // Ordinary bare package names still have no local release backing. URL
  // parsing above is conservative only for the protected runtime/catalogues.
  let explicit=/^[.\\/]/.test(raw.trim());
  try{explicit||=['http:','https:'].includes(new URL(raw).protocol);}catch{}
  return explicit?targets[0]||null:null;
}

export async function syntacticImportEdges(root,relative,source){
  // esbuild resolves importer symlinks; compare them against the same physical root.
  root=await realpath(root);
  const edges=[];
  const recorder=()=>({name:'ui-locale-edge-recorder',setup(b){
    b.onResolve({filter:/.*/},args=>{
      if(args.kind==='entry-point')return undefined;
      edges.push({importer:args.importer,specifier:args.path,kind:args.kind});
      return {path:args.path,external:true};
    });
  }});
  await build({entryPoints:[path.join(root,relative)],bundle:true,write:false,plugins:[recorder()],format:'esm',logLevel:'silent',outfile:path.join(root,'.ui-locale-audit-out.js')});
  return edges.map(edge=>({...edge,importer:edge.importer?path.relative(root,edge.importer).replaceAll('\\','/'):relative}));
}

// One esbuild pass over every audited source gives syntactic truth for
// import / export-from / import() / require() edges: comments and string
// content never produce edges. Non-literal import()/require() arguments cannot
// be validated at all and therefore fail closed (method shorthand
// `import(entries){` definitions are not calls).
export async function syntacticImportEdgesMany(root,files){
  root=await realpath(root);
  const edges=[];
  const recorder=()=>({name:'ui-locale-edge-recorder',setup(b){
    b.onResolve({filter:/.*/},args=>{
      if(args.kind==='entry-point')return undefined;
      edges.push({importer:args.importer,specifier:args.path,kind:args.kind});
      return {path:args.path,external:true};
    });
  }});
  if(files.length)await build({entryPoints:files.map(file=>path.join(root,file)),bundle:true,write:false,plugins:[recorder()],format:'esm',logLevel:'silent',outdir:path.join(root,'.ui-locale-audit-out')});
  return edges.map(edge=>({...edge,importer:edge.importer?path.relative(root,edge.importer).replaceAll('\\','/'):''}));
}

export function assertStaticModuleSyntax(source,relative='source.mjs'){
 const fail=why=>{throw Error('Unable to validate ui-locale edge from '+relative+' ('+why+')');};
 let ast;try{ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});}catch(error){fail('invalid module syntax: '+error.message);}
 const refs=[],imports=[];
 const scope=(parent,ownVar=false)=>{const s={parent,names:new Set(),varScope:null};s.varScope=ownVar?s:parent?.varScope||s;return s;};
 const root=scope(null,true);
 const literal=node=>node?.type==='Literal'&&typeof node.value==='string'?node.value:node?.type==='TemplateLiteral'&&!node.expressions.length&&node.quasis.length===1&&node.quasis[0].value.cooked!==null?node.quasis[0].value.cooked:null;
 const bind=(n,s)=>{if(!n)return;if(n.type==='Identifier')s.names.add(n.name);else if(n.type==='RestElement')bind(n.argument,s);else if(n.type==='AssignmentPattern')bind(n.left,s);else if(n.type==='ArrayPattern')n.elements.forEach(x=>bind(x,s));else if(n.type==='ObjectPattern')n.properties.forEach(p=>bind(p.type==='RestElement'?p.argument:p.value,s));};
 const pattern=(n,s)=>{if(!n)return;if(n.type==='AssignmentPattern'){pattern(n.left,s);visit(n.right,s);}else if(n.type==='RestElement')pattern(n.argument,s);else if(n.type==='ArrayPattern')n.elements.forEach(x=>pattern(x,s));else if(n.type==='ObjectPattern')n.properties.forEach(p=>{if(p.computed)visit(p.key,s);pattern(p.type==='RestElement'?p.argument:p.value,s);});};
 const functionNode=(n,s)=>{
  if(n.type==='FunctionDeclaration'&&n.id)bind(n.id,s);
  const params=scope(s);if(n.id)bind(n.id,params);
  n.params.forEach(p=>bind(p,params));n.params.forEach(p=>pattern(p,params));
  const body=scope(params,true);
  if(n.body.type==='BlockStatement')n.body.body.forEach(x=>visit(x,body));else visit(n.body,body);
 };
 function visit(n,s,directLoader=false){
  if(!n||typeof n.type!=='string')return;
  switch(n.type){
   case 'Identifier':if(n.name==='require')refs.push({scope:s,node:n,directLoader});return;
   case 'Program':n.body.forEach(x=>visit(x,s));return;
   case 'BlockStatement':{const b=scope(s);n.body.forEach(x=>visit(x,b));return;}
   case 'StaticBlock':{const b=scope(s,true);n.body.forEach(x=>visit(x,b));return;}
   case 'FunctionDeclaration':case 'FunctionExpression':case 'ArrowFunctionExpression':functionNode(n,s);return;
   case 'VariableDeclaration':for(const d of n.declarations)bind(d.id,n.kind==='var'?s.varScope:s);for(const d of n.declarations){pattern(d.id,s);visit(d.init,s);}return;
   case 'ImportDeclaration':n.specifiers.forEach(x=>bind(x.local,s));return;
   case 'ImportExpression':{const specifier=literal(n.source);if(specifier===null)fail('non-literal import specifier');imports.push({specifier,kind:'dynamic-import'});visit(n.source,s);visit(n.options,s);return;}
   case 'CallExpression':case 'NewExpression':{
    const loader=n.type==='CallExpression'&&n.callee.type==='Identifier'&&n.callee.name==='require';
    if(loader)refs.push({scope:s,node:n.callee,directLoader:true,args:n.arguments});else visit(n.callee,s);
    n.arguments.forEach(x=>visit(x,s));return;
   }
   case 'ClassDeclaration':case 'ClassExpression':{
    if(n.type==='ClassDeclaration'&&n.id)bind(n.id,s);
    const c=scope(s);if(n.id)bind(n.id,c);visit(n.superClass,c);visit(n.body,c);return;
   }
   case 'ForStatement':case 'ForInStatement':case 'ForOfStatement':{
    const f=scope(s);for(const key of ['init','left','right','test','update','body'])visit(n[key],f);return;
   }
   case 'SwitchStatement':{visit(n.discriminant,s);const c=scope(s);n.cases.forEach(x=>visit(x,c));return;}
   case 'CatchClause':{const c=scope(s);bind(n.param,c);pattern(n.param,c);visit(n.body,c);return;}
   case 'MemberExpression':visit(n.object,s);if(n.computed)visit(n.property,s);return;
   case 'Property':case 'MethodDefinition':case 'PropertyDefinition':if(n.computed)visit(n.key,s);visit(n.value,s);return;
   case 'LabeledStatement':visit(n.body,s);return;
   case 'BreakStatement':case 'ContinueStatement':case 'MetaProperty':case 'PrivateIdentifier':return;
   case 'ExportNamedDeclaration':visit(n.declaration,s);if(!n.source)n.specifiers.forEach(x=>visit(x.local,s));return;
   case 'ExportAllDeclaration':return;
  }
  for(const [key,v]of Object.entries(n)){if(key==='type'||key==='start'||key==='end')continue;if(Array.isArray(v))v.forEach(x=>visit(x,s));else if(v&&typeof v==='object')visit(v,s);}
 }
 visit(ast,root);
 for(const ref of refs){let s=ref.scope,bound=false;while(s){if(s.names.has('require')){bound=true;break;}s=s.parent;}if(bound)continue;
  if(!ref.directLoader)fail('unbound require escaped direct-call validation');
  const specifier=ref.args?.length===1?literal(ref.args[0]):null;if(specifier===null)fail('non-literal require specifier');
  imports.push({specifier,kind:'require-call'});
 }
 return imports;
}

export async function assertNoOpaqueModuleCalls(root,relative,source){assertStaticModuleSyntax(source,relative);}

// C design amendment: this controller has one actual intent/restore owner and
// one finite manual retry. These permissions do not widen old lazy policies.
export const AUDIO_PUBLIC_FILES=Object.freeze([
 'app/reader-audio.js','app/reader-audio-metadata.mjs','app/audio-state.mjs','app/audio-errors.mjs',
 'app/action-focus.mjs','app/listening-guide-state.mjs','app/reader-return.mjs',
 ...UI_LOCALE_RELEASE_ENTRIES
]);
export function assertAudioBoundaryEdges({edges,release,sources=[]}){
 const incoming=[];
 for(const edge of edges){
  const target=targetFileOf(edge.importer,edge.specifier);
  if(!['app/reader-audio','app/reader-audio.js','app/reader-audio.mjs'].includes(target))continue;
  if(edge.importer!=='app/reader-audio-bootstrap.mjs'||edge.kind!=='dynamic-import'||!['./reader-audio.js','./reader-audio.js?retry=1'].includes(edge.specifier))throw Error('Unauthorized audio boundary edge from '+edge.importer+': '+edge.specifier+' ('+edge.kind+')');
  incoming.push(edge.specifier);
 }
 if(!incoming.length&&!sources.includes('app/reader-audio-bootstrap.mjs'))return [];
 if(incoming.sort().join(',')!=='./reader-audio.js,./reader-audio.js?retry=1')throw Error('Audio boundary requires exactly base and manual retry imports');
 const visited=new Set(),visit=file=>{
  if(visited.has(file))return;visited.add(file);
  if(!release.has(file)||!AUDIO_PUBLIC_FILES.includes(file))throw Error('Non-public audio dependency: '+file);
  for(const edge of edges.filter(e=>e.importer===file)){
   const target=targetFileOf(file,edge.specifier);
   if(!target||!edge.specifier.startsWith('./')||!['import-statement','dynamic-import'].includes(edge.kind))throw Error('Unauthorized raw audio dependency: '+edge.specifier);
   if(file!=='app/ui-locale.mjs'&&(edge.kind!=='import-statement'||/[?#]/.test(edge.specifier)))throw Error('Unauthorized raw audio edge: '+edge.specifier);
   visit(target);
  }
 };visit('app/reader-audio.js');
 return [...visited].sort();
}

export const ANNOTATION_PUBLIC_FILES=Object.freeze([
 'app/reader-annotations.mjs','app/reader-annotation-pending.mjs','app/reader-annotation-margins.mjs','app/note-drafts.mjs','app/credit-labels.mjs',
 'app/reading-chat-quote.mjs','app/highlights.mjs','app/library-chat-markdown.mjs',
 'app/reader-annotations.css',...UI_LOCALE_RELEASE_ENTRIES
]);
const annotationTarget=target=>['app/reader-annotations','app/reader-annotations.js','app/reader-annotations.mjs'].includes(target);
export function assertAnnotationBoundaryEdges({edges,release,sources=[]}){
 const incoming=edges.filter(edge=>annotationTarget(targetFileOf(edge.importer,edge.specifier)));
 for(const edge of incoming)if(edge.importer!=='app/reader-highlights.mjs'||edge.kind!=='dynamic-import'||edge.specifier!=='./reader-annotations.mjs')throw Error('Unauthorized annotation boundary edge: '+edge.importer+' '+edge.specifier);
 if(!incoming.length&&!sources.includes('app/reader-annotations.mjs'))return [];
 if(incoming.length!==1)throw Error('Annotation boundary requires exactly one deferred import');
 for(const file of ANNOTATION_PUBLIC_FILES)if(!release.has(file))throw Error('Non-public annotation dependency: '+file);
 const visited=new Set(),visit=file=>{
  if(visited.has(file))return;visited.add(file);
  if(!ANNOTATION_PUBLIC_FILES.includes(file))throw Error('Non-public annotation dependency: '+file);
  for(const edge of edges.filter(edge=>edge.importer===file)){
   const target=targetFileOf(file,edge.specifier);
   if(!target||!edge.specifier.startsWith('./')||file!=='app/ui-locale.mjs'&&(edge.kind!=='import-statement'||/[?#]/.test(edge.specifier)))throw Error('Unauthorized raw annotation dependency: '+edge.specifier);
   visit(target);
  }
 };visit('app/reader-annotations.mjs');return [...visited].sort();
}

export const RETAINED_BACKUP_PUBLIC_FILES=Object.freeze([
 'app/preference-memory-codec.mjs',
 'app/book-introduction.mjs','app/highlights.mjs','app/library-backup.mjs','app/note-drafts.mjs',
 'app/paragraph-anchor.mjs','app/personal-records.mjs','app/portable-chat.mjs',
 'app/reader-annotation-records.mjs','app/reading-chat-quote.mjs','app/reading-draft-store.mjs',
 'app/reading-mark-store.mjs','app/reading-preferences.mjs','app/reading-queue-store.mjs',
 'app/reading-retained-backup.mjs','app/reading-session-record.mjs','app/reading-time-policy.mjs','app/source-revisions.mjs'
]);
const retainedTarget=file=>/^app\/reading-retained-backup(?:\.mjs|\.js)?$/.test(file);
export function assertRetainedBackupBoundaryEdges({edges,release,sources=[]}){
 const incoming=edges.filter(edge=>retainedTarget(targetFileOf(edge.importer,edge.specifier)));
 for(const edge of incoming)if(edge.importer!=='app/reading-session.js'||edge.kind!=='dynamic-import'||edge.specifier!=='./reading-retained-backup.mjs')throw Error('Unauthorized retained backup edge: '+edge.importer+' '+edge.specifier);
 if(!incoming.length&&!sources.includes('app/reading-retained-backup.mjs'))return [];
 if(incoming.length!==1)throw Error('Retained backup requires exactly one gesture import');
 const visited=new Set(),visit=file=>{if(visited.has(file))return;visited.add(file);if(!release.has(file)||!RETAINED_BACKUP_PUBLIC_FILES.includes(file))throw Error('Non-public retained backup dependency: '+file);for(const edge of edges.filter(edge=>edge.importer===file)){if(edge.kind!=='import-statement'||!edge.specifier.startsWith('./')||/[?#]/.test(edge.specifier))throw Error('Unauthorized raw retained backup edge: '+edge.specifier);visit(targetFileOf(file,edge.specifier));}};
 visit('app/reading-retained-backup.mjs');return [...visited].sort();
}

export async function auditUiLocaleGraph({root,allowed=null}={}){
  root=await realpath(root);
  const release=allowed||new Set(await releaseFiles(root));
  const walk=async dir=>{
    const out=[];
    for(const item of await readdir(dir,{withFileTypes:true})){
      const file=path.join(dir,item.name);
      if(item.isDirectory())out.push(...await walk(file));
      else if(/\.(?:mjs|js)$/.test(item.name))out.push(file);
    }
    return out;
  };
  let sources=[];
  for(const dir of ['app','server','api','deploy']){try{sources.push(...await walk(path.join(root,dir)));}catch(error){if(error.code!=='ENOENT')throw error;}}
  const owners=new Set(),catalogueEdges=[];
  let hasRuntimeModule=false,hasEdges=false;
  const audited=[];
  for(const file of sources.sort()){
    const relative=path.relative(root,file).replaceAll('\\','/');
    if(relative==='app/ui-locale.mjs')hasRuntimeModule=true;
    audited.push({relative,source:await readFile(file,'utf8')});
  }
  // Opaque (non-literal) import/require arguments fail closed everywhere in
  // the audited public/server sources before any edge policy runs.
  for(const {relative,source}of audited)await assertNoOpaqueModuleCalls(root,relative,source);
  const edges=await syntacticImportEdgesMany(root,audited.map(file=>file.relative));
  assertAudioBoundaryEdges({edges,release,sources:audited.map(file=>file.relative)});
  const annotationFiles=assertAnnotationBoundaryEdges({edges,release,sources:audited.map(file=>file.relative)});
  assertRetainedBackupBoundaryEdges({edges,release,sources:audited.map(file=>file.relative)});
  if(annotationFiles.length)for(const [file,cap]of [['app/reader-annotations.mjs',32768],['app/reader-annotation-pending.mjs',8192]])if((await readFile(path.join(root,file))).length>cap)throw Error('Annotation module exceeds public asset budget: '+file);
  for(const edge of edges){
    const base=targetFileOf(edge.importer,edge.specifier);
    const targets=new Set([base,base&&base+'.mjs',base&&base+'.js'].filter(Boolean));
    const apiHit=targets.has('app/ui-locale.mjs');
    const catalogueHit=[...targets].some(file=>file.startsWith('app/ui-catalogs/'));
    if(!apiHit&&!catalogueHit)continue;
    hasEdges=true;
    if(apiHit){
      // Exact reviewed rule: only the literal './ui-locale.mjs' static
      // import-statement edge from an actual reviewed owner may reach the
      // mutable runtime. Every other resolution/alias/query/hash/kind/caller
      // combination FAILS and is never silently bundled.
      if(edge.specifier!=='./ui-locale.mjs'||edge.kind!=='import-statement')throw Error('Unauthorized ui-locale edge from '+edge.importer+': '+edge.specifier+' ('+edge.kind+')');
      if(!UI_LOCALE_OWNERS.includes(edge.importer))throw Error('Unauthorized ui-locale edge from '+edge.importer+': wrong caller');
      owners.add(edge.importer);
    }else{
      const match=/^\.\/ui-catalogs\/(en|zh-Hans|zh-Hant|ja)\.mjs(\?retry=1)?$/.exec(edge.specifier),query=match?.[2]||'';
      if(edge.importer!=='app/ui-locale.mjs'||!match||!UI_CATALOGUES.includes(match[1]))throw Error('Unauthorized ui-catalogue edge from '+edge.importer+': '+edge.specifier+' ('+edge.kind+')');
      if(query&&query!=='?retry=1')throw Error('Unauthorized ui-catalogue query edge: '+edge.specifier);
      if(edge.kind==='import-statement'){
        if(match[1]!=='en'||query)throw Error('Unauthorized ui-catalogue static edge: '+edge.specifier);
        continue;
      }
      if(edge.kind!=='dynamic-import')throw Error('Unauthorized ui-catalogue kind edge: '+edge.specifier+' ('+edge.kind+')');
      if(match[1]==='en')throw Error('Unauthorized ui-catalogue dynamic edge: '+edge.specifier);
      catalogueEdges.push(match[1]+query);
    }
  }
  if(release.has('app/ui-locale.mjs')||hasEdges||hasRuntimeModule){
    for(const file of UI_LOCALE_RELEASE_ENTRIES)if(!release.has(file))throw Error('ui-locale graph missing release backing: '+file);
  }
  if(hasRuntimeModule){
    for(const owner of UI_LOCALE_OWNERS){
      let exists=true;try{await readFile(path.join(root,owner));}catch(error){if(error.code==='ENOENT')exists=false;else throw error;}
      if(exists&&!owners.has(owner))throw Error('Unused ui-locale owner permission: '+owner);
    }
    // Exactly six real syntactic catalogue edges: three base literals plus
    // three fixed ?retry=1 literals. Comment-only mentions never count.
    const expected=[...UI_CATALOGUES.filter(code=>code!=='en'),...UI_CATALOGUES.filter(code=>code!=='en').map(code=>code+'?retry=1')].sort();
    const actual=[...catalogueEdges].sort();
    if(actual.length!==6||actual.join(',')!==expected.join(','))throw Error('ui-locale catalogue edges must be exactly six literal base/retry imports: '+actual.join(','));
  }
  return {owners:[...owners].sort(),catalogueEdges:[...catalogueEdges].sort()};
}

export async function buildReaderWeb({root,outputDir,html}){
 root=await realpath(root);
 const scripts=[...html.matchAll(/<script\s+type="module"\s+src="(\/[^"]+)"\s*><\/script>/g)].map(x=>x[1]);
 const styles=[...html.matchAll(/<link\s+rel="stylesheet"\s+href="(\/[^"]+)"\s*>/g)].map(x=>x[1]);
 if(!scripts.includes('/reader.js')||!scripts.includes('/reader-translation.js')||!styles.length)throw Error('Reader page entry points are incomplete');
 const allowed=new Set(await releaseFiles(root)),inputs=new Set(),files=[];
 // Sharing is loaded on demand; the public arrival catalog keeps its stable
 // module URL and cache. Every other application import stays in the bundle.
 // Each external lazy module has one exact importer and one exact import kind;
 // GET-178 added only command-palette.mjs, dynamically imported on a real user
 // gesture from the small statically bundled palette bootstrap, and GET-173
 // adds only reader-book-actions.mjs, dynamically imported on the real bookplate
 // open from the statically bundled reader-book-actions-bootstrap.mjs. The
 // prior six exceptions are unchanged.
 const lazyModules={
  'reader-account.mjs':{kind:'dynamic-import',importer:'reader.js'},
  // Pure canvas layout waits for Share, preserving the fixed reader budget.
  'share-model.mjs':{kind:'dynamic-import',importer:'share.js'},
  'original-download.mjs':{kind:'dynamic-import',importer:'reader-translation.js'},
  'credit-client.mjs':{kind:'dynamic-import',importer:'reader-api.mjs'},
  // The independently served audio engine keeps loop preparation out of the fixed reader asset.
  'atmosphere-audio.mjs':{kind:'import-statement',importer:'reader-atmosphere.js'},
  'chat-book-upload.mjs':{kind:'dynamic-import',importer:'library-chat.mjs'},
  'library-chat-markdown.mjs':{kind:'dynamic-import',importer:'library-chat.mjs'},
  'reader-book-actions.mjs':{kind:'dynamic-import',importer:'reader-book-actions-bootstrap.mjs'},
  'gift-compose.mjs':{kind:'dynamic-import',importer:'reader-book-actions.mjs'},
  'book-binding.mjs':{kind:'dynamic-import',importer:'reader-book-actions.mjs'},
  'arrival-catalog.mjs':{kind:'import-statement',importer:'reading-arrival.mjs'},
  'share-fonts.mjs':{kind:'dynamic-import',importer:'share.js'},
  'reader-settings-choices.mjs':{kind:'dynamic-import',importer:'reader-settings.mjs'},
  'reader-page-inputs.mjs':{kind:'import-statement',importer:'reader-pagination.mjs'},
  'reader-page-surface.mjs':{kind:'dynamic-import',importer:'reader-page-inputs.mjs'},
  'command-palette.mjs':{kind:'dynamic-import',importer:'palette-bootstrap.mjs'}
 };
 // GET-188 scope amendment: exactly one additional external edge exists — the
 // literal './command-palette.mjs?retry=1' from palette-bootstrap.mjs,
 // dynamic-import kind only, backed by the same app/command-palette.mjs release
 // entry. No other query, importer or import kind is resolvable; those stay
 // rejected by policy instead of widening the fence.
 const paletteRetry='./command-palette.mjs?retry=1',accountRetry='./reader-account.mjs?retry=1';
 const publicModules={name:'public-reader-modules',setup(b){
  b.onResolve({filter:/.*/},args=>{
   const relative=path.relative(root,args.importer).replaceAll('\\','/'),target=targetFileOf(relative,args.path);
   if(retainedTarget(target)){
    if(relative!=='app/reading-session.js'||args.kind!=='dynamic-import'||args.path!=='./reading-retained-backup.mjs')throw Error('Unauthorized retained backup edge: '+relative+' '+args.path);
    for(const file of RETAINED_BACKUP_PUBLIC_FILES)if(!allowed.has(file))throw Error('Non-public retained backup dependency: '+file);
    return {path:'/reading-retained-backup.mjs',external:true};
   }
   if(annotationTarget(target)){
    if(relative!=='app/reader-highlights.mjs'||args.kind!=='dynamic-import'||args.path!=='./reader-annotations.mjs')throw Error('Unauthorized annotation boundary edge: '+relative+' '+args.path);
    for(const file of ANNOTATION_PUBLIC_FILES)if(!allowed.has(file))throw Error('Non-public annotation dependency: '+file);
    return {path:'/reader-annotations.mjs',external:true};
   }
   if(!['app/reader-audio','app/reader-audio.js','app/reader-audio.mjs'].includes(target))return undefined;
   if(relative!=='app/reader-audio-bootstrap.mjs'||args.kind!=='dynamic-import'||!['./reader-audio.js','./reader-audio.js?retry=1'].includes(args.path))throw Error('Unauthorized audio boundary edge: '+relative+' '+args.path);
   if(!allowed.has('app/reader-audio.js'))throw Error('Non-public audio boundary');
   return {path:'/'+args.path.slice(2),external:true};
  });
  // GET-192 mutable runtime: every resolution/alias/query/hash/kind/caller
  // edge to app/ui-locale.mjs is either an exact reviewed static owner edge
  // externalized to /ui-locale.mjs or a hard failure. Catalogue data may never
  // be bundled from anywhere; the six literal dynamic edges live only in the
  // external runtime module.
  b.onResolve({filter:/ui-locale/},args=>{
   const relative=path.relative(root,args.importer).replaceAll('\\','/');
   const base=targetFileOf(relative,args.path);
   const candidates=[base,base&&base+'.mjs',base&&base+'.js'];
   if(!candidates.includes('app/ui-locale.mjs'))return undefined;
   const at=args.path.indexOf('?'),query=at<0?'':args.path.slice(at);
   const hash=args.path.indexOf('#'),hasHash=hash>=0&&(at<0||hash<at);
   // Exact reviewed rule: only the literal './ui-locale.mjs' static
   // import-statement edge from a reviewed owner externalizes to
   // /ui-locale.mjs. Aliases, root-absolute URLs, queries, hashes, require or
   // dynamic kinds and wrong callers all FAIL here and in the source audit.
   if(query||hasHash||args.path!=='./ui-locale.mjs'||args.kind!=='import-statement'||!UI_LOCALE_OWNERS.includes(relative))throw Error('Unauthorized ui-locale edge from '+relative+': '+args.path+' ('+args.kind+')');
   for(const file of UI_LOCALE_RELEASE_ENTRIES)if(!allowed.has(file))throw Error('Non-public ui-locale release backing: '+file);
   return {path:'/ui-locale.mjs',external:true};
  });
  b.onResolve({filter:/ui-catalogs/},args=>{
   const relative=path.relative(root,args.importer).replaceAll('\\','/');
   const base=targetFileOf(relative,args.path);
   const candidates=[base,base&&base+'.mjs',base&&base+'.js'];
   if(!candidates.some(file=>file&&file.startsWith('app/ui-catalogs/')))return undefined;
   throw Error('Non-public ui-catalogue bundle edge: '+args.path);
  });
  b.onResolve({filter:/^\.\/(?:reader-account|atmosphere-audio|original-download|credit-client|chat-book-upload|library-chat-markdown|reader-book-actions|gift-compose|book-binding|arrival-catalog|share-fonts|share-model|reader-settings-choices|reader-page-inputs|reader-page-surface|command-palette)\.mjs(?:\?.*)?$/},args=>{
  const at=args.path.indexOf('?'),query=at<0?'':args.path.slice(at);
  if(query&&args.path!==paletteRetry&&args.path!==accountRetry)throw Error('Non-public lazy reader module: '+args.path);
  const entry=lazyModules[args.path.slice(2,query?at:undefined)];
  if(entry&&args.kind===entry.kind&&path.resolve(args.importer)===path.join(root,'app',entry.importer)){
   const file='app/'+args.path.slice(2,query?at:undefined);if(!allowed.has(file))throw Error('Non-public lazy reader module: '+file);
   return {path:'/'+args.path.slice(2),external:true};
  }
  if(query)throw Error('Non-public lazy reader module: '+args.path);
  return undefined;
 });}};
 const compile=async(contents,loader)=>{
  const result=await build({stdin:{contents,resolveDir:path.join(root,'app'),sourcefile:'reader-entry.'+(loader==='css'?'css':'js'),loader},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,charset:'utf8',legalComments:'none',plugins:loader==='css'?[{name:'public-css-urls',setup(b){b.onResolve({filter:/^\//},args=>{if(args.kind==='url-token')return {path:args.path,external:true};if(args.kind==='import-rule'&&args.path==='/fonts/noto-serif-sc/font-faces.css'&&path.resolve(args.importer)===path.join(root,'app/typography.css')){if(!allowed.has('app/fonts/noto-serif-sc/font-faces.css'))throw Error('Non-public CJK stylesheet');return {path:args.path,external:true};}return undefined;});}}]:[publicModules],write:false,metafile:true,logLevel:'silent'});
  for(const key of Object.keys(result.metafile.inputs)){if(key==='reader-entry.js'||key==='reader-entry.css')continue;const relative=path.relative(root,path.resolve(key)).replaceAll('\\','/');if(relative==='app/reader-entry.js'||relative==='app/reader-entry.css')continue;if(relative==='app/ui-locale.mjs')throw Error('Mutable ui-locale API bundled by alias: '+key);if(!relative.startsWith('app/')||!allowed.has(relative))throw Error('Non-public reader bundle input: '+relative);inputs.add(relative);}
  return result.outputFiles[0].contents;
 };
 await auditUiLocaleGraph({root,allowed});
 const js=await compile(scripts.map(file=>'import '+JSON.stringify('./'+file.slice(1))+';').join('\n'),'js');
 const css=await compile(styles.map(file=>'@import '+JSON.stringify('./'+file.slice(1))+';').join('\n'),'css');
 await mkdir(path.join(outputDir,'reader-web'),{recursive:true});
 for(const [prefix,extension,bytes]of [['reader','js',js],['style','css',css]]){if(bytes.length>(extension==='js'?320:200)*1024)throw Error('Reader bundle exceeds public asset budget: '+prefix+' '+bytes.length);const file='reader-web/'+prefix+'-'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.'+extension;await writeFile(path.join(outputDir,file),bytes);files.push(file);}
 html=html.replace(/<script\s+type="module"\s+src="\/[^"]+"\s*><\/script>/g,'').replace(/<link\s+rel="stylesheet"\s+href="\/[^"]+"\s*>/g,'');
 html=html.replace('</head>','<link rel="stylesheet" href="/'+files[1]+'"><script type="module" src="/'+files[0]+'"></script></head>');
 return {html,files,inputs:[...inputs].sort()};
}
