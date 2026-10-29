import {readFile,readdir,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
const pin='34548dca28a523e775672c27212870d890eb7b7430213236d6b202459a494027';
const markdownPin='85841000eac2ee95baafb236fae232c44629814dce0cc6a3c44068f307723e78';
const sha256=data=>createHash('sha256').update(data).digest('hex');
export async function verifyIOSVendor(input=new URL('../apps/ios/Vendor/ZIPFoundation/',import.meta.url)) {
  return verifyVendor(input,pin,'ZIPFoundation 0.9.20');
}
export async function verifyIOSMarkdownVendor(input=new URL('../apps/ios/Vendor/swift-cmark/',import.meta.url)) {
  return verifyVendor(input,markdownPin,'Swift cmark 0.6.0');
}
async function verifyVendor(input,expectedPin,dependency) {
  const root=input instanceof URL?fileURLToPath(input):path.resolve(input);
  const bytes=await readFile(path.join(root,'UPSTREAM.json'));
  if(sha256(bytes)!==expectedPin)throw Error('Native dependency provenance differs from the reviewed '+dependency+' pin');
  const manifest=JSON.parse(bytes);
  const expected=new Set(['UPSTREAM.json',...manifest.files.map(x=>x.path)]);
  async function walk(dir,prefix='') {
    for(const item of await readdir(dir,{withFileTypes:true})) {
      const relative=prefix+item.name,file=path.join(dir,item.name);
      if((await lstat(file)).isSymbolicLink())throw Error('Native dependency contains a symbolic link');
      if(item.isDirectory()){if(['.build','.swiftpm'].includes(item.name))continue;await walk(file,relative+'/');}
      else if(!expected.has(relative))throw Error('Unexpected native dependency source: '+relative);
    }
  }
  await walk(root);
  for(const file of manifest.files) {
    if(file.path.includes('..')||path.isAbsolute(file.path))throw Error('Invalid provenance path');
    const data=await readFile(path.join(root,file.path));
    const blob=createHash('sha1').update(Buffer.from('blob '+data.length+'\0')).update(data).digest('hex');
    if(data.length!==file.bytes||sha256(data)!==file.sha256||blob!==file.git_blob)throw Error('Native dependency source mismatch: '+file.path);
  }
  return {version:manifest.version,commit:manifest.commit,files:manifest.files.length};
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)console.log(JSON.stringify(await Promise.all([verifyIOSVendor(),verifyIOSMarkdownVendor()])));
