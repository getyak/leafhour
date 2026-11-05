import {extractDocument} from '../../server/document-import.mjs';
import {epubMetadata} from '../../server/epub-import.mjs';
import {deriveImportedCover} from '../../server/imported-cover.mjs';
import {inspectNativePdf,nativePdfOutline} from '../../server/pdf-native.mjs';
import {PDFDocument} from 'pdf-lib';
import {createWebSearch} from '../../server/reading-agent-search.mjs';
import {createChatGenerator} from '../../harness/chat-generator.mjs';
import {createCompanionGenerator} from '../../harness/companion-generator.mjs';
import {createIntroductionGenerator} from '../../harness/introduction-generator.mjs';
import {createReadingGuideGenerator} from '../../harness/reading-guide-generator.mjs';
import {createNotebookGenerator} from '../../harness/notebook-generator.mjs';
import {createPersonGenerator} from '../../harness/person-generator.mjs';
import {createReaderChatGenerator,createReaderAnnotationGenerator} from '../../server/reader-chat-generator.mjs';
import {createTranslator} from '../../server/translation.mjs';
import {createDeepSeekGiftQuoteGenerator} from '../../server/gift-quote.mjs';
import {createSpeechProvider} from '../../server/audio-provider.mjs';
import {createDialogueGenerator} from '../../server/dialogue-generator.mjs';
import {createGuideGenerator} from '../../server/listening-guide-generator.mjs';
import {createCoverGenerator} from '../../server/generated-cover.mjs';
import {createPaddleProvider} from '../../server/paddleocr.mjs';
export function createAgentProviders({env=process.env}={}){
 const handlers={
  'document-extract':job=>extractDocument({filename:job.filename,bytes:job.bytes,...(job.textStructure===undefined?{}:{textStructure:job.textStructure})}),
  'document-metadata':async job=>({metadata:/\.epub$/i.test(job.filename)?epubMetadata(job.bytes):null,cover:await deriveImportedCover(job.bytes,job.format).catch(()=>null)}),
  'pdf-structure':async job=>{const doc=await PDFDocument.load(job.bytes,{updateMetadata:false});return {pageCount:doc.getPageCount(),outline:job.outline?await nativePdfOutline(job.bytes).catch(()=>[]):[]};},
  'pdf-split':async job=>{const doc=await PDFDocument.load(job.bytes,{updateMetadata:false}),part=await PDFDocument.create();(await part.copyPages(doc,job.indices)).forEach(page=>part.addPage(page));return {bytes:Buffer.from(await part.save())};},
  'pdf-inspect':job=>inspectNativePdf(job.bytes)
 };
 if(env.DEEPSEEK_API_KEY){
  const search=createWebSearch({env});handlers['web-search']=job=>search(job.query,{signal:job.signal,reserveRequest:job.reserveRequest});
  Object.assign(handlers,{chat:createReaderChatGenerator({env}),annotation:createReaderAnnotationGenerator({env}),companion:createCompanionGenerator({env}),introduction:createIntroductionGenerator({env}),'reading-guide':createReadingGuideGenerator({env}),notebook:createNotebookGenerator({env}),person:createPersonGenerator({env}),'gift-quote':createDeepSeekGiftQuoteGenerator({env}),dialogue:createDialogueGenerator({env}),'listening-guide':createGuideGenerator({env})});
  const translate=createTranslator(env);handlers.translation=job=>translate(job.context,{signal:job.signal});
 }
 const speech=createSpeechProvider({env});if(speech.available)handlers.speech=job=>speech.synthesize(job);
 const cover=createCoverGenerator(env);if(cover)handlers.cover=job=>cover(job.book);
 const ocr=createPaddleProvider({env});if(ocr){handlers['ocr-submit']=job=>ocr.submit(job.bytes,job.options);handlers['ocr-recover']=job=>ocr.recover(job.batchId);handlers['ocr-status']=job=>ocr.status(job.handle);handlers['ocr-result']=job=>ocr.result(job.handle);}
 return handlers;
}
