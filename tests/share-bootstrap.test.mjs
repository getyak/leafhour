import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
test('the first share gesture freezes its selected content before loading the panel',async()=>{
 const source=await readFile(new URL('../app/share-bootstrap.mjs',import.meta.url),'utf8');
 class Button extends EventTarget { disabled=false;click(){this.dispatchEvent(new Event('click'));}focus(){} }
 const button=new Button(),seen=[];button.id='share-passage';let resolvePanel;
 let selection={bookId:'b',contentVersion:'v',chapterId:'c',parts:[{passageId:'p',text:'explicit first selection'}]};
 const pending=new Promise(r=>resolvePanel=r),reader={getShareIntent:()=>selection,getOwner:()=> 'owner',getAnchor:()=>({passageId:'p'})};
 const document={getElementById:id=>id==='share-passage'?button:null,createElement:()=>({remove(){}}),head:{append(link){queueMicrotask(()=>link.onload());}}};
 vm.runInNewContext(source.replace("import('./share.js')",'loadPanel()'),{document,window:{marginaliaReader:reader},structuredClone,loadPanel:()=>pending,Promise});
 button.click();selection.parts[0].text='different later selection';
 resolvePanel({openShareIntent(intent){seen.push(intent);}});await new Promise(setImmediate);
 assert.equal(seen.length,1);assert.equal(seen[0].snapshot.parts[0].text,'explicit first selection');assert.equal(seen[0].owner,'owner');
});
