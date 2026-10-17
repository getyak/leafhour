import {nodeFileTrace} from '@vercel/nft';
import {mkdtemp,mkdir,readFile,copyFile,writeFile,rm} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';

// Exercise the deployable function dependency boundary, not the developer's
// complete node_modules. Only traced files are visible to the child renderer.
export async function checkPdfPackage(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..')){
 root=path.resolve(root);
 const trace=await nodeFileTrace([path.join(root,'api/service.js')],{base:root,processCwd:root}),directory=await mkdtemp(path.join(tmpdir(),'pdf-function-package-'));
 try{
  for(const file of trace.fileList){if(path.isAbsolute(file)||file.split(path.sep).includes('..'))throw Error('Function dependency is outside the package root');const destination=path.join(directory,file);await mkdir(path.dirname(destination),{recursive:true});await copyFile(path.join(root,file),destination);}
  // This is software fixture data; no real book or credential enters the child.
  const stream='BT /F1 14 Tf 50 720 Td (Visible packaged PDF source.) Tj ET',objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n';const offsets=[0];for(const [i,object]of objects.entries()){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${object}\nendobj\n`;}const xref=Buffer.byteLength(pdf);pdf+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;await writeFile(path.join(directory,'fixture.pdf'),pdf);
  // Empty system text painting models font-free Lambda hosts even on macOS.
  // The bundled PDF font programs must still produce visible glyph paths.
  const script="import {readFile} from 'node:fs/promises';const canvas=await import('@napi-rs/canvas');const prototype=Object.getPrototypeOf(canvas.createCanvas(1,1).getContext('2d'));prototype.fillText=()=>{};prototype.strokeText=()=>{};const {renderPdfEvidence}=await import(process.argv[1]);const image=await renderPdfEvidence(await readFile('fixture.pdf'),1);if(image.mimeType!=='image/png'||image.width*image.height>1000000||Buffer.from(image.data,'base64').length>2097152)throw Error('Invalid packaged PNG');console.log('PACKAGED_PDF_OK');";
  const result=spawnSync(process.execPath,['--permission','--allow-fs-read='+directory,'--allow-addons','--input-type=module','-e',script,pathToFileURL(path.join(directory,'server/pdf-source-evidence.mjs')).href],{cwd:directory,env:{PATH:process.env.PATH,HOME:directory,TMPDIR:directory,DISABLE_SYSTEM_FONTS_LOAD:'1'},encoding:'utf8',timeout:30000,maxBuffer:32768});
  if(result.error||result.status!==0||!result.stdout.includes('PACKAGED_PDF_OK'))throw Error('Packaged PDF renderer failed: '+(result.error?.message||result.stderr||result.stdout));
  const native=[...trace.fileList].filter(file=>file.startsWith('node_modules/@napi-rs/')&&file.endsWith('.node'));if(!native.length)throw Error('The function trace omitted the Canvas native binding');
  return {rendered:true,nativeBindings:native.length,files:trace.fileList.size,modelRequests:0};
 }finally{await rm(directory,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(await checkPdfPackage(process.argv[2])));
