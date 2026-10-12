import {readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {buildExperiencePack} from '../harness/content-pack.mjs';
import {validatePack,sourceIndex} from '../server/experience-validation.mjs';
const bookPath=path.resolve(process.env.READER_BOOK_PATH||'local/finite-infinite-games/book.json');
const book=JSON.parse(await readFile(bookPath,'utf8')),pack=buildExperiencePack(book),checked=validatePack(pack,book,sourceIndex(book));
if(Object.keys(checked.xrays).length!==Object.keys(pack.xrays).length||checked.cards.length!==pack.cards.length)throw Error('Experience source validation failed');
await writeFile(path.join(path.dirname(bookPath),'experience-pack.json'),JSON.stringify(pack),{mode:0o600});
console.log(JSON.stringify({sourceOutlines:Object.keys(pack.xrays).length,chapterCards:pack.cards.length,modelCalls:0}));
