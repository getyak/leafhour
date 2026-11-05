import {randomUUID} from 'node:crypto';
import {executionAuthority} from './execution-gateway.mjs';
import {mediaConfiguration} from '../../server/media-config.mjs';
import {configuredCapabilities} from '../../packages/contracts/runtime-config.mjs';
export function createRemoteProviders({gateway,env=process.env}={}){
 const capabilities=new Set(configuredCapabilities(env));const generate=type=>capabilities.has(type)?gateway.generator(type):null;
 const person=generate('person');if(person)person.available=true;
 const speech=generate('speech'),media=mediaConfiguration(env);
 const cover=generate('cover'),translation=generate('translation');
 const ocr=method=>generate('ocr-'+method);
 const local=type=>generate(type)||(async()=>{throw Object.assign(Error('document_processing_not_configured'),{status:503});});
 const extract=local('document-extract'),metadata=local('document-metadata'),structure=local('pdf-structure'),split=local('pdf-split'),inspect=local('pdf-inspect');
 return {
  documentExtractor:({signal,onProgress,...input})=>extract({...input,signal,requestId:randomUUID()}),documentMetadata:(bytes,options)=>metadata({bytes,...options,requestId:randomUUID()}),pdfProcessor:{structure:(bytes,options={})=>structure({bytes,...options,requestId:randomUUID()}),split:async(bytes,indices)=>(await split({bytes,indices,requestId:randomUUID()})).bytes,inspect:(bytes,options)=>inspect({bytes,options,requestId:randomUUID()})},
  agentSearchWeb:capabilities.has('web-search')?async()=>{const result=executionAuthority()?.webResult;if(!result)throw Error('Remote search result unavailable');return result;}:null,chatGenerator:generate('chat'),annotationGenerator:generate('annotation'),companionGenerator:generate('companion'),introductionGenerator:generate('introduction'),readingGuideGenerator:generate('reading-guide'),notebookGenerator:generate('notebook'),personGenerator:person,
  translator:translation?(context,{signal}={})=>translation({context,bookId:context.bookId,contentVersion:context.sourceVersion,requestId:[context.bookId,context.passageId,context.targetLanguage,context.sourceVersion].join(':'),signal}):null,
  giftQuoteGenerator:generate('gift-quote'),dialogueGenerator:generate('dialogue'),guideGenerator:generate('listening-guide'),
  coverGenerator:cover?book=>cover({book}):null,
  speechProvider:{available:!!speech,model:media.public.speechModel,synthesize:speech||(async()=>{throw Object.assign(Error('speech_not_configured'),{status:503});})},
  paddleProvider:['submit','recover','status','result'].every(method=>ocr(method))?{submit:(bytes,options)=>ocr('submit')({bytes,options,requestId:options?.batchId||randomUUID()}),recover:batchId=>ocr('recover')({batchId,requestId:randomUUID()}),status:handle=>ocr('status')({handle,requestId:randomUUID()}),result:handle=>ocr('result')({handle,requestId:randomUUID()})}:null
 };
}
