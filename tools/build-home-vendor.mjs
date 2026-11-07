// Rebuild: npm install --prefix /tmp/leafhour-home-vendor --ignore-scripts
// three@0.187.0 gsap@3.14.2; node tools/build-home-vendor.mjs /tmp/leafhour-home-vendor
import {build} from 'esbuild';
import {readFile,copyFile,mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
const source=path.resolve(process.argv[2]||'/tmp/leafhour-home-vendor');
const target=new URL('../app/vendor/',import.meta.url);
await mkdir(target,{recursive:true});
for(const [name,version]of [['three','0.187.0'],['gsap','3.14.2']]){
 const pkg=JSON.parse(await readFile(path.join(source,'node_modules',name,'package.json'),'utf8'));
 if(pkg.version!==version)throw Error('Unexpected vendor version: '+name);
 if(name==='three')await copyFile(path.join(source,'node_modules',name,'LICENSE'),new URL(name+'-LICENSE.txt',target));
 else await writeFile(new URL('gsap-LICENSE.txt',target),'GSAP '+version+'\nCopyright GreenSock. All rights reserved.\nDistributed under the Standard License: https://gsap.com/standard-license/\nThe original copyright and license notices are retained in gsap-scroll.mjs.\n');
}
for(const [name,contents]of [
 ['three-scene',"export {Scene,PerspectiveCamera,WebGLRenderer,Group,Mesh,PlaneGeometry,BoxGeometry,MeshStandardMaterial,AmbientLight,DirectionalLight,DoubleSide,Color,BufferGeometry,Float32BufferAttribute,Line,LineBasicMaterial,SRGBColorSpace} from 'three';"],
 ['gsap-scroll',"export {gsap} from 'gsap'; export {ScrollTrigger} from 'gsap/ScrollTrigger';"]
])await build({stdin:{contents,resolveDir:source},outfile:new URL(name+'.mjs',target).pathname,bundle:true,format:'esm',minify:true,legalComments:'eof',target:['es2022']});
