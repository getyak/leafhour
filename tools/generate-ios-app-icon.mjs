// Deterministically rasterize the existing brand mark; no new artwork or alpha channel.
import {createRequire} from 'node:module';
import {readFileSync,writeFileSync} from 'node:fs';
import {deflateSync} from 'node:zlib';
const {createCanvas,loadImage}=createRequire(import.meta.url)('@napi-rs/canvas');
const size=1024;
const svg=readFileSync(new URL('../app/brand-assets/leafhour-mark.svg',import.meta.url),'utf8')
  .replace(/<style>[\s\S]*?<\/style>/,'').replace('<svg ','<svg width="1024" height="1024" ');
const canvas=createCanvas(size,size),context=canvas.getContext('2d');
context.fillStyle='#f7f5ef';context.fillRect(0,0,size,size);
context.drawImage(await loadImage(Buffer.from(svg)),0,0,size,size);
const pixels=context.getImageData(0,0,size,size).data;
const raw=Buffer.alloc(size*(1+size*3));
for(let y=0;y<size;y++)for(let x=0;x<size;x++) {
  const source=(y*size+x)*4,target=y*(1+size*3)+1+x*3;
  if(pixels[source+3]!==255)throw Error('App icon must be opaque');
  for(let channel=0;channel<3;channel++)raw[target+channel]=pixels[source+channel];
}
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes) {
    crc^=byte;
    for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
  }
  return (crc^0xffffffff)>>>0;
}
function chunk(name,bytes) {
  const type=Buffer.from(name),length=Buffer.alloc(4),checksum=Buffer.alloc(4);
  length.writeUInt32BE(bytes.length);checksum.writeUInt32BE(crc32(Buffer.concat([type,bytes])));
  return Buffer.concat([length,type,bytes,checksum]);
}
const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);
header[8]=8;header[9]=2; // PNG truecolor RGB; no alpha or transparency chunk.
writeFileSync(new URL('../apps/ios/Leafhour/Assets.xcassets/AppIcon.appiconset/AppIcon.png',import.meta.url),
  Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',header),chunk('IDAT',deflateSync(raw)),chunk('IEND',Buffer.alloc(0))]));
console.log('Generated opaque 1024px RGB AppIcon from the existing Leafhour brand mark.');
