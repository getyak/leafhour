// PDF.js loads Canvas with a dynamic createRequire that dependency tracers miss.
// Keep an explicit literal import edge while deferring native loading until render.
import {fileURLToPath} from 'node:url';
import {digest,fail} from './document-import.mjs';
let active=0;
// Render one authorized original page into bounded pixels. The PDF is data: no
// document scripts, actions, external URLs or uploaded filenames are executed.
export async function renderPdfEvidence(bytes,pageNumber){
 if(!Number.isSafeInteger(pageNumber)||pageNumber<1)throw fail('PDF 图像页码不正确');
 if(active>=2)throw fail('页面图像正在核对，请稍后重试',429);active++;
 let task,render,canvas,document,page,timedOut=false;const timer=setTimeout(()=>{timedOut=true;render?.cancel();task?.destroy().catch(()=>{});},20000);timer.unref?.();
 try{
  await import('@napi-rs/canvas');
  await import('pdfjs-dist/legacy/build/pdf.worker.mjs');const {getDocument}=await import('pdfjs-dist/legacy/build/pdf.mjs');
  task=getDocument({data:new Uint8Array(bytes),isEvalSupported:false,disableFontFace:true,useSystemFonts:true,stopAtErrors:true,wasmUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/wasm/',import.meta.url)),cMapPacked:true,cMapUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/cmaps/',import.meta.url)),standardFontDataUrl:fileURLToPath(new URL('../node_modules/pdfjs-dist/standard_fonts/',import.meta.url))});
  document=await task.promise;if(document.numPages>1200||pageNumber>document.numPages)throw fail('PDF 图像页码超出原件范围');page=await document.getPage(pageNumber);const base=page.getViewport({scale:1});if(!Number.isFinite(base.width*base.height)||base.width<=0||base.height<=0)throw fail('PDF 页面尺寸不正确',422);
  let scale=Math.min(2,1200/base.width,1200/base.height,Math.sqrt(990000/(base.width*base.height)));
  for(let attempt=0;attempt<3;attempt++){
   const viewport=page.getViewport({scale}),width=Math.max(1,Math.floor(viewport.width)),height=Math.max(1,Math.floor(viewport.height));canvas=document.canvasFactory.create(width,height);render=page.render({canvasContext:canvas.context,viewport,background:'rgb(255,255,255)'});await render.promise;if(timedOut)throw fail('页面图像核对超时，原件与文字仍保留',504);
   const rgba=canvas.context.getImageData(0,0,width,height).data;let visible=false;for(let i=0;i<rgba.length;i+=4)if(rgba[i+3]>0&&(rgba[i]<250||rgba[i+1]<250||rgba[i+2]<250)){visible=true;break;}if(!visible)throw fail('页面图像为空白，无法确认扫描图像已完整呈现；请下载原件核对',422);
   const image=canvas.canvas.toBuffer('image/png');if(image.length<=2*1024*1024)return {mimeType:'image/png',data:image.toString('base64'),sha256:digest(image),width,height,renderer:'pdfjs'};
   document.canvasFactory.destroy(canvas);canvas=null;scale*=.75;
  }
  throw fail('页面图像超过显示容量，请下载原件对照',413);
 }catch(error){if(error.status)throw error;throw fail(timedOut?'页面图像核对超时，原件与文字仍保留':'页面图像无法呈现，原件与提取文字仍保留，请下载原件对照',timedOut?504:422);}
 finally{clearTimeout(timer);if(canvas)document.canvasFactory.destroy(canvas);page?.cleanup();if(task)await task.destroy();active--;}
}
