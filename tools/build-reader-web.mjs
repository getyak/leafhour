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
 const compile=async(contents,loader)=>{
  const result=await build({stdin:{contents,resolveDir:path.join(root,'app'),sourcefile:'reader-entry.'+(loader==='css'?'css':'js'),loader},bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,charset:'utf8',legalComments:'none',external:loader==='css'?['/*']:[],write:false,metafile:true,logLevel:'silent'});
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
