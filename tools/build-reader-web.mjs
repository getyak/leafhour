import {build} from 'esbuild';
import {mkdir,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';
import {releaseFiles} from './release-policy.mjs';

// Only public application inputs are bundled. No runtime data or environment is
// substituted into either output; source modules remain the local dev surface.
export async function buildReaderWeb({root,outputDir,html}){
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
  'reader-book-actions.mjs':{kind:'dynamic-import',importer:'reader-book-actions-bootstrap.mjs'},
  'gift-compose.mjs':{kind:'dynamic-import',importer:'reader-book-actions.mjs'},
  'book-binding.mjs':{kind:'dynamic-import',importer:'reader-book-actions.mjs'},
  'arrival-catalog.mjs':{kind:'import-statement',importer:'reading-arrival.mjs'},
  'share-fonts.mjs':{kind:'dynamic-import',importer:'share.js'},
  'reader-settings-choices.mjs':{kind:'dynamic-import',importer:'reader-settings.mjs'},
  'command-palette.mjs':{kind:'dynamic-import',importer:'palette-bootstrap.mjs'}
 };
 // GET-188 scope amendment: exactly one additional external edge exists — the
 // literal './command-palette.mjs?retry=1' from palette-bootstrap.mjs,
 // dynamic-import kind only, backed by the same app/command-palette.mjs release
 // entry. No other query, importer or import kind is resolvable; those stay
 // rejected by policy instead of widening the fence.
 const paletteRetry='./command-palette.mjs?retry=1';
 const publicModules={name:'public-reader-modules',setup(b){b.onResolve({filter:/^\.\/(?:reader-book-actions|gift-compose|book-binding|arrival-catalog|share-fonts|reader-settings-choices|command-palette)\.mjs(?:\?.*)?$/},args=>{
  const at=args.path.indexOf('?'),query=at<0?'':args.path.slice(at);
  if(query&&args.path!==paletteRetry)throw Error('Non-public lazy reader module: '+args.path);
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
  for(const key of Object.keys(result.metafile.inputs)){if(key==='reader-entry.js'||key==='reader-entry.css')continue;const relative=path.relative(root,path.resolve(key)).replaceAll('\\','/');if(relative==='app/reader-entry.js'||relative==='app/reader-entry.css')continue;if(!relative.startsWith('app/')||!allowed.has(relative))throw Error('Non-public reader bundle input: '+relative);inputs.add(relative);}
  return result.outputFiles[0].contents;
 };
 const js=await compile(scripts.map(file=>'import '+JSON.stringify('./'+file.slice(1))+';').join('\n'),'js');
 const css=await compile(styles.map(file=>'@import '+JSON.stringify('./'+file.slice(1))+';').join('\n'),'css');
 await mkdir(path.join(outputDir,'reader-web'),{recursive:true});
 for(const [prefix,extension,bytes]of [['reader','js',js],['style','css',css]]){if(bytes.length>(extension==='js'?320:200)*1024)throw Error('Reader bundle exceeds public asset budget: '+prefix+' '+bytes.length);const file='reader-web/'+prefix+'-'+createHash('sha256').update(bytes).digest('hex').slice(0,16)+'.'+extension;await writeFile(path.join(outputDir,file),bytes);files.push(file);}
 html=html.replace(/<script\s+type="module"\s+src="\/[^"]+"\s*><\/script>/g,'').replace(/<link\s+rel="stylesheet"\s+href="\/[^"]+"\s*>/g,'');
 html=html.replace('</head>','<link rel="stylesheet" href="/'+files[1]+'"><script type="module" src="/'+files[0]+'"></script></head>');
 return {html,files,inputs:[...inputs].sort()};
}
