import {extractEpubCover} from './epub-import.mjs';
import {renderPdfEvidence} from './pdf-source-evidence.mjs';
import {fail} from './document-import.mjs';

// Check raster dimensions before native decoding. SVG and external URLs never
// reach the decoder, even when their filename or declared MIME says "image".
function rasterSize(bytes){
 if(bytes.length>=24&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return [bytes.readUInt32BE(16),bytes.readUInt32BE(20)];
 if(bytes[0]===255&&bytes[1]===216){
  let offset=2;
  while(offset+4<=bytes.length){
   if(bytes[offset++]!==255)break;
   while(bytes[offset]===255)offset++;
   const marker=bytes[offset++];if(marker===217||marker===218)break;
   if(offset+2>bytes.length)break;
   const length=bytes.readUInt16BE(offset);if(length<2||offset+length>bytes.length)break;
   if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)&&length>=8)return [bytes.readUInt16BE(offset+5),bytes.readUInt16BE(offset+3)];
   offset+=length;
  }
 }
 throw fail('原文件封面无法显示',422);
}
export async function deriveImportedCover(bytes,format){
 let raster;
 if(format==='epub')raster=extractEpubCover(bytes);
 else if(format==='pdf')raster=Buffer.from((await renderPdfEvidence(bytes,1)).data,'base64');
 if(!raster)return null;
 if(raster.length>12*1024*1024)throw fail('原文件封面过大',422);
 const [width,height]=rasterSize(raster);if(width<1||height<1||width*height>20000000)throw fail('原文件封面尺寸过大',422);
 try{
  const {createCanvas,loadImage}=await import('@napi-rs/canvas'),image=await loadImage(raster),scale=Math.min(1,640/width,960/height),canvas=createCanvas(Math.max(1,Math.round(width*scale)),Math.max(1,Math.round(height*scale)));
  canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
  const cover=await canvas.encode('webp',84);if(cover.length>1024*1024)throw fail('原文件封面过大',422);return cover;
 }catch(error){if(error.status)throw error;throw fail('原文件封面无法显示',422);}
}
