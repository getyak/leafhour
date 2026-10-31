import path from 'node:path';
import {createHash} from 'node:crypto';
import {unzipSync,Unzip,UnzipInflate} from 'fflate';
import {DOMParser,XMLSerializer} from '@xmldom/xmldom';
import {setImmediate as yieldToRequests} from 'node:timers/promises';

const invalid=(message,status=422)=>Object.assign(Error('EPUB：'+message),{status});
const hash=value=>createHash('sha256').update(value).digest('hex');
const plain=value=>value.replace(/\s+/gu,' ').trim();
const children=node=>Array.from(node.childNodes||[]);
const elements=(node,name)=>Array.from(node?.getElementsByTagNameNS('*',name)||[]);
const attr=(node,name)=>node.getAttribute(name)||'';
const NS={container:'urn:oasis:names:tc:opendocument:xmlns:container',opf:'http://www.idpf.org/2007/opf',xhtml:'http://www.w3.org/1999/xhtml',epub:'http://www.idpf.org/2007/ops'};
const table=Uint32Array.from({length:256},(_,i)=>{for(let k=0;k<8;k++)i=i&1?0xedb88320^(i>>>1):i>>>1;return i>>>0;});
const crc=bytes=>{let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
const safeName=name=>!!name&&!/[\\\u0000-\u001f]/u.test(name)&&!name.startsWith('/')&&!/^[a-z]:/i.test(name)&&name.split('/').every(p=>p!=='.'&&p!=='..')&&name.length<=1000;

// Validate both ZIP directories before any inflation. Streamed output is checked
// against these bounds and CRC; trusting only originalSize permits ZIP bombs.
function readArchive(bytes){
 if(bytes.length<22||bytes.length>20*1024*1024)throw invalid('文件最多 20 MB，且必须是完整 ZIP',413);
 const b=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
 for(let i=b.length-22;i>=Math.max(0,b.length-65557);i--)if(b.readUInt32LE(i)===0x06054b50&&i+22+b.readUInt16LE(i+20)===b.length){end=i;break;}
 if(end<0||b.readUInt16LE(end+4)||b.readUInt16LE(end+6))throw invalid('不支持分卷或损坏的 ZIP');
 const count=b.readUInt16LE(end+10),central=b.readUInt32LE(end+16),centralBytes=b.readUInt32LE(end+12);
 if(count<1||count>5000||b.readUInt16LE(end+8)!==count||central+centralBytes!==end)throw invalid('ZIP 目录或文件数量超过限制');
 const inventory=new Map(),ranges=[];let offset=central,total=0;
 for(let i=0;i<count;i++){
  if(offset+46>end||b.readUInt32LE(offset)!==0x02014b50)throw invalid('ZIP 目录损坏');
  const flags=b.readUInt16LE(offset+8),method=b.readUInt16LE(offset+10),checksum=b.readUInt32LE(offset+16),compressed=b.readUInt32LE(offset+20),size=b.readUInt32LE(offset+24),n=b.readUInt16LE(offset+28),extra=b.readUInt16LE(offset+30),comment=b.readUInt16LE(offset+32),local=b.readUInt32LE(offset+42),next=offset+46+n+extra+comment;
  if(next>end)throw invalid('ZIP 目录不完整');
  let name;try{name=new TextDecoder('utf-8',{fatal:true}).decode(b.subarray(offset+46,offset+46+n));}catch{throw invalid('ZIP 路径必须使用 UTF-8');}
  if(!safeName(name)||inventory.has(name))throw invalid('ZIP 路径重复或不安全');
  if(flags&1||![0,8].includes(method)||size===0xffffffff||compressed===0xffffffff||local===0xffffffff||size>30*1024*1024||(total+=size)>100*1024*1024)throw invalid('ZIP 加密、压缩方式或容量不受支持',413);
  if(local+30>central||b.readUInt32LE(local)!==0x04034b50||b.readUInt16LE(local+6)!==flags||b.readUInt16LE(local+8)!==method)throw invalid('ZIP 本地文件头与目录不一致');
  const ln=b.readUInt16LE(local+26),le=b.readUInt16LE(local+28),start=local+30+ln+le;
  if(start+compressed>central||!b.subarray(local+30,local+30+ln).equals(b.subarray(offset+46,offset+46+n)))throw invalid('ZIP 文件范围或路径不一致');
  if(!(flags&8)&&(b.readUInt32LE(local+14)!==checksum||b.readUInt32LE(local+18)!==compressed||b.readUInt32LE(local+22)!==size))throw invalid('ZIP 本地长度或校验与目录不一致');
  ranges.push([local,start+compressed]);inventory.set(name,{size,checksum,method,compressed,local});offset=next;
 }
 if(offset!==end)throw invalid('ZIP 目录长度不一致');
 ranges.sort((a,b)=>a[0]-b[0]);for(let i=1;i<ranges.length;i++)if(ranges[i][0]<ranges[i-1][1])throw invalid('ZIP 文件范围重叠');
 const mime=inventory.get('mimetype');if(!mime||mime.local!==0||mime.method!==0||mime.size!==20)throw invalid('缺少未压缩的首个 mimetype 文件');
 const files=new Map(),seen=new Set();
 // fflate also validates the central structure without allocating file outputs.
 unzipSync(bytes,{filter:()=>false});
 const unzip=new Unzip(file=>{
  const entry=inventory.get(file.name);if(!entry||seen.has(file.name)||file.originalSize!==undefined&&file.originalSize!==entry.size)throw invalid('ZIP 文件头与目录不一致');seen.add(file.name);
  let size=0;const chunks=[];file.ondata=(error,chunk,final)=>{if(error)throw invalid('ZIP 解压失败');size+=chunk.length;if(size>entry.size)throw invalid('ZIP 实际解压容量超过目录');chunks.push(chunk);if(final){if(size!==entry.size)throw invalid('ZIP 文件未完整解压');const out=Buffer.concat(chunks,size);if(crc(out)!==entry.checksum)throw invalid('ZIP 文件校验失败');files.set(file.name,out);}};file.start();
 });unzip.register(UnzipInflate);
 for(let i=0;i<bytes.length;i+=4096)unzip.push(bytes.subarray(i,i+4096),i+4096>=bytes.length);
 if(files.size!==inventory.size||files.get('mimetype')?.toString()!=='application/epub+zip')throw invalid('ZIP 文件或 mimetype 不完整');
 if(files.has('META-INF/encryption.xml'))throw invalid('包含加密资源；请提供可提取的无加密 EPUB');
 return files;
}
function parseXML(bytes,label,mime='application/xml'){
 if(!bytes||bytes.length>5*1024*1024)throw invalid(label+' XML 缺失或超过 5 MB');
 let text;try{text=new TextDecoder(bytes[0]===255&&bytes[1]===254?'utf-16le':bytes[0]===254&&bytes[1]===255?'utf-16be':'utf-8',{fatal:true}).decode(bytes);}catch{throw invalid(label+' XML 编码不受支持');}
 if(/<!ENTITY|<!DOCTYPE[^>]*\[/iu.test(text))throw invalid('XML 不允许实体或内部 DTD');
 try{return new DOMParser({onError:()=>{throw Error('invalid XML');}}).parseFromString(text,mime);}catch{throw invalid(label+' XML 无法解析');}
}
function reference(base,value){
 if(!value||/[\\\u0000-\u0020]/u.test(value)||value.startsWith('/')||value.startsWith('//')||/^[a-z][a-z\d+.-]*:/iu.test(value)||value.includes('?'))throw invalid('外部或无效资源路径');
 const [raw,fragment='']=value.split('#');let decoded,id;
 try{decoded=decodeURIComponent(raw);id=decodeURIComponent(fragment);}catch{throw invalid('资源路径编码不正确');}
 if(/[\\\u0000-\u001f]/u.test(decoded+id)||decoded.startsWith('/')||/^[a-z][a-z\d+.-]*:/iu.test(decoded))throw invalid('资源路径不安全');
 const href=path.posix.normalize(path.posix.join(path.posix.dirname(base),decoded||path.posix.basename(base)));
 if(!safeName(href))throw invalid('资源路径超出 EPUB');return {href,fragment:id};
}
const omitted=new Set(['script','style','iframe','object','embed','audio','video','svg','head']);
function visible(node){return node.nodeType!==1||!omitted.has(node.localName)&&!node.hasAttribute('hidden')&&attr(node,'aria-hidden')!=='true';}
function textOf(node){if(!visible(node))return '';if(node.nodeType===3||node.nodeType===4)return node.data;if(node.nodeType===1&&node.localName==='br')return '\n';return children(node).map(textOf).join('');}
function sourceBlocks(doc,href,sourceHash,includeXML=false){
 const root=doc.documentElement;if(root?.namespaceURI!==NS.xhtml||root.localName!=='html')throw invalid('内容必须为 XHTML');
 let count=0;const ids=new Set();function inspect(node,depth){if(++count>100000||depth>100)throw invalid('XHTML 节点或嵌套超过限制',413);if(node.nodeType===1){const id=attr(node,'id');if(id&&ids.has(id))throw invalid('XHTML 元素 ID 重复');if(id)ids.add(id);}for(const child of children(node))inspect(child,depth+1);}inspect(root,0);
 const body=elements(doc,'body')[0];if(!body)throw invalid('XHTML 缺少正文');
 const leaf=new Set(['p','h1','h2','h3','h4','h5','h6','li','blockquote','pre','dt','dd','figcaption','td','th']);const blocks=[],blockIds=new Set();
 function add(node,ancestors){const text=plain(textOf(node));if(!text)return;const elementId=attr(node,'id'),id=sourceHash.slice(0,16)+'-e'+hash(JSON.stringify([href,elementId?'element':'ordinal',elementId||blocks.length])).slice(0,20);if(blockIds.has(id))throw invalid('正文段落标识重复');blockIds.add(id);const ownIds=[attr(node,'id'),...Array.from(node.getElementsByTagName('*')).map(n=>attr(n,'id')),...ancestors].filter(Boolean);blocks.push({id,text,elementId:attr(node,'id')||null,elementIds:[...new Set(ownIds)],type:/^h[1-6]$/.test(node.localName)?'epub_heading':'paragraph',...(includeXML?{sourceXML:node.ownerDocument?new XMLSerializer().serializeToString(node):children(node).map(n=>new XMLSerializer().serializeToString(n)).join('')}: {})});}
 function walk(node,ancestors=[]){if(!visible(node))return;const next=node.nodeType===1&&attr(node,'id')?[...ancestors,attr(node,'id')]:ancestors;
  if(node.nodeType===1&&leaf.has(node.localName)){const nested=Array.from(node.getElementsByTagName('*')).some(n=>leaf.has(n.localName));if(!nested){add(node,ancestors);return;}}
  let inline=[];const flush=()=>{if(plain(inline.map(textOf).join(''))){const proxy={nodeType:1,localName:'div',childNodes:inline,getAttribute:()=>'',hasAttribute:()=>false,getElementsByTagName:()=>[]};add(proxy,next);}inline=[];};
  for(const child of children(node)){if(child.nodeType===1&&(['div','section','article','main','header','footer','nav','ol','ul','table','tr','tbody','thead'].includes(child.localName)||leaf.has(child.localName))){flush();walk(child,next);}else inline.push(child);}flush();
 }walk(body);return blocks;
}

export async function extractEpub(bytes,{onProgress=async()=>{}}={}){
 try{
  const files=readArchive(bytes),container=parseXML(files.get('META-INF/container.xml'),'container');
  if(container.documentElement?.namespaceURI!==NS.container)throw invalid('container 命名空间错误');
  const rootfiles=elements(container,'rootfile').filter(n=>attr(n,'media-type')==='application/oebps-package+xml');if(!rootfiles.length)throw invalid('未找到 package');
  const packagePath=attr(rootfiles[0],'full-path');if(!safeName(packagePath))throw invalid('package 路径不安全');
  const pkg=parseXML(files.get(packagePath),'package');if(pkg.documentElement?.namespaceURI!==NS.opf||pkg.documentElement.localName!=='package')throw invalid('package 命名空间错误');
  const manifest=new Map();for(const item of elements(pkg,'item')){const id=attr(item,'id');if(!id||manifest.has(id))throw invalid('manifest 标识缺失或重复');manifest.set(id,{...reference(packagePath,attr(item,'href')),type:attr(item,'media-type'),properties:attr(item,'properties').split(/\s+/u)});}
  const refs=elements(pkg,'itemref').filter(n=>attr(n,'linear')!=='no');if(!refs.length||refs.length>4000)throw invalid('阅读顺序缺失或超过 4000 项');
  const pages=[],used=new Set(),sha=hash(bytes);let chars=0;
  for(const [index,ref] of refs.entries()){const item=manifest.get(attr(ref,'idref'));if(!item||item.type!=='application/xhtml+xml')throw invalid('阅读顺序含不支持的内容，当前只支持 XHTML 正文');if(used.has(item.href))throw invalid('阅读顺序重复');used.add(item.href);const doc=parseXML(files.get(item.href),item.href,'application/xhtml+xml'),blocks=sourceBlocks(doc,item.href,sha);for(const block of blocks){chars+=block.text.length;if(chars>16000000)throw invalid('正文文字超过容量',413);}if(blocks.length)pages.push({page:null,href:item.href,title:blocks.find(b=>b.type==='epub_heading')?.text||'阅读片段 '+(pages.length+1),blocks});if(index%32===31||index===refs.length-1){await onProgress({completed:index+1,total:refs.length});await yieldToRequests();}}
  if(!pages.length)throw invalid('没有可阅读文字');
  const navItem=[...manifest.values()].find(item=>item.properties.includes('nav')),navigation=[];
  if(navItem){const doc=parseXML(files.get(navItem.href),'navigation','application/xhtml+xml'),toc=elements(doc,'nav').find(n=>(n.getAttributeNS(NS.epub,'type')||'').split(/\s+/u).includes('toc'));if(toc)for(const a of elements(toc,'a')){const target=reference(navItem.href,attr(a,'href')),title=plain(textOf(a));if(title&&used.has(target.href))navigation.push({...target,title:title.slice(0,120)});}}
  const metadata=elements(pkg,'metadata')[0],title=metadata&&plain(elements(metadata,'title')[0]?.textContent||''),author=metadata&&plain(elements(metadata,'creator')[0]?.textContent||'');
  const publicationDate=plain(elements(metadata,'date')[0]?.textContent||'');
  return {format:'epub',review:'extracted_unreviewed',processor:'epub-spine-v1',pages,navigation,title:title?.slice(0,500),author:author?.slice(0,500),...(/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(publicationDate)?{publicationDate}:{}),quality:{review:'extracted_unreviewed',navigation:navItem?'provided':'missing'}};
 }catch(error){if(error.status)throw error;throw invalid('ZIP 或内容无法解析，请检查文件是否完整');}
}

export function epubMetadata(bytes){
 const files=readArchive(bytes),container=parseXML(files.get('META-INF/container.xml'),'container'),root=elements(container,'rootfile').find(n=>attr(n,'media-type')==='application/oebps-package+xml'),file=root&&attr(root,'full-path');
 if(!safeName(file))throw invalid('package 路径不安全');
 const pkg=parseXML(files.get(file),'package'),metadata=elements(pkg,'metadata')[0];
 return {title:plain(elements(metadata,'title')[0]?.textContent||'').slice(0,500),author:plain(elements(metadata,'creator')[0]?.textContent||'').slice(0,500)};
}

// Evidence is text, never executable XHTML or an arbitrary filesystem path.
export function epubSourceEvidence(bytes,{href,elementId,blockIndex}){
 if(!safeName(href))throw invalid('来源路径不安全');const files=readArchive(bytes),doc=parseXML(files.get(href),href,'application/xhtml+xml'),blocks=sourceBlocks(doc,href,hash(bytes),true),block=elementId?blocks.find(b=>b.elementId===elementId):blocks[blockIndex];
 if(!block)throw invalid('无法定位来源元素，请保留待校对状态');return {href,sourceXML:block.sourceXML.slice(0,50000),truncated:block.sourceXML.length>50000};
}

// Reuse the same bounded ZIP and local-reference validation as source import.
export function extractEpubCover(bytes){
 const files=readArchive(bytes),container=parseXML(files.get('META-INF/container.xml'),'container');
 const root=elements(container,'rootfile').find(node=>attr(node,'media-type')==='application/oebps-package+xml'),packagePath=root&&attr(root,'full-path');
 if(!safeName(packagePath))throw invalid('package 路径不安全');
 const pkg=parseXML(files.get(packagePath),'package'),items=elements(pkg,'item');
 const legacy=elements(pkg,'meta').find(node=>attr(node,'name')==='cover');
 const item=items.find(node=>attr(node,'properties').split(/\s+/u).includes('cover-image'))||items.find(node=>legacy&&attr(node,'id')===attr(legacy,'content'));
 if(!item||!['image/jpeg','image/png'].includes(attr(item,'media-type')))return null;
 const target=reference(packagePath,attr(item,'href')),data=files.get(target.href);
 return data?Buffer.from(data):null;
}
