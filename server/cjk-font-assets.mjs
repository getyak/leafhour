import {readFile} from 'node:fs/promises';

// Fixed public software assets, never a caller-controlled directory traversal.
const manifest=JSON.parse(await readFile(new URL('../app/fonts/noto-serif-sc/manifest.json',import.meta.url),'utf8'));
if(!Array.isArray(manifest.fonts)||manifest.fonts.length!==88||new Set(manifest.fonts.map(font=>font.file)).size!==88||manifest.fonts.some(font=>!/^noto-serif-sc-\d{3}\.woff2$/.test(font.file)))throw Error('Invalid bundled CJK font asset list');
export const cjkFontAssets=Object.freeze(['font-faces.css','OFL.txt',...manifest.fonts.map(font=>font.file)].map(file=>Object.freeze({url:'/fonts/noto-serif-sc/'+file,file:'fonts/noto-serif-sc/'+file,mime:file.endsWith('.woff2')?'font/woff2':file.endsWith('.css')?'text/css':'text/plain'})));
