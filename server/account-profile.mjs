import {mkdir,readFile,writeFile,rename,unlink} from 'node:fs/promises';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {digest,fail} from './document-import.mjs';

const MAX_AVATAR_BYTES=100*1024,MAX_NAME_LENGTH=80,queues=new Map();
const controls=/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/;
const own=(value,key)=>Object.hasOwn(value,key);
function providerName(value){return typeof value==='string'?[...value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g,'').trim()].slice(0,MAX_NAME_LENGTH).join(''):'';}
export function safeProviderAvatar(value){
  if(typeof value!=='string'||!value||value.length>2048||/[\s\u0000-\u001f\u007f]/.test(value))return null;
  try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password?url.href:null;}catch{return null;}
}
// Only these presentation fields may leave provider metadata with the public identity.
export function providerProfile(user){
  const metadata=user?.user_metadata||{};
  return {displayName:providerName(metadata.full_name)||providerName(metadata.name),avatarUrl:safeProviderAvatar(metadata.avatar_url)||safeProviderAvatar(metadata.picture)};
}
function displayName(value){
  if(typeof value!=='string'||[...value].length>MAX_NAME_LENGTH||controls.test(value))throw fail('称呼请使用 80 字以内的单行文字');
  return value.trim();
}
function pngRaster(bytes){
  if(bytes.length<45||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return false;
  let cursor=8,hasHeader=false,hasPixels=false;
  while(cursor+12<=bytes.length){
    const size=bytes.readUInt32BE(cursor),type=bytes.toString('ascii',cursor+4,cursor+8),end=cursor+12+size;if(end>bytes.length)return false;
    if(!hasHeader){if(type!=='IHDR'||size!==13)return false;const width=bytes.readUInt32BE(cursor+8),height=bytes.readUInt32BE(cursor+12);if(!width||!height||width>4096||height>4096)return false;hasHeader=true;}
    else if(type==='IHDR')return false;
    if(type==='IDAT'&&size>0)hasPixels=true;
    if(type==='IEND')return size===0&&hasPixels&&end===bytes.length;
    cursor=end;
  }
  return false;
}
function jpegRaster(bytes){
  if(bytes.length<16||bytes[0]!==255||bytes[1]!==216||bytes.at(-2)!==255||bytes.at(-1)!==217)return false;
  let cursor=2,hasFrame=false;
  while(cursor+4<=bytes.length){
    if(bytes[cursor++]!==255)return false;while(bytes[cursor]===255)cursor++;const marker=bytes[cursor++];
    if(marker===217||marker===0)return false;if(marker===1||(marker>=208&&marker<=215))continue;
    if(cursor+2>bytes.length)return false;const size=bytes.readUInt16BE(cursor);if(size<2||cursor+size>bytes.length)return false;
    if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)){
      if(size<8)return false;const height=bytes.readUInt16BE(cursor+3),width=bytes.readUInt16BE(cursor+5);if(!height||!width||height>4096||width>4096)return false;hasFrame=true;
    }
    if(marker===218)return hasFrame&&size>=6&&cursor+size<bytes.length-2;
    cursor+=size;
  }
  return false;
}
function webpRaster(bytes){
  if(bytes.length<25||bytes.toString('ascii',0,4)!=='RIFF'||bytes.readUInt32LE(4)!==bytes.length-8||bytes.toString('ascii',8,12)!=='WEBP')return false;
  let cursor=12,hasPixels=false;
  while(cursor+8<=bytes.length){
    const type=bytes.toString('ascii',cursor,cursor+4),size=bytes.readUInt32LE(cursor+4),start=cursor+8,end=start+size;if(end>bytes.length)return false;
    if(type==='VP8 '){
      if(size<10||!bytes.subarray(start+3,start+6).equals(Buffer.from([157,1,42])))return false;const width=bytes.readUInt16LE(start+6)&16383,height=bytes.readUInt16LE(start+8)&16383;if(!width||!height||width>4096||height>4096)return false;hasPixels=true;
    }else if(type==='VP8L'){
      if(size<5||bytes[start]!==47)return false;const bits=bytes.readUInt32LE(start+1),width=(bits&16383)+1,height=((bits>>>14)&16383)+1;if(bits>>>29||width>4096||height>4096)return false;hasPixels=true;
    }else if(type==='VP8X'){
      if(size!==10||bytes.readUIntLE(start+4,3)+1>4096||bytes.readUIntLE(start+7,3)+1>4096)return false;
    }
    cursor=end+(size%2);
  }
  return hasPixels&&cursor===bytes.length;
}
function avatarData(value){
  if(value===null)return null;
  if(typeof value!=='string')throw fail('请选择 JPG、PNG 或 WebP 图片');
  if(value.length>Math.ceil(MAX_AVATAR_BYTES/3)*4+64)throw fail('头像请控制在 100 KB 以内',413);
  const match=value.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/);
  if(!match||match[2].length%4!==0)throw fail('头像图片格式无效，请重新选择');
  const bytes=Buffer.from(match[2],'base64');
  if(!bytes.length||bytes.length>MAX_AVATAR_BYTES)throw fail('头像请控制在 100 KB 以内',413);
  if(bytes.toString('base64')!==match[2])throw fail('头像图片不完整，请重新选择');
  if(!({png:pngRaster,jpeg:jpegRaster,webp:webpRaster})[match[1]](bytes))throw fail('头像图片格式与内容不一致，请重新选择');
  return value;
}
function accountFile(dataDir,user){
  if(typeof user?.id!=='string'||!user.id||user.id.length>512||controls.test(user.id))throw fail('请先进入自己的书房',401);
  return path.join(dataDir,'users',digest(user.id),'profile.json');
}
function publicProfile(user,data){
  let name='',avatar=null;
  try{if(own(data,'displayName'))name=displayName(data.displayName);}catch{}
  try{if(own(data,'avatarData'))avatar=avatarData(data.avatarData);}catch{}
  return {displayName:name||providerName(user.displayName),avatarUrl:avatar||safeProviderAvatar(user.avatarUrl)};
}
export function createAccountProfile({dataDir,dataStore=null}={}){
  if(typeof dataDir!=='string'||!dataDir)throw Error('Account profile data directory is required');
  async function read(file){
    if(dataStore)return (await dataStore.read(file,{}))||{};
    try{return JSON.parse(await readFile(file,'utf8'));}catch(error){if(error.code==='ENOENT')return {};throw error;}
  }
  async function mutate(file,operation){
    if(dataStore)return dataStore.mutate(file,{},operation);
    const previous=queues.get(file)||Promise.resolve(),work=previous.catch(()=>{}).then(async()=>{
      const data=await read(file),result=operation(data),pending=file+'.'+randomUUID()+'.pending';
      await mkdir(path.dirname(file),{recursive:true,mode:0o700});
      try{await writeFile(pending,JSON.stringify(data),{mode:0o600});await rename(pending,file);}finally{await unlink(pending).catch(error=>{if(error.code!=='ENOENT')throw error;});}
      return result;
    });
    queues.set(file,work);try{return await work;}finally{if(queues.get(file)===work)queues.delete(file);}
  }
  async function get(user){return publicProfile(user,await read(accountFile(dataDir,user)));}
  async function save(user,input){
    const file=accountFile(dataDir,user);
    if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(key=>!['displayName','avatarData'].includes(key)))throw fail('只能保存称呼和头像');
    const update={};if(own(input,'displayName'))update.displayName=displayName(input.displayName);if(own(input,'avatarData'))update.avatarData=avatarData(input.avatarData);
    return mutate(file,data=>{data.schemaVersion=1;for(const [key,value]of Object.entries(update)){if(value===null||value==='')delete data[key];else data[key]=value;}return publicProfile(user,data);});
  }
  return {get,save};
}
