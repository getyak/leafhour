import {buildShareModel} from './share-model.mjs';
import {quotePanelSourceNodes} from './passage-layers.mjs';

export function originalSelectionParts(book,snapshot){
 const {blocks}=buildShareModel(book,snapshot,{language:'en'});
 return blocks.map(block=>({passageId:block.passageId,language:'en',start:block.selectionAligned?block.sourceStart:0,end:block.selectionAligned?block.sourceEnd:block.primary.text.length,text:block.primary.text,wholePassage:block.sourceLanguage!=='en'}));
}

export function mountReaderSelectionOriginal({document,dialog,content,listen,write,getBook,getExcerpt,isVisible,onOpen}){
 const close=()=>{if(dialog.open)dialog.close();content.replaceChildren();};
 listen(dialog,'close',()=>content.replaceChildren());
 for(const event of ['reader:chapter','reader:jump','reader:page','reader:layout','reader:session-changed'])listen(document,event,close);
 return {
  open(){
   const book=getBook(),snapshot=structuredClone(getExcerpt());
   if(!isVisible(snapshot))throw Error('selection changed');
   const parts=originalSelectionParts(book,snapshot);
   content.replaceChildren();
   const originals=new Map(book.sections.flatMap(section=>section.paragraphs.map(p=>[p.id,p.original])));
   for(const part of parts){
    const section=document.createElement('section'),label=document.createElement('p'),quote=document.createElement('blockquote');
    section.className='reading-source';write(label,'reader.selection.'+(part.wholePassage?'wholeOriginal':'exactOriginal'));
    quote.lang=book.sourceLanguage||'en';
    quote.append(...quotePanelSourceNodes(document,{book,snapshot,parts:[part],originalFor:part=>originals.get(part.passageId)}).nodes);
    section.append(label,quote);content.append(section);
   }
   if(!dialog.open)dialog.showModal();onOpen();
  },
  dispose:close
 };
}
