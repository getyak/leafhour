export function audioBook(){return {bookId:'audio-book',contentVersion:'v1',title:{zh:'听读小样',en:'Audio sample'},chapters:[{id:'ch1',number:1},{id:'ch2',number:2}],sections:[{id:'s1',chapterId:'ch1',paragraphs:[{id:'p1',original:'Read 😀 this carefully.',translations:{literal:{text:'仔细读😀这一句。'},interpretive:{text:'把这句话认真读一遍。'}}},{id:'p2',original:'Then ask a question.',translations:{}}]},{id:'s2',chapterId:'ch2',paragraphs:[{id:'p3',original:'Another chapter.',translations:{}}]}]};}
export const audioSelection={contentVersion:'v1',chapterId:'ch1',language:'en',variant:'interpretive',parts:[{passageId:'p1',start:0,end:4,text:'Read',language:'en'}]};

export function pcmWav(samples=2400){
 const bytes=Buffer.alloc(44+samples*2);bytes.write('RIFF',0);bytes.writeUInt32LE(bytes.length-8,4);bytes.write('WAVEfmt ',8);bytes.writeUInt32LE(16,16);bytes.writeUInt16LE(1,20);bytes.writeUInt16LE(1,22);bytes.writeUInt32LE(24000,24);bytes.writeUInt32LE(48000,28);bytes.writeUInt16LE(2,32);bytes.writeUInt16LE(16,34);bytes.write('data',36);bytes.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)bytes.writeInt16LE(Math.round(Math.sin(i*2*Math.PI*440/24000)*1000),44+i*2);return bytes;
}
export function geminiSpeechResponse(bytes=pcmWav(),overrides={}){return {id:'gemini-generation',status:'completed',steps:[{type:'model_output',content:[{type:'audio',mime_type:'audio/wav',data:bytes.toString('base64')}]}],...overrides};}
