// GET-202 pinned Vale installer.
//
// Downloads (or accepts a locally staged copy of) the exact Vale v3.24.0
// upstream archive for one pinned platform/architecture, verifies its SHA256
// against the upstream release checksum BEFORE extraction, and extracts only
// the `vale` executable. Archive entries that try to escape the destination
// are rejected. No third-party installer action is involved; CI runs this
// script with explicit destination and checksum.
import {readFile,writeFile,mkdir,chmod,access} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export const RELEASE_VERSION='3.24.0';
export const RELEASE_ASSETS=Object.freeze({
  'darwin/arm64':{file:'vale_3.24.0_macOS_arm64.tar.gz',sha256:'87b513f26499f6657c15cf7175ba5b058a7c1ff2bb2d4e07265db2dd43451e44'},
  'darwin/x64':{file:'vale_3.24.0_macOS_64-bit.tar.gz',sha256:'eeb39e86f1daac27cc2a77fef3af1824d50559bdc22329fb25fb921c80c79472'},
  'linux/arm64':{file:'vale_3.24.0_Linux_arm64.tar.gz',sha256:'104cbd349279e50c4cb40adb70adf345d93cc4a3a0191f9e68bdccb97086b582'},
  'linux/x64':{file:'vale_3.24.0_Linux_64-bit.tar.gz',sha256:'867534ddb678abca7f214bc4706ead0922bd5252ffe8035fc227013f66c8b214'}
});
for(const asset of Object.values(RELEASE_ASSETS)){
  asset.url='https://github.com/vale-cli/vale/releases/download/v'+RELEASE_VERSION+'/'+asset.file;
}

function readString(buffer,start,length){
  const slice=buffer.subarray(start,start+length);
  const end=slice.indexOf(0);
  return slice.subarray(0,end===-1?slice.length:end).toString('utf8');
}
function readOctal(buffer,start,length){
  const text=readString(buffer,start,length).trim();
  if(!/^[0-7]+$/.test(text))throw Error('Unsupported tar header encoding; refusing to guess');
  return parseInt(text,8);
}

export function readTarEntries(archive){
  const entries=[];
  let offset=0;
  while(offset+512<=archive.length){
    const header=archive.subarray(offset,offset+512);
    if(header.every(byte=>byte===0))break;
    const name=readString(header,0,100);
    const prefix=readString(header,345,155);
    const size=readOctal(header,124,12);
    const mode=readOctal(header,100,8);
    const typeflag=String.fromCharCode(header[156]||48);
    const dataStart=offset+512;
    if(dataStart+size>archive.length)throw Error('Truncated tar archive');
    entries.push({name:prefix?prefix+'/'+name:name,size,mode,typeflag,data:archive.subarray(dataStart,dataStart+size)});
    offset=dataStart+Math.ceil(size/512)*512;
  }
  return entries;
}

function assertSafeEntryName(name){
  if(!name||name.startsWith('/')||name.startsWith('\\')||/^[A-Za-z]:/.test(name)||name.split(/[\\/]/).includes('..')){
    throw Error('Archive entry tries path traversal outside the destination: '+name);
  }
}

async function fetchArchive(url){
  const response=await fetch(url);
  if(!response.ok)throw Error('Upstream download failed with status '+response.status+' for '+url);
  return Buffer.from(await response.arrayBuffer());
}

export async function installVale({dest,platform,arch,archive,sha256}={}){
  if(!dest)throw Error('installVale requires an explicit destination directory');
  const key=platform+'/'+arch;
  const asset=RELEASE_ASSETS[key];
  if(!asset){
    if(!RELEASE_ASSETS[platform+'/x64']&&!RELEASE_ASSETS[platform+'/arm64'])throw Error('Unsupported platform for the pinned Vale release: '+String(platform));
    throw Error('Unsupported architecture for the pinned Vale release: '+String(arch)+' on '+String(platform));
  }
  const expected=sha256||asset.sha256;
  if(!/^[a-f0-9]{64}$/.test(String(expected)))throw Error('A full upstream SHA256 checksum is required');
  let bytes;
  if(archive){
    bytes=await readFile(archive);
  }else{
    bytes=await fetchArchive(asset.url);
  }
  const actual=createHash('sha256').update(bytes).digest('hex');
  if(actual!==expected)throw Error('Checksum mismatch for '+asset.file+': expected '+expected+' got '+actual);
  const entries=readTarEntries(gunzipSync(bytes));
  for(const entry of entries)assertSafeEntryName(entry.name);
  const executable=entries.find(entry=>entry.name==='vale'&&(entry.typeflag==='0'||entry.typeflag==='\0'||entry.typeflag===''));
  if(!executable||executable.size===0)throw Error('Archive contains no vale executable to extract');
  await mkdir(dest,{recursive:true});
  const target=path.join(dest,'vale');
  await writeFile(target,executable.data);
  await chmod(target,0o755);
  await access(target);
  return {file:target,bytes:executable.size,sha256:actual,source:archive?'local archive':asset.url};
}

async function main(argv){
  const options={dest:null,platform:process.platform,arch:process.arch,archive:null,sha256:null};
  for(let i=0;i<argv.length;i++){
    const argument=argv[i];
    if(argument==='--dest')options.dest=argv[++i];
    else if(argument==='--platform')options.platform=argv[++i];
    else if(argument==='--arch')options.arch=argv[++i];
    else if(argument==='--archive')options.archive=argv[++i];
    else if(argument==='--sha256')options.sha256=argv[++i];
    else throw Error('Unknown argument: '+argument);
  }
  if(!options.dest)throw Error('--dest is required (explicit destination directory)');
  const result=await installVale(options);
  console.log('Installed pinned Vale '+RELEASE_VERSION+' to '+result.file+' ('+result.bytes+' bytes, sha256 '+result.sha256+' from '+result.source+').');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  await main(process.argv.slice(2));
}
