import {readFile} from 'node:fs/promises';
const manifest=JSON.parse(await readFile(new URL('../app/fonts/document-export/manifest.json',import.meta.url),'utf8'));
if(manifest.fonts.length!==89||manifest.fonts.some(f=>!/^export-\d{3}\.ttf$/.test(f.file)))throw Error('Invalid export font assets');
export const documentExportAssets=['fonts/document-export/manifest.json',...manifest.fonts.map(f=>'fonts/document-export/'+f.file)];
